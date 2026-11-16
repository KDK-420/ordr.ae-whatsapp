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
