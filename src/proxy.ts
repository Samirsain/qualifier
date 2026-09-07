import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 renamed `middleware` to `proxy` (nodejs runtime, not configurable).
 *
 * This is a cheap first gate only. Server-side authorization is authoritative
 * (Security §1), so every page and action re-checks the session and permission.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    // Driven by a scheduler, not a browser: it authenticates with
    // AUTOMATION_TICK_SECRET and has no session cookie to present. Behind the
    // cookie gate it was redirected to /login, so no timer ever fired.
    pathname.startsWith("/api/automation/tick");

  if (isPublic) return NextResponse.next();

  // Auth.js sets a session cookie; absence means definitely signed out.
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!hasSession) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
