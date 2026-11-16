import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { InvalidTransitionError, type KitchenStatus, localDateKey, type Order, zonedToUtc } from "@ordr/domain";
import { OrderService } from "../orders/order.service";
import type { OrderItemPatch, OrderRepository } from "../ports";
import { TOKENS } from "../tokens";
import { RealtimeHub } from "./realtime";
import { SuiteService } from "./suite.service";
import type { Station } from "./types";

export type KitchenColumn = "new" | "preparing" | "ready" | "completed";
export type KitchenAction = "start" | "ready" | "complete";

export interface KitchenLine {
  id: string;
  title: string;
  quantity: number;
  modifiers: string[];
  notes?: string;
  status: KitchenStatus;
  stationId?: string;
}

export interface KitchenTicket {
  orderId: string;
  number: number;
  column: KitchenColumn;
  source: string;
  fulfillmentType: string;
  tableLabel?: string;
  contactName?: string;
  notes?: string;
  /** When the kitchen clock started: when the order was sent, else when it was placed. */
  firedAt: string;
  startedAt?: string;
  readyAt?: string;
  completedAt?: string;
  lines: KitchenLine[];
}

export interface KitchenBoard {
  branch: { id: string; name: string };
  stations: Station[];
  stationId: string | null;
  tickets: KitchenTicket[];
  stats: { todayOrders: number; avgPrepSeconds: number | null; pending: number; completed: number };
  serverTime: string;
}

/** Order states the kitchen is done with. */
const LEFT_THE_KITCHEN = new Set(["out_for_delivery", "delivered", "completed"]);
const DROPPED = new Set(["cancelled", "rejected"]);
/** The order states a kitchen walks through, in order, with the event that enters each. */
const PATH: Array<{ status: string; via: string }> = [
  { status: "placed", via: "" },
  { status: "accepted", via: "accept" },
  { status: "preparing", via: "start" },
  { status: "ready", via: "ready" },
];

/**
 * Kitchen display. Tickets are a view over order lines: a station sees the lines routed to it,
 * the pass ("all stations") sees whole orders. Moving lines moves the order through the
 * blueprint's states, so a WhatsApp customer still gets "preparing" and "ready" messages.
 */
@Injectable()
export class KdsService {
  constructor(
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(OrderService) private readonly orderService: OrderService,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  async board(tenantId: string, opts: { branchId?: string; stationId?: string } = {}): Promise<KitchenBoard> {
    const tenant = await this.suite.tenant(tenantId);
    const branch = await this.suite.branch(tenantId, opts.branchId);
    const station = opts.stationId ? branch.stations.find((s) => s.id === opts.stationId) : undefined;
    if (opts.stationId && !station) throw new NotFoundException("station not found");
    const tz = tenant.timezone || "Asia/Dubai";
    const dayStart = zonedToUtc(localDateKey(new Date(), tz), "00:00", tz);
    const rows = (await this.orders.listRecent(tenantId, { branchId: branch.id, createdSince: dayStart, limit: 500 })).filter((o) => o.kind === "order" && !DROPPED.has(o.status));

    const tickets: KitchenTicket[] = [];
    for (const order of rows) {
      const lines = order.items.filter((i) => !station || i.stationId === station.id);
      if (lines.length === 0) continue;
      tickets.push(toTicket(order, lines, columnOf(order, lines, !!station)));
    }
    // Oldest first within a column, so the cook reads top to bottom; finished ones newest first.
    const active = tickets.filter((t) => t.column !== "completed").sort((a, b) => a.firedAt.localeCompare(b.firedAt));
    const done = tickets.filter((t) => t.column === "completed").sort((a, b) => (b.completedAt ?? b.readyAt ?? b.firedAt).localeCompare(a.completedAt ?? a.readyAt ?? a.firedAt)).slice(0, 12);

    const prep = rows.filter((o) => o.readyAt).map((o) => (new Date(o.readyAt!).getTime() - new Date(o.firedAt ?? o.createdAt).getTime()) / 1000).filter((s) => s >= 0);
    return {
      branch: { id: branch.id, name: branch.name },
      stations: branch.stations,
      stationId: station?.id ?? null,
      tickets: [...active, ...done],
      stats: {
        todayOrders: rows.length,
        avgPrepSeconds: prep.length ? Math.round(prep.reduce((a, b) => a + b, 0) / prep.length) : null,
        pending: rows.filter((o) => !LEFT_THE_KITCHEN.has(o.status) && o.status !== "ready").length,
        completed: rows.filter((o) => LEFT_THE_KITCHEN.has(o.status)).length,
      },
      serverTime: new Date().toISOString(),
    };
  }

  /** Moves a ticket one column on: start cooking, mark ready, or hand over. A station moves only its own lines. */
  async advance(tenantId: string, orderId: string, action: KitchenAction, opts: { stationId?: string; actor?: string } = {}): Promise<KitchenTicket> {
    const order = await this.load(tenantId, orderId);
    const scope = order.items.filter((i) => !opts.stationId || i.stationId === opts.stationId);
    if (scope.length === 0) throw new BadRequestException("this station has nothing on that order");
    const now = new Date();
    const patches: OrderItemPatch[] = [];
    for (const line of scope) {
      if (!line.id) continue;
      const status = line.kitchenStatus ?? "queued";
      if (action === "start" && status === "queued") patches.push({ id: line.id, kitchenStatus: "preparing", startedAt: now });
      if (action === "ready" && (status === "queued" || status === "preparing")) patches.push({ id: line.id, kitchenStatus: "ready", startedAt: line.startedAt ? undefined : now, readyAt: now });
    }
    if (action === "complete") {
      // Handing over is always the whole order, whoever presses it.
      for (const line of order.items) if (line.id && line.kitchenStatus !== "served") patches.push({ id: line.id, kitchenStatus: "served", startedAt: line.startedAt ? undefined : now, readyAt: line.readyAt ? undefined : now });
    }
    let current = patches.length ? await this.orders.patch(tenantId, orderId, {}, patches) : order;
    current = await this.follow(tenantId, current, action === "complete", opts.actor);
    this.hub.emit(tenantId, { type: "kitchen.changed", orderId, branchId: current.branchId });
    const lines = current.items.filter((i) => !opts.stationId || i.stationId === opts.stationId);
    return toTicket(current, lines, columnOf(current, lines, !!opts.stationId));
  }

  /** Sets one line (tap on a line in a ticket), then lets the order follow its lines. */
  async setLine(tenantId: string, orderId: string, itemId: string, status: KitchenStatus, actor?: string): Promise<KitchenTicket> {
    const order = await this.load(tenantId, orderId);
    const line = order.items.find((i) => i.id === itemId);
    if (!line) throw new NotFoundException("line not found");
    const now = new Date();
    const patch: OrderItemPatch = { id: itemId, kitchenStatus: status };
    if (status === "queued") Object.assign(patch, { startedAt: null, readyAt: null });
    if (status === "preparing") Object.assign(patch, { startedAt: line.startedAt ? undefined : now, readyAt: null });
    if (status === "ready" || status === "served") Object.assign(patch, { startedAt: line.startedAt ? undefined : now, readyAt: line.readyAt ? undefined : now });
    let current = await this.orders.patch(tenantId, orderId, {}, [patch]);
    current = await this.follow(tenantId, current, false, actor);
    this.hub.emit(tenantId, { type: "kitchen.changed", orderId, branchId: current.branchId });
    return toTicket(current, current.items, columnOf(current, current.items, false));
  }

  private async load(tenantId: string, orderId: string): Promise<Order> {
    const order = await this.orders.findById(tenantId, orderId);
    if (!order || order.kind !== "order") throw new NotFoundException("order not found");
    if (DROPPED.has(order.status)) throw new ConflictException(`order #${order.number} was ${order.status}`);
    return order;
  }

  /** Walks the order's status to where its lines say it should be: any line started means preparing, all ready means ready. */
  private async follow(tenantId: string, order: Order, handOver: boolean, actor = "kitchen"): Promise<Order> {
    const statuses = order.items.map((i) => i.kitchenStatus ?? "queued");
    const allDone = statuses.every((s) => s === "ready" || s === "served");
    const anyStarted = statuses.some((s) => s !== "queued");
    const target = handOver || allDone ? "ready" : anyStarted ? "preparing" : null;
    let current = order;
    try {
      if (target) {
        const goal = PATH.findIndex((p) => p.status === target);
        let at = PATH.findIndex((p) => p.status === current.status);
        while (at >= 0 && at < goal) {
          at += 1;
          current = await this.orderService.transition(tenantId, current.id, PATH[at]!.via, actor);
        }
      }
      if (handOver && current.status === "ready") current = await this.orderService.transition(tenantId, current.id, current.fulfillmentType === "delivery" ? "dispatch" : "complete", actor);
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw new ConflictException(`order #${order.number} is ${current.status} and cannot move that way`);
      throw err;
    }
    const now = new Date();
    const stamp: { readyAt?: Date; completedAt?: Date } = {};
    if (!current.readyAt && (current.status === "ready" || LEFT_THE_KITCHEN.has(current.status))) stamp.readyAt = now;
    if (!current.completedAt && LEFT_THE_KITCHEN.has(current.status)) stamp.completedAt = now;
    return stamp.readyAt || stamp.completedAt ? this.orders.patch(tenantId, current.id, stamp) : current;
  }
}

function columnOf(order: Order, lines: Order["items"], stationView: boolean): KitchenColumn {
  if (LEFT_THE_KITCHEN.has(order.status)) return "completed";
  const statuses = lines.map((i) => i.kitchenStatus ?? "queued");
  if (stationView) {
    if (statuses.every((s) => s === "ready" || s === "served")) return "ready";
    return statuses.some((s) => s !== "queued") ? "preparing" : "new";
  }
  if (order.status === "ready") return "ready";
  if (order.status === "preparing") return "preparing";
  return "new";
}

function toTicket(order: Order, lines: Order["items"], column: KitchenColumn): KitchenTicket {
  const started = lines.map((l) => l.startedAt).filter((s): s is string => !!s).sort()[0];
  return {
    orderId: order.id,
    number: order.number,
    column,
    source: order.source,
    fulfillmentType: order.fulfillmentType,
    tableLabel: order.tableLabel,
    contactName: order.contactName,
    notes: order.notes,
    firedAt: order.firedAt ?? order.createdAt,
    startedAt: started,
    readyAt: order.readyAt,
    completedAt: order.completedAt,
    lines: lines.map((l) => ({ id: l.id ?? "", title: l.title, quantity: l.quantity, modifiers: l.modifiers.map((m) => m.title), notes: l.notes, status: l.kitchenStatus ?? "queued", stationId: l.stationId })),
  };
}
