import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "ordr_session";
const APP_PREFIXES = ["/orders", "/calendar", "/inbox", "/catalog", "/settings", "/demo", "/admin"];

/** Customer pages live on <tenant slug>.<base domain>; `localhost` makes them testable as demo-salon.localhost:3001. */
const SITE_BASE_DOMAINS = [process.env.SITE_BASE_DOMAIN ?? "ordr.ae", "localhost"];
/** Subdomains that are ours, never a customer's. */
const RESERVED = new Set(["app", "www", "api", "admin", "mail", "staging", "demo"]);

/** The old marketing pages on the app host moved to the product website. */
const MOVED_PAGES: Record<string, string> = {
  "/for/resorts": "/hotel-whatsapp-booking/",
  "/for/salons": "/salon-booking-software/",
  "/for/restaurants": "/restaurant-whatsapp-ordering/",
};

/** The product website for a request on one of our own hosts, such as app.ordr.ae. Local hosts keep the old pages. */
function websiteFor(host: string): string | null {
  const name = host.split(":")[0]!.toLowerCase();
  const base = SITE_BASE_DOMAINS[0]!;
  return name.endsWith(`.${base}`) ? `https://${base}` : null;
}

function customerSlug(host: string): string | null {
  const name = host.split(":")[0]!.toLowerCase();
  for (const base of SITE_BASE_DOMAINS) {
    if (!name.endsWith(`.${base}`)) continue;
    const sub = name.slice(0, -base.length - 1);
    if (sub && !sub.includes(".") && !RESERVED.has(sub)) return sub;
  }
  return null;
}

/** Serves customer pages on their subdomains, keeps signed-out visitors away from the app pages and signed-in ones away from the login form. */
export function proxy(request: NextRequest) {
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;
  const isApp = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const slug = customerSlug(request.headers.get("host") ?? "");
  if (slug) {
    const url = request.nextUrl.clone();
    if (pathname === "/") {
      url.pathname = `/site/${slug}`;
      return NextResponse.rewrite(url);
    }
    if (pathname === "/chat") {
      url.pathname = `/chat/${slug}`;
      return NextResponse.rewrite(url);
    }
    // The dashboard is not part of a customer's website.
    if (isApp || pathname === "/login") {
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  const website = websiteFor(request.headers.get("host") ?? "");
  if (website && pathname === "/" && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/orders";
    return NextResponse.redirect(url);
  }
  if (website && (pathname === "/" || pathname === "/for" || pathname.startsWith("/for/"))) {
    return NextResponse.redirect(`${website}${MOVED_PAGES[pathname] ?? "/"}`, 301);
  }

  if (isApp && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (pathname === "/login" && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/orders";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/chat", "/for/:path*", "/orders/:path*", "/calendar/:path*", "/inbox/:path*", "/catalog/:path*", "/settings/:path*", "/demo/:path*", "/admin/:path*", "/login"] };
