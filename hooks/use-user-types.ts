"use client";

import * as React from "react";
import { humanizeUserType } from "@/lib/user-types";

export type UserTypeOption = {
  value: string;
  label: string;
  sortOrder?: number;
};

type CacheEntry = {
  options: UserTypeOption[];
  fetchedAt: number;
};

const STALE_MS = 30_000;
let globalCache: CacheEntry | null = null;
let inflight: Promise<UserTypeOption[]> | null = null;

async function fetchUserTypes(): Promise<UserTypeOption[]> {
  const res = await fetch(`/api/user-types?_t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: { value?: unknown; label?: unknown; sortOrder?: unknown }) => ({
      value: String(r.value ?? ""),
      label: String(r.label ?? "") || humanizeUserType(String(r.value ?? "")),
      sortOrder: typeof r.sortOrder === "number" ? r.sortOrder : 0,
    }))
    .filter((r: UserTypeOption) => r.value.length > 0)
    .sort((a: UserTypeOption, b: UserTypeOption) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function loadUserTypes(): Promise<UserTypeOption[]> {
  if (globalCache && Date.now() - globalCache.fetchedAt < STALE_MS) {
    return Promise.resolve(globalCache.options);
  }
  if (!inflight) {
    inflight = fetchUserTypes()
      .then((opts) => {
        if (opts.length > 0) {
          globalCache = { options: opts, fetchedAt: Date.now() };
        }
        inflight = null;
        return opts;
      })
      .catch(() => {
        inflight = null;
        return globalCache?.options ?? [];
      });
  }
  return inflight;
}

/** Force the next call to re-fetch from the server. Call after admin
 *  edits to `form_options.user_types`. */
export function invalidateUserTypeCache() {
  globalCache = null;
}

/**
 * Returns the admin-configured list of user_types (with a humanised
 * fallback when `form_options.user_types` is empty). Used by every
 * admin picker — no hand-typed allow-list anywhere in the client code.
 */
export function useUserTypes() {
  const [options, setOptions] = React.useState<UserTypeOption[]>(globalCache?.options ?? []);
  const [loading, setLoading] = React.useState(!globalCache);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadUserTypes().then((opts) => {
      if (!cancelled) {
        setOptions(opts);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const labelMap = React.useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of options) m[o.value] = o.label;
    return m;
  }, [options]);

  const getLabel = React.useCallback(
    (value: string | null | undefined): string => {
      if (!value) return "Unknown";
      return labelMap[value] || humanizeUserType(value);
    },
    [labelMap],
  );

  return { options, loading, labelMap, getLabel };
}
