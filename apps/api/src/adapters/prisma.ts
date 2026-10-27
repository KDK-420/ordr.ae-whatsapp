import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Channel, Customer, Tenant } from "@ordr/domain";
import type { SessionState } from "@ordr/flow-schema";
import { Prisma, PrismaClient } from "@prisma/client";
import { previewOf } from "../conversation/preview";
import type {
  ChannelInput,
  ConversationRecord,
  HandoffRequestRecord,
  HandoffRequestRepository,
  ConversationRepository,
  ConversationStatus,
  ConversationSummary,
  CreateTenantInput,
  CreateUserInput,
  DedupeStore,
  MessageRecord,
  NumberPoolRepository,
  PooledNumber,
  SessionStore,
  StoredMessage,
  TenantContext,
  TenantRepository,
  UserRecord,
  UserRepository,
  UserRole,
} from "../ports";

type ChannelRow = Prisma.ChannelGetPayload<{ include: { tenant: true } }>;

function toContext(channel: ChannelRow): TenantContext {
  return {
    tenant: {
      id: channel.tenant.id,
      name: channel.tenant.name,
      slug: channel.tenant.slug,
      blueprintId: channel.tenant.blueprintId,
      defaultLanguage: channel.tenant.defaultLanguage,
      timezone: channel.tenant.timezone,
      settings: (channel.tenant.settings as Record<string, unknown>) ?? {},
    },
    channel: {
      id: channel.id,
      tenantId: channel.tenantId,
      provider: channel.provider === "web" ? "web" : "meta_cloud",
      phoneNumberId: channel.phoneNumberId,
      wabaId: channel.wabaId,
      displayPhone: channel.displayPhone,
      accessToken: channel.accessToken,
      status: "active",
    },
  };
}

const toCustomer = (c: { id: string; tenantId: string; waId: string; name: string | null; language: string | null }): Customer => ({
  id: c.id,
  tenantId: c.tenantId,
  waId: c.waId,
  name: c.name ?? undefined,
  language: c.language ?? undefined,
});

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export class PrismaTenantRepository implements TenantRepository {
  private readonly cache = new Map<string, { ctx: TenantContext | null; until: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly cacheTtlMs = 60_000,
  ) {}

  async findByPhoneNumberId(phoneNumberId: string): Promise<TenantContext | null> {
    const hit = this.cache.get(phoneNumberId);
    if (hit && hit.until > Date.now()) return hit.ctx;
    const channel = await this.prisma.channel.findUnique({ where: { phoneNumberId }, include: { tenant: true } });
    const ctx: TenantContext | null = channel && channel.status === "active" ? toContext(channel) : null;
    this.cache.set(phoneNumberId, { ctx, until: Date.now() + this.cacheTtlMs });
    return ctx;
  }

  async findContextById(tenantId: string): Promise<TenantContext | null> {
    // Newest first: a number assigned later supersedes a seed placeholder that was never retired.
    const channel = await this.prisma.channel.findFirst({ where: { tenantId, status: "active", provider: "meta_cloud" }, orderBy: { createdAt: "desc" }, include: { tenant: true } });
    return channel ? toContext(channel) : null;
  }

  async findContextByChannelId(channelId: string): Promise<TenantContext | null> {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, status: "active" }, include: { tenant: true } });
    return channel ? toContext(channel) : null;
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    return t ? toTenant(t) : null;
  }

  async list(): Promise<Array<{ tenant: Tenant; channel: Channel | null }>> {
    const rows = await this.prisma.tenant.findMany({ orderBy: { createdAt: "desc" }, include: { channels: { where: { status: "active" }, orderBy: { createdAt: "asc" }, take: 1 } } });
    return rows.map((t) => {
      const c = t.channels[0];
      return { tenant: toTenant(t), channel: c ? toContext({ ...c, tenant: t }).channel : null };
    });
  }

  async create(input: CreateTenantInput): Promise<Tenant> {
    const t = await this.prisma.tenant.create({
      data: { name: input.name, slug: input.slug, blueprintId: input.blueprintId, defaultLanguage: input.defaultLanguage ?? "en", timezone: input.timezone ?? "Asia/Dubai", settings: (input.settings ?? {}) as Prisma.InputJsonValue },
    });
    return toTenant(t);
  }

  async attachChannel(tenantId: string, input: ChannelInput): Promise<Channel> {
    // Only the channel fields: callers may pass a richer object such as a pooled number.
    const fields = { wabaId: input.wabaId, displayPhone: input.displayPhone, accessToken: input.accessToken, provider: input.provider ?? "meta_cloud" };
    const c = await this.prisma.channel.upsert({
      where: { phoneNumberId: input.phoneNumberId },
      update: { tenantId, ...fields, status: "active" },
      create: { tenantId, phoneNumberId: input.phoneNumberId, ...fields, status: "active" },
      include: { tenant: true },
    });
    this.cache.delete(input.phoneNumberId);
    return toContext(c).channel;
  }

  async detachChannel(phoneNumberId: string): Promise<void> {
    await this.prisma.channel.updateMany({ where: { phoneNumberId }, data: { status: "disabled" } });
    this.cache.delete(phoneNumberId);
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const t = await this.prisma.tenant.findUnique({ where: { slug } });
    return t ? toTenant(t) : null;
  }

  async updateSettings(tenantId: string, patch: Record<string, unknown>): Promise<Tenant | null> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) return null;
    const settings = { ...((t.settings as Record<string, unknown>) ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete settings[k];
      else settings[k] = v;
    }
    const updated = await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings: settings as Prisma.InputJsonValue } });
    this.cache.clear(); // contexts carry settings; routing must see the change on the next message
    return toTenant(updated);
  }
}

const toTenant = (t: { id: string; name: string; slug: string; blueprintId: string; defaultLanguage: string; timezone: string; settings: unknown }): Tenant => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  blueprintId: t.blueprintId,
  defaultLanguage: t.defaultLanguage,
  timezone: t.timezone,
  settings: (t.settings as Record<string, unknown>) ?? {},
});

export class PrismaNumberPoolRepository implements NumberPoolRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<PooledNumber[]> {
    const rows = await this.prisma.phoneNumber.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toPooled);
  }

  async findById(id: string): Promise<PooledNumber | null> {
    const n = await this.prisma.phoneNumber.findUnique({ where: { id } });
    return n ? toPooled(n) : null;
  }

  async create(input: ChannelInput & { label?: string }): Promise<PooledNumber> {
    return toPooled(await this.prisma.phoneNumber.create({ data: input }));
  }

  async setTenant(id: string, tenantId: string | null): Promise<PooledNumber | null> {
    const n = await this.prisma.phoneNumber.findUnique({ where: { id } });
    if (!n) return null;
    return toPooled(await this.prisma.phoneNumber.update({ where: { id }, data: { tenantId } }));
  }
}

const toPooled = (n: { id: string; phoneNumberId: string; wabaId: string; displayPhone: string; accessToken: string; label: string | null; tenantId: string | null; createdAt: Date }): PooledNumber => ({
  id: n.id,
  phoneNumberId: n.phoneNumberId,
  wabaId: n.wabaId,
  displayPhone: n.displayPhone,
  accessToken: n.accessToken,
  label: n.label ?? undefined,
  tenantId: n.tenantId,
  createdAt: n.createdAt.toISOString(),
});

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertCustomer(tenantId: string, waId: string, name?: string): Promise<Customer> {
    const c = await this.prisma.customer.upsert({
      where: { tenantId_waId: { tenantId, waId } },
      update: name ? { name } : {},
      create: { tenantId, waId, name },
    });
    return { id: c.id, tenantId: c.tenantId, waId: c.waId, name: c.name ?? undefined, language: c.language ?? undefined };
  }

  async setCustomerLanguage(customerId: string, language: string): Promise<void> {
    await this.prisma.customer.update({ where: { id: customerId }, data: { language } });
  }

  async findCustomerById(customerId: string): Promise<Customer | null> {
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    return c ? toCustomer(c) : null;
  }

  async findCustomersByIds(customerIds: string[]): Promise<Customer[]> {
    if (customerIds.length === 0) return [];
    const rows = await this.prisma.customer.findMany({ where: { id: { in: customerIds } } });
    return rows.map(toCustomer);
  }

  async findCustomerByWaId(tenantId: string, waId: string): Promise<Customer | null> {
    const c = await this.prisma.customer.findUnique({ where: { tenantId_waId: { tenantId, waId } } });
    return c ? toCustomer(c) : null;
  }

  async findConversationById(conversationId: string): Promise<(ConversationRecord & { lastInboundAt?: Date; updatedAt: Date }) | null> {
    const row = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      channelId: row.channelId,
      status: row.status as ConversationStatus,
      lastInboundAt: row.lastInboundAt ?? undefined,
      handedOverAt: row.handedOverAt ?? undefined,
      lastStaffReplyAt: row.lastStaffReplyAt ?? undefined,
      staffTypingUntil: row.staffTypingUntil ?? undefined,
      updatedAt: row.updatedAt,
    };
  }

  async getOrCreateOpenConversation(tenantId: string, customerId: string, channelId: string): Promise<ConversationRecord> {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, customerId, status: { not: "closed" } },
      orderBy: { createdAt: "desc" },
    });
    const row = existing ?? (await this.prisma.conversation.create({ data: { tenantId, customerId, channelId } }));
    return { id: row.id, tenantId: row.tenantId, customerId: row.customerId, channelId: row.channelId, status: row.status as ConversationStatus, handedOverAt: row.handedOverAt ?? undefined, lastStaffReplyAt: row.lastStaffReplyAt ?? undefined };
  }

  async setConversationStatus(conversationId: string, status: ConversationStatus): Promise<void> {
    if (status === "human") {
      // Stamp the handoff only on the way in, so a second "human" write does not reset how long the customer has waited.
      await this.prisma.conversation.updateMany({ where: { id: conversationId, status: { not: "human" } }, data: { status, handedOverAt: new Date() } });
      return;
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { status } });
  }

  async markStaffReply(conversationId: string, at: Date): Promise<void> {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastStaffReplyAt: at } });
  }

  async setStaffTyping(conversationId: string, until: Date): Promise<void> {
    await this.prisma.conversation.updateMany({ where: { id: conversationId }, data: { staffTypingUntil: until } });
  }

  async findMessageById(conversationId: string, messageId: string): Promise<StoredMessage | null> {
    const m = await this.prisma.message.findFirst({ where: { id: messageId, conversationId } });
    return m ? toStoredMessage(m) : null;
  }

  async lastInboundAtByWaId(tenantId: string, waIds: string[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    if (waIds.length === 0) return out;
    const rows = await this.prisma.customer.findMany({
      where: { tenantId, waId: { in: waIds } },
      select: { waId: true, conversations: { select: { lastInboundAt: true }, where: { lastInboundAt: { not: null } }, orderBy: { lastInboundAt: "desc" }, take: 1 } },
    });
    for (const r of rows) {
      const at = r.conversations[0]?.lastInboundAt;
      if (at) out.set(r.waId, at);
    }
    return out;
  }

  async touchInbound(conversationId: string, at: Date): Promise<void> {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { lastInboundAt: at } });
  }

  async recordMessage(m: MessageRecord): Promise<void> {
    await this.prisma.message.create({
      data: {
        tenantId: m.tenantId,
        conversationId: m.conversationId,
        direction: m.direction,
        providerMessageId: m.providerMessageId,
        kind: m.kind,
        payload: m.payload as Prisma.InputJsonValue,
        createdAt: m.createdAt,
      },
    });
  }

  async updateMessageStatus(providerMessageId: string, status: string): Promise<void> {
    await this.prisma.message.updateMany({ where: { providerMessageId }, data: { status } });
  }

  async listConversations(tenantId: string, opts: { status?: ConversationStatus; limit?: number } = {}): Promise<ConversationSummary[]> {
    const limit = opts.limit ?? 100;
    const rows = await this.prisma.conversation.findMany({
      where: { tenantId, ...(opts.status ? { status: opts.status } : {}) },
      orderBy: { updatedAt: "desc" },
      take: limit * 2,
      include: { customer: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const summaries = rows.map((row): ConversationSummary => {
      const last = row.messages[0];
      return {
        id: row.id,
        tenantId: row.tenantId,
        customerId: row.customerId,
        channelId: row.channelId,
        status: row.status as ConversationStatus,
        lastInboundAt: row.lastInboundAt ?? undefined,
        handedOverAt: row.handedOverAt ?? undefined,
        lastStaffReplyAt: row.lastStaffReplyAt ?? undefined,
        updatedAt: row.updatedAt,
        customer: toCustomer(row.customer),
        lastMessage: last ? { direction: last.direction as "in" | "out", kind: last.kind, preview: previewOf(last.payload), createdAt: last.createdAt } : undefined,
      };
    });
    const stamp = (s: ConversationSummary) => (s.lastMessage?.createdAt ?? s.updatedAt).getTime();
    return summaries.sort((a, b) => stamp(b) - stamp(a)).slice(0, limit);
  }

  async listMessages(conversationId: string, opts: { limit?: number } = {}): Promise<StoredMessage[]> {
    const rows = await this.prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: opts.limit ?? 200 });
    return rows.reverse().map(toStoredMessage);
  }
}

const toStoredMessage = (m: { id: string; tenantId: string; conversationId: string; direction: string; providerMessageId: string | null; kind: string; payload: unknown; status: string | null; createdAt: Date }): StoredMessage => ({
  id: m.id,
  tenantId: m.tenantId,
  conversationId: m.conversationId,
  direction: m.direction as "in" | "out",
  providerMessageId: m.providerMessageId ?? undefined,
  kind: m.kind,
  payload: m.payload,
  status: m.status ?? undefined,
  createdAt: m.createdAt,
});

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    return u ? toUser(u) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const u = await this.prisma.user.findUnique({ where: { id } });
    return u ? toUser(u) : null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const u = await this.prisma.user.create({ data: { ...input, email: input.email.trim().toLowerCase() } });
    return toUser(u);
  }

  async touchLogin(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } });
  }

  async listByTenant(tenantId: string): Promise<UserRecord[]> {
    const rows = await this.prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
    return rows.map(toUser);
  }

  async update(id: string, patch: Partial<Pick<UserRecord, "name" | "role" | "isActive" | "passwordHash">>): Promise<UserRecord | null> {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) return null;
    return toUser(await this.prisma.user.update({ where: { id }, data: patch }));
  }
}

const toUser = (u: { id: string; tenantId: string; email: string; name: string; role: string; passwordHash: string; isActive: boolean; isPlatformAdmin: boolean }): UserRecord => ({
  id: u.id,
  tenantId: u.tenantId,
  email: u.email,
  name: u.name,
  role: u.role === "owner" ? "owner" : ("staff" satisfies UserRole),
  passwordHash: u.passwordHash,
  isActive: u.isActive,
  isPlatformAdmin: u.isPlatformAdmin,
});

export class PrismaSessionStore implements SessionStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(tenantId: string, waId: string): Promise<SessionState | null> {
    const row = await this.prisma.session.findUnique({ where: { tenantId_waId: { tenantId, waId } } });
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) {
      await this.delete(tenantId, waId);
      return null;
    }
    return row.state as unknown as SessionState;
  }

  async set(tenantId: string, waId: string, session: SessionState, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const state = session as unknown as Prisma.InputJsonValue;
    await this.prisma.session.upsert({
      where: { tenantId_waId: { tenantId, waId } },
      update: { state, expiresAt },
      create: { tenantId, waId, state, expiresAt },
    });
  }

  async delete(tenantId: string, waId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tenantId, waId } });
  }
}

export class PrismaDedupeStore implements DedupeStore {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      await this.prisma.processedWebhook.create({ data: { key } });
      // Opportunistic cleanup of old keys; cheap because of the primary key index.
      if (Math.random() < 0.01) {
        await this.prisma.processedWebhook.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - ttlSeconds * 1000) } } });
      }
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
      throw err;
    }
  }
}

const toRequest = (r: { id: string; tenantId: string; conversationId: string; customerId: string; reason: string | null; preview: string | null; createdAt: Date; lastAlertedAt: Date; alerts: number; resolvedAt: Date | null; resolvedBy: string | null }): HandoffRequestRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  conversationId: r.conversationId,
  customerId: r.customerId,
  reason: r.reason ?? undefined,
  preview: r.preview ?? undefined,
  createdAt: r.createdAt,
  lastAlertedAt: r.lastAlertedAt,
  alerts: r.alerts,
  resolvedAt: r.resolvedAt ?? undefined,
  resolvedBy: r.resolvedBy ?? undefined,
});

export class PrismaHandoffRequestRepository implements HandoffRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOpen(conversationId: string): Promise<HandoffRequestRecord | null> {
    const r = await this.prisma.handoffRequest.findFirst({ where: { conversationId, resolvedAt: null }, orderBy: { createdAt: "asc" } });
    return r ? toRequest(r) : null;
  }

  async listOpen(tenantId: string): Promise<HandoffRequestRecord[]> {
    const rows = await this.prisma.handoffRequest.findMany({ where: { tenantId, resolvedAt: null }, orderBy: { createdAt: "asc" } });
    return rows.map(toRequest);
  }

  async create(input: { tenantId: string; conversationId: string; customerId: string; reason?: string; preview?: string }): Promise<HandoffRequestRecord> {
    return toRequest(await this.prisma.handoffRequest.create({ data: { tenantId: input.tenantId, conversationId: input.conversationId, customerId: input.customerId, reason: input.reason ?? null, preview: input.preview ?? null } }));
  }

  async markAlerted(id: string, at: Date, patch: { reason?: string; preview?: string } = {}): Promise<HandoffRequestRecord | null> {
    const existing = await this.prisma.handoffRequest.findUnique({ where: { id } });
    if (!existing) return null;
    return toRequest(await this.prisma.handoffRequest.update({ where: { id }, data: { lastAlertedAt: at, alerts: { increment: 1 }, ...(patch.reason ? { reason: patch.reason } : {}), ...(patch.preview ? { preview: patch.preview } : {}) } }));
  }

  async resolve(conversationId: string, by: string, at: Date): Promise<number> {
    const res = await this.prisma.handoffRequest.updateMany({ where: { conversationId, resolvedAt: null }, data: { resolvedAt: at, resolvedBy: by } });
    return res.count;
  }
}
