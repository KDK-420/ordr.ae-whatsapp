import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { formatMoney, localized, type Offering, type Order, type Tenant } from "@ordr/domain";
import { statusLabel } from "../actions/copy";
import { OrderService } from "../orders/order.service";
import type { CatalogRepository, OrderRepository, TenantRepository } from "../ports";
import { siteSettings } from "../site/site.service";
import { businessProfile, type BusinessProfile } from "../tenant-profile";
import { TOKENS } from "../tokens";
import { SuiteService } from "./suite.service";
import { type TenantTheme, tenantModules, tenantTheme } from "./types";

export interface StoreOption {
  id: string;
  name: string;
  priceDeltaMinor: number;
}

export interface StoreItem {
  id: string;
  categoryId?: string;
  name: string;
  description?: string;
  priceMinor: number;
  price: string;
  imageUrl?: string;
  modifierGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; options: StoreOption[] }>;
}

export interface PublicStore {
  slug: string;
  name: string;
  language: string;
  languages: string[];
  theme: TenantTheme;
  headline?: string;
  about?: string;
  heroImageUrl?: string;
  profile: BusinessProfile;
  currency: string;
  vatRate: number;
  vatInclusive: boolean;
  deliveryFeeMinor: number;
  fulfillmentTypes: string[];
  branches: Array<{ id: string; name: string; address?: string; phone?: string }>;
  categories: Array<{ id: string; name: string; items: StoreItem[] }>;
  featured: StoreItem[];
}

export interface TrackedOrder {
  number: number;
  status: string;
  statusLabel: string;
  /** Where the order is on the customer's progress bar, 0 to steps.length - 1; -1 when it was cancelled. */
  step: number;
  steps: string[];
  fulfillmentType: string;
  branch?: { name: string; address?: string; phone?: string };
  placedAt: string;
  readyAt?: string;
  items: Array<{ title: string; quantity: number; modifiers: string[]; lineTotal: string }>;
  subtotal: string;
  deliveryFee?: string;
  discount?: string;
  vat: string;
  vatInclusive: boolean;
  total: string;
  paymentStatus: string;
  paymentMethod?: string;
}

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LANGUAGES = ["en", "ar"];
/** What the storefront offers; dine-in from a table code comes with the POS tables work. */
const STORE_FULFILLMENT = ["pickup", "delivery"];

/**
 * The public ordering site of a restaurant. Read models are built field by field, so nothing
 * about staff, channels or other customers can ride along. Available only to tenants with the
 * Storefront module; everyone else looks like they do not exist.
 */
@Injectable()
export class StoreService {
  constructor(
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.OrderRepository) private readonly orders: OrderRepository,
    @Inject(SuiteService) private readonly suite: SuiteService,
    @Inject(OrderService) private readonly orderService: OrderService,
  ) {}

  /** The tenant behind a slug when it has the Storefront module. */
  async storeTenant(slug: string): Promise<Tenant> {
    const tenant = SUBDOMAIN.test(slug) ? await this.tenants.findBySlug(slug) : null;
    if (!tenant || !tenantModules(tenant.settings).includes("storefront")) throw new NotFoundException("no such store");
    return tenant;
  }

  async store(slug: string, requestedLanguage?: string): Promise<PublicStore> {
    const tenant = await this.storeTenant(slug);
    const language = requestedLanguage && LANGUAGES.includes(requestedLanguage) ? requestedLanguage : tenant.defaultLanguage;
    // The vertical decides what kinds of fulfilment exist at all; the store offers the ones a website can take.
    const [view, categories, offerings, blueprint] = await Promise.all([this.suite.view(tenant.id), this.catalog.listCategories(tenant.id), this.catalog.listAllOfferings(tenant.id), this.orderService.blueprintFor(tenant.id)]);
    const site = siteSettings(tenant.settings);
    const item = (o: Offering): StoreItem => ({
      id: o.id,
      categoryId: o.categoryId,
      name: localized(o.name, language, tenant.defaultLanguage),
      description: o.description ? localized(o.description, language, tenant.defaultLanguage) : undefined,
      priceMinor: o.priceMinor,
      price: formatMoney(o.priceMinor, o.currency),
      imageUrl: o.imageUrl,
      modifierGroups: o.modifierGroups
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((g) => ({ id: g.id, name: localized(g.name, language, tenant.defaultLanguage), minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options.filter((x) => x.isActive).map((x) => ({ id: x.id, name: localized(x.name, language, tenant.defaultLanguage), priceDeltaMinor: x.priceDeltaMinor })) })),
    });
    const active = offerings.filter((o) => o.isActive && o.type === "product").sort((a, b) => a.sortOrder - b.sortOrder);
    const grouped = categories.map((c) => ({ id: c.id, name: localized(c.name, language, tenant.defaultLanguage), items: active.filter((o) => o.categoryId === c.id).map(item) })).filter((c) => c.items.length > 0);
    // One favourite from each category first, so the row shows the range of the menu.
    const featured = [...grouped.map((c) => c.items[0]!), ...grouped.flatMap((c) => c.items.slice(1))].filter((i) => i.imageUrl).slice(0, 5);
    return {
      slug: tenant.slug,
      name: tenant.name,
      language,
      languages: LANGUAGES,
      theme: view.theme,
      headline: site.headline,
      about: site.about,
      heroImageUrl: site.heroImageUrl ?? view.theme.coverImageUrl,
      profile: businessProfile(tenant.settings),
      currency: view.currency,
      vatRate: view.vatRate,
      vatInclusive: view.vatInclusive,
      deliveryFeeMinor: view.deliveryFeeMinor,
      fulfillmentTypes: STORE_FULFILLMENT.filter((t) => blueprint.fulfillmentTypes.includes(t)),
      branches: view.branches.map((b) => ({ id: b.id, name: b.name, address: b.address, phone: b.phone })),
      categories: grouped,
      featured,
    };
  }

  async track(slug: string, token: string, requestedLanguage?: string): Promise<TrackedOrder> {
    const tenant = await this.storeTenant(slug);
    const order = token.length >= 16 ? await this.orders.findByPublicToken(token) : null;
    if (!order || order.tenantId !== tenant.id) throw new NotFoundException("no such order");
    const language = requestedLanguage && LANGUAGES.includes(requestedLanguage) ? requestedLanguage : tenant.defaultLanguage;
    const view = await this.suite.view(tenant.id);
    const branch = view.branches.find((b) => b.id === order.branchId);
    return toTracked(order, language, view.vatInclusive, branch);
  }
}

const DELIVERY_STEPS = ["placed", "preparing", "ready", "out_for_delivery", "delivered"];
const PICKUP_STEPS = ["placed", "preparing", "ready", "completed"];

export function toTracked(order: Order, language: string, vatInclusive: boolean, branch?: { name: string; address?: string; phone?: string }): TrackedOrder {
  const steps = order.fulfillmentType === "delivery" ? DELIVERY_STEPS : PICKUP_STEPS;
  const at = order.status === "accepted" ? "placed" : order.status === "completed" && order.fulfillmentType === "delivery" ? "delivered" : order.status;
  const money = (n: number) => formatMoney(n, order.currency);
  return {
    number: order.number,
    status: order.status,
    statusLabel: statusLabel(order.status, language),
    step: steps.indexOf(at),
    steps,
    fulfillmentType: order.fulfillmentType,
    branch: branch ? { name: branch.name, address: branch.address, phone: branch.phone } : undefined,
    placedAt: order.createdAt,
    readyAt: order.readyAt,
    items: order.items.map((i) => ({ title: i.title, quantity: i.quantity, modifiers: i.modifiers.map((m) => m.title), lineTotal: money(i.lineTotalMinor) })),
    subtotal: money(order.subtotalMinor),
    deliveryFee: order.deliveryFeeMinor ? money(order.deliveryFeeMinor) : undefined,
    discount: order.discountMinor ? money(order.discountMinor) : undefined,
    vat: money(order.vatMinor),
    vatInclusive,
    total: money(order.totalMinor),
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
  };
}
