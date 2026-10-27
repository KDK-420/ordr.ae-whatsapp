import { Inject, Injectable, Logger } from "@nestjs/common";
import { type DownloadedMedia, MediaError, type MessageSender, text } from "@ordr/whatsapp";
import { previewOf } from "../conversation/preview";
import type { ConversationRepository, ConversationStatus, ConversationSummary, HandoffRequestRecord, HandoffRequestRepository, StoredMessage, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";

/** Meta allows free-form replies only within 24 hours of the customer's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Largest file the inbox will proxy from Meta (its own cap for images, video and audio). */
const MAX_INBOX_MEDIA_BYTES = 16 * 1024 * 1024;

/** A typing heartbeat from the dashboard keeps the bot out of the thread for this long; the composer sends one every few seconds. */
export const TYPING_HOLD_MS = 8000;

/** The customer's open question for a person, as the inbox shows it. */
export interface OpenRequestView {
  id: string;
  reason?: string;
  preview?: string;
  createdAt: string;
  lastAlertedAt: string;
  alerts: number;
}

export interface ConversationView {
  id: string;
  status: ConversationStatus;
  customer: { id: string; name?: string; waId?: string; language?: string } | null;
  lastInboundAt?: string;
  updatedAt: string;
  lastMessage?: { direction: "in" | "out"; kind: string; preview: string; createdAt: string };
  /** Whether an agent may send a free-form reply right now. */
  windowOpen: boolean;
  windowClosesAt?: string;
  /** Set while the customer is waiting for a person; replying from the inbox resolves it. */
  openRequest?: OpenRequestView;
}

export interface MessageView {
  id: string;
  direction: "in" | "out";
  kind: string;
  preview: string;
  payload: unknown;
  status?: string;
  createdAt: string;
  /** The message this one replies to (a quoted reply), when known. */
  quoted?: { id: string; direction: "in" | "out"; preview: string };
}

export class InboxError extends Error {
  constructor(
    public readonly code: "not_found" | "window_closed" | "no_channel" | "no_customer" | "media_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "InboxError";
  }
}

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.MessageSender) private readonly sender: MessageSender,
    @Inject(TOKENS.HandoffRequestRepository) private readonly requests: HandoffRequestRepository,
  ) {}

  async list(tenantId: string, status?: ConversationStatus): Promise<ConversationView[]> {
    const [rows, open] = await Promise.all([this.conversations.listConversations(tenantId, { status, limit: 200 }), this.requests.listOpen(tenantId)]);
    const byConversation = new Map(open.map((r) => [r.conversationId, r]));
    return rows.map((r) => this.present(r, byConversation.get(r.id)));
  }

  async thread(tenantId: string, conversationId: string): Promise<{ conversation: ConversationView; messages: MessageView[] }> {
    const conversation = await this.summary(tenantId, conversationId);
    const [messages, open] = await Promise.all([this.conversations.listMessages(conversationId, { limit: 200 }), this.requests.findOpen(conversationId)]);
    return { conversation: this.present(conversation, open ?? undefined), messages: messages.map(toMessageView) };
  }

  /**
   * Sends an agent's text to the customer, optionally as a quoted reply to one of the thread's
   * messages, and resolves the customer's open request for a person. The bot keeps working on
   * the thread; "Take over" is the explicit way to silence it.
   */
  async reply(tenantId: string, conversationId: string, body: string, actor: string, replyToMessageId?: string): Promise<MessageView> {
    const conversation = await this.summary(tenantId, conversationId);
    if (!this.windowOpen(conversation.lastInboundAt)) {
      throw new InboxError("window_closed", "the customer last wrote more than 24 hours ago; WhatsApp only allows template messages now");
    }
    const ctx = (await this.tenants.findContextByChannelId(conversation.channelId)) ?? (await this.tenants.findContextById(tenantId));
    if (!ctx) throw new InboxError("no_channel", "tenant has no active WhatsApp channel");
    const customer = conversation.customer;
    if (!customer) throw new InboxError("no_customer", "conversation has no customer");

    let quoted: MessageView["quoted"];
    let replyTo: string | undefined;
    if (replyToMessageId) {
      const target = await this.conversations.findMessageById(conversationId, replyToMessageId);
      if (!target) throw new InboxError("not_found", "the message to reply to is not in this conversation");
      quoted = { id: target.id, direction: target.direction, preview: previewOf(target.payload) };
      // Meta needs the wamid; web and demo messages have none Meta knows, so the quote is only shown, not sent.
      replyTo = target.providerMessageId && !target.providerMessageId.startsWith("wamid.demo.") && !target.providerMessageId.startsWith("web:") ? target.providerMessageId : undefined;
    }
    const message = text(body, { replyTo });
    const { providerMessageId } = await this.sender.send({ phoneNumberId: ctx.channel.phoneNumberId, accessToken: ctx.channel.accessToken, to: customer.waId }, message);
    const record: StoredMessage = {
      id: providerMessageId,
      tenantId,
      conversationId,
      direction: "out",
      providerMessageId,
      kind: "text",
      payload: quoted ? { ...message, quoted } : message,
      createdAt: new Date(),
    };
    await this.conversations.recordMessage(record);
    await this.conversations.markStaffReply(conversationId, record.createdAt);
    const resolved = await this.requests.resolve(conversationId, actor, record.createdAt);
    this.logger.log(`${actor} replied to ${customer.waId} in conversation ${conversationId}${quoted ? ` (quoting ${quoted.id})` : ""}${resolved ? `, resolved ${resolved} request(s)` : ""}`);
    return toMessageView(record);
  }

  /** The dashboard composer is in use: hold the bot's replies on this thread for a few seconds. */
  async typing(tenantId: string, conversationId: string): Promise<void> {
    await this.summary(tenantId, conversationId);
    await this.conversations.setStaffTyping(conversationId, new Date(Date.now() + TYPING_HOLD_MS));
  }

  /** Marks the customer's open request handled without a reply in the chat (answered by phone, for example). */
  async resolveRequest(tenantId: string, conversationId: string, actor: string): Promise<ConversationView> {
    const conversation = await this.summary(tenantId, conversationId);
    await this.requests.resolve(conversationId, actor, new Date());
    return this.present(conversation, undefined);
  }

  /**
   * The bytes of a media message the customer sent, fetched from Meta on demand with the channel's
   * token. Nothing is stored on our side; Meta keeps media for about 30 days.
   */
  async media(tenantId: string, conversationId: string, messageId: string): Promise<DownloadedMedia> {
    const conversation = await this.summary(tenantId, conversationId);
    const message = await this.conversations.findMessageById(conversationId, messageId);
    const payload = message?.direction === "in" ? (message.payload as { kind?: unknown; mediaId?: unknown; mimeType?: unknown }) : undefined;
    if (!payload || payload.kind !== "media" || typeof payload.mediaId !== "string") throw new InboxError("not_found", "no media on that message");
    const ctx = (await this.tenants.findContextByChannelId(conversation.channelId)) ?? (await this.tenants.findContextById(tenantId));
    if (!ctx) throw new InboxError("no_channel", "tenant has no active WhatsApp channel");
    if (!this.sender.downloadMedia) throw new InboxError("media_unavailable", "media download is not available with this sender");
    try {
      const fetched = await this.sender.downloadMedia(payload.mediaId, ctx.channel.accessToken, { maxBytes: MAX_INBOX_MEDIA_BYTES });
      return { ...fetched, mimeType: fetched.mimeType || (typeof payload.mimeType === "string" ? payload.mimeType : "application/octet-stream") };
    } catch (err) {
      if (err instanceof MediaError) throw new InboxError("media_unavailable", err.message);
      throw err;
    }
  }

  async setStatus(tenantId: string, conversationId: string, status: ConversationStatus): Promise<ConversationView> {
    await this.summary(tenantId, conversationId);
    await this.conversations.setConversationStatus(conversationId, status);
    return this.present(await this.summary(tenantId, conversationId));
  }

  /** One conversation by id, scoped to the tenant: two point lookups instead of listing the whole inbox. */
  private async summary(tenantId: string, conversationId: string): Promise<ConversationSummary> {
    const found = await this.conversations.findConversationById(conversationId);
    if (!found || found.tenantId !== tenantId) throw new InboxError("not_found", "conversation not found");
    const customer = await this.conversations.findCustomerById(found.customerId);
    return { ...found, customer };
  }

  private windowOpen(lastInboundAt: Date | undefined, now = Date.now()): boolean {
    return !!lastInboundAt && now - lastInboundAt.getTime() <= SERVICE_WINDOW_MS;
  }

  private present(c: ConversationSummary, request?: HandoffRequestRecord): ConversationView {
    const open = this.windowOpen(c.lastInboundAt);
    return {
      id: c.id,
      status: c.status,
      customer: c.customer ? { id: c.customer.id, name: c.customer.name, waId: c.customer.waId, language: c.customer.language } : null,
      lastInboundAt: c.lastInboundAt?.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      lastMessage: c.lastMessage ? { ...c.lastMessage, createdAt: c.lastMessage.createdAt.toISOString() } : undefined,
      windowOpen: open,
      windowClosesAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + SERVICE_WINDOW_MS).toISOString() : undefined,
      openRequest: request ? { id: request.id, reason: request.reason, preview: request.preview, createdAt: request.createdAt.toISOString(), lastAlertedAt: request.lastAlertedAt.toISOString(), alerts: request.alerts } : undefined,
    };
  }
}

/** The quote stored next to an outbound payload by `reply`, when it was a reply to a specific message. */
export function quotedOf(payload: unknown): MessageView["quoted"] {
  const q = (payload as { quoted?: unknown } | null)?.quoted as { id?: unknown; direction?: unknown; preview?: unknown } | undefined;
  if (!q || typeof q.id !== "string" || typeof q.preview !== "string") return undefined;
  return { id: q.id, direction: q.direction === "in" ? "in" : "out", preview: q.preview };
}

const toMessageView = (m: StoredMessage): MessageView => ({
  id: m.id,
  direction: m.direction,
  kind: m.kind,
  preview: previewOf(m.payload),
  payload: m.payload,
  status: m.status,
  createdAt: m.createdAt.toISOString(),
  quoted: quotedOf(m.payload),
});
