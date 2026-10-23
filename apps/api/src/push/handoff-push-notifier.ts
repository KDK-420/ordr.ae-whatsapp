import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@ordr/domain";
import type { HandedOverPayload } from "../conversation/conversation.service";
import { clipPreview } from "../conversation/handoff-notifier";
import type { EventBus, PushSubscriptionRepository } from "../ports";
import { TOKENS } from "../tokens";
import { PushSendError, type WebPushSender } from "./web-push";

/** Push services answer these when the browser dropped the subscription; the row is useless afterwards. */
const GONE_STATUSES = new Set([404, 410]);

/**
 * Pushes "<customer> needs a person" to every phone and browser the tenant's staff registered
 * from the dashboard when the bot hands a thread over. Sits next to `HandoffNotifier`, which
 * covers WhatsApp; both subscribe to `conversation.handed_over`. Dead subscriptions (404/410)
 * are deleted; any other failure is logged and does not retry, since a push is a nudge, not a
 * record, and the WhatsApp alert and the inbox badge still carry it.
 */
@Injectable()
export class HandoffPushNotifier implements OnModuleInit {
  private readonly logger = new Logger(HandoffPushNotifier.name);

  constructor(
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
    @Inject(TOKENS.WebPushSender) private readonly sender: WebPushSender,
    @Inject(TOKENS.PushSubscriptionRepository) private readonly subscriptions: PushSubscriptionRepository,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe("conversation.handed_over", (event) => this.onHandedOver(event));
  }

  async onHandedOver(event: DomainEvent): Promise<void> {
    if (!this.sender.enabled) return;
    const payload = event.payload as HandedOverPayload;
    const targets = await this.subscriptions.listByTenant(event.tenantId);
    if (targets.length === 0) return;

    const who = payload.customerName?.trim() || `+${payload.waId}`;
    const message = { title: `${who} needs a person`, body: clipPreview(payload.preview) || "Open the inbox to reply", url: "/inbox", tag: `handoff-${payload.conversationId}` };
    let delivered = 0;
    let pruned = 0;
    for (const sub of targets) {
      try {
        await this.sender.send({ endpoint: sub.endpoint, keys: sub.keys }, message);
        delivered += 1;
      } catch (err) {
        if (err instanceof PushSendError && GONE_STATUSES.has(err.statusCode)) {
          await this.subscriptions.removeByEndpoint(sub.endpoint);
          pruned += 1;
          continue;
        }
        this.logger.warn(`handoff ${payload.conversationId}: push to ${sub.userId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.logger.log(`handoff ${payload.conversationId}: pushed to ${delivered} of ${targets.length} device(s)${pruned ? `, ${pruned} dead subscription(s) removed` : ""}`);
  }
}
