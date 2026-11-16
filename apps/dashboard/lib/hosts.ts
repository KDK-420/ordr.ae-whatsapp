/**
 * Which restaurant a host belongs to. A restaurant lives on one host, `<slug>.<base domain>`:
 * its ordering site at the root and its staff apps under /admin. `localhost` makes that
 * testable as daybreak.localhost:3001.
 */
export const SITE_BASE_DOMAINS = [process.env.SITE_BASE_DOMAIN ?? "ordr.ae", "localhost"];

/** Subdomains that are ours, never a customer's. */
export const RESERVED = new Set(["app", "www", "api", "admin", "mail", "staging", "demo", "pos", "booking"]);

export function customerSlug(host: string): string | null {
  const name = host.split(":")[0]!.toLowerCase();
  for (const base of SITE_BASE_DOMAINS) {
    if (!name.endsWith(`.${base}`)) continue;
    const sub = name.slice(0, -base.length - 1);
    if (sub && !sub.includes(".") && !RESERVED.has(sub)) return sub;
  }
  return null;
}

/** Where the staff apps are mounted for this host: /admin on a restaurant's own host, /r on ours. */
export function staffBase(host: string): string {
  return customerSlug(host) ? "/admin" : "/r";
}

/** Where the ordering site is mounted: the root of the restaurant's host, /site/<slug> on ours. */
export function storeBase(host: string, slug: string): string {
  return customerSlug(host) === slug ? "" : `/site/${slug}`;
}
