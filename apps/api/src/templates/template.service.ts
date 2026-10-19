import { Inject, Injectable, Logger } from "@nestjs/common";
import { type OutboundMessage, template as templateMessage } from "@ordr/whatsapp";
import { normalizeStatus } from "../adapters/templates";
import type { MessageTemplateRecord, TemplateApi, TemplateRepository, TenantRepository } from "../ports";
import { TOKENS } from "../tokens";

export const ORDER_STATUS_PURPOSE = "order_status";
export const BOOKING_REMINDER_PURPOSE = "booking_reminder";

/** Templates every tenant needs. Bodies use Meta's positional placeholders. */
export const DEFAULT_TEMPLATES = [
  {
    purpose: ORDER_STATUS_PURPOSE,
    name: "ordr_order_status",
    category: "UTILITY",
    parameters: ["orderNumber", "status", "total"],
    bodies: {
      en: "Order #{{1}} is {{2}}. Total {{3}}. Reply here if you have any question.",
      ar: "الطلب رقم {{1}} حالته: {{2}}. الإجمالي {{3}}. راسلنا هنا إذا كان لديك أي سؤال.",
    } as Record<string, string>,
    examples: ["42", "confirmed", "AED 34.00"],
  },
  {
    purpose: BOOKING_REMINDER_PURPOSE,
    name: "ordr_booking_reminder",
    category: "UTILITY",
    parameters: ["tenant", "when"],
    bodies: {
      en: "Reminder: your booking at {{1}} is on {{2}}. Reply here if you need to change it.",
      ar: "تذكير: حجزك في {{1}} في {{2}}. راسلنا هنا إذا أردت تغييره.",
    } as Record<string, string>,
    examples: ["Demo Salon", "Tue 20 Oct, 11:00"],
  },
];

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);

  constructor(
    @Inject(TOKENS.TemplateRepository) private readonly templates: TemplateRepository,
    @Inject(TOKENS.TemplateApi) private readonly api: TemplateApi,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
  ) {}

  list(tenantId: string): Promise<MessageTemplateRecord[]> {
    return this.templates.list(tenantId);
  }

  /** Registers the default templates with Meta for every language the tenant's blueprint speaks. */
  async submitDefaults(tenantId: string, languages: string[]): Promise<MessageTemplateRecord[]> {
    const ctx = await this.tenants.findContextById(tenantId);
    if (!ctx) throw new TemplateError("tenant has no active WhatsApp channel");
    const out: MessageTemplateRecord[] = [];
    for (const def of DEFAULT_TEMPLATES) {
      for (const language of languages) {
        const body = def.bodies[language];
        if (!body) continue;
        const record = await this.templates.upsert({ tenantId, name: def.name, language, category: def.category, purpose: def.purpose, body, parameters: def.parameters });
        if (record.status === "approved" || record.status === "pending") {
          out.push(record);
          continue;
        }
        try {
          const remote = await this.api.createTemplate(ctx.channel.wabaId, ctx.channel.accessToken, { name: def.name, language, category: def.category, body, examples: def.examples });
          await this.templates.setStatus(record.id, normalizeStatus(remote.status), { metaId: remote.id });
          this.logger.log(`template ${def.name}/${language} submitted for tenant ${tenantId}: ${remote.status}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.templates.setStatus(record.id, "rejected", { rejectedReason: message });
          this.logger.warn(`template ${def.name}/${language} submission failed for tenant ${tenantId}: ${message}`);
        }
        out.push(...(await this.templates.list(tenantId)).filter((t) => t.id === record.id));
      }
    }
    return out;
  }

  /** Pulls the current review status of every known template from Meta. */
  async sync(tenantId: string): Promise<MessageTemplateRecord[]> {
    const ctx = await this.tenants.findContextById(tenantId);
    if (!ctx) throw new TemplateError("tenant has no active WhatsApp channel");
    const [local, remote] = await Promise.all([this.templates.list(tenantId), this.api.listTemplates(ctx.channel.wabaId, ctx.channel.accessToken)]);
    for (const t of local) {
      const match = remote.find((r) => r.name === t.name && r.language === t.language);
      if (!match) continue;
      const status = normalizeStatus(match.status);
      if (status !== t.status || (match.id && match.id !== t.metaId)) {
        await this.templates.setStatus(t.id, status, { metaId: match.id, rejectedReason: match.rejectedReason });
      }
    }
    return this.templates.list(tenantId);
  }

  /** An approved template for the purpose in the language, else in any of the fallbacks, else null. */
  async approved(tenantId: string, purpose: string, language: string, fallbacks: string[] = []): Promise<MessageTemplateRecord | null> {
    for (const lang of [language, ...fallbacks]) {
      const t = await this.templates.findApproved(tenantId, purpose, lang);
      if (t) return t;
    }
    return null;
  }

  /** Fills a template's positional parameters, in the order its `parameters` list names them. */
  render(t: MessageTemplateRecord, values: Record<string, string | number>): OutboundMessage {
    const parameters = t.parameters.map((key) => ({ type: "text", text: String(values[key] ?? "") }));
    return templateMessage(t.name, t.language, parameters.length ? [{ type: "body", parameters }] : undefined);
  }
}
