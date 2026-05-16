/**
 * Module-level cache for `/api/form-options?groupKey=...` results.
 *
 * Why this exists
 * ---------------
 * Several dashboard surfaces (PolicyExpiryCalendar, PoliciesTableClient,
 * status pickers, package field pickers, …) all fetch the same
 * `form_options` groups on mount, with `cache: "no-store"` and a
 * `_t=Date.now()` cache-buster — meaning every page navigation
 * re-pays the round trip even though the data changes rarely.
 *
 * The PolicyExpiryCalendar in particular fired:
 *   - GET /api/form-options?groupKey=packages
 *   - GET /api/form-options?groupKey={pkg}_fields  (one per package)
 *   - GET /api/form-options?groupKey=policy_statuses (via usePolicyStatuses)
 *
 * The bulk of dashboard "spinner" time on a slow tenant was these
 * cascaded form-options round-trips. This module turns them into a
 * 30s shared in-memory cache (matches the convention already set by
 * `hooks/use-policy-statuses.ts`).
 *
 * Contract
 * --------
 *   - `getFormOptionsGroup(groupKey)` — returns a Promise of rows.
 *     If the cache has a fresh entry, resolves synchronously. If
 *     a request is already in-flight for the same group, returns
 *     the same promise (dedupes concurrent callers).
 *   - `invalidateFormOptionsGroup(groupKey)` — drop a group from
 *     the cache so the next call refetches. Use after an admin
 *     edits `form_options` for that group.
 *   - `invalidateAllFormOptions()` — nuke the whole cache.
 *
 * The cache is intentionally simple — no LRU, no per-locale keying.
 * The form_options data is small and stable; a 30s TTL plus manual
 * invalidation hooks are sufficient.
 */

export type FormOptionRow = {
  id?: number;
  label?: string;
  value?: string;
  valueType?: string;
  meta?: Record<string, unknown> | null;
  sortOrder?: number;
};

type CacheEntry = {
  rows: FormOptionRow[];
  fetchedAt: number;
};

const STALE_MS = 30_000;
// A FAILED fetch (network blip, transient 401, slow timeout) is held only
// briefly so the next consumer retries instead of being stuck behind a
// poisoned cache for the full 30s TTL. This was the source of the
// recurring "FormulaField shows raw code instead of option label" bug.
const FAIL_MS = 1_500;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FormOptionRow[]>>();

class FormOptionsFetchError extends Error {}

/**
 * Fetch a single group from the API. Throws (rather than swallowing into
 * `[]`) so the caller can decide whether to cache the empty result or
 * retry. Empty arrays from the API (group simply has no rows) ARE a
 * legitimate success and are returned normally.
 */
async function doFetch(groupKey: string): Promise<FormOptionRow[]> {
  let res: Response;
  try {
    res = await fetch(
      `/api/form-options?groupKey=${encodeURIComponent(groupKey)}`,
      { cache: "no-store" },
    );
  } catch (err) {
    throw new FormOptionsFetchError(
      err instanceof Error ? err.message : "network error",
    );
  }
  if (!res.ok) {
    throw new FormOptionsFetchError(`HTTP ${res.status}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new FormOptionsFetchError(
      err instanceof Error ? err.message : "invalid json",
    );
  }
  return Array.isArray(body) ? (body as FormOptionRow[]) : [];
}

export function getFormOptionsGroup(groupKey: string): Promise<FormOptionRow[]> {
  const now = Date.now();
  const cached = cache.get(groupKey);
  if (cached) {
    // Empty/failed caches have a much shorter TTL so transient failures
    // don't pin every consumer for 30s.
    const ttl = cached.rows.length === 0 ? FAIL_MS : STALE_MS;
    if (now - cached.fetchedAt < ttl) {
      return Promise.resolve(cached.rows);
    }
  }
  const pending = inflight.get(groupKey);
  if (pending) return pending;

  const p = doFetch(groupKey)
    .then((rows) => {
      cache.set(groupKey, { rows, fetchedAt: Date.now() });
      inflight.delete(groupKey);
      return rows;
    })
    .catch(() => {
      inflight.delete(groupKey);
      // Surface the LAST GOOD value (non-empty) if we have one, so a
      // transient hiccup doesn't break formula label translation that
      // was working a moment ago. If we never had a good value, return
      // an empty array but DON'T cache it — the next caller retries.
      const fallback = cache.get(groupKey);
      return fallback?.rows ?? [];
    });
  inflight.set(groupKey, p);
  return p;
}

/**
 * Fetch multiple groups in parallel, hitting the cache where
 * possible. Returns a map keyed by groupKey.
 */
export async function getFormOptionsGroups(
  groupKeys: string[],
): Promise<Map<string, FormOptionRow[]>> {
  const unique = Array.from(new Set(groupKeys.filter((g) => g && g.length > 0)));
  const results = await Promise.all(
    unique.map(async (g) => [g, await getFormOptionsGroup(g)] as const),
  );
  return new Map(results);
}

export function invalidateFormOptionsGroup(groupKey: string): void {
  cache.delete(groupKey);
  inflight.delete(groupKey);
}

export function invalidateAllFormOptions(): void {
  cache.clear();
  inflight.clear();
}
