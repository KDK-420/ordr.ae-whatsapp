import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Tenant } from "@ordr/domain";
import { OrderService } from "../orders/order.service";
import type { TenantRepository } from "../ports";
import { TOKENS } from "../tokens";
import { type Branch, type BranchInput, listedInSearch, SUITE_MODULES, type SuiteModule, type SuiteRepository, SWATCHES, type TenantTheme, tenantModules, tenantTheme } from "./types";
import { activeBranches, DEFAULT_STATIONS } from "./routing";

export interface SuiteView {
  tenant: { id: string; name: string; slug: string; timezone: string };
  modules: SuiteModule[];
  theme: TenantTheme;
  branches: Branch[];
  currency: string;
  vatRate: number;
  vatInclusive: boolean;
  deliveryFeeMinor: number;
}


/**
 * The suite's core: which modules a restaurant has, its theme, and its branches. Every module
 * controller asks here before doing anything, so a module that is off does not exist for that
 * tenant.
 */
@Injectable()
export class SuiteService {
  constructor(
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.SuiteRepository) private readonly suite: SuiteRepository,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {}

  async tenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException("tenant not found");
    return tenant;
  }

  async modules(tenantId: string): Promise<SuiteModule[]> {
    return tenantModules((await this.tenant(tenantId)).settings);
  }

  /** Refuses with 403 when the restaurant does not have the module. */
  async requireModule(tenantId: string, module: SuiteModule): Promise<Tenant> {
    const tenant = await this.tenant(tenantId);
    if (!tenantModules(tenant.settings).includes(module)) throw new ForbiddenException(`the ${module} module is not part of this restaurant's plan`);
    return tenant;
  }

  /** Any of the given modules is enough (the stream and the shared order views). */
  async requireAnyModule(tenantId: string, modules: SuiteModule[]): Promise<Tenant> {
    const tenant = await this.tenant(tenantId);
    const has = tenantModules(tenant.settings);
    if (!modules.some((m) => has.includes(m))) throw new ForbiddenException("this is not part of this restaurant's plan");
    return tenant;
  }

  /** Active branches; a restaurant that has none yet gets its first one here, so nothing downstream handles "no branch". */
  branches(tenantId: string): Promise<Branch[]> {
    return activeBranches(this.suite, tenantId);
  }

  /** The branch a request names, or the first one when it names none. 404 for a branch of another tenant. */
  async branch(tenantId: string, branchId?: string): Promise<Branch> {
    if (branchId) {
      const found = await this.suite.getBranch(tenantId, branchId);
      if (!found || !found.isActive) throw new NotFoundException("branch not found");
      return found;
    }
    const [first] = await this.branches(tenantId);
    if (!first) throw new NotFoundException("this restaurant has no active branch");
    return first;
  }

  async createBranch(tenantId: string, input: BranchInput): Promise<Branch> {
    return this.suite.createBranch(tenantId, { ...input, stations: input.stations?.length ? input.stations : DEFAULT_STATIONS });
  }

  async updateBranch(tenantId: string, branchId: string, patch: Partial<BranchInput>): Promise<Branch> {
    const updated = await this.suite.updateBranch(tenantId, branchId, patch);
    if (!updated) throw new NotFoundException("branch not found");
    return updated;
  }

  async view(tenantId: string): Promise<SuiteView> {
    const settings = await this.orders.settingsFor(tenantId);
    const tenant = settings.tenant;
    return {
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, timezone: tenant.timezone || "Asia/Dubai" },
      modules: tenantModules(tenant.settings),
      theme: tenantTheme(tenant.settings),
      branches: await this.branches(tenantId),
      currency: settings.currency,
      vatRate: settings.vatRate,
      vatInclusive: settings.vatInclusive,
      deliveryFeeMinor: settings.deliveryFeeMinor,
    };
  }

  async listedInSearch(tenantId: string): Promise<boolean> {
    return listedInSearch((await this.tenant(tenantId)).settings);
  }

  /** Platform operator only: which modules a restaurant has, its look, and whether search engines may list its site. */
  async configure(tenantId: string, input: { modules?: string[]; theme?: Record<string, unknown>; listInSearch?: boolean }): Promise<{ modules: SuiteModule[]; theme: TenantTheme; listInSearch: boolean }> {
    const patch: Record<string, unknown> = {};
    if (input.listInSearch !== undefined) patch.listInSearch = input.listInSearch;
    if (input.modules) patch.modules = SUITE_MODULES.filter((m) => input.modules!.includes(m));
    if (input.theme) {
      const current = (await this.tenant(tenantId)).settings.theme;
      const merged = { ...(current && typeof current === "object" ? (current as Record<string, unknown>) : {}), ...input.theme };
      if (!(SWATCHES as readonly string[]).includes(String(merged.swatch))) merged.swatch = "espresso";
      patch.theme = merged;
    }
    const updated = await this.tenants.updateSettings(tenantId, patch);
    if (!updated) throw new NotFoundException("tenant not found");
    return { modules: tenantModules(updated.settings), theme: tenantTheme(updated.settings), listInSearch: listedInSearch(updated.settings) };
  }
}
