import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@ordr/domain";
import { type MessageSender, type OutboundMessage, text } from "@ordr/whatsapp";
import type { AppConfig } from "../config";
import type { ConversationRepository, EventBus, TenantContext, TenantRepository } from "../ports";
import { HANDOFF_ALERT_PURPOSE, TemplateService } from "../templates/template.service";
import { TOKENS } from "../tokens";
import type { HandedOverPayload } from "./conversation.service";

/** Meta allows free-form messages only within 24 hours of the recipient's last message. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Staff numbers to alert, at most. */
export const MAX_HANDOFF_NUMBERS = 5;
/** Long customer messages are cut so the alert stays one glance. */
const PREVIEW_MAX = 160;

/** The `handoffNumbers` tenant setting as a clean list of E.164 digits, whatever was stored. */
export function handoffNumbers(settings: Record<string, unknown>): string[] {
  const raw = Array.isArray(settings.handoffNumbers) ? settings.handoffNumbers : [];
  const out: string[] = [];
  for (const n of raw) {
    if (typeof n !== "string") continue;
    const digits = n.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15 && !out.includes(digits)) out.push(digits);
  }
  return out.slice(0, MAX_HANDOFF_NUMBERS);
}

/** "Sara (+971500000000)" or "+971500000000" when the profile has no name. */
export function customerLabel(name: string | undefined, waId: string): string {
  const who = name?.trim();
  return who ? `${who} (+${waId})` : `+${waId}`;
}

export function clipPreview(preview: string): string {
  const one = preview.replace(/\s+/g, " ").trim();
  return one.length > PREVIEW_MAX ? `${one.slice(0, PREVIEW_MAX - 1)}…` : one;
}

/**
 * Pings the merchant's staff on WhatsApp when the bot hands a thread to a person. The alert goes
 * out from the number the customer wrote to, as a text inside the 24 hour window and as the
 * approved `ordr_handoff_alert` template outside it. One staff number failing does not stop the
 * others; a transport error is rethrown so the outbox relay retries the event.
 */
@Injectable()
export class HandoffNotifier implements OnModuleInit {
  private readonly logger = new Logger(HandoffNotifier.name);

  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.MessageSender) private readonly sender: MessageSender,
    @Inject(TemplateService) private readonly templates: TemplateService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe("conversation.handed_over", (event) => this.onHandedOver(event));
  }

  async onHandedOver(event: DomainEvent): Promise<void> {
    const payload = event.payload as HandedOverPayload;
    // Alert from the number the customer wrote to; the tenant's newest real number only when that channel is gone or is web chat.
    const byChannel = await this.tenants.findContextByChannelId(payload.channelId);
    const ctx = (byChannel?.channel.provider === "meta_cloud" ? byChannel : null) ?? (await this.tenants.findContextById(event.tenantId));
    if (!ctx) {
      this.logger.warn(`handoff ${payload.conversationId}: tenant ${event.tenantId} has no active WhatsApp channel; staff not alerted`);
      return;
    }
    const numbers = handoffNumbers(ctx.tenant.settings).filter((n) => n !== payload.waId);
    if (numbers.length === 0) {
      this.logger.log(`handoff ${payload.conversationId}: no handoffNumbers configured for tenant ${event.tenantId}; staff not alerted`);
      return;
    }

    const values = { customer: customerLabel(payload.customerName, payload.waId), preview: clipPreview(payload.preview), url: `${this.config.PUBLIC_BASE_URL.replace(/\/$/, "")}/inbox` };
    const reason = payload.reason?.trim();
    const body = [`${values.customer} needs a person: "${values.preview}".`, reason ? `Reason: ${reason}` : null, `Reply in the inbox: ${values.url}`].filter(Boolean).join("\n");
    const lastInbound = await this.lastInboundFrom(ctx, numbers);

    let failure: unknown;
    for (const to of numbers) {
      const at = lastInbound.get(to);
      const inWindow = !!at && Date.now() - at.getTime() <= SERVICE_WINDOW_MS;
      let message: OutboundMessage;
      let kind: string;
      if (inWindow) {
        message = text(body);
        kind = "text";
      } else {
        const tpl = await this.templates.approved(event.tenantId, HANDOFF_ALERT_PURPOSE, ctx.tenant.defaultLanguage, ["en"]);
        if (!tpl) {
          this.logger.warn(`handoff ${payload.conversationId}: ${to} is outside the 24h window and no approved "${HANDOFF_ALERT_PURPOSE}" template exists; not alerted`);
          continue;
        }
        message = this.templates.render(tpl, values);
        kind = `template.${tpl.name}`;
      }
      try {
        await this.sender.send({ phoneNumberId: ctx.channel.phoneNumberId, accessToken: ctx.channel.accessToken, to }, message);
        this.logger.log(`handoff ${payload.conversationId}: alerted ${to} (${kind})`);
      } catch (err) {
        this.logger.error(`handoff ${payload.conversationId}: alert to ${to} failed: ${err instanceof Error ? err.message : String(err)}`);
        failure ??= err;
      }
    }
    // Rethrow after trying every number so the outbox relay retries with backoff.
    if (failure) throw failure;
  }

  /** When each staff number last wrote to this tenant, from their own threads; absent when they never did. */
  private lastInboundFrom(ctx: TenantContext, numbers: string[]): Promise<Map<string, Date>> {
    return this.conversations.lastInboundAtByWaId(ctx.tenant.id, numbers);
  }
}
