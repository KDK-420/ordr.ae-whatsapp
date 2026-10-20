import { Inject, Injectable, Logger } from "@nestjs/common";
import { CommerceService } from "./commerce/commerce.service";
import { SchedulingService } from "./scheduling/scheduling.service";

/** Periodic housekeeping: lapsed holds and unpaid checkouts release what they reserved. */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = new Date()): Promise<{ holds: number; checkouts: number }> {
    const out = { holds: 0, checkouts: 0 };
    try {
      out.holds = await this.scheduling.expireHolds(now);
      out.checkouts = await this.commerce.expireCheckouts(now);
      if (out.holds || out.checkouts) this.logger.log(`expired ${out.holds} hold(s), ${out.checkouts} checkout(s)`);
    } catch (err) {
      this.logger.error(`maintenance failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return out;
  }
}
