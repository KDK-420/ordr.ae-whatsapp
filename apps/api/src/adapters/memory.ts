import type { Channel, Customer, Tenant } from "@ordr/domain";
import type { SessionState } from "@ordr/flow-schema";
import { previewOf } from "../conversation/preview";
import type {
  ChannelInput,
  ConversationRecord,
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
} from "../ports";

let idSeq = 0;
const nextId = (prefix: string) => `${prefix}_${++idSeq}`;

export class InMemoryTenantRepository implements TenantRepository {
  private readonly byPhone = new Map<string, TenantContext>();

  constructor(seed: TenantContext[] = []) {
    for (const t of seed) this.add(t);
  }

  add(ctx: TenantContext): void {
    this.byPhone.set(ctx.channel.phoneNumberId, ctx);
  }

  async findByPhoneNumberId(phoneNumberId: string): Promise<TenantContext | null> {
    const ctx = this.byPhone.get(phoneNumberId);
    return ctx && ctx.channel.status === "active" ? ctx : null;
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    for (const ctx of this.byPhone.values()) if (ctx.tenant.id === tenantId) return ctx.tenant;
    return null;
  }

  async findContextById(tenantId: string): Promise<TenantContext | null> {
    for (const ctx of this.byPhone.values()) if (ctx.tenant.id === tenantId && ctx.channel.status === "active") return ctx;
    return null;
  }

  /** Tenants without a number live here until a channel is attached. */
  private readonly tenants = new Map<string, Tenant>();

  async list(): Promise<Array<{ tenant: Tenant; channel: Channel | null }>> {
    // Seeded tenants were there first; created ones follow in creation order. Newest first, like the Prisma adapter.
    const out = new Map<string, { tenant: Tenant; channel: Channel | null }>();
    for (const ctx of this.byPhone.values()) if (!this.tenants.has(ctx.tenant.id)) out.set(ctx.tenant.id, { tenant: ctx.tenant, channel: null });
    for (const t of this.tenants.values()) out.set(t.id, { tenant: t, channel: null });
    for (const ctx of this.byPhone.values()) {
      const row = out.get(ctx.tenant.id);
      if (row && ctx.channel.status === "active" && !row.channel) row.channel = ctx.channel;
    }
    return [...out.values()].reverse();
  }

  async create(input: CreateTenantInput): Promise<Tenant> {
    for (const t of await this.list()) if (t.tenant.slug === input.slug) throw new Error(`slug ${input.slug} already exists`);
    const tenant: Tenant = { id: nextId("tenant"), name: input.name, slug: input.slug, blueprintId: input.blueprintId, defaultLanguage: input.defaultLanguage ?? "en", timezone: input.timezone ?? "Asia/Dubai", settings: input.settings ?? {} };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async attachChannel(tenantId: string, input: ChannelInput): Promise<Channel> {
    const tenant = this.tenants.get(tenantId) ?? (await this.findById(tenantId));
    if (!tenant) throw new Error(`tenant ${tenantId} not found`);
    const existing = this.byPhone.get(input.phoneNumberId);
    const channel: Channel = {
      id: existing?.channel.id ?? nextId("channel"),
      tenantId,
      provider: "meta_cloud",
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      displayPhone: input.displayPhone,
      accessToken: input.accessToken,
      status: "active",
    };
    this.byPhone.set(input.phoneNumberId, { tenant, channel });
    return channel;
  }

  async detachChannel(phoneNumberId: string): Promise<void> {
    const ctx = this.byPhone.get(phoneNumberId);
    if (ctx) {
      this.tenants.set(ctx.tenant.id, ctx.tenant);
      this.byPhone.set(phoneNumberId, { tenant: ctx.tenant, channel: { ...ctx.channel, status: "disabled" } });
    }
  }

  async updateSettings(tenantId: string, patch: Record<string, unknown>): Promise<Tenant | null> {
    const tenant = this.tenants.get(tenantId) ?? (await this.findById(tenantId));
    if (!tenant) return null;
    const settings = { ...tenant.settings };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete settings[k];
      else settings[k] = v;
    }
    tenant.settings = settings; // the same object is referenced from every context, so routing sees it at once
    return tenant;
  }
}

export class InMemoryNumberPoolRepository implements NumberPoolRepository {
  readonly numbers: PooledNumber[] = [];

  async list(): Promise<PooledNumber[]> {
    return this.numbers.map((n) => ({ ...n }));
  }

  async findById(id: string): Promise<PooledNumber | null> {
    const n = this.numbers.find((x) => x.id === id);
    return n ? { ...n } : null;
  }

  async create(input: ChannelInput & { label?: string }): Promise<PooledNumber> {
    if (this.numbers.some((n) => n.phoneNumberId === input.phoneNumberId)) throw new Error(`number ${input.phoneNumberId} already in the pool`);
    const n: PooledNumber = { id: nextId("num"), ...input, tenantId: null, createdAt: new Date().toISOString() };
    this.numbers.push(n);
    return { ...n };
  }

  async setTenant(id: string, tenantId: string | null): Promise<PooledNumber | null> {
    const n = this.numbers.find((x) => x.id === id);
    if (!n) return null;
    n.tenantId = tenantId;
    return { ...n };
  }
}

export class InMemoryUserRepository implements UserRepository {
  readonly users: UserRecord[] = [];
  readonly logins = new Map<string, Date>();

  constructor(seed: Array<Omit<UserRecord, "id" | "isActive" | "isPlatformAdmin"> & Partial<Pick<UserRecord, "id" | "isActive" | "isPlatformAdmin">>> = []) {
    for (const u of seed) this.users.push({ id: u.id ?? nextId("usr"), isActive: u.isActive ?? true, isPlatformAdmin: false, ...u });
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const key = email.trim().toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === key) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const user: UserRecord = { id: nextId("usr"), isActive: true, isPlatformAdmin: false, ...input, email: input.email.trim().toLowerCase() };
    this.users.push(user);
    return user;
  }

  async touchLogin(id: string, at: Date): Promise<void> {
    this.logins.set(id, at);
  }

  async listByTenant(tenantId: string): Promise<UserRecord[]> {
    return this.users.filter((u) => u.tenantId === tenantId).map((u) => ({ ...u }));
  }

  async update(id: string, patch: Partial<Pick<UserRecord, "name" | "role" | "isActive" | "passwordHash">>): Promise<UserRecord | null> {
    const u = this.users.find((x) => x.id === id);
    if (!u) return null;
    Object.assign(u, patch);
    return { ...u };
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  readonly customers = new Map<string, Customer>();
  readonly conversations = new Map<string, ConversationRecord & { lastInboundAt?: Date; updatedAt: Date }>();
  readonly messages: StoredMessage[] = [];
  readonly statuses = new Map<string, string>();

  async upsertCustomer(tenantId: string, waId: string, name?: string): Promise<Customer> {
    const key = `${tenantId}:${waId}`;
    const existing = this.customers.get(key);
    if (existing) {
      if (name && !existing.name) existing.name = name;
      return existing;
    }
    const created: Customer = { id: nextId("cus"), tenantId, waId, name };
    this.customers.set(key, created);
    return created;
  }

  async setCustomerLanguage(customerId: string, language: string): Promise<void> {
    for (const c of this.customers.values()) if (c.id === customerId) c.language = language;
  }

  async findCustomerById(customerId: string): Promise<Customer | null> {
    for (const c of this.customers.values()) if (c.id === customerId) return c;
    return null;
  }

  async findCustomersByIds(customerIds: string[]): Promise<Customer[]> {
    const wanted = new Set(customerIds);
    return [...this.customers.values()].filter((c) => wanted.has(c.id));
  }

  async findConversationById(conversationId: string): Promise<(ConversationRecord & { lastInboundAt?: Date }) | null> {
    return this.conversations.get(conversationId) ?? null;
  }

  async getOrCreateOpenConversation(tenantId: string, customerId: string, channelId: string): Promise<ConversationRecord> {
    for (const c of this.conversations.values()) {
      if (c.tenantId === tenantId && c.customerId === customerId && c.status !== "closed") return c;
    }
    const created = { id: nextId("conv"), tenantId, customerId, channelId, status: "bot" as ConversationStatus, updatedAt: new Date() };
    this.conversations.set(created.id, created);
    return created;
  }

  async setConversationStatus(conversationId: string, status: ConversationStatus): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (c) {
      c.status = status;
      c.updatedAt = new Date();
    }
  }

  async touchInbound(conversationId: string, at: Date): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (c) {
      c.lastInboundAt = at;
      c.updatedAt = at;
    }
  }

  async recordMessage(message: MessageRecord): Promise<void> {
    this.messages.push({ id: nextId("msg"), ...message });
  }

  async updateMessageStatus(providerMessageId: string, status: string): Promise<void> {
    this.statuses.set(providerMessageId, status);
    for (const m of this.messages) if (m.providerMessageId === providerMessageId) m.status = status;
  }

  async listConversations(tenantId: string, opts: { status?: ConversationStatus; limit?: number } = {}): Promise<ConversationSummary[]> {
    const customers = [...this.customers.values()];
    const out: ConversationSummary[] = [];
    for (const c of this.conversations.values()) {
      if (c.tenantId !== tenantId) continue;
      if (opts.status && c.status !== opts.status) continue;
      const mine = this.messages.filter((m) => m.conversationId === c.id);
      const last = mine[mine.length - 1];
      out.push({
        ...c,
        customer: customers.find((x) => x.id === c.customerId) ?? null,
        lastMessage: last ? { direction: last.direction, kind: last.kind, preview: previewOf(last.payload), createdAt: last.createdAt } : undefined,
      });
    }
    const stamp = (s: ConversationSummary) => (s.lastMessage?.createdAt ?? s.updatedAt).getTime();
    return out.sort((a, b) => stamp(b) - stamp(a)).slice(0, opts.limit ?? 100);
  }

  async listMessages(conversationId: string, opts: { limit?: number } = {}): Promise<StoredMessage[]> {
    const mine = this.messages.filter((m) => m.conversationId === conversationId);
    return mine.slice(-(opts.limit ?? 200)).map((m) => structuredClone(m));
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly data = new Map<string, { session: SessionState; expiresAt: number }>();

  async get(tenantId: string, waId: string): Promise<SessionState | null> {
    const entry = this.data.get(`${tenantId}:${waId}`);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.data.delete(`${tenantId}:${waId}`);
      return null;
    }
    return structuredClone(entry.session);
  }

  async set(tenantId: string, waId: string, session: SessionState, ttlSeconds: number): Promise<void> {
    this.data.set(`${tenantId}:${waId}`, { session: structuredClone(session), expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async delete(tenantId: string, waId: string): Promise<void> {
    this.data.delete(`${tenantId}:${waId}`);
  }
}

export class InMemoryDedupeStore implements DedupeStore {
  private readonly seen = new Map<string, number>();

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const until = this.seen.get(key);
    if (until && until > now) return false;
    this.seen.set(key, now + ttlSeconds * 1000);
    return true;
  }
}
