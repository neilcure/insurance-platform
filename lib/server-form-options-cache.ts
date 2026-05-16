/**
 * Server-side cache for `form_options` reads by `groupKey`.
 *
 * Why this exists
 * ---------------
 * Several hot API routes (the policy calendar's
 * `/api/policies/bulk-task-list-open`, the per-policy
 * `/api/policies/[id]/task-list-open`, every flow that calls
 * `loadAccountingFields()`) read the same small set of `form_options`
 * groups on every request. The data changes only when an admin edits
 * the field/status/upload-type config in the admin UI — typically a
 * few times per day at most.
 *
 * A short in-process TTL turns these N×(per-request) DB round-trips
 * into ~1 every 30 seconds. Mirrors the convention already set by the
 * client-side `lib/form-options-cache.ts`.
 *
 * Contract
 * --------
 *   - `getFormOptionsGroupServer(groupKey)` — returns the raw rows.
 *     If cached fresh, resolves synchronously from memory. Concurrent
 *     callers share a single in-flight request (request coalescing).
 *   - `invalidateServerFormOptionsGroup(groupKey?)` — drop one or
 *     ALL groups. Call this from any admin POST/PATCH/DELETE handler
 *     that mutates `form_options` so the next read refetches.
 *
 * Notes
 * -----
 *   - The cache is **per-process**. In a multi-instance deployment
 *     each instance keeps its own copy; staleness is bounded by TTL
 *     so a 30s convergence window after an admin edit is acceptable.
 *   - The cache stores the raw drizzle row objects so downstream
 *     callers can keep using the same shape they already expect from
 *     a direct `.select().from(formOptions).where(...)` call.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";

type FormOptionsRow = typeof formOptions.$inferSelect;

const STALE_MS = 30_000;

type CacheEntry = {
  rows: FormOptionsRow[];
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FormOptionsRow[]>>();

async function fetchGroup(groupKey: string): Promise<FormOptionsRow[]> {
  return db
    .select()
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.isActive, true)))
    .orderBy(asc(formOptions.sortOrder));
}

/**
 * Returns the rows for `form_options` where `group_key = groupKey AND
 * is_active = true`, ordered by `sortOrder`. Cached in-process for
 * `STALE_MS` milliseconds. Concurrent calls dedupe to a single fetch.
 */
export function getFormOptionsGroupServer(groupKey: string): Promise<FormOptionsRow[]> {
  const cached = cache.get(groupKey);
  if (cached && Date.now() - cached.fetchedAt < STALE_MS) {
    return Promise.resolve(cached.rows);
  }
  const pending = inflight.get(groupKey);
  if (pending) return pending;

  const p = fetchGroup(groupKey)
    .then((rows) => {
      cache.set(groupKey, { rows, fetchedAt: Date.now() });
      inflight.delete(groupKey);
      return rows;
    })
    .catch((err) => {
      inflight.delete(groupKey);
      // Don't poison the cache — let the next call retry. Surface the
      // last good value if we have one so a transient DB blip doesn't
      // break the route.
      const fallback = cache.get(groupKey)?.rows;
      if (fallback) return fallback;
      throw err;
    });
  inflight.set(groupKey, p);
  return p;
}

/**
 * Fetch several groups in parallel, hitting the cache wherever
 * possible. Returns a `Map<groupKey, rows>` so callers can split a
 * combined response by group without scanning each row.
 */
export async function getFormOptionsGroupsServer(
  groupKeys: readonly string[],
): Promise<Map<string, FormOptionsRow[]>> {
  const unique = Array.from(new Set(groupKeys.filter((g) => g && g.length > 0)));
  const results = await Promise.all(
    unique.map(async (g) => [g, await getFormOptionsGroupServer(g)] as const),
  );
  return new Map(results);
}

/**
 * Invalidate one (or all) cached groups. Call this from any admin
 * write path that modifies `form_options` so the next consumer fetch
 * sees the latest state.
 */
export function invalidateServerFormOptionsGroup(groupKey?: string): void {
  if (!groupKey) {
    cache.clear();
    inflight.clear();
    return;
  }
  cache.delete(groupKey);
  inflight.delete(groupKey);
}
