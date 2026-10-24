import type { LocalizedText } from "./catalog";
import type { TenantId } from "./ids";

/**
 * A resort, hotel or venue a tenant runs. One tenant (one WhatsApp number) can run several
 * properties; room types are Offerings of type "stay" that point at one property.
 */
export interface Property {
  id: string;
  tenantId: TenantId;
  name: LocalizedText;
  description?: LocalizedText;
  /** Street address as customers should read it. */
  address?: string;
  /** A Google Maps (or similar) link customers can tap. */
  mapsUrl?: string;
  /** Front desk number, international format. */
  phone?: string;
  /** Local wall clock, HH:MM, in the tenant timezone. */
  checkInTime: string;
  checkOutTime: string;
  /** Short amenity names, e.g. "Private beach", "Pool", "Spa". */
  amenities: string[];
  /** Photos sent to customers: public https URLs. */
  imageUrls: string[];
  sortOrder: number;
  isActive: boolean;
}
