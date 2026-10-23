import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { type DomainEvent, formatMoney } from "@ordr/domain";
import { type MessageSender, text } from "@ordr/whatsapp";
import { COPY, statusLabel, t } from "../actions/copy";
import type { ConversationRepository, EventBus, OrderRepository, TenantRepository } from "../ports";
import { formatWhen } from "../scheduling/format";
import { ORDER_STATUS_PURPOSE, TemplateService } from "../templates/template.service";
import { TOKENS } from "../tokens";

/** Meta allows free-form messages only within 24 hours of the customer's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Tells the customer on WhatsApp when the merchant moves their order along: a plain text inside
 * the 24 hour service window, an approved template outside it. With no approved template the
 * notification is logged and skipped rather than failing the transition.
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
    @Inject(TemplateService) private readonly templates: TemplateService,
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
    const conversation = order.conversationId ? await this.conversations.findConversationById(order.conversationId) : null;
    // Answer on the number the customer wrote to; the tenant's newest channel only when there is no thread.
    const ctx = (conversation ? await this.tenants.findContextByChannelId(conversation.channelId) : null) ?? (await this.tenants.findContextById(order.tenantId));
    if (!ctx) {
      this.logger.warn(`order #${order.number}: tenant ${order.tenantId} has no active channel; notification skipped`);
      return;
    }
    const customer = await this.conversations.findCustomerById(order.customerId);
    if (!customer) return;
    const lastInbound = conversation?.lastInboundAt;
    const inWindow = !!lastInbound && Date.now() - lastInbound.getTime() <= SERVICE_WINDOW_MS;

    const language = customer.language ?? ctx.tenant.defaultLanguage;
    const values = { number: order.number, status: statusLabel(order.status, language), total: formatMoney(order.totalMinor, order.currency) };
    const booking = order.kind === "booking" && order.scheduledAt;
    let message;
    let kind: string;
    if (inWindow) {
      message = booking
        ? text(t(COPY.bookingStatus, language, { ...values, when: formatWhen(new Date(order.scheduledAt!), ctx.tenant.timezone || "Asia/Dubai", language) }))
        : text(t(COPY.orderStatus, language, values));
      kind = "text";
    } else {
      const tpl = await this.templates.approved(order.tenantId, ORDER_STATUS_PURPOSE, language, [ctx.tenant.defaultLanguage, "en"]);
      if (!tpl) {
        this.logger.warn(`order #${order.number}: customer ${customer.waId} is outside the 24h window and no approved "${ORDER_STATUS_PURPOSE}" template exists; "${order.status}" not sent`);
        return;
      }
      message = this.templates.render(tpl, { orderNumber: values.number, status: values.status, total: values.total });
      kind = `template.${tpl.name}`;
    }
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
          kind,
          payload: message,
          createdAt: new Date(),
        });
      }
      this.logger.log(`order #${order.number}: told ${customer.waId} it is now "${order.status}" (${kind})`);
    } catch (err) {
      // Rethrow so the outbox relay retries with backoff; in memory mode OrderService logs and moves on.
      this.logger.error(`order #${order.number}: notification to ${customer.waId} failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
