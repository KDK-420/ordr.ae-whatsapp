import type { Metadata } from "next";
import { SITE_BASE_DOMAINS } from "./hosts";
import type { PublicStore, TrackedOrder } from "./suite";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:3000";

/** The restaurant's ordering site as the API publishes it; null when the slug has no Storefront. */
export async function loadStore(slug: string, lang?: string): Promise<PublicStore | null> {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  const res = await fetch(`${API_INTERNAL_URL}/v1/store/${encodeURIComponent(slug)}${query}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`store ${slug}: API answered ${res.status}`);
  return (await res.json()) as PublicStore;
}

export async function loadTrackedOrder(slug: string, token: string): Promise<TrackedOrder | null> {
  const res = await fetch(`${API_INTERNAL_URL}/v1/store/${encodeURIComponent(slug)}/orders/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`order ${token}: API answered ${res.status}`);
  return (await res.json()) as TrackedOrder;
}

/** The one public address of a restaurant's site, whatever host the request came in on. */
export function storeOrigin(slug: string): string {
  return `https://${slug}.${SITE_BASE_DOMAINS[0]}`;
}

/**
 * What search engines are told about a store page: its canonical address on the restaurant's
 * own host (the same page also answers under /site/<slug> on ours), and "do not list" for a
 * shop the operator has not opened to search yet.
 */
export function storeSeo(store: PublicStore, path: string): Pick<Metadata, "alternates" | "robots"> {
  return { alternates: { canonical: `${storeOrigin(store.slug)}${path}` }, robots: store.indexable ? { index: true, follow: true } : { index: false, follow: false } };
}

const absolute = (store: PublicStore, url: string | undefined) => (!url ? undefined : /^https?:\/\//.test(url) ? url : `${storeOrigin(store.slug)}${url.startsWith("/") ? "" : "/"}${url}`);

/** schema.org data for the store's front page: who the restaurant is and where to order. */
export function restaurantJsonLd(store: PublicStore): Record<string, unknown> {
  const origin = storeOrigin(store.slug);
  const address = store.branches[0]?.address ?? store.profile.address;
  return {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: store.name,
    url: `${origin}/`,
    description: store.about ?? store.theme.tagline ?? store.headline,
    image: absolute(store, store.heroImageUrl ?? store.theme.coverImageUrl ?? store.featured.find((i) => i.imageUrl)?.imageUrl),
    logo: absolute(store, store.theme.logoUrl),
    telephone: store.branches[0]?.phone ?? store.profile.phone,
    address: address ? { "@type": "PostalAddress", streetAddress: address, addressCountry: "AE" } : undefined,
    hasMap: store.profile.mapsUrl,
    hasMenu: `${origin}/menu`,
    potentialAction: { "@type": "OrderAction", target: `${origin}/menu`, deliveryMethod: store.fulfillmentTypes.map((t) => (t === "delivery" ? "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet" : "http://purl.org/goodrelations/v1#DeliveryModePickUp")) },
  };
}

/** schema.org data for the menu page: sections, items and prices as the store shows them. */
export function menuJsonLd(store: PublicStore): Record<string, unknown> {
  const origin = storeOrigin(store.slug);
  return {
    "@context": "https://schema.org",
    "@type": "Menu",
    name: `${store.name} menu`,
    url: `${origin}/menu`,
    inLanguage: store.language,
    hasMenuSection: store.categories.map((c) => ({
      "@type": "MenuSection",
      name: c.name,
      hasMenuItem: c.items.map((i) => ({
        "@type": "MenuItem",
        name: i.name,
        description: i.description,
        image: absolute(store, i.imageUrl),
        offers: { "@type": "Offer", price: (i.priceMinor / 100).toFixed(2), priceCurrency: store.currency },
      })),
    })),
  };
}
