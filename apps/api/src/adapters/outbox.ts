import type { DomainEvent } from "@ordr/domain";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { EventBus, EventHandler, OutboxRecord, OutboxStore } from "../ports";

export function toOutboxRow(event: DomainEvent): Prisma.OutboxEventCreateManyInput {
  return {
    id: event.id,
    tenantId: event.tenantId,
    type: event.type,
    subjectKind: event.subject.kind,
    subjectId: event.subject.id,
    payload: (event.payload ?? {}) as Prisma.InputJsonValue,
    occurredAt: new Date(event.occurredAt),
  };
}

interface OutboxRow {
  id: string;
  tenantId: string;
  type: string;
  subjectKind: string;
  subjectId: string;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
}

const toRecord = (r: OutboxRow): OutboxRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  type: r.type,
  subject: { kind: r.subjectKind, id: r.subjectId },
  payload: r.payload,
  occurredAt: r.occurredAt.toISOString(),
  attempts: r.attempts,
});

/**
 * EventBus for the API process on Postgres: publish() records the event durably and returns.
 * Handlers registered here are kept for completeness but never run in this process; the worker
 * dispatches outbox rows through its own InMemoryEventBus. Repositories that already wrote the
 * event in their transaction make publish() a no-op thanks to skipDuplicates.
 */
export class OutboxEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  constructor(private readonly prisma: PrismaClient) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.prisma.outboxEvent.createMany({ data: [toOutboxRow(event)], skipDuplicates: true });
  }

  subscribe(type: string | "*", handler: EventHandler): () => void {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => set.delete(handler);
  }
}

export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly prisma: PrismaClient) {}

  /** One statement: pick due rows with SKIP LOCKED so several workers never take the same event. */
  async claim(limit: number, now = new Date()): Promise<OutboxRecord[]> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE "OutboxEvent"
      SET status = 'processing', attempts = attempts + 1, "claimedAt" = ${now}
      WHERE id IN (
        SELECT id FROM "OutboxEvent"
        WHERE status = 'pending' AND "nextAttemptAt" <= ${now}
        ORDER BY "occurredAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "tenantId", type, "subjectKind", "subjectId", payload, "occurredAt", attempts`;
    return rows.map(toRecord);
  }

  async markSent(id: string, at = new Date()): Promise<void> {
    await this.prisma.outboxEvent.update({ where: { id }, data: { status: "sent", sentAt: at, lastError: null } });
  }

  async markFailed(id: string, error: string, retryAt: Date | null): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: retryAt ? { status: "pending", nextAttemptAt: retryAt, lastError: error.slice(0, 1000) } : { status: "failed", lastError: error.slice(0, 1000) },
    });
  }

  async requeueStale(olderThan: Date): Promise<number> {
    const res = await this.prisma.outboxEvent.updateMany({ where: { status: "processing", claimedAt: { lt: olderThan } }, data: { status: "pending" } });
    return res.count;
  }

  async counts(): Promise<Record<string, number>> {
    const groups = await this.prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  }
}
