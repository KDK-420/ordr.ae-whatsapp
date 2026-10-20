import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Customer } from "@ordr/domain";
import type { InboundContent, InboundMessage, MessageSender, OutboundMessage, SendResult, SendTarget } from "@ordr/whatsapp";
import { ConversationService } from "../conversation/conversation.service";
import { InboundQueue } from "../conversation/inbound-queue";
import { type ConversationView, InboxError, InboxService, type MessageView } from "../inbox/inbox.service";
import type { ConversationRepository, SessionStore, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";

/**
 * Demo customers have WhatsApp ids that no real phone can have. Their messages run through the
 * same ConversationService as real webhooks; only the last hop (sending to Meta) is skipped.
 */
export const DEMO_WA_PREFIX = "000";

export function isDemoWaId(waId: string): boolean {
  return waId.startsWith(DEMO_WA_PREFIX);
}

/** Web chat visitors are identified by an opaque id that is not a phone number. */
export const WEB_WA_PREFIX = "web:";

export function isWebWaId(waId: string): boolean {
  return waId.startsWith(WEB_WA_PREFIX);
}

/** Wraps the real sender: demo numbers are recorded in the thread but never reach Meta. */
export class DemoAwareSender implements MessageSender {
  private counter = 0;
  constructor(private readonly inner: MessageSender) {}

  async send(target: SendTarget, message: OutboundMessage): Promise<SendResult> {
    if (isDemoWaId(target.to) || isWebWaId(target.to)) return { providerMessageId: `wamid.demo.${Date.now()}.${++this.counter}` };
    return this.inner.send(target, message);
  }

  async markRead(target: Omit<SendTarget, "to">, messageId: string): Promise<void> {
    if (messageId.startsWith("wamid.demo.") || messageId.startsWith(WEB_WA_PREFIX)) return;
    await this.inner.markRead?.(target, messageId);
  }
}

export interface DemoCustomer {
  waId: string;
  name: string;
  conversationId: string;
  language?: string;
  updatedAt: string;
}

export interface DemoThread {
  customer: DemoCustomer;
  conversation: ConversationView;
  messages: MessageView[];
}

@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);

  constructor(
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.SessionStore) private readonly sessions: SessionStore,
    @Inject(ConversationService) private readonly conversation: ConversationService,
    @Inject(InboundQueue) private readonly queue: InboundQueue,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  async listCustomers(tenantId: string): Promise<DemoCustomer[]> {
    const rows = await this.conversations.listConversations(tenantId, { limit: 200 });
    return rows
      .filter((r) => r.customer && isDemoWaId(r.customer.waId))
      .map((r) => ({ waId: r.customer!.waId, name: r.customer!.name ?? "Demo customer", conversationId: r.id, language: r.customer!.language, updatedAt: r.updatedAt.toISOString() }));
  }

  async createCustomer(tenantId: string, name: string): Promise<DemoCustomer> {
    const ctx = await this.context(tenantId);
    const waId = `${DEMO_WA_PREFIX}${randomBytes(5).readUIntBE(0, 5).toString().padStart(12, "0").slice(0, 12)}`;
    const customer = await this.conversations.upsertCustomer(tenantId, waId, name);
    const conversation = await this.conversations.getOrCreateOpenConversation(tenantId, customer.id, ctx.channel.id);
    this.logger.log(`demo customer ${name} (${waId}) created for tenant ${tenantId}`);
    return { waId, name, conversationId: conversation.id, updatedAt: new Date().toISOString() };
  }

  /** Delivers one customer message and waits for the bot's replies, then returns the whole thread. */
  async send(tenantId: string, waId: string, content: InboundContent): Promise<DemoThread> {
    const { ctx, customer } = await this.demoCustomer(tenantId, waId);
    const event: InboundMessage = {
      type: "message",
      phoneNumberId: ctx.channel.phoneNumberId,
      displayPhone: ctx.channel.displayPhone,
      wabaId: ctx.channel.wabaId,
      messageId: `wamid.demo.in.${randomUUID()}`,
      from: waId,
      profileName: customer.name,
      timestamp: Math.floor(Date.now() / 1000),
      content,
    };
    await new Promise<void>((resolve) => {
      // Same per-customer ordering as real webhooks; errors are logged by the queue and the thread still returns.
      this.queue.enqueue(`${ctx.channel.phoneNumberId}:${waId}`, () => this.conversation.handleEvent(event).finally(resolve));
    });
    return this.thread(tenantId, waId);
  }

  /** Forgets the flow state and hands the thread back to the bot, so a demo can start from "hi" again. */
  async reset(tenantId: string, waId: string): Promise<DemoThread> {
    const { customer } = await this.demoCustomer(tenantId, waId);
    await this.sessions.delete(tenantId, waId);
    const conversation = await this.openConversation(tenantId, customer);
    await this.conversations.setConversationStatus(conversation.id, "bot");
    return this.thread(tenantId, waId);
  }

  async thread(tenantId: string, waId: string): Promise<DemoThread> {
    const { customer } = await this.demoCustomer(tenantId, waId);
    const conversation = await this.openConversation(tenantId, customer);
    const t = await this.inbox.thread(tenantId, conversation.id);
    return {
      customer: { waId, name: customer.name ?? "Demo customer", conversationId: conversation.id, language: customer.language, updatedAt: t.conversation.updatedAt },
      conversation: t.conversation,
      messages: t.messages,
    };
  }

  private async context(tenantId: string) {
    const ctx = await this.tenants.findContextById(tenantId);
    if (!ctx) throw new InboxError("no_channel", "tenant has no active WhatsApp channel");
    return ctx;
  }

  private async demoCustomer(tenantId: string, waId: string): Promise<{ ctx: Awaited<ReturnType<SimulatorService["context"]>>; customer: Customer }> {
    if (!isDemoWaId(waId)) throw new InboxError("not_found", "not a demo customer");
    const ctx = await this.context(tenantId);
    const existing = (await this.listCustomers(tenantId)).find((c) => c.waId === waId);
    if (!existing) throw new InboxError("not_found", "demo customer not found");
    const customer = await this.conversations.upsertCustomer(tenantId, waId);
    return { ctx, customer };
  }

  private async openConversation(tenantId: string, customer: Customer) {
    const ctx = await this.context(tenantId);
    return this.conversations.getOrCreateOpenConversation(tenantId, customer.id, ctx.channel.id);
  }
}
