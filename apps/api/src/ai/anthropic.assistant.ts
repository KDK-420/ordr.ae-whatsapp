import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@nestjs/common";
import { z } from "zod";
import type { Assistant, DraftReplyInput, HistoryTurn, Interpretation, InterpretInput, PickOptionInput, TenantKnowledge } from "./assistant";

export interface AnthropicAssistantOptions {
  apiKey: string;
  model: string;
  /** Per request, in milliseconds. A WhatsApp customer is waiting, so keep it short. */
  timeoutMs?: number;
  /** Test hook: the SDK's fetch implementation. */
  fetch?: typeof fetch;
}

const InterpretationSchema = z.object({
  flow: z.string().nullable(),
  reply: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

const PickSchema = z.object({ optionId: z.string().nullable() });

const DraftSchema = z.object({ reply: z.string() });

/** JSON schemas handed to structured outputs; kept by hand so they stay strict and small. */
const SCHEMAS = {
  interpretation: {
    type: "object",
    properties: {
      flow: { type: ["string", "null"], description: "Id of the flow to start, or null." },
      reply: { type: ["string", "null"], description: "Short reply in the customer's language, or null." },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["flow", "reply", "confidence"],
    additionalProperties: false,
  },
  pick: {
    type: "object",
    properties: { optionId: { type: ["string", "null"], description: "Id of the matching option, or null." } },
    required: ["optionId"],
    additionalProperties: false,
  },
  draft: {
    type: "object",
    properties: { reply: { type: "string" } },
    required: ["reply"],
    additionalProperties: false,
  },
} as const;

const LANGUAGE_NAMES: Record<string, string> = { en: "English", ar: "Arabic" };

/**
 * Claude through the official SDK. Every call is a single structured-output request with low
 * effort: the questions are small (which flow, which option, a short reply) and the customer is
 * waiting on WhatsApp. Refusal fallbacks are on so a safety decline is retried server-side on
 * another model instead of surfacing as a failed turn.
 */
export class AnthropicAssistant implements Assistant {
  readonly enabled = true;
  private readonly logger = new Logger(AnthropicAssistant.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicAssistantOptions) {
    this.model = opts.model;
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 15_000, maxRetries: 1, fetch: opts.fetch });
  }

  async interpret(input: InterpretInput): Promise<Interpretation> {
    const system = [
      systemPreamble(input.knowledge),
      "Task: the customer sent free text that the menu did not understand. Decide which flow to start, if any.",
      "Rules:",
      "- Choose a flow only when the message clearly asks for what that flow does. Otherwise set flow to null.",
      "- When flow is null and the facts above answer the question, write a short friendly reply (one or two sentences) in " + languageName(input.language) + ". Otherwise set reply to null.",
      "- Never invent prices, times, availability or policies. Only repeat facts listed above.",
      "- Never promise a booking or an order; the flow confirms those.",
      "- A reply must not ask the customer to pick from a list; the flow will do that.",
    ].join("\n");
    const out = await this.ask(system, [...historyTurns(input.history), { role: "user", content: `Customer: ${input.text}` }], SCHEMAS.interpretation, InterpretationSchema, 300);
    if (!out) return { flow: null, reply: null, confidence: "low" };
    const known = new Set(input.knowledge.intents.map((i) => i.flow));
    const flow = out.flow && known.has(out.flow) ? out.flow : null;
    return { flow, reply: out.reply?.trim() || null, confidence: out.confidence };
  }

  async pickOption(input: PickOptionInput): Promise<string | null> {
    const system = [
      "You map a WhatsApp customer's free-text answer onto exactly one of the options a question offered.",
      `The customer writes in ${languageName(input.language)} or English; options may be in either.`,
      "Return the option id only when the text clearly means that option (a name, a paraphrase, a typo, a translation, or an ordinal like 'the second one').",
      "Return null when the text is ambiguous, asks something else, or matches nothing.",
    ].join("\n");
    const options = input.options.map((o, i) => `${i + 1}. id=${o.id} title=${JSON.stringify(o.title)}${o.description ? ` description=${JSON.stringify(o.description)}` : ""}`).join("\n");
    const user = `Question asked: ${input.prompt}\nOptions:\n${options}\n\nCustomer answered: ${input.text}`;
    const out = await this.ask(system, [{ role: "user", content: user }], SCHEMAS.pick, PickSchema, 100);
    if (!out?.optionId) return null;
    return input.options.some((o) => o.id === out.optionId) ? out.optionId : null;
  }

  async draftReply(input: DraftReplyInput): Promise<string> {
    const system = [
      systemPreamble(input.knowledge),
      `Task: draft the next message a human agent of ${input.knowledge.tenantName} will send to this customer on WhatsApp, in ${languageName(input.language)}.`,
      "Keep it short and warm, two to four sentences, no markdown, no bullet points. Use only the facts above; do not invent prices, times or availability.",
      input.instruction ? `The agent wants to say: ${input.instruction}` : "Reply to the customer's latest message.",
    ].join("\n");
    const messages = historyTurns(input.history);
    if (messages.length === 0 || messages.at(-1)!.role !== "user") messages.push({ role: "user", content: "(no customer message yet; write an opening message)" });
    const out = await this.ask(system, messages, SCHEMAS.draft, DraftSchema, 600);
    if (!out) throw new Error("the assistant returned no draft");
    return out.reply.trim();
  }

  /** One structured-output request. Returns null (and logs) on any API problem so a flow never breaks because of the model. */
  private async ask<T>(system: string, messages: Anthropic.Beta.BetaMessageParam[], schema: Record<string, unknown>, parser: z.ZodType<T>, maxTokens: number): Promise<T | null> {
    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      });
      if (response.stop_reason === "refusal") {
        this.logger.warn(`assistant request declined (${response.stop_details?.category ?? "unknown"})`);
        return null;
      }
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") return null;
      const parsed = parser.safeParse(JSON.parse(textBlock.text));
      if (!parsed.success) {
        this.logger.warn(`assistant returned an unexpected shape: ${parsed.error.message}`);
        return null;
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) this.logger.error("ANTHROPIC_API_KEY was rejected; the assistant is effectively off");
      else if (err instanceof Anthropic.RateLimitError) this.logger.warn("assistant rate limited; falling back to the menu");
      else if (err instanceof Anthropic.APIError) this.logger.warn(`assistant API error ${err.status}: ${err.message}`);
      else this.logger.warn(`assistant failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

function systemPreamble(k: TenantKnowledge): string {
  const services = k.services.map((s) => `- ${s.title} (id ${s.id}): ${s.price}${s.durationMinutes ? `, ${s.durationMinutes} min` : ""}`).join("\n");
  const staff = k.staff.map((s) => `- ${s.title} (id ${s.id})`).join("\n");
  const intents = k.intents.map((i) => `- ${i.flow}: ${i.description}${i.keywords.length ? ` (customers also type: ${i.keywords.join(", ")})` : ""}`).join("\n");
  const facts = k.facts.map((f) => `- ${f}`).join("\n");
  return [
    `You are the WhatsApp assistant of ${k.tenantName}, a ${k.blueprintId} business (timezone ${k.timezone}).`,
    "Answer in JSON matching the schema you are given.",
    services ? `Services and prices:\n${services}` : "",
    staff ? `Staff:\n${staff}` : "",
    intents ? `Flows the bot can start:\n${intents}` : "",
    facts ? `Business facts:\n${facts}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Recent turns as alternating messages. The API merges consecutive same-role messages itself. */
function historyTurns(history: HistoryTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const turns: Anthropic.Beta.BetaMessageParam[] = history
    .filter((h) => h.text.trim())
    .map((h) => ({ role: h.role === "customer" ? "user" : "assistant", content: `${h.role === "customer" ? "Customer" : h.role === "agent" ? "Agent" : "Bot"}: ${h.text}` }));
  // The first message must come from the user.
  while (turns.length && turns[0]!.role !== "user") turns.shift();
  return turns;
}
