"use client";

/**
 * `usePagination<T>` — single source of truth for any paginated list
 * surface in this app.
 *
 * Every consumer (Policies, Agents, Accounting Invoices, Audit Log, ...)
 * hits a paginated GET endpoint that returns `{ rows, total, limit, offset }`
 * (see `lib/pagination/types.ts`).
 *
 * The hook handles:
 *   - GET on mount with optional initial-rows / initial-total seeded by SSR
 *   - Re-fetch when page, page size, or `params` change
 *   - Per-scope page-size persistence in localStorage
 *   - Bounds-clamping when `total` shrinks below the current page
 *   - Stale-response rejection when the user clicks Next twice quickly
 *
 * The hook is intentionally NOT opinionated about what `T` is.
 * See `.cursor/skills/pagination/SKILL.md` for the full contract.
 */

import * as React from "react";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  isPaginatedResponse,
  type Paginated,
} from "@/lib/pagination/types";

export type UsePaginationOptions<T> = {
  /** API endpoint URL. The hook appends `limit` and `offset` itself; do NOT
   *  include them in the URL. Other query string params (filters, search)
   *  are preserved as-is from the URL or via the `params` prop. */
  url: string;
  /** Distinct namespace per list. Used as the localStorage key for the
   *  user's preferred page size (`pagination:size:<scope>`). */
  scope: string;
  /** Server-side filter / search parameters. Changing this object resets
   *  the page to 0 and refetches. Pass `undefined` for no extra params. */
  params?: Record<string, string | number | boolean | null | undefined>;
  /** Optional SSR-seeded first page. When provided, the hook does NOT
   *  fetch on mount — it only fetches when the user changes page / size
   *  / params. Useful for server-rendered pages that already paid for the
   *  first query. */
  initialRows?: T[];
  /** Total count for the SSR-seeded page. Required when `initialRows` is
   *  provided so the page bar can render correctly on first paint. */
  initialTotal?: number;
  /** Initial page index (0-based). Defaults to 0. */
  initialPage?: number;
  /** Initial page size. If omitted, the hook reads
   *  `pagination:size:<scope>` from localStorage, then falls back to
   *  `DEFAULT_PAGE_SIZE`. */
  initialPageSize?: number;
  /** Optional response transformer for endpoints that wrap rows in a
   *  non-standard shape (e.g. `{ rows, total }` nested under `data`).
   *  Most callers should NOT need this. */
  parseResponse?: (raw: unknown) => Paginated<T> | null;
};

export type UsePaginationReturn<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  /** True while a fetch is in flight (initial load OR page change). */
  loading: boolean;
  /** Last fetch error, if any. Cleared on the next successful fetch. */
  error: string | null;
  /** Total page count derived from `total` and `pageSize`. Always >= 1. */
  pageCount: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Re-run the current request (preserves page / size / params). */
  refresh: () => void;
  /** Replace the row at `index` in-place. Useful for optimistic updates
   *  after an inline edit / row mutation, without a full refetch. */
  patchRow: (index: number, next: T) => void;
  /** Remove a row by predicate and decrement `total`. Useful for
   *  optimistic deletes. */
  removeRow: (predicate: (row: T) => boolean) => void;
};

const PAGE_SIZE_LS_PREFIX = "pagination:size:";

function readStoredPageSize(scope: string): number | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(`${PAGE_SIZE_LS_PREFIX}${scope}`);
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(Math.max(Math.floor(n), 1), MAX_PAGE_SIZE);
  } catch {
    return null;
  }
}

function writeStoredPageSize(scope: string, size: number) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`${PAGE_SIZE_LS_PREFIX}${scope}`, String(size));
  } catch {
    /* swallow quota errors */
  }
}

/**
 * Stable string key for a `params` object so React effects can depend on
 * its content rather than reference equality. Skips undefined / null
 * values (so a missing filter doesn't appear in the query string).
 */
function paramsKey(
  params: Record<string, string | number | boolean | null | undefined> | undefined,
): string {
  if (!params) return "";
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join("&");
}

function buildUrl(
  url: string,
  params: Record<string, string | number | boolean | null | undefined> | undefined,
  limit: number,
  offset: number,
): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      qs.append(k, String(v));
    }
  }
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${qs.toString()}`;
}

export function usePagination<T>(
  options: UsePaginationOptions<T>,
): UsePaginationReturn<T> {
  const {
    url,
    scope,
    params,
    initialRows,
    initialTotal,
    initialPage = 0,
    initialPageSize,
    parseResponse,
  } = options;

  const [pageSize, setPageSizeState] = React.useState<number>(() => {
    if (initialPageSize && initialPageSize > 0) return initialPageSize;
    return readStoredPageSize(scope) ?? DEFAULT_PAGE_SIZE;
  });
  const [page, setPageState] = React.useState<number>(initialPage);
  const [rows, setRows] = React.useState<T[]>(initialRows ?? []);
  const [total, setTotal] = React.useState<number>(initialTotal ?? 0);
  const [loading, setLoading] = React.useState<boolean>(
    initialRows === undefined,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Stable string fingerprint of params so React doesn't refetch on every
  // render due to a fresh `{}` reference.
  const paramsFingerprint = React.useMemo(() => paramsKey(params), [params]);

  // After hydration, apply `pagination:size:<scope>` even when the caller
  // passed `initialPageSize` from SSR — otherwise the server default wins and
  // the user's saved rows/page preference appears to reset every visit.
  React.useEffect(() => {
    const stored = readStoredPageSize(scope);
    if (stored === null) return;
    setPageSizeState((prevSize) => {
      if (prevSize === stored) return prevSize;
      writeStoredPageSize(scope, stored);
      setPageState((p) => {
        const firstRowIndex = p * prevSize;
        return Math.floor(firstRowIndex / stored);
      });
      return stored;
    });
  }, [scope]);

  // Reset to page 0 when the filter / search params change (skip on first
  // mount so SSR-seeded pages don't immediately re-fetch).
  const isFirstMountRef = React.useRef(true);
  const lastParamsRef = React.useRef(paramsFingerprint);
  React.useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      lastParamsRef.current = paramsFingerprint;
      return;
    }
    if (lastParamsRef.current !== paramsFingerprint) {
      lastParamsRef.current = paramsFingerprint;
      // Invalidate the SSR snapshot so it never skips a fetch again once the
      // user has changed params away from the initial state. Without this,
      // switching back to the original params (e.g. month-tab All → Jun → All)
      // would match the SSR snapshot and skip the fetch, leaving stale rows
      // from the Jun fetch on screen.
      ssrSnapshotRef.current = { ...ssrSnapshotRef.current, rows: undefined };
      setPageState(0);
    }
  }, [paramsFingerprint]);

  // Track the SSR-seeded snapshot so we know whether to skip the first
  // fetch. After any user-driven change (page/size/params/refresh), the
  // hook must hit the network.
  const ssrSnapshotRef = React.useRef<{
    rows: T[] | undefined;
    page: number;
    size: number;
    paramsKey: string;
  }>({
    rows: initialRows,
    page: initialPage,
    size: initialPageSize ?? DEFAULT_PAGE_SIZE,
    paramsKey: paramsFingerprint,
  });

  React.useEffect(() => {
    const offset = page * pageSize;
    const snap = ssrSnapshotRef.current;
    const isMatchingSsrSnapshot =
      snap.rows !== undefined &&
      snap.page === page &&
      snap.size === pageSize &&
      snap.paramsKey === paramsFingerprint &&
      refreshKey === 0;
    if (isMatchingSsrSnapshot) {
      // First paint matches the SSR-seeded data — no network needed.
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const requestedOffset = offset;
    setLoading(true);
    setError(null);
    fetch(buildUrl(url, params, pageSize, offset), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((raw: unknown) => {
        if (cancelled) return;
        const parsed = parseResponse
          ? parseResponse(raw)
          : isPaginatedResponse<T>(raw)
            ? raw
            : null;
        if (!parsed) {
          throw new Error("Unexpected response shape");
        }
        // Stale-response guard: if the user changed page mid-flight,
        // ignore late arrivals.
        if (parsed.offset !== requestedOffset) return;
        setRows(parsed.rows);
        setTotal(parsed.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, params, paramsFingerprint, page, pageSize, refreshKey, parseResponse]);

  // Whenever `total` or `pageSize` shrink past the current page, clamp the
  // page back into range. Avoids "Page 7 of 3" after applying a filter.
  React.useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (page > maxPage) {
      setPageState(maxPage);
    }
  }, [total, pageSize, page]);

  const setPage = React.useCallback((next: number) => {
    setPageState((prev) => {
      const clamped = Math.max(0, Math.floor(next));
      return clamped === prev ? prev : clamped;
    });
  }, []);

  const setPageSize = React.useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(Math.floor(next), 1), MAX_PAGE_SIZE);
      writeStoredPageSize(scope, clamped);
      setPageSizeState((prev) => {
        if (prev === clamped) return prev;
        // Try to keep the user's view roughly in place: pin the first row
        // of the current page after the size change.
        const firstRowIndex = page * prev;
        const newPage = Math.floor(firstRowIndex / clamped);
        setPageState(newPage);
        return clamped;
      });
    },
    [scope, page],
  );

  const refresh = React.useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const patchRow = React.useCallback((index: number, next: T) => {
    setRows((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const copy = prev.slice();
      copy[index] = next;
      return copy;
    });
  }, []);

  const removeRow = React.useCallback(
    (predicate: (row: T) => boolean) => {
      setRows((prev) => {
        const next = prev.filter((r) => !predicate(r));
        if (next.length === prev.length) return prev;
        setTotal((t) => Math.max(0, t - (prev.length - next.length)));
        return next;
      });
    },
    [],
  );

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return {
    rows,
    total,
    page,
    pageSize,
    loading,
    error,
    pageCount,
    setPage,
    setPageSize,
    refresh,
    patchRow,
    removeRow,
  };
}
