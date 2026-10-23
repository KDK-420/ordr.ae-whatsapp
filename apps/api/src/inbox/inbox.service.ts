import { Inject, Injectable, Logger } from "@nestjs/common";
import { type DownloadedMedia, MediaError, type MessageSender, text } from "@ordr/whatsapp";
import { previewOf } from "../conversation/preview";
import type { ConversationRepository, ConversationStatus, ConversationSummary, StoredMessage, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";

/** Meta allows free-form replies only within 24 hours of the customer's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Largest file the inbox will proxy from Meta (its own cap for images, video and audio). */
const MAX_INBOX_MEDIA_BYTES = 16 * 1024 * 1024;

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
}

export interface MessageView {
  id: string;
  direction: "in" | "out";
  kind: string;
  preview: string;
  payload: unknown;
  status?: string;
  createdAt: string;
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
  ) {}

  async list(tenantId: string, status?: ConversationStatus): Promise<ConversationView[]> {
    const rows = await this.conversations.listConversations(tenantId, { status, limit: 200 });
    return rows.map((r) => this.present(r));
  }

  async thread(tenantId: string, conversationId: string): Promise<{ conversation: ConversationView; messages: MessageView[] }> {
    const conversation = await this.summary(tenantId, conversationId);
    const messages = await this.conversations.listMessages(conversationId, { limit: 200 });
    return { conversation: this.present(conversation), messages: messages.map(toMessageView) };
  }

  /** Sends an agent's text to the customer and hands the thread to a human until the customer asks for the bot. */
  async reply(tenantId: string, conversationId: string, body: string, actor: string): Promise<MessageView> {
    const conversation = await this.summary(tenantId, conversationId);
    if (!this.windowOpen(conversation.lastInboundAt)) {
      throw new InboxError("window_closed", "the customer last wrote more than 24 hours ago; WhatsApp only allows template messages now");
    }
    const ctx = (await this.tenants.findContextByChannelId(conversation.channelId)) ?? (await this.tenants.findContextById(tenantId));
    if (!ctx) throw new InboxError("no_channel", "tenant has no active WhatsApp channel");
    const customer = conversation.customer;
    if (!customer) throw new InboxError("no_customer", "conversation has no customer");

    const message = text(body);
    const { providerMessageId } = await this.sender.send({ phoneNumberId: ctx.channel.phoneNumberId, accessToken: ctx.channel.accessToken, to: customer.waId }, message);
    const record: StoredMessage = {
      id: providerMessageId,
      tenantId,
      conversationId,
      direction: "out",
      providerMessageId,
      kind: "text",
      payload: message,
      createdAt: new Date(),
    };
    await this.conversations.recordMessage(record);
    if (conversation.status !== "human") await this.conversations.setConversationStatus(conversationId, "human");
    this.logger.log(`${actor} replied to ${customer.waId} in conversation ${conversationId}`);
    return toMessageView(record);
  }

  /**
   * The bytes of a media message the customer sent, fetched from Meta on demand with the channel's
   * token. Nothing is stored on our side; Meta keeps media for about 30 days.
   */
  async media(tenantId: string, conversationId: string, messageId: string): Promise<DownloadedMedia> {
    const messages = await this.conversations.listMessages(conversationId, { limit: 1000 });
    const message = messages.find((m) => m.id === messageId && m.direction === "in");
    const payload = message?.payload as { kind?: unknown; mediaId?: unknown; mimeType?: unknown } | undefined;
    if (!payload || payload.kind !== "media" || typeof payload.mediaId !== "string") throw new InboxError("not_found", "no media on that message");
    const conversation = await this.summary(tenantId, conversationId);
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

  private async summary(tenantId: string, conversationId: string): Promise<ConversationSummary> {
    const rows = await this.conversations.listConversations(tenantId, { limit: 1000 });
    const found = rows.find((r) => r.id === conversationId);
    if (!found) throw new InboxError("not_found", "conversation not found");
    return found;
  }

  private windowOpen(lastInboundAt: Date | undefined, now = Date.now()): boolean {
    return !!lastInboundAt && now - lastInboundAt.getTime() <= SERVICE_WINDOW_MS;
  }

  private present(c: ConversationSummary): ConversationView {
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
    };
  }
}

const toMessageView = (m: StoredMessage): MessageView => ({
  id: m.id,
  direction: m.direction,
  kind: m.kind,
  preview: previewOf(m.payload),
  payload: m.payload,
  status: m.status,
  createdAt: m.createdAt.toISOString(),
});
