import { SlotTakenError } from "@ordr/domain";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AgentRunRecord,
  AgentRunRepository,
  BookingHoldRecord,
  BookingHoldRepository,
  CartLine,
  CartRecord,
  CartRepository,
  ConsentRecord,
  CreateHoldInput,
  PushSubscriptionRecord,
  PushSubscriptionRepository,
  HoldStatus,
  MemoryRecord,
  MemoryRepository,
  PaymentIntentRecord,
  PaymentIntentRepository,
  PaymentIntentStatus,
  WebhookReceiptRepository,
  WebSessionRecord,
  WebSessionRepository,
} from "../ports";

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

const toCart = (r: { id: string; tenantId: string; customerId: string; conversationId: string | null; status: string; currency: string; items: Prisma.JsonValue; expiresAt: Date | null; updatedAt: Date }): CartRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  customerId: r.customerId,
  conversationId: r.conversationId ?? undefined,
  status: r.status as CartRecord["status"],
  currency: r.currency,
  items: (Array.isArray(r.items) ? r.items : []) as unknown as CartLine[],
  expiresAt: r.expiresAt?.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export class PrismaCartRepository implements CartRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findOpen(tenantId: string, customerId: string): Promise<CartRecord | null> {
    const r = await this.prisma.cart.findFirst({ where: { tenantId, customerId, status: "open" }, orderBy: { updatedAt: "desc" } });
    return r ? toCart(r) : null;
  }

  async create(tenantId: string, customerId: string, currency: string, conversationId?: string): Promise<CartRecord> {
    return toCart(await this.prisma.cart.create({ data: { tenantId, customerId, currency, conversationId, items: [] } }));
  }

  async save(cart: CartRecord): Promise<CartRecord> {
    const r = await this.prisma.cart.update({
      where: { id: cart.id },
      data: { items: cart.items as unknown as Prisma.InputJsonValue, status: cart.status, conversationId: cart.conversationId, expiresAt: cart.expiresAt ? new Date(cart.expiresAt) : null },
    });
    return toCart(r);
  }
}

const toIntent = (r: { id: string; tenantId: string; orderId: string; provider: string; amountMinor: number; currency: string; status: string; checkoutUrl: string; providerRef: string | null; expiresAt: Date; paidAt: Date | null }): PaymentIntentRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  orderId: r.orderId,
  provider: r.provider,
  amountMinor: r.amountMinor,
  currency: r.currency,
  status: r.status as PaymentIntentStatus,
  checkoutUrl: r.checkoutUrl,
  providerRef: r.providerRef ?? undefined,
  expiresAt: r.expiresAt.toISOString(),
  paidAt: r.paidAt?.toISOString(),
});

export class PrismaPaymentIntentRepository implements PaymentIntentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: Omit<PaymentIntentRecord, "status" | "paidAt">): Promise<PaymentIntentRecord> {
    return toIntent(
      await this.prisma.paymentIntent.create({
        data: { id: input.id, tenantId: input.tenantId, orderId: input.orderId, provider: input.provider, amountMinor: input.amountMinor, currency: input.currency, checkoutUrl: input.checkoutUrl, providerRef: input.providerRef, expiresAt: new Date(input.expiresAt) },
      }),
    );
  }

  async findById(id: string): Promise<PaymentIntentRecord | null> {
    const r = await this.prisma.paymentIntent.findUnique({ where: { id } });
    return r ? toIntent(r) : null;
  }

  async findByOrder(tenantId: string, orderId: string): Promise<PaymentIntentRecord | null> {
    const r = await this.prisma.paymentIntent.findFirst({ where: { tenantId, orderId } });
    return r ? toIntent(r) : null;
  }

  async setStatus(id: string, status: PaymentIntentStatus, patch: { providerRef?: string; paidAt?: Date } = {}): Promise<PaymentIntentRecord | null> {
    const r = await this.prisma.paymentIntent.findUnique({ where: { id } });
    if (!r) return null;
    return toIntent(await this.prisma.paymentIntent.update({ where: { id }, data: { status, ...(patch.providerRef ? { providerRef: patch.providerRef } : {}), ...(patch.paidAt ? { paidAt: patch.paidAt } : {}) } }));
  }

  async listExpired(now: Date, limit = 100): Promise<PaymentIntentRecord[]> {
    const rows = await this.prisma.paymentIntent.findMany({ where: { status: "pending", expiresAt: { lt: now } }, take: limit, orderBy: { expiresAt: "asc" } });
    return rows.map(toIntent);
  }
}

const toPush = (r: { id: string; userId: string; tenantId: string; endpoint: string; keys: unknown; userAgent: string | null; createdAt: Date }): PushSubscriptionRecord => ({
  id: r.id,
  userId: r.userId,
  tenantId: r.tenantId,
  endpoint: r.endpoint,
  keys: r.keys as { p256dh: string; auth: string },
  userAgent: r.userAgent ?? undefined,
  createdAt: r.createdAt,
});

export class PrismaPushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(input: Omit<PushSubscriptionRecord, "id" | "createdAt">): Promise<PushSubscriptionRecord> {
    const data = { userId: input.userId, tenantId: input.tenantId, keys: input.keys, userAgent: input.userAgent ?? null };
    const row = await this.prisma.pushSubscription.upsert({ where: { endpoint: input.endpoint }, create: { ...data, endpoint: input.endpoint }, update: data });
    return toPush(row);
  }

  async listByTenant(tenantId: string): Promise<PushSubscriptionRecord[]> {
    const rows = await this.prisma.pushSubscription.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
    return rows.map(toPush);
  }

  async removeByEndpoint(endpoint: string, userId?: string): Promise<boolean> {
    const res = await this.prisma.pushSubscription.deleteMany({ where: { endpoint, ...(userId ? { userId } : {}) } });
    return res.count > 0;
  }
}

export class PrismaWebhookReceiptRepository implements WebhookReceiptRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(provider: string, eventId: string): Promise<boolean> {
    const res = await this.prisma.webhookReceipt.createMany({ data: [{ id: `${provider}:${eventId}`, provider }], skipDuplicates: true });
    return res.count === 1;
  }
}

const toHold = (r: { id: string; tenantId: string; customerId: string; conversationId: string | null; offeringId: string; resourceId: string; startAt: Date; endAt: Date; status: string; expiresAt: Date }): BookingHoldRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  customerId: r.customerId,
  conversationId: r.conversationId ?? undefined,
  offeringId: r.offeringId,
  resourceId: r.resourceId,
  startAt: r.startAt.toISOString(),
  endAt: r.endAt.toISOString(),
  status: r.status as HoldStatus,
  expiresAt: r.expiresAt.toISOString(),
});

export class PrismaBookingHoldRepository implements BookingHoldRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateHoldInput, blockingStatuses: string[]): Promise<BookingHoldRecord> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Resource" WHERE id = ${input.resourceId} FOR UPDATE`;
      const now = new Date();
      const holds = await tx.bookingHold.count({ where: { tenantId: input.tenantId, resourceId: input.resourceId, status: "held", expiresAt: { gt: now }, startAt: { lt: input.endAt }, endAt: { gt: input.startAt } } });
      if (holds > 0) throw new SlotTakenError();
      const bookings = await tx.order.findMany({
        where: { tenantId: input.tenantId, resourceId: input.resourceId, status: { in: blockingStatuses }, scheduledAt: { gte: new Date(input.startAt.getTime() - 24 * 60 * 60_000), lt: input.endAt } },
        select: { scheduledAt: true, durationMinutes: true },
      });
      if (bookings.some((b) => b.scheduledAt && overlaps(input.startAt, input.endAt, b.scheduledAt, new Date(b.scheduledAt.getTime() + (b.durationMinutes ?? 0) * 60_000)))) throw new SlotTakenError();
      return toHold(await tx.bookingHold.create({ data: { ...input } }));
    });
  }

  async findById(tenantId: string, id: string): Promise<BookingHoldRecord | null> {
    const r = await this.prisma.bookingHold.findFirst({ where: { tenantId, id } });
    return r ? toHold(r) : null;
  }

  async setStatus(id: string, status: HoldStatus): Promise<BookingHoldRecord | null> {
    const r = await this.prisma.bookingHold.findUnique({ where: { id } });
    if (!r) return null;
    return toHold(await this.prisma.bookingHold.update({ where: { id }, data: { status } }));
  }

  async activeOverlapping(tenantId: string, resourceId: string, from: Date, to: Date, now: Date, exceptId?: string): Promise<BookingHoldRecord[]> {
    const rows = await this.prisma.bookingHold.findMany({ where: { tenantId, resourceId, status: "held", expiresAt: { gt: now }, startAt: { lt: to }, endAt: { gt: from }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    return rows.map(toHold);
  }

  async expire(now: Date): Promise<number> {
    const res = await this.prisma.bookingHold.updateMany({ where: { status: "held", expiresAt: { lte: now } }, data: { status: "expired" } });
    return res.count;
  }
}

export class PrismaWebSessionRepository implements WebSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { tenantId: string; customerId: string; conversationId: string; tokenHash: string }): Promise<WebSessionRecord> {
    const r = await this.prisma.webSession.create({ data: input });
    return { id: r.id, tenantId: r.tenantId, customerId: r.customerId, conversationId: r.conversationId, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString() };
  }

  async findByTokenHash(tokenHash: string): Promise<WebSessionRecord | null> {
    const r = await this.prisma.webSession.findUnique({ where: { tokenHash } });
    return r ? { id: r.id, tenantId: r.tenantId, customerId: r.customerId, conversationId: r.conversationId, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString() } : null;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.prisma.webSession.updateMany({ where: { id }, data: { lastSeenAt: at } });
  }
}

const toMemory = (r: { id: string; tenantId: string; customerId: string; kind: string; key: string; value: Prisma.JsonValue; confidence: number; sourceMessageIds: Prisma.JsonValue; consentPurpose: string; createdAt: Date; lastConfirmedAt: Date; expiresAt: Date | null; deletedAt: Date | null }): MemoryRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  customerId: r.customerId,
  kind: r.kind as MemoryRecord["kind"],
  key: r.key,
  value: r.value,
  confidence: r.confidence,
  sourceMessageIds: (Array.isArray(r.sourceMessageIds) ? r.sourceMessageIds : []) as string[],
  consentPurpose: r.consentPurpose,
  createdAt: r.createdAt.toISOString(),
  lastConfirmedAt: r.lastConfirmedAt.toISOString(),
  expiresAt: r.expiresAt?.toISOString(),
  deletedAt: r.deletedAt?.toISOString(),
});

export class PrismaMemoryRepository implements MemoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listActive(tenantId: string, customerId: string, now: Date): Promise<MemoryRecord[]> {
    const rows = await this.prisma.memory.findMany({ where: { tenantId, customerId, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: { lastConfirmedAt: "desc" } });
    return rows.map(toMemory);
  }

  async upsert(input: Omit<MemoryRecord, "id" | "createdAt" | "lastConfirmedAt" | "deletedAt">): Promise<MemoryRecord> {
    const existing = await this.prisma.memory.findFirst({ where: { tenantId: input.tenantId, customerId: input.customerId, key: input.key, deletedAt: null } });
    const data = {
      kind: input.kind,
      value: input.value as Prisma.InputJsonValue,
      confidence: input.confidence,
      sourceMessageIds: input.sourceMessageIds as Prisma.InputJsonValue,
      consentPurpose: input.consentPurpose,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      lastConfirmedAt: new Date(),
    };
    if (existing) return toMemory(await this.prisma.memory.update({ where: { id: existing.id }, data }));
    return toMemory(await this.prisma.memory.create({ data: { tenantId: input.tenantId, customerId: input.customerId, key: input.key, ...data } }));
  }

  async forget(tenantId: string, customerId: string, key?: string): Promise<number> {
    const res = await this.prisma.memory.updateMany({ where: { tenantId, customerId, deletedAt: null, ...(key ? { key } : {}) }, data: { deletedAt: new Date() } });
    return res.count;
  }

  async getConsent(tenantId: string, customerId: string): Promise<ConsentRecord | null> {
    const r = await this.prisma.customerConsent.findFirst({ where: { tenantId, customerId } });
    return r ? { customerId: r.customerId, tenantId: r.tenantId, memory: r.memory, purpose: r.purpose, sourceMessageId: r.sourceMessageId ?? undefined, updatedAt: r.updatedAt.toISOString() } : null;
  }

  async setConsent(input: Omit<ConsentRecord, "updatedAt">): Promise<ConsentRecord> {
    const r = await this.prisma.customerConsent.upsert({
      where: { customerId: input.customerId },
      update: { memory: input.memory, purpose: input.purpose, sourceMessageId: input.sourceMessageId },
      create: { customerId: input.customerId, tenantId: input.tenantId, memory: input.memory, purpose: input.purpose, sourceMessageId: input.sourceMessageId },
    });
    return { customerId: r.customerId, tenantId: r.tenantId, memory: r.memory, purpose: r.purpose, sourceMessageId: r.sourceMessageId ?? undefined, updatedAt: r.updatedAt.toISOString() };
  }
}

export class PrismaAgentRunRepository implements AgentRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(run: Omit<AgentRunRecord, "id" | "createdAt">): Promise<AgentRunRecord> {
    const r = await this.prisma.agentRun.create({
      data: { ...run, tools: run.tools as unknown as Prisma.InputJsonValue, memoryIds: run.memoryIds as unknown as Prisma.InputJsonValue },
    });
    return { ...run, id: r.id, createdAt: r.createdAt.toISOString() };
  }

  async listForConversation(tenantId: string, conversationId: string, limit = 50): Promise<AgentRunRecord[]> {
    const rows = await this.prisma.agentRun.findMany({ where: { tenantId, conversationId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      conversationId: r.conversationId,
      inboundMessageId: r.inboundMessageId ?? undefined,
      channel: r.channel,
      model: r.model,
      tools: (Array.isArray(r.tools) ? r.tools : []) as AgentRunRecord["tools"],
      memoryIds: (Array.isArray(r.memoryIds) ? r.memoryIds : []) as string[],
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      durationMs: r.durationMs,
      outcome: r.outcome as AgentRunRecord["outcome"],
      error: r.error ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
