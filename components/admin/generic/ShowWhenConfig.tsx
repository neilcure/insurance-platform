"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

type ShowWhenRule = { package: string; category: string | string[] };

export function ShowWhenConfig({
  value,
  onChange,
  allPackages,
  crossPkgCategories,
  onLoadCategories,
  compact,
}: {
  value: ShowWhenRule[];
  onChange: (next: ShowWhenRule[]) => void;
  allPackages: { label: string; value: string }[];
  crossPkgCategories: Record<string, { label: string; value: string }[]>;
  onLoadCategories: (pkg: string) => void;
  compact?: boolean;
}) {
  const labelSize = compact ? "text-[11px]" : "text-xs";

  React.useEffect(() => {
    for (const rule of value) {
      if (rule.package && !crossPkgCategories[rule.package]) {
        onLoadCategories(rule.package);
      }
    }
  }, [value, crossPkgCategories, onLoadCategories]);

  return (
    <div className="grid gap-1">
      <Label className={labelSize}>
        {compact ? "Show when (cross-package)" : "Cross-Package Conditions (showWhen)"}
      </Label>
      <p className={`${compact ? "text-[10px]" : "text-xs"} text-neutral-500`}>
        Only show when another package&apos;s category matches.
      </p>
      {value.map((rule, rIdx) => {
        const cats = crossPkgCategories[rule.package] ?? [];
        return (
          <div key={rIdx} className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Label className={`w-16 shrink-0 ${labelSize}`}>Package</Label>
                <select
                  className="h-7 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  value={rule.package}
                  onChange={(e) => {
                    const next = [...value];
                    next[rIdx] = { ...next[rIdx], package: e.target.value, category: [] };
                    onChange(next);
                    if (e.target.value) onLoadCategories(e.target.value);
                  }}
                >
                  <option value="">-- Select --</option>
                  {allPackages.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              {rule.package && cats.length > 0 ? (
                <div className="flex items-start gap-2">
                  <Label className={`w-16 shrink-0 pt-0.5 ${labelSize}`}>Category</Label>
                  <div className="flex flex-wrap gap-2">
                    {cats.map((c) => {
                      const allowed = Array.isArray(rule.category) ? rule.category : (rule.category ? [rule.category] : []);
                      const checked = allowed.includes(c.value);
                      return (
                        <label key={c.value} className="inline-flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = [...value];
                              const cur = Array.isArray(next[rIdx].category)
                                ? [...(next[rIdx].category as string[])]
                                : (next[rIdx].category ? [next[rIdx].category as string] : []);
                              const updated = checked ? cur.filter((v) => v !== c.value) : [...cur, c.value];
                              next[rIdx] = { ...next[rIdx], category: updated };
                              onChange(next);
                            }}
                          />
                          {c.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : rule.package && cats.length === 0 ? (
                <p className="text-[10px] text-neutral-500 ml-18">No categories for this package.</p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 w-6 p-0"
              onClick={() => onChange(value.filter((_, i) => i !== rIdx))}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="w-fit text-xs"
        onClick={() => onChange([...value, { package: "", category: [] }])}
      >
        + Add condition
      </Button>
    </div>
  );
}
