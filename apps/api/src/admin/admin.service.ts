import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Channel, Tenant } from "@ordr/domain";
import { demoCatalog } from "../actions/demo-catalog";
import { demoSalonCatalog } from "../actions/demo-salon";
import { hashPassword } from "../auth/password";
import { temporaryPassword } from "../merchant/users.controller";
import type { BlueprintRegistry, CatalogRepository, ChannelInput, NumberPoolRepository, PooledNumber, ResourceRepository, TenantRepository, UserRecord, UserRepository } from "../ports";
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
    @Inject(TOKENS.NumberPoolRepository) private readonly numbers: NumberPoolRepository,
    @Inject(TOKENS.BlueprintRegistry) private readonly blueprints: BlueprintRegistry,
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
    const email = req.ownerEmail.trim().toLowerCase();
    if (await this.users.findByEmail(email)) throw new AdminError("conflict", `${email} already has an account`);
    const number = req.numberId ? await this.pooled(req.numberId) : null;
    if (number?.tenantId) throw new AdminError("conflict", "that number is already assigned");

    const slug = await this.uniqueSlug(req.name);
    const tenant = await this.tenants.create({ name: req.name.trim(), slug, blueprintId: req.blueprintId, defaultLanguage: req.defaultLanguage, timezone: req.timezone });
    const password = temporaryPassword();
    const owner = await this.users.create({ tenantId: tenant.id, email, name: req.ownerName.trim(), role: "owner", passwordHash: hashPassword(password) });
    if (req.seedDemo ?? true) await this.seedDemo(tenant);
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
  private async seedDemo(tenant: Tenant): Promise<void> {
    const demo = tenant.blueprintId === "salon" ? demoSalonCatalog(tenant.id) : { ...demoCatalog(tenant.id), resources: [] };
    const categoryIds = new Map<string, string>();
    for (const c of demo.categories) {
      const created = await this.catalog.createCategory(tenant.id, { name: c.name, sortOrder: c.sortOrder, isActive: c.isActive });
      categoryIds.set(c.id, created.id);
    }
    const offeringIds = new Map<string, string>();
    for (const o of demo.offerings) {
      const created = await this.catalog.createOffering(tenant.id, {
        categoryId: o.categoryId ? (categoryIds.get(o.categoryId) ?? null) : null,
        type: o.type,
        name: o.name,
        description: o.description ?? null,
        priceMinor: o.priceMinor,
        currency: o.currency,
        durationMinutes: o.durationMinutes ?? null,
        sortOrder: o.sortOrder,
        isActive: o.isActive,
        modifierGroups: o.modifierGroups.map((g) => ({ name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: g.sortOrder, options: g.options.map((op) => ({ name: op.name, priceDeltaMinor: op.priceDeltaMinor, sortOrder: op.sortOrder, isActive: op.isActive })) })),
      });
      offeringIds.set(o.id, created.id);
    }
    for (const r of demo.resources) {
      await this.resources.create(tenant.id, { name: r.name, type: r.type, hours: r.hours, skills: r.skills.map((s) => offeringIds.get(s) ?? s), sortOrder: r.sortOrder, isActive: r.isActive });
    }
  }
}

export const publicOwner = (u: UserRecord) => ({ id: u.id, email: u.email, name: u.name });
