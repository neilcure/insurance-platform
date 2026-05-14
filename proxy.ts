/**
 * Edge / Node proxy — defense-in-depth auth gate.
 *
 * (This is the Next.js 16 successor to the legacy `middleware.ts`
 * convention. Same NextRequest/NextResponse API; just renamed and
 * defaults to the Node.js runtime now.)
 *
 * What this does
 * --------------
 * For protected routes (see `config.matcher` below), we decode the
 * NextAuth JWT cookie. If it's missing or invalid:
 *
 *   - HTML pages (/dashboard/*, /admin/*, /policies/*) →
 *     redirect to /auth/signin?callbackUrl=...
 *   - API routes (/api/* allowlist below) → return 401 JSON
 *
 * This is purely additive on top of the per-route `requireUser()`
 * checks. Route handlers remain authoritative — the proxy just
 * short-circuits the obvious "not signed in" case before we hit the
 * database, and ensures any future route added without a manual
 * `requireUser()` call still gets a basic check.
 *
 * Public routes
 * -------------
 * The matcher uses a strict POSITIVE allowlist (only `/dashboard`,
 * `/admin`, `/policies`, and `/api`). Everything else is bypassed
 * entirely so we cannot accidentally lock out a public surface.
 *
 * Inside `/api/*` we additionally skip these prefixes — they handle
 * their own auth or are intentionally public:
 *
 *   - /api/auth/*           — NextAuth + invite / forgot / reset / change password
 *   - /api/sign/*           — public document signing flow (token-based)
 *   - /api/share/*          — public document download flow (token-based)
 *   - /api/cron/*           — uses CRON_SECRET header, not session
 *   - /api/admin/assets/*   — public branding assets (logo) used by the
 *                             unauthenticated landing page; POST/DELETE
 *                             on this surface still call requireUser
 *                             internally so admin-only mutations stay safe.
 *   - /api/admin/landing-page — public read of admin-edited landing page
 *                             content; POST still calls requireUser.
 *
 * Kill switch
 * -----------
 * Set `DISABLE_AUTH_MIDDLEWARE=1` to short-circuit this proxy
 * (returns NextResponse.next() unconditionally). Useful if a release
 * misroutes a public endpoint and you need to recover quickly without
 * a redeploy of the matcher.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { LOCALE_COOKIE, LOCALE_HEADER, coerceLocale } from "@/lib/i18n/types";

const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/sign/",
  "/api/share/",
  "/api/cron/",
  // Branding assets (light/dark logo) loaded by the public landing page.
  // POST/DELETE on this prefix still call requireUser inside the handler.
  "/api/admin/assets/",
  // Public read of admin-edited landing-page content. POST still calls
  // requireUser inside the handler.
  "/api/admin/landing-page",
  // Locale switcher — visitors on the unauthenticated landing page must
  // be able to flip language. The handler conditionally persists to the
  // DB only when a session exists; the cookie is always set.
  "/api/me/locale",
];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Forward the resolved locale to downstream handlers via the
 * `x-locale` request header so route handlers / server components
 * can call `getLocale()` without repeating the cookie parse.
 *
 * The header is the FIRST link in the chain consulted by
 * `lib/i18n/locale.ts` after the cookie itself, so this works as a
 * pure optimisation — pages still resolve the correct locale even
 * if the proxy is bypassed (kill-switch, tests, etc.).
 *
 * We mutate the inbound request headers and pass them through
 * `NextResponse.next({ request })` rather than the response, since
 * server components read REQUEST headers via `next/headers`.
 */
function withLocaleHeader(req: NextRequest): NextResponse {
  const cookieValue = req.cookies.get(LOCALE_COOKIE)?.value;
  if (!cookieValue) return NextResponse.next();
  const locale = coerceLocale(cookieValue);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(LOCALE_HEADER, locale);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(req: NextRequest) {
  if (process.env.DISABLE_AUTH_MIDDLEWARE === "1") {
    return withLocaleHeader(req);
  }

  const { pathname, search } = req.nextUrl;

  // Skip the public API surfaces — they handle their own auth (or
  // intentionally don't need any, like the public sign flow).
  if (pathname.startsWith("/api/") && isPublicApi(pathname)) {
    return withLocaleHeader(req);
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) {
    return withLocaleHeader(req);
  }

  // Not signed in.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Page navigation — bounce to the sign-in screen and remember where
  // the user was trying to go.
  const signInUrl = new URL("/auth/signin", req.url);
  signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(signInUrl);
}

// Strict POSITIVE allowlist for which URL prefixes the proxy runs on.
// Everything else (`/`, `/login`, `/auth/*`, `/sign/[token]`,
// `/invite/[token]`, `/reset-password/[token]`, `/forgot-password`,
// `/dev/*`, static files, _next internals, og images, robots.txt,
// sitemap.xml, favicon, etc.) is bypassed entirely so we cannot
// accidentally lock out a public surface.
//
// If you add a NEW protected URL prefix (e.g. /reports), add it here.
// If you add a new PUBLIC API surface, add it to PUBLIC_API_PREFIXES
// instead — do not loosen this matcher.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/policies/:path*",
    "/api/:path*",
  ],
};
