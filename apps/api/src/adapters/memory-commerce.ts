import { SlotTakenError } from "@ordr/domain";
import type {
  AgentRunRecord,
  AgentRunRepository,
  BookingHoldRecord,
  BookingHoldRepository,
  CartRecord,
  CartRepository,
  ConsentRecord,
  CreateHoldInput,
  HoldStatus,
  MemoryRecord,
  MemoryRepository,
  OrderRepository,
  PaymentIntentRecord,
  PaymentIntentRepository,
  PaymentIntentStatus,
  WebhookReceiptRepository,
  WebSessionRecord,
  WebSessionRepository,
} from "../ports";

let seq = 0;
const nextId = (p: string) => `${p}_${++seq}`;
const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && bStart < aEnd;

export class InMemoryCartRepository implements CartRepository {
  readonly carts: CartRecord[] = [];

  async findOpen(tenantId: string, customerId: string): Promise<CartRecord | null> {
    const c = [...this.carts].reverse().find((x) => x.tenantId === tenantId && x.customerId === customerId && x.status === "open");
    return c ? structuredClone(c) : null;
  }

  async create(tenantId: string, customerId: string, currency: string, conversationId?: string): Promise<CartRecord> {
    const cart: CartRecord = { id: nextId("cart"), tenantId, customerId, conversationId, status: "open", currency, items: [], updatedAt: new Date().toISOString() };
    this.carts.push(cart);
    return structuredClone(cart);
  }

  async save(cart: CartRecord): Promise<CartRecord> {
    const i = this.carts.findIndex((x) => x.id === cart.id);
    if (i < 0) throw new Error("cart not found");
    this.carts[i] = structuredClone({ ...cart, updatedAt: new Date().toISOString() });
    return structuredClone(this.carts[i]!);
  }
}

export class InMemoryPaymentIntentRepository implements PaymentIntentRepository {
  readonly intents: PaymentIntentRecord[] = [];

  async create(input: Omit<PaymentIntentRecord, "status" | "paidAt">): Promise<PaymentIntentRecord> {
    const rec: PaymentIntentRecord = { ...input, status: "pending" };
    this.intents.push(rec);
    return structuredClone(rec);
  }

  async findById(id: string): Promise<PaymentIntentRecord | null> {
    const r = this.intents.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }

  async findByOrder(tenantId: string, orderId: string): Promise<PaymentIntentRecord | null> {
    const r = this.intents.find((x) => x.tenantId === tenantId && x.orderId === orderId);
    return r ? structuredClone(r) : null;
  }

  async setStatus(id: string, status: PaymentIntentStatus, patch: { providerRef?: string; paidAt?: Date } = {}): Promise<PaymentIntentRecord | null> {
    const r = this.intents.find((x) => x.id === id);
    if (!r) return null;
    r.status = status;
    if (patch.providerRef) r.providerRef = patch.providerRef;
    if (patch.paidAt) r.paidAt = patch.paidAt.toISOString();
    return structuredClone(r);
  }

  async listExpired(now: Date, limit = 100): Promise<PaymentIntentRecord[]> {
    return this.intents.filter((x) => x.status === "pending" && new Date(x.expiresAt) < now).slice(0, limit).map((x) => structuredClone(x));
  }
}

export class InMemoryWebhookReceiptRepository implements WebhookReceiptRepository {
  private readonly seen = new Set<string>();
  async claim(provider: string, eventId: string): Promise<boolean> {
    const key = `${provider}:${eventId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

/** Holds also need the bookings to check against; the order repository is handed in. */
export class InMemoryBookingHoldRepository implements BookingHoldRepository {
  readonly holds: BookingHoldRecord[] = [];
  constructor(private readonly orders: OrderRepository) {}

  async create(input: CreateHoldInput, blockingStatuses: string[]): Promise<BookingHoldRecord> {
    const now = new Date();
    if ((await this.activeOverlapping(input.tenantId, input.resourceId, input.startAt, input.endAt, now)).length) throw new SlotTakenError();
    const bookings = await this.orders.listBookings(input.tenantId, { from: new Date(input.startAt.getTime() - 24 * 60 * 60_000), to: input.endAt, resourceId: input.resourceId, statuses: blockingStatuses });
    if (bookings.some((b) => b.scheduledAt && overlaps(input.startAt, input.endAt, new Date(b.scheduledAt), new Date(new Date(b.scheduledAt).getTime() + (b.durationMinutes ?? 0) * 60_000)))) throw new SlotTakenError();
    const hold: BookingHoldRecord = { id: nextId("hold"), tenantId: input.tenantId, customerId: input.customerId, conversationId: input.conversationId, offeringId: input.offeringId, resourceId: input.resourceId, startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString(), status: "held", expiresAt: input.expiresAt.toISOString() };
    this.holds.push(hold);
    return structuredClone(hold);
  }

  async findById(tenantId: string, id: string): Promise<BookingHoldRecord | null> {
    const h = this.holds.find((x) => x.tenantId === tenantId && x.id === id);
    return h ? structuredClone(h) : null;
  }

  async setStatus(id: string, status: HoldStatus): Promise<BookingHoldRecord | null> {
    const h = this.holds.find((x) => x.id === id);
    if (!h) return null;
    h.status = status;
    return structuredClone(h);
  }

  async activeOverlapping(tenantId: string, resourceId: string, from: Date, to: Date, now: Date, exceptId?: string): Promise<BookingHoldRecord[]> {
    return this.holds
      .filter((h) => h.tenantId === tenantId && h.resourceId === resourceId && h.status === "held" && new Date(h.expiresAt) > now && h.id !== exceptId && overlaps(from, to, new Date(h.startAt), new Date(h.endAt)))
      .map((h) => structuredClone(h));
  }

  async expire(now: Date): Promise<number> {
    let n = 0;
    for (const h of this.holds) {
      if (h.status === "held" && new Date(h.expiresAt) <= now) {
        h.status = "expired";
        n += 1;
      }
    }
    return n;
  }
}

export class InMemoryWebSessionRepository implements WebSessionRepository {
  readonly sessions: Array<WebSessionRecord & { tokenHash: string }> = [];

  async create(input: { tenantId: string; customerId: string; conversationId: string; tokenHash: string }): Promise<WebSessionRecord> {
    const now = new Date().toISOString();
    const s = { id: nextId("ws"), ...input, createdAt: now, lastSeenAt: now };
    this.sessions.push(s);
    const { tokenHash: _t, ...rec } = s;
    return rec;
  }

  async findByTokenHash(tokenHash: string): Promise<WebSessionRecord | null> {
    const s = this.sessions.find((x) => x.tokenHash === tokenHash);
    if (!s) return null;
    const { tokenHash: _t, ...rec } = s;
    return { ...rec };
  }

  async touch(id: string, at: Date): Promise<void> {
    const s = this.sessions.find((x) => x.id === id);
    if (s) s.lastSeenAt = at.toISOString();
  }
}

export class InMemoryMemoryRepository implements MemoryRepository {
  readonly memories: MemoryRecord[] = [];
  readonly consents: ConsentRecord[] = [];

  async listActive(tenantId: string, customerId: string, now: Date): Promise<MemoryRecord[]> {
    return this.memories
      .filter((m) => m.tenantId === tenantId && m.customerId === customerId && !m.deletedAt && (!m.expiresAt || new Date(m.expiresAt) > now))
      .sort((a, b) => b.lastConfirmedAt.localeCompare(a.lastConfirmedAt))
      .map((m) => structuredClone(m));
  }

  async upsert(input: Omit<MemoryRecord, "id" | "createdAt" | "lastConfirmedAt" | "deletedAt">): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const existing = this.memories.find((m) => m.tenantId === input.tenantId && m.customerId === input.customerId && m.key === input.key && !m.deletedAt);
    if (existing) {
      Object.assign(existing, { kind: input.kind, value: input.value, confidence: input.confidence, sourceMessageIds: input.sourceMessageIds, consentPurpose: input.consentPurpose, expiresAt: input.expiresAt, lastConfirmedAt: now });
      return structuredClone(existing);
    }
    const rec: MemoryRecord = { id: nextId("mem"), ...input, createdAt: now, lastConfirmedAt: now };
    this.memories.push(rec);
    return structuredClone(rec);
  }

  async forget(tenantId: string, customerId: string, key?: string): Promise<number> {
    let n = 0;
    for (const m of this.memories) {
      if (m.tenantId === tenantId && m.customerId === customerId && !m.deletedAt && (!key || m.key === key)) {
        m.deletedAt = new Date().toISOString();
        n += 1;
      }
    }
    return n;
  }

  async getConsent(tenantId: string, customerId: string): Promise<ConsentRecord | null> {
    const c = this.consents.find((x) => x.tenantId === tenantId && x.customerId === customerId);
    return c ? { ...c } : null;
  }

  async setConsent(input: Omit<ConsentRecord, "updatedAt">): Promise<ConsentRecord> {
    const existing = this.consents.find((x) => x.customerId === input.customerId);
    const rec: ConsentRecord = { ...input, updatedAt: new Date().toISOString() };
    if (existing) Object.assign(existing, rec);
    else this.consents.push(rec);
    return { ...rec };
  }
}

export class InMemoryAgentRunRepository implements AgentRunRepository {
  readonly runs: AgentRunRecord[] = [];

  async record(run: Omit<AgentRunRecord, "id" | "createdAt">): Promise<AgentRunRecord> {
    const rec: AgentRunRecord = { ...run, id: nextId("run"), createdAt: new Date().toISOString() };
    this.runs.push(rec);
    return structuredClone(rec);
  }

  async listForConversation(tenantId: string, conversationId: string, limit = 50): Promise<AgentRunRecord[]> {
    return this.runs
      .filter((r) => r.tenantId === tenantId && r.conversationId === conversationId)
      .reverse()
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
}
