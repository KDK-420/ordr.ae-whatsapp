/**
 * The LLM is an assistant to the deterministic flows, never a replacement for them (ADR-002):
 * it maps free text onto a flow or onto one of the options a question is already showing, answers
 * simple questions from tenant facts, and drafts replies for agents. It never writes to the
 * database and never states a price or time the flow will not confirm itself.
 */

export interface KnowledgeService {
  id: string;
  title: string;
  price: string;
  durationMinutes?: number;
}

export interface KnowledgeIntent {
  /** Flow id to start. */
  flow: string;
  description: string;
  /** Keywords the deterministic router already understands, as examples for the model. */
  keywords: string[];
}

/** Facts about one tenant the assistant may rely on. Built fresh per request from the database. */
export interface TenantKnowledge {
  tenantName: string;
  blueprintId: string;
  timezone: string;
  services: KnowledgeService[];
  staff: { id: string; title: string }[];
  intents: KnowledgeIntent[];
  /** Short free-text facts a merchant wants the bot to know: address, parking, policies. */
  facts: string[];
}

export interface HistoryTurn {
  role: "customer" | "bot" | "agent";
  text: string;
}

export interface InterpretInput {
  text: string;
  language: string;
  knowledge: TenantKnowledge;
  history: HistoryTurn[];
}

export interface Interpretation {
  /** Flow to start, or null when the text is a question or small talk. */
  flow: string | null;
  /** A short reply in the customer's language when no flow fits and the facts allow an answer. */
  reply: string | null;
  confidence: "high" | "medium" | "low";
}

export interface PickOptionInput {
  text: string;
  language: string;
  prompt: string;
  options: { id: string; title: string; description?: string }[];
}

export interface DraftReplyInput {
  language: string;
  knowledge: TenantKnowledge;
  history: HistoryTurn[];
  /** What the agent wants to say, in their own words; the draft expands and polishes it. */
  instruction?: string;
}

export interface Assistant {
  readonly enabled: boolean;
  interpret(input: InterpretInput): Promise<Interpretation>;
  /** The id of the option the text means, or null when none clearly fits. */
  pickOption(input: PickOptionInput): Promise<string | null>;
  draftReply(input: DraftReplyInput): Promise<string>;
}

export class AssistantUnavailableError extends Error {
  constructor(message = "AI assistant is not configured: set ANTHROPIC_API_KEY") {
    super(message);
    this.name = "AssistantUnavailableError";
  }
}

/** Used when no API key is configured: flows behave exactly as before. */
export class NoopAssistant implements Assistant {
  readonly enabled = false;
  async interpret(): Promise<Interpretation> {
    return { flow: null, reply: null, confidence: "low" };
  }
  async pickOption(): Promise<string | null> {
    return null;
  }
  async draftReply(): Promise<string> {
    throw new AssistantUnavailableError();
  }
}
