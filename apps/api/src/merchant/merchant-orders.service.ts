import { Inject, Injectable } from "@nestjs/common";
import { type Customer, isTerminal, type Order, type StateMachine } from "@ordr/domain";
import { OrderService } from "../orders/order.service";
import type { BlueprintRegistry, ConversationRepository, OrderRepository } from "../ports";
import { TOKENS } from "../tokens";

export type OrderScope = "board" | "active" | "all";

export interface OrderView extends Order {
  customer: { id: string; name?: string; waId?: string; language?: string } | null;
  /** Transition events the merchant may apply from the current status, e.g. ["accept", "reject"]. */
  allowedEvents: string[];
  isTerminal: boolean;
}

export interface OrderListResult {
  orders: OrderView[];
  /** The tenant's blueprint state machine, so the UI can lay out columns and label events. */
  states: StateMachine;
}

/** How long finished orders stay on the board. */
const DONE_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MerchantOrdersService {
  constructor(
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(OrderService) private readonly orderService: OrderService,
  ) {}

  async list(tenantId: string, scope: OrderScope = "board", limit = 100): Promise<OrderListResult> {
    const states = await this.machine(tenantId);
    const active = states.states.filter((s) => !isTerminal(states, s));
    let rows: Order[];
    if (scope === "all") {
      rows = await this.orders.listRecent(tenantId, { limit });
    } else if (scope === "active") {
      rows = await this.orders.listRecent(tenantId, { statuses: active, limit });
    } else {
      const [open, done] = await Promise.all([
        this.orders.listRecent(tenantId, { statuses: active, limit }),
        this.orders.listRecent(tenantId, { statuses: states.terminal, since: new Date(Date.now() - DONE_WINDOW_MS), limit }),
      ]);
      rows = [...open, ...done];
    }
    return { orders: await this.present(rows, states), states };
  }

  async get(tenantId: string, orderId: string): Promise<OrderView | null> {
    const order = await this.orders.findById(tenantId, orderId);
    if (!order) return null;
    const [view] = await this.present([order], await this.machine(tenantId));
    return view ?? null;
  }

  /** Applies a blueprint event on behalf of a dashboard user. Throws like OrderService.transition. */
  async transition(tenantId: string, orderId: string, event: string, actor: string): Promise<OrderView> {
    const order = await this.orderService.transition(tenantId, orderId, event, actor);
    const [view] = await this.present([order], await this.machine(tenantId));
    return view!;
  }

  private async machine(tenantId: string): Promise<StateMachine> {
    const settings = await this.orderService.settingsFor(tenantId);
    const blueprint = this.blueprints.get(settings.tenant.blueprintId);
    if (!blueprint) throw new Error(`blueprint ${settings.tenant.blueprintId} not found`);
    return blueprint.orderStates;
  }

  private async present(orders: Order[], states: StateMachine): Promise<OrderView[]> {
    const customers = await this.conversations.findCustomersByIds([...new Set(orders.map((o) => o.customerId))]);
    const byId = new Map<string, Customer>(customers.map((c) => [c.id, c]));
    return orders.map((order) => {
      const c = byId.get(order.customerId);
      return {
        ...order,
        customer: c ? { id: c.id, name: c.name, waId: c.waId, language: c.language } : null,
        allowedEvents: states.transitions.filter((t) => t.from === order.status).map((t) => t.on),
        isTerminal: isTerminal(states, order.status),
      };
    });
  }
}
