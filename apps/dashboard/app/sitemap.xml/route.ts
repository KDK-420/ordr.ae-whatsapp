import { customerSlug } from "@/lib/hosts";
import { loadStore, storeOrigin } from "@/lib/store-server";

export const dynamic = "force-dynamic";

/** The sitemap of one restaurant's site: its front page and its menu. Only for shops listed in search; anything else has none. */
export async function GET(request: Request): Promise<Response> {
  const slug = customerSlug(request.headers.get("host") ?? "");
  const store = slug ? await loadStore(slug).catch(() => null) : null;
  if (!slug || !store?.indexable) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const origin = storeOrigin(slug);
  const today = new Date().toISOString().slice(0, 10);
  const urls = ["/", "/menu"].map((path) => `  <url>\n    <loc>${origin}${path}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
