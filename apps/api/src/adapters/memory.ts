import type { Customer, Tenant } from "@ordr/domain";
import type { SessionState } from "@ordr/flow-schema";
import type {
  ConversationRecord,
  ConversationRepository,
  ConversationStatus,
  CreateUserInput,
  DedupeStore,
  MessageRecord,
  SessionStore,
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
    return this.byPhone.get(phoneNumberId) ?? null;
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    for (const ctx of this.byPhone.values()) if (ctx.tenant.id === tenantId) return ctx.tenant;
    return null;
  }

  async findContextById(tenantId: string): Promise<TenantContext | null> {
    for (const ctx of this.byPhone.values()) if (ctx.tenant.id === tenantId && ctx.channel.status === "active") return ctx;
    return null;
  }
}

export class InMemoryUserRepository implements UserRepository {
  readonly users: UserRecord[] = [];
  readonly logins = new Map<string, Date>();

  constructor(seed: Array<Omit<UserRecord, "id" | "isActive"> & Partial<Pick<UserRecord, "id" | "isActive">>> = []) {
    for (const u of seed) this.users.push({ id: u.id ?? nextId("usr"), isActive: u.isActive ?? true, ...u });
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const key = email.trim().toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === key) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    const user: UserRecord = { id: nextId("usr"), isActive: true, ...input, email: input.email.trim().toLowerCase() };
    this.users.push(user);
    return user;
  }

  async touchLogin(id: string, at: Date): Promise<void> {
    this.logins.set(id, at);
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  readonly customers = new Map<string, Customer>();
  readonly conversations = new Map<string, ConversationRecord & { lastInboundAt?: Date }>();
  readonly messages: MessageRecord[] = [];
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
    const created: ConversationRecord = { id: nextId("conv"), tenantId, customerId, channelId, status: "bot" };
    this.conversations.set(created.id, created);
    return created;
  }

  async setConversationStatus(conversationId: string, status: ConversationStatus): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (c) c.status = status;
  }

  async touchInbound(conversationId: string, at: Date): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (c) c.lastInboundAt = at;
  }

  async recordMessage(message: MessageRecord): Promise<void> {
    this.messages.push(message);
  }

  async updateMessageStatus(providerMessageId: string, status: string): Promise<void> {
    this.statuses.set(providerMessageId, status);
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
