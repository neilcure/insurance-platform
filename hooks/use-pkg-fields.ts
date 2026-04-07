"use client";

import * as React from "react";

export type PkgFieldInfo = {
  id: number;
  value: string;
  label: string;
  isActive?: boolean;
  meta: {
    inputType?: string;
    options?: { label?: string; value?: string; children?: Record<string, unknown>[] }[];
    booleanLabels?: { true?: string; false?: string };
  } | null;
};

const STALE_MS = 30_000;
const globalCache: Record<string, { fields: PkgFieldInfo[]; fetchedAt: number }> = {};
const inflight: Record<string, Promise<PkgFieldInfo[]>> = {};

function fetchPkgFields(pkg: string): Promise<PkgFieldInfo[]> {
  if (globalCache[pkg] && Date.now() - globalCache[pkg].fetchedAt < STALE_MS) {
    return Promise.resolve(globalCache[pkg].fields);
  }
  if (!inflight[pkg]) {
    inflight[pkg] = fetch(
      `/api/admin/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`,
      { cache: "no-store" },
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PkgFieldInfo[]) => {
        const rows = (Array.isArray(data) ? data : []).map((r) => ({
          id: r.id,
          value: r.value,
          label: r.label,
          isActive: r.isActive,
          meta: (r.meta ?? null) as PkgFieldInfo["meta"],
        }));
        globalCache[pkg] = { fields: rows, fetchedAt: Date.now() };
        delete inflight[pkg];
        return rows;
      })
      .catch(() => {
        delete inflight[pkg];
        return globalCache[pkg]?.fields ?? [];
      });
  }
  return inflight[pkg];
}

export function usePkgFields() {
  const [cache, setCache] = React.useState<Record<string, PkgFieldInfo[]>>({});

  const load = React.useCallback(
    async (pkg: string) => {
      if (cache[pkg]) return;
      const rows = await fetchPkgFields(pkg);
      setCache((prev) => (prev[pkg] ? prev : { ...prev, [pkg]: rows }));
    },
    [cache],
  );

  return { pkgFieldsCache: cache, loadPkgFields: load };
}
