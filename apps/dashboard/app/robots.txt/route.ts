import { customerSlug } from "@/lib/hosts";
import { loadStore, storeOrigin } from "@/lib/store-server";

export const dynamic = "force-dynamic";

/**
 * robots.txt, per host. A restaurant's host keeps crawlers out of the staff apps, checkout and
 * order pages, and names its sitemap once the operator lists the shop in search. A shop that is
 * not listed stays crawlable on purpose: its pages say "noindex", and a crawler has to be able
 * to read that. Our own host keeps crawlers out of the signed-in app.
 */
export async function GET(request: Request): Promise<Response> {
  const slug = customerSlug(request.headers.get("host") ?? "");
  const lines = ["User-agent: *", "Allow: /"];
  if (slug) {
    lines.push("Disallow: /admin", "Disallow: /checkout", "Disallow: /o/");
    const store = await loadStore(slug).catch(() => null);
    if (store?.indexable) lines.push("", `Sitemap: ${storeOrigin(slug)}/sitemap.xml`);
  } else {
    lines.push("Disallow: /orders", "Disallow: /login", "Disallow: /inbox", "Disallow: /calendar", "Disallow: /catalog", "Disallow: /properties", "Disallow: /settings", "Disallow: /admin", "Disallow: /r", "Disallow: /pay");
  }
  return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
