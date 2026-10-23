import type { TenantId } from "./ids";

/**
 * Envelope for every domain event. Events are written to an outbox in the same transaction
 * as the state change and relayed to the bus by the worker.
 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  id: string;
  type: TType;
  tenantId: TenantId;
  occurredAt: string;
  /** Aggregate the event belongs to, e.g. { kind: "order", id: "..." }. */
  subject: { kind: string; id: string };
  payload: TPayload;
}

export type ConversationEventType =
  | "conversation.message_received"
  | "conversation.message_sent"
  | "conversation.handoff_requested"
  /** The bot paused itself on a thread; staff are alerted. */
  | "conversation.handed_over"
  | "conversation.flow_completed";
