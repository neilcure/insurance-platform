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

const STATUS_LABEL_FALLBACKS: Record<string, string> = {
  commission_pending: "Commission Pending",
  statement_created: "Statement Created",
  statement_sent: "Statement Sent",
  statement_confirmed: "Statement Confirmed",
  credit_advice_prepared: "Credit Advice Prepared",
  credit_advice_sent: "Credit Advice Sent",
  credit_advice_confirmed: "Credit Advice Confirmed",
  commission_settled: "Commission Settled",
};

const STATUS_COLOR_FALLBACKS: Record<string, string> = {
  commission_pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  statement_created: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  statement_sent: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  statement_confirmed: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  credit_advice_prepared: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  credit_advice_sent: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  credit_advice_confirmed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  commission_settled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
};

function toTitleCaseStatus(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

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
    (value: string) => statusMap.get(value)?.label ?? STATUS_LABEL_FALLBACKS[value] ?? toTitleCaseStatus(value),
    [statusMap],
  );

  const getColor = React.useCallback(
    (value: string) =>
      statusMap.get(value)?.color
      ?? STATUS_COLOR_FALLBACKS[value]
      ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
    [statusMap],
  );

  const getOption = React.useCallback(
    (value: string) =>
      statusMap.get(value) ?? {
        value,
        label: STATUS_LABEL_FALLBACKS[value] ?? toTitleCaseStatus(value),
        color: STATUS_COLOR_FALLBACKS[value] ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
        sortOrder: Number.MAX_SAFE_INTEGER,
        flows: [],
        triggersInvoice: false,
      },
    [statusMap],
  );

  const sortedValues = React.useMemo(
    () => allOptions.map((o) => o.value),
    [allOptions],
  );

  return { options, allOptions, loading, getLabel, getColor, getOption, sortedValues, statusMap };
}
