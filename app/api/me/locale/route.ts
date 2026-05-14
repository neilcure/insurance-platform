/**
 * POST /api/me/locale — persist the caller's UI language preference.
 *
 * Two side effects, in this order:
 *
 *   1. Always set the `NEXT_LOCALE` cookie on the response so the
 *      next request (including unauthenticated visitors on the
 *      landing page) is rendered in the chosen language.
 *
 *   2. If the caller is signed in, also write the value to
 *      `users.profile_meta.locale` so it survives across devices and
 *      browser sessions. The DB write is best-effort — a failure
 *      there must not prevent the cookie from being set, otherwise
 *      the user would see the language flip back on the next page
 *      load.
 *
 * The route is intentionally PUBLIC (added to the proxy allowlist)
 * because the landing page exposes the same language picker to
 * visitors who don't yet have an account.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { authOptions } from "@/lib/auth/options";
import {
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/lib/i18n/types";

const Body = z.object({
  locale: z.enum(SUPPORTED_LOCALES as readonly [Locale, ...Locale[]]),
});

/** One year — long enough that the cookie effectively persists, short enough that browsers won't reject it. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Build the response synchronously — the cookie is what unblocks the
 * NEXT page request, and the client switcher already has the new
 * locale rendering RIGHT NOW. Returning fast keeps the browser-side
 * `keepalive` request short and stops any UI that does happen to
 * await the response from feeling sluggish.
 */
function buildResponse(locale: Locale) {
  const response = NextResponse.json({ locale }, { status: 200 });
  response.cookies.set({
    name: LOCALE_COOKIE,
    value: locale,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
    // Do NOT mark httpOnly — the client-side switcher reads / writes
    // this cookie too (it's the lowest-friction hand-off when the
    // user hasn't signed in yet).
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

/**
 * Single-statement upsert into `users.profile_meta` using the JSONB
 * concat operator. Replaces the OLD pattern of:
 *
 *   SELECT profile_meta FROM users WHERE id = $1   -- 1 round-trip
 *   UPDATE users SET profile_meta = ... WHERE id = $1  -- 2nd round-trip
 *
 * with a single round-trip that lets Postgres do the merge:
 *
 *   UPDATE users
 *   SET profile_meta = COALESCE(profile_meta, '{}'::jsonb)
 *                      || jsonb_build_object('locale', $1),
 *       updated_at = now()
 *   WHERE id = $2
 *
 * This roughly halves the wall-clock time of the route on a warm
 * connection — the dominant cost is the network hop, not the work
 * Postgres does.
 */
async function persistLocaleToUser(userId: number, locale: Locale) {
  await db.execute(sql`
    UPDATE users
    SET profile_meta = COALESCE(profile_meta, '{}'::jsonb)
                       || jsonb_build_object('locale', ${locale}::text),
        updated_at = NOW()
    WHERE id = ${userId}
  `);
}

export async function POST(request: NextRequest) {
  let parsed;
  try {
    const json = await request.json();
    parsed = Body.safeParse(json);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Unsupported locale" },
      { status: 400 },
    );
  }

  const { locale } = parsed.data;

  // Persist to the user row when the caller is signed in. The merge
  // is done by Postgres via the JSONB `||` operator so unrelated
  // keys (`companyName`, `primaryId`, etc.) are preserved — same
  // semantics as the admin user PATCH handler, but in ONE round-trip
  // instead of two.
  try {
    const session = await getServerSession(authOptions);
    const userId = Number((session?.user as { id?: string | number } | undefined)?.id);
    if (Number.isFinite(userId) && userId > 0) {
      await persistLocaleToUser(userId, locale);
    }
  } catch (err) {
    // Don't fail the request — the cookie is still written below so
    // the locale takes effect immediately for THIS browser even if
    // the cross-device persistence step couldn't complete.
    console.error("[/api/me/locale] DB persistence failed:", err);
  }

  return buildResponse(locale);
}
