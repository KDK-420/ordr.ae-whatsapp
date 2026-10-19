import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Blueprint } from "@ordr/flow-schema";
import { formatMoney, localized, type Tenant } from "@ordr/domain";
import { previewOf } from "../conversation/preview";
import type { BlueprintRegistry, CatalogRepository, ConversationRepository, ResourceRepository, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";
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
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.ResourceRepository) private readonly resources: ResourceRepository,
    @Inject(TOKENS.ConversationRepository) private readonly conversations: ConversationRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
  ) {}

  get enabled(): boolean {
    return this.assistant.enabled;
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
    };
  }

  private async history(conversationId: string): Promise<HistoryTurn[]> {
    const messages = await this.conversations.listMessages(conversationId, { limit: HISTORY_TURNS });
    return messages.map((m) => ({ role: m.direction === "in" ? "customer" : "bot", text: previewOf(m.payload) }));
  }
}
