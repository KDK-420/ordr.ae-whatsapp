import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@ordr/domain";
import { type MessageSender, text } from "@ordr/whatsapp";
import { COPY, t } from "../actions/copy";
import type { ConversationRepository, EventBus, OrderRepository, TenantRepository } from "../ports";
import { formatWhen } from "../scheduling/format";
import { BOOKING_REMINDER_PURPOSE, TemplateService } from "../templates/template.service";
import { businessProfile, locationLines } from "../tenant-profile";
import { TOKENS } from "../tokens";

/** Meta allows free-form messages only within 24 hours of the customer's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const BOOKING_REMINDER_EVENT = "booking.reminder";

/** Statuses a reminder still makes sense for. Cancelled, rejected or finished bookings are skipped. */
const REMIND_WHEN = new Set(["requested", "confirmed"]);

export interface BookingReminderPayload {
  leadMinutes: number;
  scheduledAt: string;
}

/** The outbox event id for one reminder; stable so a retried booking never queues it twice. */
export function reminderEventId(orderId: string, leadMinutes: number): string {
  return `${orderId}:reminder:${leadMinutes}`;
}

/**
 * Sends "see you tomorrow at 11:00" style reminders. The events are queued in the outbox when a
 * booking is placed, with a delivery time ahead of the appointment; the worker relays them when
 * due. At delivery the booking is re-read so a cancelled or moved appointment gets no reminder.
 */
@Injectable()
export class BookingReminderNotifier implements OnModuleInit {
  private readonly logger = new Logger(BookingReminderNotifier.name);

  constructor(
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.MessageSender) private readonly sender: MessageSender,
    @Inject(TemplateService) private readonly templates: TemplateService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(BOOKING_REMINDER_EVENT, (event) => this.onReminder(event));
  }

  async onReminder(event: DomainEvent, now = new Date()): Promise<void> {
    const payload = event.payload as Partial<BookingReminderPayload>;
    const order = await this.orders.findById(event.tenantId, event.subject.id);
    if (!order || order.kind !== "booking" || !order.scheduledAt) return;
    if (!REMIND_WHEN.has(order.status)) {
      this.logger.log(`booking #${order.number} is ${order.status}; reminder skipped`);
      return;
    }
    const startsAt = new Date(order.scheduledAt);
    if (startsAt.getTime() <= now.getTime()) {
      this.logger.log(`booking #${order.number} already started; reminder skipped`);
      return;
    }
    if (payload.scheduledAt && payload.scheduledAt !== order.scheduledAt) {
      this.logger.log(`booking #${order.number} was moved; reminder for the old time skipped`);
      return;
    }
    const conversation = order.conversationId ? await this.conversations.findConversationById(order.conversationId) : null;
    const ctx = (conversation ? await this.tenants.findContextByChannelId(conversation.channelId) : null) ?? (await this.tenants.findContextById(order.tenantId));
    if (!ctx) {
      this.logger.warn(`booking #${order.number}: tenant ${order.tenantId} has no active channel; reminder skipped`);
      return;
    }
    const customer = await this.conversations.findCustomerById(order.customerId);
    if (!customer) return;
    const lastInbound = conversation?.lastInboundAt;
    const inWindow = !!lastInbound && now.getTime() - lastInbound.getTime() <= SERVICE_WINDOW_MS;

    const language = customer.language ?? ctx.tenant.defaultLanguage;
    const when = formatWhen(startsAt, ctx.tenant.timezone || "Asia/Dubai", language);
    let message;
    let kind: string;
    if (inWindow) {
      message = text([t(COPY.bookingReminder, language, { tenant: ctx.tenant.name, when }), ...locationLines(businessProfile(ctx.tenant.settings))].join("\n"));
      kind = "text";
    } else {
      const tpl = await this.templates.approved(order.tenantId, BOOKING_REMINDER_PURPOSE, language, [ctx.tenant.defaultLanguage, "en"]);
      if (!tpl) {
        this.logger.warn(`booking #${order.number}: customer ${customer.waId} is outside the 24h window and no approved "${BOOKING_REMINDER_PURPOSE}" template exists; reminder not sent`);
        return;
      }
      message = this.templates.render(tpl, { tenant: ctx.tenant.name, when });
      kind = `template.${tpl.name}`;
    }
    // Throws on failure so the relay retries with backoff.
    const { providerMessageId } = await this.sender.send({ phoneNumberId: ctx.channel.phoneNumberId, accessToken: ctx.channel.accessToken, to: customer.waId }, message);
    if (conversation) {
      await this.conversations.recordMessage({ tenantId: order.tenantId, conversationId: conversation.id, direction: "out", providerMessageId, kind, payload: message, createdAt: now });
    }
    this.logger.log(`booking #${order.number}: reminded ${customer.waId} (${payload.leadMinutes ?? "?"} min ahead, ${kind})`);
  }
}
