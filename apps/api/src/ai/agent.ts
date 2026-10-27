import type { Blueprint } from "@ordr/flow-schema";
import type { Customer, Order, Tenant } from "@ordr/domain";
import type { ConsentRecord, MemoryRecord } from "../ports";
import type { HistoryTurn, TenantKnowledge } from "./assistant";

/**
 * "Natural" conversation style: Claude talks to the customer like a staff member would and
 * acts only through tools backed by the scheduling engine, so every price, time and booking
 * it mentions comes from the database. The guided flows (buttons and lists) stay available
 * as the fallback and for tenants that prefer them.
 */

export interface AgentInput {
  tenant: Tenant;
  blueprint: Blueprint;
  customer: Customer;
  conversationId: string;
  /** Language the customer seems to write in: a hint, the model follows the customer. */
  language: string;
  /** The message that just arrived, as text (a tapped button is passed as its title, a voice note as its transcript). */
  text: string;
  /** Images the customer sent with this message, already downloaded and within the model's limits. */
  attachments?: AgentAttachment[];
  history: HistoryTurn[];
  knowledge: TenantKnowledge;
  /** Where the customer is writing from; changes tone and what links make sense. */
  channel: "whatsapp" | "web";
  /** Stored id of the inbound message, for memory provenance. */
  inboundMessageId?: string;
  /** The customer already has an open question with the team: keep helping, do not escalate it again. */
  openRequest?: { reason?: string; sinceMinutes: number };
  /** The WhatsApp number the customer is writing to, so the model never sends them "to the salon" on it. */
  businessNumber?: string;
  /** Consented memories about this customer at this tenant (empty when off or not consented). */
  memories: MemoryRecord[];
  /** Null when the customer was never asked; undefined when the tenant keeps no memory. */
  consent?: ConsentRecord | null;
  /** The customer's latest orders and bookings here, newest first. */
  recentOrders: Order[];
}

/** A picture the customer sent, ready for the model: Claude accepts these four formats inline. */
export interface AgentAttachment {
  kind: "image";
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  /** Base64, no newlines. */
  data: string;
}

export interface AgentPhoto {
  link: string;
  caption?: string;
}

export interface ToolTrace {
  name: string;
  input: unknown;
  ok: boolean;
  ms: number;
}

export interface AgentTrace {
  model: string;
  tools: ToolTrace[];
  memoryIds: string[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface AgentReply {
  /** What to send back; empty when the model chose to say nothing (should not happen). */
  text: string;
  /** The customer asked for a person, or the model could not help: pause the bot for this thread. */
  handoff: boolean;
  /** Why the model handed over, as it told the hand_over_to_human tool; shown to staff. */
  handoffReason?: string;
  /** A guided flow to start right after the text (e.g. the ordering menu). */
  startFlow?: string;
  /** Photos to send right after the text, each with a caption (catalog items, rooms, resorts). */
  media?: AgentPhoto[];
  /** What the model did, for the audit log. */
  trace?: AgentTrace;
}

export interface ConversationAgent {
  readonly enabled: boolean;
  reply(input: AgentInput): Promise<AgentReply>;
}

export class NoopAgent implements ConversationAgent {
  readonly enabled = false;
  async reply(): Promise<AgentReply> {
    throw new Error("conversation agent is not configured: set ANTHROPIC_API_KEY");
  }
}

/** Which style a tenant runs: its own setting, else the blueprint's, else guided. */
export function conversationStyle(tenant: Tenant, blueprint: Blueprint): "guided" | "natural" {
  const own = tenant.settings.conversationStyle;
  const fromBlueprint = (blueprint.settings as Record<string, unknown>).conversationStyle;
  const pick = own ?? fromBlueprint;
  return pick === "natural" ? "natural" : "guided";
}
