import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Tenant } from "@ordr/domain";
import type { AppConfig } from "../config";
import type { ConsentRecord, MemoryKind, MemoryRecord, MemoryRepository } from "../ports";
import { TOKENS } from "../tokens";

export class MemoryError extends Error {
  constructor(
    public readonly code: "no_consent" | "disabled" | "sensitive" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "MemoryError";
  }
}

/** Attributes we refuse to persist however they are phrased (ADR 0003). */
const SENSITIVE = /health|medical|pregnan|allerg|religio|ethnic|disab|diagnos|medication|sexual|politic|immigra|salary|income|passport|emirates id|card number|password/i;

/**
 * Consented, tenant-scoped customer memory. Writes need the tenant's memory switched on and
 * the customer's recorded consent; reads return only live rows for the same tenant and
 * customer. The model proposes, this service decides.
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.MemoryRepository) private readonly memories: MemoryRepository,
  ) {}

  enabledFor(tenant: Tenant): boolean {
    return tenant.settings.memoryEnabled !== false;
  }

  consent(tenantId: string, customerId: string): Promise<ConsentRecord | null> {
    return this.memories.getConsent(tenantId, customerId);
  }

  async setConsent(tenant: Tenant, customerId: string, granted: boolean, sourceMessageId?: string): Promise<ConsentRecord> {
    if (!this.enabledFor(tenant)) throw new MemoryError("disabled", "this business does not keep customer memory");
    const rec = await this.memories.setConsent({ tenantId: tenant.id, customerId, memory: granted, purpose: "personalization", sourceMessageId });
    if (!granted) {
      const n = await this.memories.forget(tenant.id, customerId);
      if (n) this.logger.log(`consent withdrawn by ${customerId}: ${n} memories forgotten`);
    }
    return rec;
  }

  /** Live memories to show the assistant; empty without consent or when the tenant has memory off. */
  async recall(tenant: Tenant, customerId: string, now = new Date()): Promise<MemoryRecord[]> {
    if (!this.enabledFor(tenant)) return [];
    const consent = await this.memories.getConsent(tenant.id, customerId);
    if (!consent?.memory) return [];
    return this.memories.listActive(tenant.id, customerId, now);
  }

  async remember(tenant: Tenant, customerId: string, input: { kind: MemoryKind; key: string; value: unknown; confidence?: number; sourceMessageIds?: string[] }): Promise<MemoryRecord> {
    if (!this.enabledFor(tenant)) throw new MemoryError("disabled", "this business does not keep customer memory");
    const consent = await this.memories.getConsent(tenant.id, customerId);
    if (!consent?.memory) throw new MemoryError("no_consent", "the customer has not agreed to be remembered");
    const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60);
    if (!key) throw new MemoryError("invalid", "key is required");
    const text = `${key} ${JSON.stringify(input.value)}`;
    if (SENSITIVE.test(text)) throw new MemoryError("sensitive", "that kind of detail is not stored");
    const retentionMs = this.config.MEMORY_RETENTION_DAYS * 24 * 60 * 60_000;
    const rec = await this.memories.upsert({
      tenantId: tenant.id,
      customerId,
      kind: input.kind,
      key,
      value: input.value,
      confidence: Math.max(0, Math.min(1, input.confidence ?? 1)),
      sourceMessageIds: input.sourceMessageIds ?? [],
      consentPurpose: consent.purpose,
      expiresAt: new Date(Date.now() + retentionMs).toISOString(),
    });
    this.logger.log(`remembered ${key} for ${customerId} (tenant ${tenant.id})`);
    return rec;
  }

  async forget(tenant: Tenant, customerId: string, key?: string): Promise<number> {
    const n = await this.memories.forget(tenant.id, customerId, key ? key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_") : undefined);
    this.logger.log(`forgot ${key ?? "everything"} for ${customerId}: ${n} row(s)`);
    return n;
  }
}
