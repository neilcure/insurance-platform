"use client";

import * as React from "react";

export type PolicyStatusOption = {
  value: string;
  label: string;
  color: string;
  sortOrder: number;
  flows: string[];
  triggersInvoice: boolean;
};

type RawRow = {
  label: string;
  value: string;
  sortOrder?: number;
  meta?: {
    color?: string;
    flows?: string[];
    triggersInvoice?: boolean;
    sortOrder?: number;
  } | null;
};

type CacheEntry = {
  options: PolicyStatusOption[];
  fetchedAt: number;
};

const STALE_MS = 30_000;
let globalCache: CacheEntry | null = null;
let inflight: Promise<PolicyStatusOption[]> | null = null;

function parseRows(rows: RawRow[]): PolicyStatusOption[] {
  return rows
    .map((r) => ({
      value: r.value,
      label: r.label,
      color: r.meta?.color || "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
      sortOrder: r.sortOrder ?? r.meta?.sortOrder ?? 0,
      flows: r.meta?.flows ?? [],
      triggersInvoice: !!r.meta?.triggersInvoice,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

async function fetchStatuses(): Promise<PolicyStatusOption[]> {
  const res = await fetch(`/api/form-options?groupKey=policy_statuses&_t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const rows: RawRow[] = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return parseRows(rows);
}

function loadStatuses(): Promise<PolicyStatusOption[]> {
  if (globalCache && Date.now() - globalCache.fetchedAt < STALE_MS) {
    return Promise.resolve(globalCache.options);
  }
  if (!inflight) {
    inflight = fetchStatuses().then((opts) => {
      if (opts.length > 0) {
        globalCache = { options: opts, fetchedAt: Date.now() };
      }
      inflight = null;
      return opts;
    }).catch(() => {
      inflight = null;
      return globalCache?.options ?? [];
    });
  }
  return inflight;
}

/** Force next call to re-fetch from server */
export function invalidatePolicyStatusCache() {
  globalCache = null;
}

export function usePolicyStatuses(flowKey?: string) {
  const [allOptions, setAllOptions] = React.useState<PolicyStatusOption[]>(globalCache?.options ?? []);
  const [loading, setLoading] = React.useState(!globalCache);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadStatuses().then((opts) => {
      if (!cancelled) {
        setAllOptions(opts);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const options = React.useMemo(() => {
    if (!flowKey) return allOptions;
    return allOptions.filter((o) => {
      if (o.flows.length === 0) return true;
      return o.flows.includes(flowKey);
    });
  }, [allOptions, flowKey]);

  const statusMap = React.useMemo(() => {
    const map = new Map<string, PolicyStatusOption>();
    for (const o of allOptions) map.set(o.value, o);
    return map;
  }, [allOptions]);

  const getLabel = React.useCallback(
    (value: string) => statusMap.get(value)?.label ?? value,
    [statusMap],
  );

  const getColor = React.useCallback(
    (value: string) => statusMap.get(value)?.color ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
    [statusMap],
  );

  const getOption = React.useCallback(
    (value: string) => statusMap.get(value) ?? null,
    [statusMap],
  );

  const sortedValues = React.useMemo(
    () => allOptions.map((o) => o.value),
    [allOptions],
  );

  return { options, allOptions, loading, getLabel, getColor, getOption, sortedValues, statusMap };
}
