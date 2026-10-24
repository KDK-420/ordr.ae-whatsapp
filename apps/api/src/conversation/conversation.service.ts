import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ActionContext, type ActionRegistry, type Blueprint, detectLanguage, FlowRunner, type RunResult, type SessionState } from "@ordr/flow-schema";
import { image, type InboundContent, type InboundEvent, type InboundMessage, type InboundStatus, type MessageSender, type OutboundMessage, text } from "@ordr/whatsapp";
import type { Customer, DomainEvent } from "@ordr/domain";
import { COPY, t } from "../actions/copy";
import { type AgentAttachment, conversationStyle } from "../ai/agent";
import { AssistantService } from "../ai/assistant.service";
import type { AppConfig } from "../config";
import type { BlueprintRegistry, ConversationRecord, ConversationRepository, DedupeStore, EventBus, SessionStore, TenantContext, TenantRepository } from "../ports";
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

/** A waiting customer is told once per this long that the team has their messages; the same cadence re-alerts staff. */
const HANDOFF_ACK_EVERY_SECONDS = 10 * 60;
/** Minutes a handed-over thread may wait with no reply from staff before the bot takes it back. Tenant setting `handoffResumeMinutes`; 0 disables. */
export const DEFAULT_HANDOFF_RESUME_MINUTES = 60;

/** The `handoffResumeMinutes` tenant setting, clean. */
export function handoffResumeMinutes(settings: Record<string, unknown>): number {
  const v = settings.handoffResumeMinutes;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT_HANDOFF_RESUME_MINUTES;
}

/**
 * What the bot does when a customer writes into a thread a person owns.
 * - resume: nobody from staff has written for `resumeMinutes` (since the handoff, or since their last reply), so the bot answers again.
 * - quiet: a staff member has replied since the handoff and is recent; the inbox shows the new message.
 * - ack: the customer is still waiting for the first human reply; tell them (rate limited) and re-alert staff.
 */
export function whileHumanOwns(conversation: Pick<ConversationRecord, "handedOverAt" | "lastStaffReplyAt">, resumeMinutes: number, now: Date): "resume" | "quiet" | "ack" {
  const handedOverAt = conversation.handedOverAt?.getTime();
  const staffAt = conversation.lastStaffReplyAt?.getTime();
  const lastHuman = Math.max(handedOverAt ?? 0, staffAt ?? 0);
  if (lastHuman > 0 && resumeMinutes > 0 && now.getTime() - lastHuman > resumeMinutes * 60_000) return "resume";
  if (staffAt && handedOverAt && staffAt >= handedOverAt) return "quiet";
  return "ack";
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

    const preface: OutboundMessage[] = [];
    if (!globalFlow && conversation.status === "human") {
      // A person owns this thread. The customer must never feel dropped: a recent human reply means stay quiet (the
      // inbox shows the message); still waiting means say so and nudge staff; waiting too long means the bot steps back in.
      const decision = whileHumanOwns(conversation, handoffResumeMinutes(tenant.settings), receivedAt);
      if (decision !== "resume") {
        this.markRead(ctx, event.messageId, false);
        if (decision === "ack") await this.acknowledgeWaiting(ctx, conversation, customer, language, previewOf(received?.payload ?? event.content));
        return;
      }
      this.logger.log(`conversation ${conversation.id}: no staff reply for ${handoffResumeMinutes(tenant.settings)} min, bot resumes`);
      await this.conversations.setConversationStatus(conversation.id, "bot");
      preface.push(text(t(COPY.handoffResumed, language)));
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
        result = await this.converse(runner, blueprint, tenant, customer, conversation.id, asText, language, baseContext, actionCtx, { channel: channel.provider === "web" ? "web" : "whatsapp", inboundMessageId: event.messageId, attachments: received?.attachments });
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

    await this.deliver(ctx, conversation.id, event.from, [...preface, ...result.outbound]);

    const finalLanguage = result.session?.language ?? language;
    if (finalLanguage !== customer.language) await this.conversations.setCustomerLanguage(customer.id, finalLanguage);

    if (result.handoff) {
      await this.conversations.setConversationStatus(conversation.id, "human");
      await this.publishHandedOver({
        conversationId: conversation.id,
        customerId: customer.id,
        customerName: customer.name,
        waId: customer.waId,
        channelId: channel.id,
        preview: previewOf(received?.payload ?? event.content),
        reason: result.handoffReason,
      }, tenant.id);
    }

    if (result.session) await this.sessions.set(tenant.id, event.from, result.session, this.config.SESSION_TTL_SECONDS);
    else await this.sessions.delete(tenant.id, event.from);
  }

  /**
   * The customer wrote again while waiting for a person. At most once per HANDOFF_ACK_EVERY_SECONDS they are told
   * the team has their message (and how to get the assistant back), and staff are alerted again through the outbox.
   */
  private async acknowledgeWaiting(ctx: TenantContext, conversation: ConversationRecord, customer: Customer, language: string, preview: string): Promise<void> {
    if (!(await this.dedupe.claim(`handoff-ack:${conversation.id}`, HANDOFF_ACK_EVERY_SECONDS))) return;
    await this.deliver(ctx, conversation.id, customer.waId, [text(t(COPY.handoffWaiting, language))]);
    const waitedMin = conversation.handedOverAt ? Math.round((Date.now() - conversation.handedOverAt.getTime()) / 60_000) : undefined;
    await this.publishHandedOver({
      conversationId: conversation.id,
      customerId: customer.id,
      customerName: customer.name,
      waId: customer.waId,
      channelId: ctx.channel.id,
      preview,
      reason: waitedMin !== undefined ? `still waiting for a reply (${waitedMin} min)` : "still waiting for a reply",
    }, ctx.tenant.id);
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
    opts: { channel: "whatsapp" | "web"; inboundMessageId: string; attachments?: AgentAttachment[] },
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

