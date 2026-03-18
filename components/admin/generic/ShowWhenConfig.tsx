"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import type { ShowWhenRule } from "@/lib/types/form";
import { usePkgFields, type PkgFieldInfo } from "@/hooks/use-pkg-fields";

type FieldInfo = PkgFieldInfo;

export function ShowWhenConfig({
  value,
  onChange,
  allPackages,
  crossPkgCategories,
  onLoadCategories,
  compact,
  logic = "and",
  onLogicChange,
}: {
  value: ShowWhenRule[];
  onChange: (next: ShowWhenRule[]) => void;
  allPackages: { label: string; value: string }[];
  crossPkgCategories: Record<string, { label: string; value: string }[]>;
  onLoadCategories: (pkg: string) => void;
  compact?: boolean;
  logic?: "and" | "or";
  onLogicChange?: (logic: "and" | "or") => void;
}) {
  const labelSize = compact ? "text-[11px]" : "text-xs";
  const selectCls = "h-7 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

  const { pkgFieldsCache, loadPkgFields } = usePkgFields();

  React.useEffect(() => {
    for (const rule of value) {
      if (rule.package && !crossPkgCategories[rule.package]) {
        onLoadCategories(rule.package);
      }
      if (rule.package && rule.field && !pkgFieldsCache[rule.package]) {
        void loadPkgFields(rule.package);
      }
    }
  }, [value, crossPkgCategories, onLoadCategories, pkgFieldsCache, loadPkgFields]);

  return (
    <div className="grid gap-1">
      <Label className={labelSize}>
        {compact ? "Show when (cross-package)" : "Cross-Package Conditions (showWhen)"}
      </Label>
      <p className={`${compact ? "text-[10px]" : "text-xs"} text-neutral-500`}>
        Only show when another package&apos;s category or field value matches.
      </p>
      {value.map((rule, rIdx) => {
        const cats = crossPkgCategories[rule.package] ?? [];
        const pkgFields = pkgFieldsCache[rule.package] ?? [];
        const fieldCandidates = pkgFields.filter(
          (f) => (f.meta?.inputType === "select" || f.meta?.inputType === "boolean") && f.isActive !== false,
        );
        const selectedField = rule.field ? pkgFields.find((f) => f.value === rule.field) : null;
        const fieldType = selectedField?.meta?.inputType;
        const fieldOpts: { label: string; value: string }[] =
          fieldType === "boolean"
            ? [
                { label: selectedField?.meta?.booleanLabels?.true ?? "Yes", value: "true" },
                { label: selectedField?.meta?.booleanLabels?.false ?? "No", value: "false" },
              ]
            : (selectedField?.meta?.options ?? []).map((o) => ({ label: o.label ?? o.value ?? "", value: o.value ?? "" }));
        const selectedFieldValues = rule.fieldValues ?? [];

        return (
          <React.Fragment key={rIdx}>
          <div className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Label className={`w-16 shrink-0 ${labelSize}`}>Package</Label>
                <select
                  className={selectCls}
                  value={rule.package}
                  onChange={(e) => {
                    const next = [...value];
                    next[rIdx] = { ...next[rIdx], package: e.target.value, category: [], field: undefined, fieldValues: undefined };
                    onChange(next);
                    if (e.target.value) {
                      onLoadCategories(e.target.value);
                      void loadPkgFields(e.target.value);
                    }
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
              {rule.package ? (
                <div className="flex items-start gap-2">
                  <Label className={`w-16 shrink-0 pt-0.5 ${labelSize}`}>Field</Label>
                  <div className="flex-1 space-y-1">
                    <select
                      className={selectCls}
                      value={rule.field ?? ""}
                      onChange={(e) => {
                        const next = [...value];
                        next[rIdx] = { ...next[rIdx], field: e.target.value || undefined, fieldValues: e.target.value ? [] : undefined, childKey: undefined, childValues: undefined };
                        onChange(next);
                      }}
                    >
                      <option value="">(no field condition)</option>
                      {fieldCandidates.map((f) => (
                        <option key={f.id} value={f.value}>
                          {f.label} ({f.meta?.inputType})
                        </option>
                      ))}
                    </select>
                    {rule.field && fieldOpts.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {fieldOpts.map((o) => {
                          const checked = selectedFieldValues.includes(o.value);
                          return (
                            <label key={o.value} className="inline-flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = [...value];
                                  const updated = checked
                                    ? selectedFieldValues.filter((v) => v !== o.value)
                                    : [...selectedFieldValues, o.value];
                                  next[rIdx] = { ...next[rIdx], fieldValues: updated, childKey: undefined, childValues: undefined };
                                  onChange(next);
                                }}
                              />
                              {o.label}
                            </label>
                          );
                        })}
                      </div>
                    ) : null}
                    {(() => {
                      if (fieldType !== "select" || selectedFieldValues.length === 0 || !selectedField?.meta?.options) return null;
                      const childCandidates: { key: string; label: string; inputType: string; options?: { label?: string; value?: string }[]; booleanLabels?: { true?: string; false?: string } }[] = [];
                      for (const optVal of selectedFieldValues) {
                        const opt = selectedField.meta.options.find((o) => o.value === optVal);
                        const kids = Array.isArray(opt?.children) ? opt.children : [];
                        kids.forEach((child, idx) => {
                          const cType = String((child as Record<string, unknown>)?.inputType ?? "string");
                          if (cType !== "select" && cType !== "boolean") return;
                          childCandidates.push({
                            key: `opt_${optVal}__c${idx}`,
                            label: String((child as Record<string, unknown>)?.label ?? `Child ${idx + 1}`),
                            inputType: cType,
                            options: (child as Record<string, unknown>)?.options as { label?: string; value?: string }[] | undefined,
                            booleanLabels: (child as Record<string, unknown>)?.booleanLabels as { true?: string; false?: string } | undefined,
                          });
                        });
                      }
                      if (childCandidates.length === 0) return null;
                      const selectedChild = rule.childKey ? childCandidates.find((c) => c.key === rule.childKey) : null;
                      const childValueOpts: { label: string; value: string }[] = selectedChild
                        ? selectedChild.inputType === "boolean"
                          ? [
                              { label: selectedChild.booleanLabels?.true ?? "Yes", value: "true" },
                              { label: selectedChild.booleanLabels?.false ?? "No", value: "false" },
                            ]
                          : (selectedChild.options ?? []).map((o) => ({ label: o.label ?? o.value ?? "", value: o.value ?? "" }))
                        : [];
                      const selectedChildValues = rule.childValues ?? [];
                      return (
                        <div className="mt-1 space-y-1 rounded border border-dashed border-neutral-300 p-1.5 dark:border-neutral-700">
                          <div className="flex items-center gap-2">
                            <Label className={`w-20 shrink-0 ${labelSize}`}>Child Field</Label>
                            <select
                              className={selectCls}
                              value={rule.childKey ?? ""}
                              onChange={(e) => {
                                const next = [...value];
                                next[rIdx] = { ...next[rIdx], childKey: e.target.value || undefined, childValues: e.target.value ? [] : undefined };
                                onChange(next);
                              }}
                            >
                              <option value="">(no child condition)</option>
                              {childCandidates.map((c) => (
                                <option key={c.key} value={c.key}>{c.label} ({c.inputType})</option>
                              ))}
                            </select>
                          </div>
                          {rule.childKey && childValueOpts.length > 0 ? (
                            <div className="flex flex-wrap gap-2 pl-22">
                              {childValueOpts.map((o) => {
                                const checked = selectedChildValues.includes(o.value);
                                return (
                                  <label key={o.value} className="inline-flex items-center gap-1 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => {
                                        const next = [...value];
                                        const updated = checked
                                          ? selectedChildValues.filter((v) => v !== o.value)
                                          : [...selectedChildValues, o.value];
                                        next[rIdx] = { ...next[rIdx], childValues: updated };
                                        onChange(next);
                                      }}
                                    />
                                    {o.label}
                                  </label>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>
                </div>
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
          {rIdx < value.length - 1 && value.length > 1 && (
            <div className="flex justify-center">
              <button
                type="button"
                className={`rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  logic === "or"
                    ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-800/50"
                    : "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-800/50"
                }`}
                onClick={() => onLogicChange?.(logic === "and" ? "or" : "and")}
              >
                {logic === "and" ? "AND" : "OR"}
              </button>
            </div>
          )}
          </React.Fragment>
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
