import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Channel, Tenant } from "@ordr/domain";
import { type DemoSet, demoDataFor } from "../actions/demo";
import type { CoffeeDemo } from "../actions/demo-coffee";
import { hashPassword } from "../auth/password";
import { temporaryPassword } from "../merchant/users.controller";
import type { BlueprintRegistry, CatalogRepository, ChannelInput, NumberPoolRepository, PooledNumber, PropertyRepository, ResourceRepository, TenantRepository, UserRecord, UserRepository } from "../ports";
import { type InventoryRepository, SUITE_MODULES, type SuiteModule, type SuiteRepository, type SwatchId } from "../suite/types";
import { TOKENS } from "../tokens";

export interface TenantOverview {
  tenant: Tenant;
  channel: { id: string; phoneNumberId: string; displayPhone: string } | null;
  owners: Array<{ id: string; email: string; name: string }>;
}

export interface CreateTenantRequest {
  name: string;
  blueprintId: string;
  ownerEmail: string;
  ownerName: string;
  defaultLanguage?: string;
  timezone?: string;
  /** Pool number to attach right away. */
  numberId?: string;
  /** Load the vertical's demo catalog (and salon staff) so the bot has something to show. */
  seedDemo?: boolean;
  /** Restaurant suite modules to switch on; left out, the merchant has WhatsApp only. */
  modules?: SuiteModule[];
  /** Theme swatch for the ordering site and the staff apps. */
  swatch?: SwatchId;
  /** A fuller demo than the vertical's plain catalog. "coffee": a coffee shop with photos, stations, stock, recipes and suppliers. */
  demoSet?: DemoSet;
}

export interface CreateTenantResult {
  tenant: Tenant;
  owner: { id: string; email: string; temporaryPassword: string };
  channel: Channel | null;
}

export class AdminError extends Error {
  constructor(
    public readonly code: "not_found" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

/** Platform operations: create merchants and hand them WhatsApp numbers from the pool. */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.UserRepository) private readonly users: UserRepository,
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.ResourceRepository) private readonly resources: ResourceRepository,
    @Inject(TOKENS.PropertyRepository) private readonly properties: PropertyRepository,
    @Inject(TOKENS.NumberPoolRepository) private readonly numbers: NumberPoolRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
    @Inject(TOKENS.SuiteRepository) private readonly suite: SuiteRepository,
    @Inject(TOKENS.InventoryRepository) private readonly inventory: InventoryRepository,
  ) {}

  async listTenants(): Promise<TenantOverview[]> {
    const rows = await this.tenants.list();
    return Promise.all(
      rows.map(async ({ tenant, channel }) => ({
        tenant,
        channel: channel ? { id: channel.id, phoneNumberId: channel.phoneNumberId, displayPhone: channel.displayPhone } : null,
        owners: (await this.users.listByTenant(tenant.id)).filter((u) => u.role === "owner" && u.isActive).map((u) => ({ id: u.id, email: u.email, name: u.name })),
      })),
    );
  }

  async createTenant(req: CreateTenantRequest): Promise<CreateTenantResult> {
    const blueprint = this.blueprints.get(req.blueprintId);
    if (!blueprint) throw new AdminError("invalid", `unknown vertical "${req.blueprintId}"`);
    if (req.demoSet === "coffee" && req.blueprintId !== "restaurant") throw new AdminError("invalid", "the coffee shop demo is for the restaurant vertical");
    const email = req.ownerEmail.trim().toLowerCase();
    if (await this.users.findByEmail(email)) throw new AdminError("conflict", `${email} already has an account`);
    const number = req.numberId ? await this.pooled(req.numberId) : null;
    if (number?.tenantId) throw new AdminError("conflict", "that number is already assigned");

    const slug = await this.uniqueSlug(req.name);
    let tenant = await this.tenants.create({ name: req.name.trim(), slug, blueprintId: req.blueprintId, defaultLanguage: req.defaultLanguage, timezone: req.timezone });
    if (req.modules || req.swatch) {
      const settings: Record<string, unknown> = {};
      if (req.modules) settings.modules = SUITE_MODULES.filter((m) => req.modules!.includes(m));
      if (req.swatch) settings.theme = { swatch: req.swatch };
      tenant = (await this.tenants.updateSettings(tenant.id, settings)) ?? tenant;
    }
    const password = temporaryPassword();
    const owner = await this.users.create({ tenantId: tenant.id, email, name: req.ownerName.trim(), role: "owner", passwordHash: hashPassword(password) });
    if (req.seedDemo ?? true) tenant = await this.seedDemo(tenant, req);
    const channel = number ? await this.attach(number, tenant.id) : null;
    this.logger.log(`tenant "${tenant.name}" (${tenant.id}, ${tenant.blueprintId}) created for ${email}${channel ? ` on ${channel.displayPhone}` : ""}`);
    return { tenant, owner: { id: owner.id, email: owner.email, temporaryPassword: password }, channel };
  }

  async resetOwnerPassword(tenantId: string, userId: string): Promise<{ email: string; temporaryPassword: string }> {
    const user = await this.users.findById(userId);
    if (!user || user.tenantId !== tenantId) throw new AdminError("not_found", "user not found");
    const password = temporaryPassword();
    await this.users.update(user.id, { passwordHash: hashPassword(password) });
    return { email: user.email, temporaryPassword: password };
  }

  listNumbers(): Promise<PooledNumber[]> {
    return this.numbers.list();
  }

  async addNumber(input: ChannelInput & { label?: string }): Promise<PooledNumber> {
    if ((await this.numbers.list()).some((n) => n.phoneNumberId === input.phoneNumberId)) throw new AdminError("conflict", "that phone number id is already in the pool");
    return this.numbers.create(input);
  }

  /** Points the number at the tenant; the previous tenant, if any, loses it. */
  async assignNumber(numberId: string, tenantId: string): Promise<PooledNumber> {
    const number = await this.pooled(numberId);
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new AdminError("not_found", "tenant not found");
    await this.attach(number, tenant.id);
    return (await this.numbers.findById(numberId))!;
  }

  async releaseNumber(numberId: string): Promise<PooledNumber> {
    const number = await this.pooled(numberId);
    await this.tenants.detachChannel(number.phoneNumberId);
    return (await this.numbers.setTenant(number.id, null))!;
  }

  private async attach(number: PooledNumber, tenantId: string): Promise<Channel> {
    const channel = await this.tenants.attachChannel(tenantId, { phoneNumberId: number.phoneNumberId, wabaId: number.wabaId, displayPhone: number.displayPhone, accessToken: number.accessToken });
    await this.numbers.setTenant(number.id, tenantId);
    return channel;
  }

  private async pooled(id: string): Promise<PooledNumber> {
    const n = await this.numbers.findById(id);
    if (!n) throw new AdminError("not_found", "number not found");
    return n;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant";
    const taken = new Set((await this.tenants.list()).map((t) => t.tenant.slug));
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    return slug;
  }

  /** The same demo data the seed loads, with fresh ids so several tenants can have it. */
  private async seedDemo(tenant: Tenant, req: Pick<CreateTenantRequest, "demoSet" | "modules" | "swatch"> = {}): Promise<Tenant> {
    const demo = demoDataFor(tenant.blueprintId, tenant.id, req.demoSet);
    const propertyIds = new Map<string, string>();
    for (const p of demo.properties) {
      const created = await this.properties.create(tenant.id, { name: p.name, description: p.description ?? null, address: p.address ?? null, mapsUrl: p.mapsUrl ?? null, phone: p.phone ?? null, checkInTime: p.checkInTime, checkOutTime: p.checkOutTime, amenities: p.amenities, imageUrls: p.imageUrls, sortOrder: p.sortOrder, isActive: p.isActive });
      propertyIds.set(p.id, created.id);
    }
    const categoryIds = new Map<string, string>();
    for (const c of demo.categories) {
      const created = await this.catalog.createCategory(tenant.id, { name: c.name, sortOrder: c.sortOrder, isActive: c.isActive });
      categoryIds.set(c.id, created.id);
    }
    const offeringIds = new Map<string, string>();
    const optionIds = new Map<string, string>();
    for (const o of demo.offerings) {
      const created = await this.catalog.createOffering(tenant.id, {
        categoryId: o.categoryId ? (categoryIds.get(o.categoryId) ?? null) : null,
        type: o.type,
        name: o.name,
        description: o.description ?? null,
        priceMinor: o.priceMinor,
        currency: o.currency,
        durationMinutes: o.durationMinutes ?? null,
        imageUrl: o.imageUrl ?? null,
        stock: o.stock ?? null,
        propertyId: o.propertyId ? (propertyIds.get(o.propertyId) ?? null) : null,
        maxGuests: o.maxGuests ?? null,
        units: o.units ?? null,
        variants: (o.variants ?? []).map((v) => ({ name: v.name, sku: v.sku, priceMinor: v.priceMinor, stock: v.stock, sortOrder: v.sortOrder, isActive: v.isActive })),
        sortOrder: o.sortOrder,
        isActive: o.isActive,
        modifierGroups: o.modifierGroups.map((g) => ({ name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: g.sortOrder, options: g.options.map((op) => ({ name: op.name, priceDeltaMinor: op.priceDeltaMinor, sortOrder: op.sortOrder, isActive: op.isActive })) })),
      });
      offeringIds.set(o.id, created.id);
      // Recipes name the option they depend on (the large size, the extra shot): follow the demo's ids to the stored ones, by name.
      // Postgres hands stored names back with their languages in another order, so compare them language by language.
      const canon = (n: Record<string, string>) => JSON.stringify(Object.entries(n).sort(([a], [b]) => a.localeCompare(b)));
      const same = (a: Record<string, string>, b: Record<string, string>) => canon(a) === canon(b);
      for (const g of o.modifierGroups) {
        const storedGroup = created.modifierGroups.find((x) => same(x.name, g.name));
        for (const op of g.options) {
          const stored = storedGroup?.options.find((x) => same(x.name, op.name))?.id;
          if (op.id && stored) optionIds.set(op.id, stored);
        }
      }
    }
    for (const r of demo.resources) {
      await this.resources.create(tenant.id, { name: r.name, type: r.type, hours: r.hours, skills: r.skills.map((s) => offeringIds.get(s) ?? s), sortOrder: r.sortOrder, isActive: r.isActive });
    }
    return demo.suite ? this.seedSuite(tenant, demo.suite, { categoryIds, offeringIds, optionIds }, req) : tenant;
  }

  /**
   * The operational side of a suite demo: a branch with its kitchen stations, the stock list with
   * opening levels, a recipe per menu item, suppliers, and the shop's settings. Every id is the
   * new tenant's own; the demo's ids only say what points at what.
   */
  private async seedSuite(tenant: Tenant, demo: CoffeeDemo, ids: { categoryIds: Map<string, string>; offeringIds: Map<string, string>; optionIds: Map<string, string> }, req: Pick<CreateTenantRequest, "modules" | "swatch">): Promise<Tenant> {
    let firstBranchId: string | undefined;
    for (const b of demo.branches) {
      const stations = b.stations.map((st) => ({ ...st, categoryIds: st.categoryIds.map((c) => ids.categoryIds.get(c)).filter((c): c is string => !!c) }));
      const created = await this.suite.createBranch(tenant.id, { name: b.name, address: b.address ?? null, phone: b.phone ?? null, stations, sortOrder: b.sortOrder, isActive: b.isActive });
      firstBranchId ??= created.id;
    }
    const stockIds = new Map<string, { id: string; unitSize: number; costMinor: number }>();
    for (const i of demo.stockItems) {
      const created = await this.inventory.createItem(tenant.id, { name: i.name, category: i.category ?? null, kind: i.kind, baseUnit: i.baseUnit, unitLabel: i.unitLabel, unitSize: i.unitSize, reorderLevel: i.reorderLevel, costMinor: i.costMinor, isActive: i.isActive });
      stockIds.set(i.id, { id: created.id, unitSize: i.unitSize, costMinor: i.costMinor });
    }
    const recipes = new Map<string, Array<{ stockItemId: string; quantity: number; modifierOptionId?: string; appliesTo: CoffeeDemo["recipeLines"][number]["appliesTo"] }>>();
    for (const l of demo.recipeLines) {
      const offeringId = ids.offeringIds.get(l.offeringId);
      const stock = stockIds.get(l.stockItemId);
      const optionId = l.modifierOptionId ? ids.optionIds.get(l.modifierOptionId) : undefined;
      // A line whose item, stock or option did not make it across is dropped rather than left pointing nowhere.
      if (!offeringId || !stock || (l.modifierOptionId && !optionId)) continue;
      recipes.set(offeringId, [...(recipes.get(offeringId) ?? []), { stockItemId: stock.id, quantity: l.quantity, modifierOptionId: optionId, appliesTo: l.appliesTo }]);
    }
    for (const [offeringId, lines] of recipes) await this.inventory.setRecipe(tenant.id, offeringId, lines);
    for (const sup of demo.suppliers) await this.inventory.createSupplier(tenant.id, { name: sup.name, phone: sup.phone, email: sup.email, notes: sup.notes, leadDays: sup.leadDays, isActive: sup.isActive });
    if (firstBranchId) {
      const opening = demo.opening.flatMap((o) => {
        const stock = stockIds.get(o.stockItemId);
        return stock && o.units > 0 ? [{ tenantId: tenant.id, branchId: firstBranchId!, stockItemId: stock.id, type: "count" as const, quantity: o.units * stock.unitSize, unitCostMinor: stock.costMinor, note: "Opening stock" }] : [];
      });
      if (opening.length) await this.inventory.move(opening);
    }
    // The shop's own settings come from the demo; which modules it has and how it looks stay the operator's choice.
    const { modules: demoModules, theme: demoTheme, ...shop } = demo.settings;
    const theme = { ...(demoTheme as Record<string, unknown>), ...(req.swatch ? { swatch: req.swatch } : {}) };
    const modules = req.modules ? SUITE_MODULES.filter((m) => req.modules!.includes(m)) : demoModules;
    return (await this.tenants.updateSettings(tenant.id, { ...shop, modules, theme })) ?? tenant;
  }
}

export const publicOwner = (u: UserRecord) => ({ id: u.id, email: u.email, name: u.name });
