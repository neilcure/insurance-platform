"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { usePkgFields } from "@/hooks/use-pkg-fields";

export type AutoFillMapping = {
  sourcePackage: string;
  sourceField: string;
  targetPackage?: string;
  targetField: string;
};

export type AutoFillConfig = {
  when: "true" | "false";
  mappings: AutoFillMapping[];
};

export function AutoFillConfigEditor({
  value,
  onChange,
  allPackages,
  currentPkg,
  currentFieldValue,
}: {
  value: AutoFillConfig | undefined;
  onChange: (next: AutoFillConfig | undefined) => void;
  allPackages: { label: string; value: string }[];
  currentPkg: string;
  currentFieldValue: string;
}) {
  const { pkgFieldsCache, loadPkgFields } = usePkgFields();

  React.useEffect(() => {
    if (!value?.mappings) return;
    for (const m of value.mappings) {
      if (m.sourcePackage && !pkgFieldsCache[m.sourcePackage]) {
        void loadPkgFields(m.sourcePackage);
      }
      const tp = m.targetPackage || currentPkg;
      if (tp && !pkgFieldsCache[tp]) {
        void loadPkgFields(tp);
      }
    }
    if (!pkgFieldsCache[currentPkg]) void loadPkgFields(currentPkg);
  }, [value, pkgFieldsCache, loadPkgFields, currentPkg]);

  const selectCls =
    "h-7 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

  if (!value) {
    return (
      <div className="grid gap-1">
        <Label className="text-xs">Auto-fill from another package</Label>
        <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
          When this boolean is toggled, auto-fill fields in this package from
          another package&apos;s values.
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-fit text-xs"
          onClick={() =>
            onChange({ when: "true", mappings: [{ sourcePackage: "", sourceField: "", targetPackage: undefined, targetField: "" }] })
          }
        >
          + Enable auto-fill
        </Button>
      </div>
    );
  }

  const mappings = value.mappings ?? [];

  return (
    <div className="grid gap-2">
      <Label className="text-xs">Auto-fill from another package</Label>
      <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
        When this boolean matches the trigger value, copy field values from
        another package into this package.
      </p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">
          Trigger when value is
        </span>
        <select
          className="h-7 w-24 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          value={value.when}
          onChange={(e) =>
            onChange({ ...value, when: e.target.value as "true" | "false" })
          }
        >
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </div>

      {mappings.map((m, idx) => {
        const sourceFields = (pkgFieldsCache[m.sourcePackage] ?? []).filter(
          (f) => f.isActive !== false,
        );
        const targetPkg = m.targetPackage || currentPkg;
        const targetFields = (pkgFieldsCache[targetPkg] ?? []).filter(
          (f) => f.isActive !== false && f.value !== currentFieldValue,
        );
        return (
          <div
            key={idx}
            className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
          >
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Source pkg
                </span>
                <select
                  className={selectCls}
                  value={m.sourcePackage}
                  onChange={(e) => {
                    const next = [...mappings];
                    next[idx] = {
                      ...next[idx],
                      sourcePackage: e.target.value,
                      sourceField: "",
                    };
                    onChange({ ...value, mappings: next });
                    if (e.target.value) void loadPkgFields(e.target.value);
                  }}
                >
                  <option value="">-- Select --</option>
                  {allPackages.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {m.sourcePackage && sourceFields.length > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                    Source field
                  </span>
                  <select
                    className={selectCls}
                    value={m.sourceField}
                    onChange={(e) => {
                      const next = [...mappings];
                      next[idx] = { ...next[idx], sourceField: e.target.value };
                      onChange({ ...value, mappings: next });
                    }}
                  >
                    <option value="">-- Select --</option>
                    {sourceFields.map((f) => (
                      <option key={f.id} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Target pkg
                </span>
                <select
                  className={selectCls}
                  value={m.targetPackage || currentPkg}
                  onChange={(e) => {
                    const next = [...mappings];
                    const tp = e.target.value === currentPkg ? undefined : e.target.value;
                    next[idx] = { ...next[idx], targetPackage: tp, targetField: "" };
                    onChange({ ...value, mappings: next });
                    if (e.target.value) void loadPkgFields(e.target.value);
                  }}
                >
                  {allPackages.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}{p.value === currentPkg ? " (this)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Target field
                </span>
                <select
                  className={selectCls}
                  value={m.targetField}
                  onChange={(e) => {
                    const next = [...mappings];
                    next[idx] = { ...next[idx], targetField: e.target.value };
                    onChange({ ...value, mappings: next });
                  }}
                >
                  <option value="">-- Select --</option>
                  {targetFields.map((f) => (
                    <option key={f.id} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 w-6 p-0"
              onClick={() => {
                const next = mappings.filter((_, i) => i !== idx);
                if (next.length === 0) {
                  onChange(undefined);
                } else {
                  onChange({ ...value, mappings: next });
                }
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      })}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="text-xs"
          onClick={() =>
            onChange({
              ...value,
              mappings: [
                ...mappings,
                { sourcePackage: "", sourceField: "", targetPackage: undefined, targetField: "" },
              ],
            })
          }
        >
          + Add mapping
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-xs text-red-600 dark:text-red-400"
          onClick={() => onChange(undefined)}
        >
          Remove auto-fill
        </Button>
      </div>
    </div>
  );
}
