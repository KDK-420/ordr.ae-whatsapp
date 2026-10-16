import { Inject, Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "@ordr/domain";
import type { AppConfig } from "../config";
import type { EventBus, OutboxStore } from "../ports";
import { TOKENS } from "../tokens";

/** A claim older than this with no outcome means the worker died mid-batch; the event goes back to pending. */
const STALE_CLAIM_MS = 5 * 60_000;

/** 2s, 4s, 8s ... capped at 5 minutes between attempts. */
export function backoffMs(attempt: number): number {
  return Math.min(5 * 60_000, 1000 * 2 ** Math.min(Math.max(attempt, 1), 10));
}

/**
 * Moves events from the outbox table to their handlers. Runs in the worker process only.
 * A handler that throws causes a retry with exponential backoff until OUTBOX_MAX_ATTEMPTS,
 * after which the event is parked as "failed" for a human to look at.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = true;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.OutboxStore) private readonly store: OutboxStore,
    @Inject(TOKENS.EventBus) private readonly bus: EventBus,
  ) {}

  start(): void {
    this.stopped = false;
    this.logger.log(`outbox relay started (poll ${this.config.OUTBOX_POLL_MS}ms, batch ${this.config.OUTBOX_BATCH_SIZE}, max attempts ${this.config.OUTBOX_MAX_ATTEMPTS})`);
    const loop = async () => {
      if (this.stopped) return;
      let processed = 0;
      this.inFlight = this.tick()
        .then((n) => void (processed = n))
        .catch((err) => this.logger.error(`relay tick failed: ${err instanceof Error ? err.stack : String(err)}`));
      await this.inFlight;
      if (this.stopped) return;
      // Drain quickly while there is work, otherwise poll.
      this.timer = setTimeout(() => void loop(), processed > 0 ? 0 : this.config.OUTBOX_POLL_MS);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
    this.logger.log("outbox relay stopped");
  }

  /** One pass: requeue stale claims, claim a batch, dispatch each event. Returns how many were claimed. */
  async tick(now = new Date()): Promise<number> {
    const requeued = await this.store.requeueStale(new Date(now.getTime() - STALE_CLAIM_MS));
    if (requeued > 0) this.logger.warn(`requeued ${requeued} stale outbox event(s)`);
    const batch = await this.store.claim(this.config.OUTBOX_BATCH_SIZE, now);
    for (const record of batch) {
      const { attempts, ...event } = record;
      await this.dispatch(event, attempts, now);
    }
    return batch.length;
  }

  private async dispatch(event: DomainEvent, attempts: number, now: Date): Promise<void> {
    try {
      await this.bus.publish(event);
      await this.store.markSent(event.id, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = attempts >= this.config.OUTBOX_MAX_ATTEMPTS;
      const retryAt = giveUp ? null : new Date(now.getTime() + backoffMs(attempts));
      await this.store.markFailed(event.id, message, retryAt);
      if (giveUp) this.logger.error(`event ${event.type} ${event.id} failed ${attempts} times, parked: ${message}`);
      else this.logger.warn(`event ${event.type} ${event.id} attempt ${attempts} failed, retry at ${retryAt!.toISOString()}: ${message}`);
    }
  }
}
