import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ActionContext, type ActionRegistry, type Blueprint, detectLanguage, FlowRunner, type RunResult, type SessionState } from "@ordr/flow-schema";
import { type InboundContent, type InboundEvent, type InboundMessage, type InboundStatus, type MessageSender, type OutboundMessage, text } from "@ordr/whatsapp";
import type { Customer } from "@ordr/domain";
import { COPY, t } from "../actions/copy";
import { conversationStyle } from "../ai/agent";
import { AssistantService } from "../ai/assistant.service";
import type { AppConfig } from "../config";
import type { BlueprintRegistry, ConversationRepository, DedupeStore, SessionStore, TenantContext, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";

const APOLOGY: Record<string, string> = {
  en: "Sorry, something went wrong on our side. Please send \"menu\" to try again.",
  ar: "عذراً، حدث خطأ من جانبنا. يرجى إرسال \"القائمة\" للمحاولة مرة أخرى.",
};

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  private readonly runners = new Map<string, FlowRunner>();

  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.SessionStore) private readonly sessions: SessionStore,
    @Inject(TOKENS.DedupeStore) private readonly dedupe: DedupeStore,
    @Inject(TOKENS.MessageSender) private readonly sender: MessageSender,
    @Inject(TOKENS.ActionRegistry) private readonly actions: ActionRegistry,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(AssistantService) private readonly assistant: AssistantService,
  ) {}

  async handleEvent(event: InboundEvent): Promise<void> {
    if (event.type === "status") return this.handleStatus(event);
    return this.handleMessage(event);
  }

  private async handleStatus(event: InboundStatus): Promise<void> {
    await this.conversations.updateMessageStatus(event.messageId, event.status);
  }

  private async handleMessage(event: InboundMessage): Promise<void> {
    const ctx = await this.tenants.findByPhoneNumberId(event.phoneNumberId);
    if (!ctx) {
      this.logger.warn(`no tenant for phone_number_id ${event.phoneNumberId}; ignoring message ${event.messageId}`);
      return;
    }
    if (!(await this.dedupe.claim(`wamid:${event.messageId}`, this.config.DEDUPE_TTL_SECONDS))) {
      this.logger.debug(`duplicate webhook for ${event.messageId}`);
      return;
    }

    const { tenant, channel } = ctx;
    const blueprint = this.blueprints.get(tenant.blueprintId);
    if (!blueprint) {
      this.logger.error(`tenant ${tenant.id} references unknown blueprint "${tenant.blueprintId}"`);
      return;
    }

    const customer = await this.conversations.upsertCustomer(tenant.id, event.from, event.profileName);
    const conversation = await this.conversations.getOrCreateOpenConversation(tenant.id, customer.id, channel.id);
    const receivedAt = new Date(event.timestamp * 1000);
    await this.conversations.recordMessage({
      tenantId: tenant.id,
      conversationId: conversation.id,
      direction: "in",
      providerMessageId: event.messageId,
      kind: event.content.kind,
      payload: event.content,
      createdAt: receivedAt,
    });
    await this.conversations.touchInbound(conversation.id, receivedAt);
    this.markRead(ctx, event.messageId);

    const runner = this.runnerFor(blueprint);
    const session = await this.sessions.get(tenant.id, event.from);
    const globalFlow = runner.matchGlobalCommand(event.content);

    if (!globalFlow && conversation.status === "human") {
      // An agent owns this thread. The bot stays quiet until the customer asks for the menu.
      return;
    }

    const language =
      session?.language ??
      customer.language ??
      (event.content.kind === "text"
        ? detectLanguage(event.content.text, blueprint.languages, tenant.defaultLanguage)
        : tenant.defaultLanguage);
    const baseContext = {
      tenant: { id: tenant.id, name: tenant.name },
      customer: { id: customer.id, waId: customer.waId, name: customer.name ?? "" },
    };
    const actionCtx = { tenantId: tenant.id, customer: { id: customer.id, waId: customer.waId, name: customer.name }, conversationId: conversation.id };

    const natural = conversationStyle(tenant, blueprint) === "natural" && this.assistant.conversational;
    const asText = natural ? textOf(event.content) : null;

    let result: RunResult;
    try {
      if (natural && asText !== null && !(session?.awaiting && event.content.kind !== "text")) {
        // Natural style: Claude answers like a staff member, booking through tools. A tapped button from an
        // older guided message still goes to its flow; everything else is a conversation.
        result = await this.converse(runner, blueprint, tenant, customer, conversation.id, asText, language, baseContext, actionCtx, { channel: channel.provider === "web" ? "web" : "whatsapp", inboundMessageId: event.messageId });
      } else if (globalFlow) {
        if (conversation.status === "human") await this.conversations.setConversationStatus(conversation.id, "bot");
        // Jumping to "menu" or "cart" must not throw away what the customer has already picked.
        const carried = session?.context.cart ? { cart: session.context.cart } : {};
        result = await runner.start(globalFlow, { language, context: { ...baseContext, ...carried } }, actionCtx);
      } else if (session?.awaiting) {
        // Free text the question does not accept: let the assistant map it onto one of the options shown.
        const content = await this.resolveAnswer(runner, session, event.content, language);
        result = await runner.resume(session, content, actionCtx);
      } else {
        const entry = blueprint.fallbackFlow ?? blueprint.entryFlow;
        const understood = event.content.kind === "text" ? await this.assistant.interpret(tenant, blueprint, conversation.id, event.content.text, language) : null;
        if (understood?.flow && understood.flow !== entry) {
          const preface = understood.reply ? [text(understood.reply)] : [];
          const started = await runner.start(understood.flow, { language, context: baseContext }, actionCtx);
          result = { ...started, outbound: [...preface, ...started.outbound] };
        } else if (understood?.reply && !understood.flow) {
          // A question answered from tenant facts; no flow to run.
          result = { outbound: [text(understood.reply)], session: null, handoff: false, completed: true };
        } else {
          result = await runner.start(entry, { language, context: baseContext }, actionCtx);
        }
      }
    } catch (err) {
      this.logger.error(`flow error for tenant ${tenant.id}, customer ${event.from}: ${err instanceof Error ? err.stack : String(err)}`);
      await this.sessions.delete(tenant.id, event.from);
      await this.deliver(ctx, conversation.id, event.from, [text(APOLOGY[language] ?? APOLOGY.en!)]);
      return;
    }

    await this.deliver(ctx, conversation.id, event.from, result.outbound);

    const finalLanguage = result.session?.language ?? language;
    if (finalLanguage !== customer.language) await this.conversations.setCustomerLanguage(customer.id, finalLanguage);

    if (result.handoff) await this.conversations.setConversationStatus(conversation.id, "human");

    if (result.session) await this.sessions.set(tenant.id, event.from, result.session, this.config.SESSION_TTL_SECONDS);
    else await this.sessions.delete(tenant.id, event.from);
  }

  /** One natural-style turn; falls back to the guided menu when the model is unavailable. */
  private async converse(
    runner: FlowRunner,
    blueprint: Blueprint,
    tenant: TenantContext["tenant"],
    customer: Customer,
    conversationId: string,
    text_: string,
    language: string,
    baseContext: Record<string, unknown>,
    actionCtx: Omit<ActionContext, "language" | "context">,
    opts: { channel: "whatsapp" | "web"; inboundMessageId: string },
  ): Promise<RunResult> {
    try {
      const reply = await this.assistant.converse(tenant, blueprint, customer, conversationId, text_, language, opts);
      const outbound: OutboundMessage[] = reply.text ? [text(reply.text)] : [];
      if (reply.startFlow) {
        const started = await runner.start(reply.startFlow, { language, context: baseContext }, actionCtx);
        return { ...started, outbound: [...outbound, ...started.outbound], handoff: started.handoff || reply.handoff };
      }
      if (reply.handoff && !reply.text) outbound.push(text(t(COPY.handoff, language)));
      return { outbound, session: null, handoff: reply.handoff, completed: true };
    } catch (err) {
      this.logger.warn(`natural conversation failed for ${customer.waId}, showing the menu instead: ${err instanceof Error ? err.message : String(err)}`);
      return runner.start(blueprint.fallbackFlow ?? blueprint.entryFlow, { language, context: baseContext }, actionCtx);
    }
  }

  /** Turns free text into the button or list reply it means, when the assistant is confident; otherwise the input as sent. */
  private async resolveAnswer(runner: FlowRunner, session: SessionState, content: InboundContent, language: string): Promise<InboundContent> {
    if (content.kind !== "text" || runner.accepts(session, content)) return content;
    const pending = runner.pendingOptions(session);
    if (!pending) return content;
    const id = await this.assistant.pickOption({ text: content.text, language, prompt: pending.prompt, options: pending.options });
    const option = id ? pending.options.find((o) => o.id === id) : undefined;
    if (!option) return content;
    return { kind: pending.kind, id: option.id, title: option.title };
  }

  private async deliver(ctx: TenantContext, conversationId: string, to: string, messages: RunResult["outbound"]): Promise<void> {
    const target = { phoneNumberId: ctx.channel.phoneNumberId, accessToken: ctx.channel.accessToken, to };
    for (const message of messages) {
      try {
        const { providerMessageId } = await this.sender.send(target, message);
        await this.conversations.recordMessage({
          tenantId: ctx.tenant.id,
          conversationId,
          direction: "out",
          providerMessageId,
          kind: message.type === "interactive" ? `interactive.${message.interactive.type}` : message.type,
          payload: message,
          createdAt: new Date(),
        });
      } catch (err) {
        this.logger.error(`send to ${to} failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
  }

  private markRead(ctx: TenantContext, messageId: string): void {
    if (!this.sender.markRead) return;
    this.sender
      .markRead({ phoneNumberId: ctx.channel.phoneNumberId, accessToken: ctx.channel.accessToken }, messageId)
      .catch((err) => this.logger.debug(`markRead failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  private runnerFor(blueprint: Blueprint): FlowRunner {
    const key = `${blueprint.id}@${blueprint.version}`;
    let runner = this.runners.get(key);
    if (!runner) {
      runner = new FlowRunner(blueprint, this.actions);
      this.runners.set(key, runner);
    }
    return runner;
  }
}

/** What the customer said, as text the agent can read; null for content with no words (media, reactions). */
function textOf(content: InboundContent): string | null {
  switch (content.kind) {
    case "text":
      return content.text;
    case "button":
    case "list":
      return content.title;
    case "location":
      return `[shared location: ${content.name ?? ""} ${content.address ?? ""} (${content.latitude}, ${content.longitude})]`.replace(/\s+/g, " ");
    default:
      return null;
  }
}
