import { Injectable, Logger } from "@nestjs/common";

/** What staff screens are told when something changed; they refetch what they show. */
export interface RealtimeEvent {
  type: string;
  orderId?: string;
  branchId?: string;
  at: string;
}

type Listener = (event: RealtimeEvent) => void;

/**
 * In-process fan-out of "something changed" signals to open staff screens (server-sent events).
 * Signals carry no data worth trusting on their own: a screen that hears one refetches, and a
 * screen that reconnects refetches too, so a missed signal costs one poll interval at most.
 * One API instance only; Redis pub/sub takes this role behind a load balancer.
 */
@Injectable()
export class RealtimeHub {
  private readonly logger = new Logger(RealtimeHub.name);
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(tenantId: string, listener: Listener): () => void {
    const set = this.listeners.get(tenantId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(tenantId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(tenantId);
    };
  }

  emit(tenantId: string, event: Omit<RealtimeEvent, "at">): void {
    const set = this.listeners.get(tenantId);
    if (!set) return;
    const full: RealtimeEvent = { ...event, at: new Date().toISOString() };
    for (const listener of set) {
      try {
        listener(full);
      } catch (err) {
        this.logger.debug(`listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** Open connections for a tenant, for tests and health output. */
  count(tenantId: string): number {
    return this.listeners.get(tenantId)?.size ?? 0;
  }
}
