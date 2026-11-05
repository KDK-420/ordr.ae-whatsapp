import { Inject, Injectable } from "@nestjs/common";
import { formatMoney, localized, type Offering, type Tenant } from "@ordr/domain";
import type { AppConfig } from "../config";
import type { CatalogRepository, PropertyRepository, TenantRepository } from "../ports";
import { type BusinessProfile, businessProfile } from "../tenant-profile";
import { TOKENS } from "../tokens";

/** What a merchant sets in Settings › Website. Stored in `tenant.settings.site`. */
export interface SiteSettings {
  /** Nothing is public, and no certificate is issued, until this is true. */
  published: boolean;
  headline?: string;
  about?: string;
  heroImageUrl?: string;
}

export interface SiteItem {
  id: string;
  name: string;
  description?: string;
  price: string;
  durationMinutes?: number;
  imageUrl?: string;
  /** Stays only: the property this room type belongs to, and how many it sleeps. */
  propertyId?: string;
  maxGuests?: number;
}

export interface SiteCategory {
  id: string;
  name: string;
  items: SiteItem[];
}

export interface SiteProperty {
  id: string;
  name: string;
  description?: string;
  address?: string;
  mapsUrl?: string;
  phone?: string;
  checkInTime: string;
  checkOutTime: string;
  amenities: string[];
  imageUrls: string[];
}

/** Everything a public page may show. Built field by field so nothing private can ride along. */
export interface PublicSite {
  slug: string;
  name: string;
  vertical: string;
  language: string;
  languages: string[];
  headline?: string;
  about?: string;
  heroImageUrl?: string;
  profile: BusinessProfile;
  facts: string[];
  /** Digits for a wa.me link; absent until the merchant has a real number. */
  whatsapp?: string;
  categories: SiteCategory[];
  properties: SiteProperty[];
}

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SITE_LANGUAGES = ["en", "ar"];

export function siteSettings(settings: Record<string, unknown>): SiteSettings {
  const raw = settings.site;
  if (!raw || typeof raw !== "object") return { published: false };
  const s = raw as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { published: s.published === true, headline: text(s.headline), about: text(s.about), heroImageUrl: text(s.heroImageUrl) };
}

/** Public pages for customers: `<tenant slug>.<base domain>`, from data the merchant already keeps here. */
@Injectable()
export class SiteService {
  constructor(
    @Inject(TOKENS.Config) private readonly config: AppConfig,
    @Inject(TOKENS.TenantRepository) private readonly tenants: TenantRepository,
    @Inject(TOKENS.CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(TOKENS.PropertyRepository) private readonly properties: PropertyRepository,
  ) {}

  /** The tenant behind a slug, only when its page is published. */
  private async publishedTenant(slug: string): Promise<Tenant | null> {
    if (!SUBDOMAIN.test(slug)) return null;
    const tenant = await this.tenants.findBySlug(slug);
    return tenant && siteSettings(tenant.settings).published ? tenant : null;
  }

  /** Caddy asks this before issuing a certificate, so a random subdomain can never burn our Let's Encrypt quota. */
  async allowsCertificate(domain: string): Promise<boolean> {
    const host = domain.trim().toLowerCase();
    const suffix = `.${this.config.SITE_BASE_DOMAIN}`;
    if (!host.endsWith(suffix)) return false;
    return (await this.publishedTenant(host.slice(0, -suffix.length))) !== null;
  }

  async publicSite(slug: string, requestedLanguage?: string): Promise<PublicSite | null> {
    const tenant = await this.publishedTenant(slug);
    if (!tenant) return null;
    const language = requestedLanguage && SITE_LANGUAGES.includes(requestedLanguage) ? requestedLanguage : tenant.defaultLanguage;
    const site = siteSettings(tenant.settings);
    const [categories, offerings, properties, context] = await Promise.all([
      this.catalog.listCategories(tenant.id),
      this.catalog.listAllOfferings(tenant.id),
      this.properties.list(tenant.id),
      this.tenants.findContextById(tenant.id),
    ]);

    const item = (o: Offering): SiteItem => ({
      id: o.id,
      name: localized(o.name, language),
      description: o.description ? localized(o.description, language) : undefined,
      price: formatMoney(o.priceMinor, o.currency),
      durationMinutes: o.durationMinutes,
      imageUrl: o.imageUrl,
      propertyId: o.propertyId,
      maxGuests: o.maxGuests,
    });
    const active = offerings.filter((o) => o.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
    const grouped: SiteCategory[] = categories
      .map((c) => ({ id: c.id, name: localized(c.name, language), items: active.filter((o) => o.categoryId === c.id).map(item) }))
      .filter((c) => c.items.length > 0);
    const known = new Set(categories.map((c) => c.id));
    const loose = active.filter((o) => !o.categoryId || !known.has(o.categoryId)).map(item);
    if (loose.length > 0) grouped.push({ id: "other", name: "", items: loose });

    const facts = Array.isArray(tenant.settings.facts) ? tenant.settings.facts.filter((f): f is string => typeof f === "string") : [];
    return {
      slug: tenant.slug,
      name: tenant.name,
      vertical: tenant.blueprintId,
      language,
      languages: SITE_LANGUAGES,
      headline: site.headline,
      about: site.about,
      heroImageUrl: site.heroImageUrl,
      profile: businessProfile(tenant.settings),
      facts,
      whatsapp: whatsappDigits(context?.channel.phoneNumberId, context?.channel.displayPhone),
      categories: grouped,
      properties: properties.map((p) => ({
        id: p.id,
        name: localized(p.name, language),
        description: p.description ? localized(p.description, language) : undefined,
        address: p.address,
        mapsUrl: p.mapsUrl,
        phone: p.phone,
        checkInTime: p.checkInTime,
        checkOutTime: p.checkOutTime,
        amenities: p.amenities,
        imageUrls: p.imageUrls,
      })),
    };
  }
}

/** A seed placeholder channel has an all-zero id and must never become a public "chat with us" link. */
function whatsappDigits(phoneNumberId: string | undefined, displayPhone: string | undefined): string | undefined {
  if (!phoneNumberId || /^0+$/.test(phoneNumberId)) return undefined;
  const digits = (displayPhone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits : undefined;
}
