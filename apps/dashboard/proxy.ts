import { type NextRequest, NextResponse } from "next/server";
import { customerSlug, SITE_BASE_DOMAINS } from "./lib/hosts";

const SESSION_COOKIE = "ordr_session";
const APP_PREFIXES = ["/orders", "/calendar", "/inbox", "/catalog", "/settings", "/demo", "/admin", "/r"];

/** Ordering-site pages a restaurant's host serves besides its front page. */
const STORE_PREFIXES = ["/menu", "/checkout", "/o"];

/** The old marketing pages on the app host moved to the product website. */
const MOVED_PAGES: Record<string, string> = {
  "/for/resorts": "https://booking.ordr.ae/hotels/",
  "/for/salons": "https://booking.ordr.ae/salons/",
  "/for/restaurants": "https://pos.ordr.ae/restaurants/",
};

/** The product website for a request on one of our own hosts, such as app.ordr.ae. Local hosts keep the old pages. */
function websiteFor(host: string): string | null {
  const name = host.split(":")[0]!.toLowerCase();
  const base = SITE_BASE_DOMAINS[0]!;
  return name.endsWith(`.${base}`) ? `https://${base}` : null;
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
    if (STORE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      url.pathname = `/site/${slug}${pathname}`;
      return NextResponse.rewrite(url);
    }
    // Staff apps: <host>/admin, /admin/pos, /admin/kds, /admin/inventory. Served by the /r pages.
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      const rest = pathname.slice("/admin".length);
      if (!signedIn && rest !== "/login") {
        url.pathname = "/admin/login";
        return NextResponse.redirect(url);
      }
      if (signedIn && rest === "/login") {
        url.pathname = "/admin";
        return NextResponse.redirect(url);
      }
      url.pathname = `/r${rest}`;
      return NextResponse.rewrite(url);
    }
    if (pathname === "/r" || pathname.startsWith("/r/")) {
      url.pathname = `/admin${pathname.slice(2)}`;
      return NextResponse.redirect(url);
    }
    if (pathname === "/login") {
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
    // The rest of the dashboard is not part of a restaurant's host.
    if (isApp) {
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
    return NextResponse.redirect(MOVED_PAGES[pathname] ?? `${website}/`, 301);
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

export const config = { matcher: ["/", "/chat", "/for/:path*", "/orders/:path*", "/calendar/:path*", "/inbox/:path*", "/catalog/:path*", "/settings/:path*", "/demo/:path*", "/admin/:path*", "/r/:path*", "/menu/:path*", "/checkout/:path*", "/o/:path*", "/login"] };
