import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { type DomainEvent, formatMoney } from "@ordr/domain";
import { type MessageSender, text } from "@ordr/whatsapp";
import { COPY, statusLabel, t } from "../actions/copy";
import type { ConversationRepository, EventBus, OrderRepository, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";

/** Meta allows free-form messages only within 24 hours of the customer's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Tells the customer on WhatsApp when the merchant moves their order along.
 * Outside the 24 hour window Meta requires an approved template; until a template registry
 * exists those notifications are logged and skipped rather than failing the transition.
 */
@Injectable()
export class OrderNotifier implements OnModuleInit {
  private readonly logger = new Logger(OrderNotifier.name);

  constructor(
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.MessageSender) private readonly sender: MessageSender,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe("order.status_changed", (event) => this.onStatusChanged(event));
  }

  async onStatusChanged(event: DomainEvent): Promise<void> {
    const payload = event.payload as { from?: string; to?: string };
    // "delivered" already told the customer the order arrived; the final bookkeeping step adds nothing.
    if (payload.to === "completed" && payload.from === "delivered") return;

    const order = await this.orders.findById(event.tenantId, event.subject.id);
    if (!order) return;
    const ctx = await this.tenants.findContextById(order.tenantId);
    if (!ctx) {
      this.logger.warn(`order #${order.number}: tenant ${order.tenantId} has no active channel; notification skipped`);
      return;
    }
    const customer = await this.conversations.findCustomerById(order.customerId);
    if (!customer) return;
    const conversation = order.conversationId ? await this.conversations.findConversationById(order.conversationId) : null;
    const lastInbound = conversation?.lastInboundAt;
    if (!lastInbound || Date.now() - lastInbound.getTime() > SERVICE_WINDOW_MS) {
      this.logger.warn(`order #${order.number}: customer ${customer.waId} is outside the 24h window; "${order.status}" not sent (templates not implemented yet)`);
      return;
    }

    const language = customer.language ?? ctx.tenant.defaultLanguage;
    const message = text(
      t(COPY.orderStatus, language, { number: order.number, status: statusLabel(order.status, language), total: formatMoney(order.totalMinor, order.currency) }),
    );
    try {
      const { providerMessageId } = await this.sender.send(
        { phoneNumberId: ctx.channel.phoneNumberId, accessToken: ctx.channel.accessToken, to: customer.waId },
        message,
      );
      if (conversation) {
        await this.conversations.recordMessage({
          tenantId: order.tenantId,
          conversationId: conversation.id,
          direction: "out",
          providerMessageId,
          kind: "text",
          payload: message,
          createdAt: new Date(),
        });
      }
      this.logger.log(`order #${order.number}: told ${customer.waId} it is now "${order.status}"`);
    } catch (err) {
      this.logger.error(`order #${order.number}: notification to ${customer.waId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
