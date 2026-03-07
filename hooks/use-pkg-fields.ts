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

export function usePkgFields() {
  const [cache, setCache] = React.useState<Record<string, PkgFieldInfo[]>>({});

  const load = React.useCallback(
    async (pkg: string) => {
      if (cache[pkg]) return;
      try {
        const res = await fetch(
          `/api/admin/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as PkgFieldInfo[];
        const rows = (Array.isArray(data) ? data : []).map((r) => ({
          id: r.id,
          value: r.value,
          label: r.label,
          isActive: r.isActive,
          meta: (r.meta ?? null) as PkgFieldInfo["meta"],
        }));
        setCache((prev) => ({ ...prev, [pkg]: rows }));
      } catch {
        /* ignore */
      }
    },
    [cache],
  );

  return { pkgFieldsCache: cache, loadPkgFields: load };
}
