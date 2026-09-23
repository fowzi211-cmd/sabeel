import { NextResponse, type NextRequest } from "next/server";

/**
 * Coarse gate only: send visitors without a session cookie to the sign-in page.
 * Whether the session is valid, and which role it holds, is decided on the server
 * (guards.ts for pages, http.ts for the API) — never trust the mere presence of a cookie.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("sabeel_session")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/supplier/:path*", "/admin/:path*", "/account/:path*", "/certificate/:path*", "/2fa"],
};
