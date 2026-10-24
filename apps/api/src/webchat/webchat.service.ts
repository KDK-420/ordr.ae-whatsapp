import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { InboundMessage } from "@ordr/whatsapp";
import { ConversationService } from "../conversation/conversation.service";
import { InboundQueue } from "../conversation/inbound-queue";
import { previewOf } from "../conversation/preview";
import type { AppConfig } from "../config";
import type { ConversationRepository, DedupeStore, TenantContext, TenantRepository, WebSessionRecord, WebSessionRepository } from "../ports";
import { WEB_WA_PREFIX } from "../simulator/simulator.service";
import { TOKENS } from "../tokens";

export class WebChatError extends Error {
  constructor(
    public readonly code: "not_found" | "unauthorized" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "WebChatError";
  }
}

export interface WebMessageView {
  id: string;
  role: "customer" | "assistant";
  text: string;
  /** A photo the assistant sent; `text` is then its caption. */
  imageUrl?: string;
  createdAt: string;
}

/** Image messages become a picture with the caption as text; everything else is its preview line. */
export function webMessageText(payload: unknown): { text: string; imageUrl?: string } {
  const p = payload as { type?: unknown; image?: { link?: unknown; caption?: unknown } } | null;
  if (p && typeof p === "object" && p.type === "image" && typeof p.image?.link === "string") {
    return { text: typeof p.image.caption === "string" ? p.image.caption : "", imageUrl: p.image.link };
  }
  return { text: previewOf(payload) };
}

export interface WebSessionView {
  sessionId: string;
  tenant: { name: string; slug: string; blueprintId: string; language: string };
  conversationId: string;
  status: "bot" | "human";
  messages: WebMessageView[];
}

/** Virtual channel id for a tenant's web chat; one per tenant, created on first use. */
export const webChannelId = (tenantId: string) => `${WEB_WA_PREFIX}${tenantId}`;

/**
 * Anonymous web chat on top of the same conversation pipeline WhatsApp uses: a visitor gets an
 * opaque identity scoped to one tenant and a bearer token (stored hashed). Messages run through
 * ConversationService with the tenant's web channel, so the agent, tools, persistence and audit
 * are identical across channels; only delivery differs (the browser polls instead of Meta pushing).
 */
@Injectable()
export class WebChatService {
  private readonly logger = new Logger(WebChatService.name);

  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.WebSessionRepository) private readonly sessions: WebSessionRepository,
    @Inject(TOKENS.DedupeStore) private readonly dedupe: DedupeStore,
    @Inject(ConversationService) private readonly conversation: ConversationService,
    @Inject(InboundQueue) private readonly queue: InboundQueue,
  ) {}

  /** Starts an anonymous session for the tenant behind `slug`. Returns the token once; only its hash is stored. */
  async start(slug: string, opts: { name?: string; language?: string } = {}): Promise<{ token: string; view: WebSessionView }> {
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) throw new WebChatError("not_found", "unknown business");
    const ctx = await this.webContext(tenant.id);
    const waId = `${WEB_WA_PREFIX}${randomBytes(12).toString("base64url")}`;
    const name = (opts.name ?? "").trim().slice(0, 80) || "Web visitor";
    const customer = await this.conversations.upsertCustomer(tenant.id, waId, name);
    if (opts.language && opts.language !== customer.language) await this.conversations.setCustomerLanguage(customer.id, opts.language);
    const conversation = await this.conversations.getOrCreateOpenConversation(tenant.id, customer.id, ctx.channel.id);
    const token = randomBytes(32).toString("base64url");
    const session = await this.sessions.create({ tenantId: tenant.id, customerId: customer.id, conversationId: conversation.id, tokenHash: hashToken(token) });
    this.logger.log(`web session ${session.id} started for tenant ${tenant.id}`);
    return { token, view: await this.view(session, ctx) };
  }

  /** Resolves a bearer token to its session, or throws. Sessions are tenant-bound; the id in the URL must match. */
  async authenticate(sessionId: string, token: string | undefined): Promise<WebSessionRecord> {
    if (!token) throw new WebChatError("unauthorized", "missing token");
    const session = await this.sessions.findByTokenHash(hashToken(token));
    if (!session || session.id !== sessionId) throw new WebChatError("unauthorized", "invalid session");
    await this.sessions.touch(session.id, new Date());
    return session;
  }

  async thread(session: WebSessionRecord): Promise<WebSessionView> {
    return this.view(session, await this.webContext(session.tenantId));
  }

  /** Delivers one visitor message through the conversation pipeline and waits for the reply. */
  async send(session: WebSessionRecord, input: { text: string; clientMessageId?: string }): Promise<WebSessionView> {
    const text = input.text.trim();
    if (!text) throw new WebChatError("invalid", "empty message");
    if (text.length > 2000) throw new WebChatError("invalid", "message too long");
    const ctx = await this.webContext(session.tenantId);
    const customer = await this.conversations.findCustomerById(session.customerId);
    if (!customer || customer.tenantId !== session.tenantId) throw new WebChatError("unauthorized", "invalid session");
    const messageId = `${WEB_WA_PREFIX}${session.id}:${input.clientMessageId?.slice(0, 64) || randomUUID()}`;
    const event: InboundMessage = {
      type: "message",
      phoneNumberId: ctx.channel.phoneNumberId,
      displayPhone: ctx.channel.displayPhone,
      wabaId: ctx.channel.wabaId,
      messageId,
      from: customer.waId,
      profileName: customer.name,
      timestamp: Math.floor(Date.now() / 1000),
      content: { kind: "text", text },
    };
    await new Promise<void>((resolve) => {
      // Same per-customer ordering as webhooks; the conversation service dedupes on messageId, so a retried client id is harmless.
      this.queue.enqueue(`${ctx.channel.phoneNumberId}:${customer.waId}`, () => this.conversation.handleEvent(event).finally(resolve));
    });
    return this.view(session, ctx);
  }

  private async view(session: WebSessionRecord, ctx: TenantContext): Promise<WebSessionView> {
    const conversation = await this.conversations.findConversationById(session.conversationId);
    const messages = await this.conversations.listMessages(session.conversationId, { limit: 100 });
    return {
      sessionId: session.id,
      tenant: { name: ctx.tenant.name, slug: ctx.tenant.slug, blueprintId: ctx.tenant.blueprintId, language: ctx.tenant.defaultLanguage },
      conversationId: session.conversationId,
      status: conversation?.status === "human" ? "human" : "bot",
      messages: messages.map((m) => ({ id: m.id, role: m.direction === "in" ? "customer" : "assistant", ...webMessageText(m.payload), createdAt: m.createdAt.toISOString() })),
    };
  }

  /** The tenant's virtual web channel, created on first use. Its "phone number id" is web:<tenantId>, so it can never collide with Meta's. */
  private async webContext(tenantId: string): Promise<TenantContext> {
    const id = webChannelId(tenantId);
    const existing = await this.tenants.findByPhoneNumberId(id);
    if (existing) return existing;
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new WebChatError("not_found", "unknown business");
    await this.tenants.attachChannel(tenantId, { provider: "web", phoneNumberId: id, wabaId: "web", displayPhone: "web chat", accessToken: "" });
    const ctx = await this.tenants.findByPhoneNumberId(id);
    if (!ctx) throw new Error("web channel could not be created");
    this.logger.log(`web channel created for tenant ${tenantId}`);
    return ctx;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

