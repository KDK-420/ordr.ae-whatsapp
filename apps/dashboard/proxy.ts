import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "ordr_session";

/** Keeps signed-out visitors away from the app pages and signed-in ones away from the login form. */
export function proxy(request: NextRequest) {
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/orders") && !signedIn) {
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

export const config = { matcher: ["/orders/:path*", "/login"] };
