import { Prisma, type PrismaClient } from "@prisma/client";
import type { MessageTemplateRecord, RemoteTemplate, TemplateApi, TemplateDefinition, TemplateRepository, TemplateStatus, UpsertTemplateInput } from "../ports";

let seq = 0;

export class InMemoryTemplateRepository implements TemplateRepository {
  readonly rows: MessageTemplateRecord[] = [];

  async list(tenantId: string): Promise<MessageTemplateRecord[]> {
    return this.rows.filter((r) => r.tenantId === tenantId).map((r) => structuredClone(r));
  }

  async findApproved(tenantId: string, purpose: string, language: string): Promise<MessageTemplateRecord | null> {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.purpose === purpose && x.language === language && x.status === "approved");
    return r ? structuredClone(r) : null;
  }

  async upsert(input: UpsertTemplateInput): Promise<MessageTemplateRecord> {
    let r = this.rows.find((x) => x.tenantId === input.tenantId && x.name === input.name && x.language === input.language);
    if (r) {
      Object.assign(r, { category: input.category, purpose: input.purpose, body: input.body, parameters: [...input.parameters], updatedAt: new Date().toISOString() });
    } else {
      r = { id: `tpl_${++seq}`, status: "draft", ...input, parameters: [...input.parameters], updatedAt: new Date().toISOString() };
      this.rows.push(r);
    }
    return structuredClone(r);
  }

  async setStatus(id: string, status: TemplateStatus, meta: { metaId?: string; rejectedReason?: string } = {}): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return;
    r.status = status;
    if (meta.metaId) r.metaId = meta.metaId;
    r.rejectedReason = meta.rejectedReason;
    r.updatedAt = new Date().toISOString();
  }
}

const STATUSES = new Set<TemplateStatus>(["draft", "pending", "approved", "rejected", "paused", "disabled"]);

/** Meta reports statuses such as APPROVED, PENDING, REJECTED, PAUSED, DISABLED; unknown ones count as pending. */
export function normalizeStatus(raw: string): TemplateStatus {
  const s = raw.toLowerCase() as TemplateStatus;
  return STATUSES.has(s) ? s : "pending";
}

type Row = Prisma.MessageTemplateGetPayload<Record<string, never>>;

const toRecord = (r: Row): MessageTemplateRecord => ({
  id: r.id,
  tenantId: r.tenantId,
  name: r.name,
  language: r.language,
  category: r.category,
  purpose: r.purpose,
  body: r.body,
  parameters: Array.isArray(r.parameters) ? (r.parameters as string[]) : [],
  status: normalizeStatus(r.status),
  metaId: r.metaId ?? undefined,
  rejectedReason: r.rejectedReason ?? undefined,
  updatedAt: r.updatedAt.toISOString(),
});

export class PrismaTemplateRepository implements TemplateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tenantId: string): Promise<MessageTemplateRecord[]> {
    const rows = await this.prisma.messageTemplate.findMany({ where: { tenantId }, orderBy: [{ purpose: "asc" }, { language: "asc" }] });
    return rows.map(toRecord);
  }

  async findApproved(tenantId: string, purpose: string, language: string): Promise<MessageTemplateRecord | null> {
    const r = await this.prisma.messageTemplate.findFirst({ where: { tenantId, purpose, language, status: "approved" } });
    return r ? toRecord(r) : null;
  }

  async upsert(input: UpsertTemplateInput): Promise<MessageTemplateRecord> {
    const data = { category: input.category, purpose: input.purpose, body: input.body, parameters: input.parameters as unknown as Prisma.InputJsonValue };
    const r = await this.prisma.messageTemplate.upsert({
      where: { tenantId_name_language: { tenantId: input.tenantId, name: input.name, language: input.language } },
      update: data,
      create: { tenantId: input.tenantId, name: input.name, language: input.language, ...data },
    });
    return toRecord(r);
  }

  async setStatus(id: string, status: TemplateStatus, meta: { metaId?: string; rejectedReason?: string } = {}): Promise<void> {
    await this.prisma.messageTemplate.update({
      where: { id },
      data: { status, ...(meta.metaId ? { metaId: meta.metaId } : {}), rejectedReason: meta.rejectedReason ?? null },
    });
  }
}

/**
 * Stand-in for Meta's template API in development and tests. Approves everything immediately
 * so the notification path outside the 24 hour window can be exercised without a real WABA.
 */
export class FakeTemplateApi implements TemplateApi {
  readonly created: Array<{ wabaId: string; definition: TemplateDefinition }> = [];
  /** Status the fake reports for new templates; tests flip it to simulate review. */
  statusForNew = "APPROVED";

  async createTemplate(wabaId: string, _accessToken: string, definition: TemplateDefinition): Promise<RemoteTemplate> {
    this.created.push({ wabaId, definition });
    return { id: `fake_${this.created.length}`, name: definition.name, language: definition.language, status: this.statusForNew, category: definition.category };
  }

  async listTemplates(wabaId: string): Promise<RemoteTemplate[]> {
    return this.created
      .filter((c) => c.wabaId === wabaId)
      .map((c, i) => ({ id: `fake_${i + 1}`, name: c.definition.name, language: c.definition.language, status: this.statusForNew, category: c.definition.category }));
  }
}
