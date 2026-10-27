import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ActionContext, type ActionRegistry, type Blueprint, detectLanguage, FlowRunner, type RunResult, type SessionState } from "@ordr/flow-schema";
import { image, type InboundContent, type InboundEvent, type InboundMessage, type InboundStatus, type MessageSender, type OutboundMessage, text } from "@ordr/whatsapp";
import type { Customer, DomainEvent } from "@ordr/domain";
import { COPY, t } from "../actions/copy";
import { type AgentAttachment, conversationStyle } from "../ai/agent";
import { AssistantService } from "../ai/assistant.service";
import type { AppConfig } from "../config";
import type { BlueprintRegistry, ConversationRecord, ConversationRepository, DedupeStore, EventBus, HandoffRequestRepository, SessionStore, TenantContext, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";
import { InboundMediaService } from "./inbound-media.service";
import { textOf } from "./inbound-text";
import { previewOf } from "./preview";

/** A flow result plus why the agent handed over, when it said. */
type TurnResult = RunResult & { handoffReason?: string };

/** What the outbox carries when the bot hands a thread to a person; HandoffNotifier turns it into a WhatsApp alert. */
export interface HandedOverPayload {
  conversationId: string;
  customerId: string;
  customerName?: string;
  waId: string;
  channelId: string;
  /** The last inbound text, or a media preview such as "Voice note: …". */
  preview: string;
  /** The reason the agent gave hand_over_to_human, when it gave one. */
  reason?: string;
}

/** Staff are alerted again about an open request at most once per this long, when the customer chases. */
const REALERT_EVERY_MS = 10 * 60 * 1000;
/** How long the bot holds a reply while an operator is typing in the inbox, at most. */
const TYPING_HOLD_MAX_MS = 60 * 1000;
const TYPING_POLL_MS = 1000;

/** What the agent is told about a customer's open question for the team. */
export interface OpenRequestInfo {
  reason?: string;
  sinceMinutes: number;
}

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
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
    @Inject(TOKENS.ActionRegistry) private readonly actions: ActionRegistry,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(AssistantService) private readonly assistant: AssistantService,
    @Inject(InboundMediaService) private readonly media: InboundMediaService,
    @Inject(TOKENS.HandoffRequestRepository) private readonly requests: HandoffRequestRepository,
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
    const natural = conversationStyle(tenant, blueprint) === "natural" && this.assistant.conversational;
    // Media is fetched and transcribed before anything is stored, so the thread shows what arrived.
    const received = event.content.kind === "media" ? await this.media.receive(ctx, event.content, { attachImages: natural, language: customer.language ?? tenant.defaultLanguage }) : null;
    // Independent writes and the session read run together: one round trip instead of three before the bot can think.
    const [, , session] = await Promise.all([
      this.conversations.recordMessage({
        tenantId: tenant.id,
        conversationId: conversation.id,
        direction: "in",
        providerMessageId: event.messageId,
        kind: event.content.kind,
        payload: received?.payload ?? event.content,
        createdAt: receivedAt,
      }),
      this.conversations.touchInbound(conversation.id, receivedAt),
      this.sessions.get(tenant.id, event.from),
    ]);

    const runner = this.runnerFor(blueprint);
    const globalFlow = runner.matchGlobalCommand(event.content);

    const spoken = event.content.kind === "text" ? event.content.text : (received?.payload.transcript ?? received?.payload.caption);
    const language = session?.language ?? customer.language ?? (spoken ? detectLanguage(spoken, blueprint.languages, tenant.defaultLanguage) : tenant.defaultLanguage);

    if (!globalFlow && conversation.status === "human") {
      // Someone pressed "Take over": the bot stays out until they hand back or the customer asks for the menu.
      this.markRead(ctx, event.messageId, false);
      return;
    }
    if (globalFlow && conversation.status === "human") await this.conversations.setConversationStatus(conversation.id, "bot");
    // An operator typing in the inbox gets a moment to send; if they do, the bot has nothing to add.
    if (await this.staffAnsweredWhileTyping(conversation, receivedAt)) {
      this.markRead(ctx, event.messageId, false);
      return;
    }
    // The bot will answer: show "typing…" while the flow or the model works on it.
    this.markRead(ctx, event.messageId, true);
    const baseContext = {
      tenant: { id: tenant.id, name: tenant.name },
      customer: { id: customer.id, waId: customer.waId, name: customer.name ?? "" },
    };
    const actionCtx = { tenantId: tenant.id, customer: { id: customer.id, waId: customer.waId, name: customer.name }, conversationId: conversation.id };

    const asText = natural ? (received ? received.text : textOf(event.content)) : null;

    let result: TurnResult;
    try {
      if (natural && asText !== null && !(session?.awaiting && event.content.kind !== "text")) {
        // Natural style: Claude answers like a staff member, booking through tools. A tapped button from an
        // older guided message still goes to its flow; everything else is a conversation.
        const open = await this.requests.findOpen(conversation.id);
        const openRequest: OpenRequestInfo | undefined = open ? { reason: open.reason, sinceMinutes: Math.max(0, Math.round((receivedAt.getTime() - open.createdAt.getTime()) / 60_000)) } : undefined;
        result = await this.converse(runner, blueprint, tenant, customer, conversation.id, asText, language, baseContext, actionCtx, { channel: channel.provider === "web" ? "web" : "whatsapp", inboundMessageId: event.messageId, attachments: received?.attachments, openRequest, businessNumber: channel.provider === "web" ? undefined : channel.displayPhone });
      } else if (globalFlow) {
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

    if (result.handoff) {
      // A question for the team, not a mode: the bot keeps answering everything else while staff pick it up.
      await this.requestPerson(ctx, conversation, customer, previewOf(received?.payload ?? event.content), result.handoffReason, receivedAt);
    }

    if (result.session) await this.sessions.set(tenant.id, event.from, result.session, this.config.SESSION_TTL_SECONDS);
    else await this.sessions.delete(tenant.id, event.from);
  }

  /**
   * Opens a request for a person, or when one is already open, re-alerts staff (the customer is
   * chasing) at most once per REALERT_EVERY_MS. The alert itself goes through the outbox.
   */
  private async requestPerson(ctx: TenantContext, conversation: ConversationRecord, customer: Customer, preview: string, reason: string | undefined, now: Date): Promise<void> {
    const existing = await this.requests.findOpen(conversation.id);
    let alert = false;
    let effectiveReason = reason;
    if (!existing) {
      await this.requests.create({ tenantId: ctx.tenant.id, conversationId: conversation.id, customerId: customer.id, reason, preview });
      alert = true;
    } else if (now.getTime() - existing.lastAlertedAt.getTime() >= REALERT_EVERY_MS) {
      await this.requests.markAlerted(existing.id, now, { reason, preview });
      const waited = Math.round((now.getTime() - existing.createdAt.getTime()) / 60_000);
      effectiveReason = `${reason ?? existing.reason ?? "needs a person"} (still waiting, ${waited} min)`;
      alert = true;
    } else {
      this.logger.log(`conversation ${conversation.id}: request already open and alerted ${Math.round((now.getTime() - existing.lastAlertedAt.getTime()) / 1000)}s ago; not re-alerting`);
    }
    if (alert) {
      await this.publishHandedOver({ conversationId: conversation.id, customerId: customer.id, customerName: customer.name, waId: customer.waId, channelId: ctx.channel.id, preview, reason: effectiveReason }, ctx.tenant.id);
    }
  }

  /**
   * While an operator is typing in the inbox (heartbeat from the dashboard), the bot waits up to a
   * minute. Resolves true when staff sent a reply in the meantime, so the bot's turn is skipped.
   */
  private async staffAnsweredWhileTyping(conversation: ConversationRecord, receivedAt: Date): Promise<boolean> {
    let current: (ConversationRecord & { lastInboundAt?: Date }) | null = conversation;
    const deadline = Date.now() + TYPING_HOLD_MAX_MS;
    while (current?.staffTypingUntil && current.staffTypingUntil.getTime() > Date.now() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, TYPING_POLL_MS));
      current = await this.conversations.findConversationById(conversation.id);
      if (current?.lastStaffReplyAt && current.lastStaffReplyAt.getTime() >= receivedAt.getTime()) {
        this.logger.log(`conversation ${conversation.id}: staff replied while typing; bot turn skipped`);
        return true;
      }
    }
    return false;
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
    opts: { channel: "whatsapp" | "web"; inboundMessageId: string; attachments?: AgentAttachment[]; openRequest?: OpenRequestInfo; businessNumber?: string },
  ): Promise<TurnResult> {
    try {
      const reply = await this.assistant.converse(tenant, blueprint, customer, conversationId, text_, language, opts);
      const outbound: OutboundMessage[] = reply.text ? [text(reply.text)] : [];
      for (const photo of reply.media ?? []) outbound.push(image({ link: photo.link }, photo.caption));
      if (reply.startFlow) {
        const started = await runner.start(reply.startFlow, { language, context: baseContext }, actionCtx);
        return { ...started, outbound: [...outbound, ...started.outbound], handoff: started.handoff || reply.handoff, handoffReason: reply.handoffReason };
      }
      if (reply.handoff && !reply.text) outbound.push(text(t(COPY.handoff, language)));
      return { outbound, session: null, handoff: reply.handoff, handoffReason: reply.handoffReason, completed: true };
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

  /**
   * Tells the outbox a person is needed. The thread is already paused; a failure here must not
   * fail the customer's turn, so it is logged (with the outbox the worker retries the handler).
   */
  private async publishHandedOver(payload: HandedOverPayload, tenantId: string): Promise<void> {
    const event: DomainEvent<"conversation.handed_over", HandedOverPayload> = {
      id: randomUUID(),
      type: "conversation.handed_over",
      tenantId,
      occurredAt: new Date().toISOString(),
      subject: { kind: "conversation", id: payload.conversationId },
      payload,
    };
    try {
      await this.bus.publish(event);
    } catch (err) {
      this.logger.error(`conversation.handed_over for ${payload.conversationId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  private markRead(ctx: TenantContext, messageId: string, typing: boolean): void {
    if (!this.sender.markRead) return;
    this.sender
      .markRead({ phoneNumberId: ctx.channel.phoneNumberId, accessToken: ctx.channel.accessToken }, messageId, { typing })
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

