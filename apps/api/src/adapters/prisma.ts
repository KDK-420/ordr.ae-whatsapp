import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Customer, Tenant } from "@ordr/domain";
import type { SessionState } from "@ordr/flow-schema";
import { Prisma, PrismaClient } from "@prisma/client";
import { previewOf } from "../conversation/preview";
import type {
  ConversationRecord,
  ConversationRepository,
  ConversationStatus,
  ConversationSummary,
  CreateUserInput,
  DedupeStore,
  MessageRecord,
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
      provider: "meta_cloud",
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
    const channel = await this.prisma.channel.findFirst({ where: { tenantId, status: "active" }, orderBy: { createdAt: "asc" }, include: { tenant: true } });
    return channel ? toContext(channel) : null;
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      blueprintId: t.blueprintId,
      defaultLanguage: t.defaultLanguage,
      timezone: t.timezone,
      settings: (t.settings as Record<string, unknown>) ?? {},
    };
  }
}

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

  async findConversationById(conversationId: string): Promise<(ConversationRecord & { lastInboundAt?: Date }) | null> {
    const row = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      channelId: row.channelId,
      status: row.status as ConversationStatus,
      lastInboundAt: row.lastInboundAt ?? undefined,
    };
  }

  async getOrCreateOpenConversation(tenantId: string, customerId: string, channelId: string): Promise<ConversationRecord> {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, customerId, status: { not: "closed" } },
      orderBy: { createdAt: "desc" },
    });
    const row = existing ?? (await this.prisma.conversation.create({ data: { tenantId, customerId, channelId } }));
    return { id: row.id, tenantId: row.tenantId, customerId: row.customerId, channelId: row.channelId, status: row.status as ConversationStatus };
  }

  async setConversationStatus(conversationId: string, status: ConversationStatus): Promise<void> {
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { status } });
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
    return rows.reverse().map((m) => ({
      id: m.id,
      tenantId: m.tenantId,
      conversationId: m.conversationId,
      direction: m.direction as "in" | "out",
      providerMessageId: m.providerMessageId ?? undefined,
      kind: m.kind,
      payload: m.payload,
      status: m.status ?? undefined,
      createdAt: m.createdAt,
    }));
  }
}

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

const toUser = (u: { id: string; tenantId: string; email: string; name: string; role: string; passwordHash: string; isActive: boolean }): UserRecord => ({
  id: u.id,
  tenantId: u.tenantId,
  email: u.email,
  name: u.name,
  role: u.role === "owner" ? "owner" : ("staff" satisfies UserRole),
  passwordHash: u.passwordHash,
  isActive: u.isActive,
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
