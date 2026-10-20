import type { Blueprint } from "@ordr/flow-schema";
import type { Customer, Tenant } from "@ordr/domain";
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
  /** The message that just arrived, as text (a tapped button is passed as its title). */
  text: string;
  history: HistoryTurn[];
  knowledge: TenantKnowledge;
}

export interface AgentReply {
  /** What to send back; empty when the model chose to say nothing (should not happen). */
  text: string;
  /** The customer asked for a person, or the model could not help: pause the bot for this thread. */
  handoff: boolean;
  /** A guided flow to start right after the text (e.g. the ordering menu). */
  startFlow?: string;
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
