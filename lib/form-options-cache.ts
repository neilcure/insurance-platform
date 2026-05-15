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
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FormOptionRow[]>>();

async function doFetch(groupKey: string): Promise<FormOptionRow[]> {
  try {
    const res = await fetch(
      `/api/form-options?groupKey=${encodeURIComponent(groupKey)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as FormOptionRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function getFormOptionsGroup(groupKey: string): Promise<FormOptionRow[]> {
  const cached = cache.get(groupKey);
  if (cached && Date.now() - cached.fetchedAt < STALE_MS) {
    return Promise.resolve(cached.rows);
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
      return cache.get(groupKey)?.rows ?? [];
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
