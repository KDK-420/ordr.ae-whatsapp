import type { OfferingId, TenantId } from "./ids";

/** Copy stored per language, e.g. { en: "Burgers", ar: "برجر" }. */
export type LocalizedText = Record<string, string>;

export function localized(t: LocalizedText | undefined | null, language: string, fallback = "en"): string {
  if (!t) return "";
  return t[language] ?? t[fallback] ?? Object.values(t)[0] ?? "";
}

export interface Category {
  id: string;
  tenantId: TenantId;
  name: LocalizedText;
  sortOrder: number;
  isActive: boolean;
}

export interface ModifierOption {
  id: string;
  name: LocalizedText;
  priceDeltaMinor: number;
  sortOrder: number;
  isActive: boolean;
}

export interface ModifierGroup {
  id: string;
  name: LocalizedText;
  /** 0 means optional. */
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: ModifierOption[];
}

/** A purchasable variant of a product (size, weight, colour) with its own stock and optional price. */
export interface ProductVariant {
  id: string;
  name: LocalizedText;
  sku?: string;
  /** Overrides the offering price when set. */
  priceMinor?: number;
  /** Units on hand; undefined means not tracked. */
  stock?: number;
  sortOrder: number;
  isActive: boolean;
}

/** What an offering is: a product (food, goods), a service (salon treatment) or a stay (a room type, priced per night). */
export type OfferingType = "product" | "service" | "stay";

/** A product (food item), a service (salon treatment) or a room type (resort stay). Same shape, different blueprint. */
export interface Offering {
  id: OfferingId;
  tenantId: TenantId;
  categoryId?: string;
  type: OfferingType;
  name: LocalizedText;
  description?: LocalizedText;
  priceMinor: number;
  currency: string;
  durationMinutes?: number;
  imageUrl?: string;
  /** Units on hand for products without variants; undefined means not tracked. */
  stock?: number;
  /** Stays: the property (resort) this room type belongs to. */
  propertyId?: string;
  /** Stays: most guests one unit sleeps. */
  maxGuests?: number;
  /** Stays: how many identical units exist (rooms, villas, tents); undefined means one. */
  units?: number;
  sortOrder: number;
  isActive: boolean;
  modifierGroups: ModifierGroup[];
  /** Products with sizes, weights or colours; absent or empty means one plain SKU. */
  variants?: ProductVariant[];
}
