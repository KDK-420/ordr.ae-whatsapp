import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Blueprint } from "@ordr/flow-schema";
import { type Customer, formatMoney, localized, type Tenant } from "@ordr/domain";
import { agentTextOf } from "../conversation/preview";
import { MemoryService } from "../memory/memory.service";
import { businessProfile } from "../tenant-profile";
import type { AgentRunRepository, BlueprintRegistry, CatalogRepository, ConversationRepository, OrderRepository, ResourceRepository, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";
import type { AgentAttachment, AgentReply, ConversationAgent } from "./agent";
import type { Assistant, HistoryTurn, Interpretation, PickOptionInput, TenantKnowledge } from "./assistant";

/** How much of the thread the model sees. Enough for "the same as last time", small enough to stay cheap. */
const HISTORY_TURNS = 10;

/** Flows a customer cannot sensibly ask for by name. */
const HIDDEN_FLOWS = new Set(["language"]);

/**
 * Builds the tenant facts the assistant is allowed to use and wraps every model call so a
 * conversation never fails because of the model: on any problem the deterministic flow goes on
 * exactly as it would without AI.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @Inject(TOKENS.Assistant) private readonly assistant: Assistant,
    @Inject(TOKENS.Agent) private readonly agent: ConversationAgent,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.ResourceRepository) private readonly resources: ResourceRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(TOKENS.AgentRunRepository) private readonly runs: AgentRunRepository,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  get enabled(): boolean {
    return this.assistant.enabled;
  }

  get conversational(): boolean {
    return this.agent.enabled;
  }

  /**
   * Natural style: the agent answers the customer directly, acting through tools. Memories are
   * loaded only with the customer's consent, and every run is recorded for the audit log.
   * Throws when the model fails so the caller can fall back.
   */
  async converse(tenant: Tenant, blueprint: Blueprint, customer: Customer, conversationId: string, text: string, language: string, opts: { channel?: "whatsapp" | "web"; inboundMessageId?: string; attachments?: AgentAttachment[] } = {}): Promise<AgentReply> {
    const started = Date.now();
    const memoryOn = this.memory.enabledFor(tenant);
    const [knowledge, history, memories, consent, recent] = await Promise.all([
      this.knowledge(tenant, blueprint, language),
      this.history(conversationId),
      memoryOn ? this.memory.recall(tenant, customer.id) : Promise.resolve([]),
      memoryOn ? this.memory.consent(tenant.id, customer.id) : Promise.resolve(undefined),
      this.recentOrders(tenant.id, customer.id),
    ]);
    const channel = opts.channel ?? "whatsapp";
    try {
      const reply = await this.agent.reply({ tenant, blueprint, customer, conversationId, language, text, attachments: opts.attachments, history, knowledge, channel, inboundMessageId: opts.inboundMessageId, memories, consent, recentOrders: recent });
      this.logger.log(`converse "${text.slice(0, 60)}"${opts.attachments?.length ? ` +${opts.attachments.length} image(s)` : ""} -> ${reply.text.length} chars${reply.handoff ? ", handoff" : ""}${reply.startFlow ? `, flow ${reply.startFlow}` : ""}${reply.trace ? `, ${reply.trace.tools.length} tool call(s)` : ""}`);
      await this.recordRun(tenant.id, conversationId, channel, opts.inboundMessageId, reply, started);
      return reply;
    } catch (err) {
      await this.recordRun(tenant.id, conversationId, channel, opts.inboundMessageId, { text: "", handoff: false }, started, err);
      throw err;
    }
  }

  private async recordRun(tenantId: string, conversationId: string, channel: string, inboundMessageId: string | undefined, reply: AgentReply, started: number, err?: unknown): Promise<void> {
    const t = reply.trace;
    try {
      await this.runs.record({
        tenantId,
        conversationId,
        inboundMessageId,
        channel,
        model: t?.model ?? "unknown",
        tools: t?.tools ?? [],
        memoryIds: t?.memoryIds ?? [],
        inputTokens: t?.inputTokens ?? 0,
        outputTokens: t?.outputTokens ?? 0,
        durationMs: t?.durationMs ?? Date.now() - started,
        outcome: err ? "error" : reply.handoff ? "handoff" : "replied",
        error: err ? (err instanceof Error ? err.message : String(err)).slice(0, 500) : undefined,
      });
    } catch (e) {
      this.logger.warn(`agent run not recorded: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private recentOrders(tenantId: string, customerId: string) {
    return this.orders.listRecent(tenantId, { customerId, limit: 5 });
  }

  /** Which flow free text asks for, or a direct reply. Null means "not sure": show the menu as before. */
  async interpret(tenant: Tenant, blueprint: Blueprint, conversationId: string, text: string, language: string): Promise<Interpretation | null> {
    if (!this.assistant.enabled) return null;
    try {
      const [knowledge, history] = await Promise.all([this.knowledge(tenant, blueprint, language), this.history(conversationId)]);
      const out = await this.assistant.interpret({ text, language, knowledge, history });
      this.logger.log(`interpret "${text.slice(0, 60)}" -> flow=${out.flow ?? "-"} reply=${out.reply ? "yes" : "no"} (${out.confidence})`);
      return out;
    } catch (err) {
      this.logger.warn(`interpret failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async pickOption(input: PickOptionInput): Promise<string | null> {
    if (!this.assistant.enabled || input.options.length === 0) return null;
    try {
      const id = await this.assistant.pickOption(input);
      this.logger.log(`pickOption "${input.text.slice(0, 60)}" -> ${id ?? "-"}`);
      return id;
    } catch (err) {
      this.logger.warn(`pickOption failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** A reply for a human agent to review before sending. Throws when the assistant is off or fails. */
  async draftReply(tenantId: string, conversationId: string, instruction?: string): Promise<string> {
    const ctx = await this.tenants.findContextById(tenantId);
    if (!ctx) throw new Error("tenant not found");
    const blueprint = this.blueprints.get(ctx.tenant.blueprintId);
    if (!blueprint) throw new Error(`unknown blueprint ${ctx.tenant.blueprintId}`);
    const conversation = await this.conversations.findConversationById(conversationId);
    if (!conversation || conversation.tenantId !== tenantId) throw new Error("conversation not found");
    const customer = await this.conversations.findCustomerById(conversation.customerId);
    const language = customer?.language ?? ctx.tenant.defaultLanguage;
    const [knowledge, history] = await Promise.all([this.knowledge(ctx.tenant, blueprint, language), this.history(conversationId)]);
    return this.assistant.draftReply({ language, knowledge, history, instruction });
  }

  async knowledge(tenant: Tenant, blueprint: Blueprint, language: string): Promise<TenantKnowledge> {
    const [offerings, staff] = await Promise.all([this.catalog.listAllOfferings(tenant.id), this.resources.list(tenant.id, { includeInactive: false })]);
    const keywordsByFlow = new Map<string, string[]>();
    for (const g of blueprint.globalCommands) keywordsByFlow.set(g.flow, [...(keywordsByFlow.get(g.flow) ?? []), ...g.keywords]);
    const settings = tenant.settings as { facts?: unknown };
    const facts = Array.isArray(settings.facts) ? settings.facts.filter((f): f is string => typeof f === "string") : [];
    return {
      tenantName: tenant.name,
      blueprintId: blueprint.id,
      timezone: tenant.timezone || "Asia/Dubai",
      services: offerings
        .filter((o) => o.isActive)
        .map((o) => ({ id: o.id, title: localized(o.name, language), price: formatMoney(o.priceMinor, o.currency), durationMinutes: o.durationMinutes })),
      staff: staff.map((r) => ({ id: r.id, title: localized(r.name, language) })),
      intents: blueprint.flows
        .filter((f) => !HIDDEN_FLOWS.has(f.id))
        .map((f) => ({ flow: f.id, description: f.description ?? f.id.replace(/_/g, " "), keywords: keywordsByFlow.get(f.id) ?? [] })),
      facts,
      profile: businessProfile(tenant.settings),
    };
  }

  private async history(conversationId: string): Promise<HistoryTurn[]> {
    const messages = await this.conversations.listMessages(conversationId, { limit: HISTORY_TURNS });
    return messages.map((m) => ({ role: m.direction === "in" ? "customer" : "bot", text: agentTextOf(m.payload) }));
  }
}
