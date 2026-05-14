/**
 * Server-side locale resolution.
 *
 * Resolution order (matches the plan):
 *   1. `NEXT_LOCALE` cookie (set by the locale switcher; written
 *      eagerly on every change so the next request honours it
 *      without a round-trip to the DB)
 *   2. `users.profile_meta.locale` for the signed-in user
 *   3. `Accept-Language` header — if it mentions any `zh*` variant
 *      we treat that as `zh-HK` (we only ship one Chinese variant)
 *   4. `DEFAULT_LOCALE` (English)
 *
 * The proxy (`proxy.ts`) ALSO reads the cookie and forwards it as an
 * `x-locale` request header so API routes can call `getLocale()`
 * cheaply without re-parsing cookies.
 */

import "server-only";

import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  type Locale,
  coerceLocale,
} from "./types";

/**
 * Map a raw `Accept-Language` header value to a known locale.
 *
 * We only check whether the language starts with `zh` because the
 * single Chinese variant we ship today is `zh-HK`. Future variants
 * (e.g. `zh-CN`) would need an explicit branch added here AND a
 * matching `messages/zh-CN.ts` file.
 */
function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    if (!tag) continue;
    if (tag === "en" || tag.startsWith("en-")) return "en";
    if (tag === "zh" || tag.startsWith("zh-") || tag.startsWith("zh_")) return "zh-HK";
  }
  return null;
}

/**
 * Read the user's stored locale preference from the DB. Returns
 * `null` for unauthenticated requests, missing rows, or malformed
 * profile_meta values. Never throws — locale resolution must never
 * break a page render.
 */
async function localeFromUserPreference(): Promise<Locale | null> {
  try {
    const session = await getServerSession(authOptions);
    const userId = Number((session?.user as { id?: string | number } | undefined)?.id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    const [row] = await db
      .select({ profileMeta: users.profileMeta })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const stored = (row?.profileMeta as { locale?: unknown } | null)?.locale;
    if (typeof stored !== "string" || !stored) return null;
    return coerceLocale(stored);
  } catch {
    return null;
  }
}

/**
 * Resolve the locale for the current server request.
 *
 * Safe to call from any server component, server action, or route
 * handler. The cookie read is the fast path; the DB lookup only
 * runs when no cookie is present (i.e. the very first request after
 * sign-in, or when the user has never picked a language).
 */
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LOCALE_COOKIE)?.value;
  if (cookieValue) return coerceLocale(cookieValue);

  const headerStore = await headers();
  const headerLocale = headerStore.get(LOCALE_HEADER);
  if (headerLocale) return coerceLocale(headerLocale);

  const userLocale = await localeFromUserPreference();
  if (userLocale) return userLocale;

  const acceptLanguage = headerStore.get("accept-language");
  const detected = localeFromAcceptLanguage(acceptLanguage);
  if (detected) return detected;

  return DEFAULT_LOCALE;
}
