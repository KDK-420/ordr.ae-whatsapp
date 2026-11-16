import { Inject, Injectable } from "@nestjs/common";
import type { OrderItem, Tenant } from "@ordr/domain";
import type { CatalogRepository } from "../ports";
import { TOKENS } from "../tokens";
import { type Branch, type Station, type SuiteRepository, tenantModules } from "./types";

/** A sensible kitchen for a first branch: one station that takes everything. */
export const DEFAULT_STATIONS: Station[] = [{ id: "st_kitchen", name: "Kitchen", categoryIds: [] }];

/** Active branches; a restaurant that has none yet gets its first one here, so nothing downstream handles "no branch". */
export async function activeBranches(repo: SuiteRepository, tenantId: string): Promise<Branch[]> {
  const existing = await repo.listBranches(tenantId);
  if (existing.length > 0) return existing;
  const all = await repo.listBranches(tenantId, { includeInactive: true });
  if (all.length > 0) return [];
  return [await repo.createBranch(tenantId, { name: "Main Store", stations: DEFAULT_STATIONS })];
}

/** The station that lists the item's category, else the branch's first station. */
export function stationFor(branch: Pick<Branch, "stations">, categoryId: string | undefined): string | undefined {
  const match = categoryId ? branch.stations.find((s) => s.categoryIds.includes(categoryId)) : undefined;
  return (match ?? branch.stations[0])?.id;
}

export interface Routed<T> {
  branchId: string;
  items: Array<T & Pick<OrderItem, "stationId" | "kitchenStatus">>;
  firedAt: Date;
}

/**
 * Sends an order that did not come from the till or the ordering site (a WhatsApp or web chat
 * order) into the restaurant's operation: a branch, a station per line, and a kitchen clock.
 * Without this such an order would never reach the kitchen display, the day's sales or the
 * stock ledger. Restaurants without POS, KDS or Inventory are left exactly as they were.
 */
@Injectable()
export class SuiteRouting {
  constructor(
    @Inject(TOKENS.SuiteRepository) private readonly repo: SuiteRepository,
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
  ) {}

  async route<T extends { offeringId: string }>(tenant: Tenant, items: T[], now: Date): Promise<Routed<T> | null> {
    const modules = tenantModules(tenant.settings);
    if (!modules.some((m) => m === "pos" || m === "kds" || m === "inventory")) return null;
    // Chat customers are not asked which branch; their orders go to the first one.
    const [branch] = await activeBranches(this.repo, tenant.id);
    if (!branch) return null;
    const categories = new Map<string, string | undefined>();
    for (const o of await this.catalog.listAllOfferings(tenant.id)) categories.set(o.id, o.categoryId ?? undefined);
    return { branchId: branch.id, firedAt: now, items: items.map((i) => ({ ...i, stationId: stationFor(branch, categories.get(i.offeringId)), kitchenStatus: "queued" as const })) };
  }
}
