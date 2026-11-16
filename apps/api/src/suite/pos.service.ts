import { Inject, Injectable } from "@nestjs/common";
import { type Customer, localDateKey, type Order, zonedToUtc } from "@ordr/domain";
import type { ConversationRepository, OrderRepository } from "../ports";
import { TOKENS } from "../tokens";
import { SuiteService } from "./suite.service";
import type { OrderPaymentRecord, SuiteRepository } from "./types";

export interface PosOrderView extends Order {
  payments: OrderPaymentRecord[];
  paidMinor: number;
  dueMinor: number;
  customerName?: string;
}

export interface DayReport {
  date: string;
  branch: { id: string; name: string };
  orders: number;
  cancelled: number;
  grossMinor: number;
  vatMinor: number;
  discountMinor: number;
  averageMinor: number;
  collectedMinor: number;
  unpaidMinor: number;
  byMethod: Array<{ method: string; amountMinor: number; count: number }>;
  bySource: Array<{ source: string; orders: number; grossMinor: number }>;
  byType: Array<{ type: string; orders: number; grossMinor: number }>;
  topItems: Array<{ title: string; quantity: number; grossMinor: number }>;
  currency: string;
}

const DROPPED = new Set(["cancelled", "rejected"]);

/** What the till shows besides selling: today's orders, the day's numbers, and who the customers are. */
@Injectable()
export class PosService {
  constructor(
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.SuiteRepository) private readonly repo: SuiteRepository,
    @Inject(TOKENS.ConversationRepository) private readonly customers: ConversationRepository,
  ) {}

  /** The local day containing `date` (YYYY-MM-DD, default today) as instants. */
  private async day(tenantId: string, date?: string): Promise<{ key: string; from: Date; to: Date }> {
    const tenant = await this.suite.tenant(tenantId);
    const tz = tenant.timezone || "Asia/Dubai";
    const key = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateKey(new Date(), tz);
    const from = zonedToUtc(key, "00:00", tz);
    return { key, from, to: new Date(from.getTime() + 24 * 60 * 60_000) };
  }

  async view(tenantId: string, order: Order): Promise<PosOrderView> {
    const [view] = await this.views(tenantId, [order]);
    return view!;
  }

  private async views(tenantId: string, orders: Order[], payments?: OrderPaymentRecord[]): Promise<PosOrderView[]> {
    const all = payments ?? (await Promise.all(orders.map((o) => this.repo.listPayments(tenantId, { orderId: o.id })))).flat();
    const byOrder = new Map<string, OrderPaymentRecord[]>();
    for (const p of all) byOrder.set(p.orderId, [...(byOrder.get(p.orderId) ?? []), p]);
    const people = await this.customers.findCustomersByIds([...new Set(orders.map((o) => o.customerId))]);
    const names = new Map<string, Customer>(people.map((c) => [c.id, c]));
    return orders.map((o) => {
      const mine = byOrder.get(o.id) ?? [];
      const paidMinor = mine.reduce((n, p) => n + p.amountMinor, 0);
      return { ...o, payments: mine, paidMinor, dueMinor: Math.max(0, o.totalMinor - paidMinor), customerName: o.contactName ?? names.get(o.customerId)?.name };
    });
  }

  /** The day's orders at a branch, newest first, each with what was paid. */
  async dayOrders(tenantId: string, opts: { branchId?: string; date?: string } = {}): Promise<PosOrderView[]> {
    const branch = await this.suite.branch(tenantId, opts.branchId);
    const { from, to } = await this.day(tenantId, opts.date);
    const rows = (await this.orders.listRecent(tenantId, { branchId: branch.id, createdSince: from, limit: 500 })).filter((o) => o.kind === "order" && new Date(o.createdAt) < to);
    const payments = await this.repo.listPayments(tenantId, { branchId: branch.id, from, to: new Date(to.getTime() + 24 * 60 * 60_000) });
    return this.views(tenantId, rows, payments.filter((p) => rows.some((o) => o.id === p.orderId)));
  }

  async report(tenantId: string, opts: { branchId?: string; date?: string } = {}): Promise<DayReport> {
    const branch = await this.suite.branch(tenantId, opts.branchId);
    const { key } = await this.day(tenantId, opts.date);
    const all = await this.dayOrders(tenantId, { branchId: branch.id, date: key });
    const sold = all.filter((o) => !DROPPED.has(o.status));
    const sum = (rows: PosOrderView[], f: (o: PosOrderView) => number) => rows.reduce((n, o) => n + f(o), 0);
    const group = <K extends string>(keyOf: (o: PosOrderView) => K) => {
      const m = new Map<K, { orders: number; grossMinor: number }>();
      for (const o of sold) {
        const g = m.get(keyOf(o)) ?? { orders: 0, grossMinor: 0 };
        g.orders += 1;
        g.grossMinor += o.totalMinor;
        m.set(keyOf(o), g);
      }
      return [...m.entries()].sort((a, b) => b[1].grossMinor - a[1].grossMinor);
    };
    const methods = new Map<string, { amountMinor: number; count: number }>();
    for (const p of sold.flatMap((o) => o.payments)) {
      const m = methods.get(p.method) ?? { amountMinor: 0, count: 0 };
      m.amountMinor += p.amountMinor;
      m.count += 1;
      methods.set(p.method, m);
    }
    const items = new Map<string, { quantity: number; grossMinor: number }>();
    for (const line of sold.flatMap((o) => o.items)) {
      const i = items.get(line.title) ?? { quantity: 0, grossMinor: 0 };
      i.quantity += line.quantity;
      i.grossMinor += line.lineTotalMinor;
      items.set(line.title, i);
    }
    const grossMinor = sum(sold, (o) => o.totalMinor);
    return {
      date: key,
      branch: { id: branch.id, name: branch.name },
      orders: sold.length,
      cancelled: all.length - sold.length,
      grossMinor,
      vatMinor: sum(sold, (o) => o.vatMinor),
      discountMinor: sum(sold, (o) => o.discountMinor ?? 0),
      averageMinor: sold.length ? Math.round(grossMinor / sold.length) : 0,
      collectedMinor: sum(sold, (o) => o.paidMinor),
      unpaidMinor: sum(sold, (o) => o.dueMinor),
      byMethod: [...methods.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amountMinor - a.amountMinor),
      bySource: group((o) => o.source).map(([source, v]) => ({ source, ...v })),
      byType: group((o) => o.fulfillmentType).map(([type, v]) => ({ type, ...v })),
      topItems: [...items.entries()].map(([title, v]) => ({ title, ...v })).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
      currency: sold[0]?.currency ?? all[0]?.currency ?? "AED",
    };
  }

  /** People who ordered recently, with how often and how much; the walk-in placeholder is left out. */
  async recentCustomers(tenantId: string): Promise<Array<{ id: string; name?: string; phone?: string; orders: number; spentMinor: number; lastOrderAt: string }>> {
    const rows = (await this.orders.listRecent(tenantId, { limit: 500 })).filter((o) => o.kind === "order" && !DROPPED.has(o.status));
    const stats = new Map<string, { orders: number; spentMinor: number; lastOrderAt: string }>();
    for (const o of rows) {
      const s = stats.get(o.customerId) ?? { orders: 0, spentMinor: 0, lastOrderAt: o.createdAt };
      s.orders += 1;
      s.spentMinor += o.totalMinor;
      if (o.createdAt > s.lastOrderAt) s.lastOrderAt = o.createdAt;
      stats.set(o.customerId, s);
    }
    const people = await this.customers.findCustomersByIds([...stats.keys()]);
    return people
      .filter((c) => /^\d+$/.test(c.waId))
      .map((c) => ({ id: c.id, name: c.name, phone: c.waId, ...stats.get(c.id)! }))
      .sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
  }
}
