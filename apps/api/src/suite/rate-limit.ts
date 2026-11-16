import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * A small fixed-window limiter for the public ordering site, per API process. It keeps one
 * visitor from flooding a kitchen with orders; with several API instances each one counts on
 * its own, which only makes the limit looser.
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  now: () => number = () => Date.now();

  /** Counts one hit for `key`; throws 429 once `limit` hits were made inside the window. */
  hit(key: string, limit: number, windowMs: number): void {
    const now = this.now();
    if (this.hits.size > 20_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > limit) throw new HttpException("Too many requests. Please wait a moment and try again.", HttpStatus.TOO_MANY_REQUESTS);
  }
}
