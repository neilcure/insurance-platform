"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import { usePkgFields, type PkgFieldInfo } from "@/hooks/use-pkg-fields";

type GswRule = {
  package?: string;
  field: string;
  values: string[];
  childKey?: string;
  childValues?: string[];
};

type GroupShowWhen = GswRule | GswRule[] | null;

type FieldInfo = PkgFieldInfo;

type ChildMeta = {
  label?: string;
  inputType?: string;
  options?: { label?: string; value?: string }[];
  booleanLabels?: { true?: string; false?: string };
};

function normalizeRules(val: GroupShowWhen): GswRule[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

const CATEGORY_SENTINEL = "__category__";

function RuleRow({
  rule,
  ruleIdx,
  localFields,
  allPackages,
  currentPkg,
  excludeFieldId,
  onUpdate,
  onRemove,
  canRemove,
  onLoadPkgFields,
  pkgFieldsCache,
}: {
  rule: GswRule;
  ruleIdx: number;
  localFields: FieldInfo[];
  allPackages: { label: string; value: string }[];
  currentPkg: string;
  excludeFieldId?: number;
  onUpdate: (idx: number, next: GswRule) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
  onLoadPkgFields: (pkg: string) => void;
  pkgFieldsCache: Record<string, FieldInfo[]>;
}) {
  const selectCls = "rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

  const selectedPkg = rule.package || currentPkg;
  const isCrossPkg = selectedPkg !== currentPkg;
  const fields = isCrossPkg ? (pkgFieldsCache[selectedPkg] ?? []) : localFields;

  const isCategory = rule.field === "category";
  const [catOptions, setCatOptions] = React.useState<{ label: string; value: string }[]>([]);

  React.useEffect(() => {
    if (!isCategory || !selectedPkg) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${selectedPkg}_category`)}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { label: string; value: string }[];
        if (!cancelled) setCatOptions(Array.isArray(data) ? data : []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [isCategory, selectedPkg]);

  const triggerCandidates = fields.filter(
    (r) =>
      (!isCrossPkg ? r.id !== excludeFieldId : true) &&
      (r.meta?.inputType === "select" || r.meta?.inputType === "boolean") &&
      r.isActive !== false,
  );

  const triggerField = !isCategory && rule.field ? fields.find((r) => r.value === rule.field) : null;
  const triggerType = triggerField?.meta?.inputType;

  const topOpts: { label?: string; value?: string; children?: ChildMeta[] }[] = isCategory
    ? catOptions.map((c) => ({ label: c.label, value: c.value }))
    : triggerType === "boolean"
      ? [
          { label: triggerField?.meta?.booleanLabels?.true ?? "Yes", value: "true" },
          { label: triggerField?.meta?.booleanLabels?.false ?? "No", value: "false" },
        ]
      : (triggerField?.meta?.options as { label?: string; value?: string; children?: ChildMeta[] }[]) ?? [];

  const selectedValues = rule.values ?? [];

  const childrenFromSelected: { optValue: string; childIdx: number; child: ChildMeta }[] = [];
  if (triggerType === "select") {
    for (const optVal of selectedValues) {
      const opt = topOpts.find((o) => o.value === optVal);
      if (opt?.children) {
        opt.children.forEach((child, idx) => {
          childrenFromSelected.push({ optValue: optVal, childIdx: idx, child });
        });
      }
    }
  }

  const hasChildren = childrenFromSelected.length > 0;
  const currentChildKey = rule.childKey ?? "";
  const currentChildValues = rule.childValues ?? [];

  const selectedChildEntry = currentChildKey
    ? childrenFromSelected.find((c) => `${rule.field}__opt_${c.optValue}__c${c.childIdx}` === currentChildKey)
    : null;

  const childOpts: { label: string; value: string }[] = (() => {
    if (!selectedChildEntry) return [];
    const ct = selectedChildEntry.child.inputType ?? "string";
    if (ct === "boolean") {
      return [
        { label: selectedChildEntry.child.booleanLabels?.true ?? "Yes", value: "true" },
        { label: selectedChildEntry.child.booleanLabels?.false ?? "No", value: "false" },
      ];
    }
    if (ct === "select") {
      return (selectedChildEntry.child.options ?? []).map((o) => ({
        label: o.label ?? o.value ?? "",
        value: o.value ?? "",
      }));
    }
    return [];
  })();

  return (
    <div className="flex items-start gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Label className="w-16 shrink-0 text-xs">Package</Label>
          <select
            className={`flex-1 ${selectCls}`}
            value={selectedPkg}
            onChange={(e) => {
              const v = e.target.value;
              const nextPkg = v === currentPkg ? undefined : v;
              onUpdate(ruleIdx, { package: nextPkg, field: "", values: [] });
              if (nextPkg && !pkgFieldsCache[v]) {
                onLoadPkgFields(v);
              }
            }}
          >
            {allPackages.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}{p.value === currentPkg ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-start gap-2">
          <Label className="w-16 shrink-0 pt-0.5 text-xs">Field</Label>
          <div className="flex-1 space-y-1">
            <select
              className={`w-full ${selectCls}`}
              value={isCategory ? CATEGORY_SENTINEL : rule.field}
              onChange={(e) => {
                const v = e.target.value;
                const fieldVal = v === CATEGORY_SENTINEL ? "category" : v;
                onUpdate(ruleIdx, { ...rule, field: fieldVal, values: [], childKey: undefined, childValues: undefined });
              }}
            >
              <option value="">-- Select field --</option>
              <option value={CATEGORY_SENTINEL}>Category</option>
              {triggerCandidates.map((r) => (
                <option key={r.id} value={r.value}>
                  {r.label} ({r.meta?.inputType})
                </option>
              ))}
            </select>
            {rule.field && topOpts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {topOpts.map((opt) => {
                  const v = String(opt.value ?? "");
                  const checked = selectedValues.includes(v);
                  return (
                    <label key={v} className="inline-flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked ? selectedValues.filter((s) => s !== v) : [...selectedValues, v];
                          onUpdate(ruleIdx, { ...rule, values: next });
                        }}
                      />
                      {opt.label || v}
                    </label>
                  );
                })}
              </div>
            ) : rule.field ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">No options found for this field.</p>
            ) : null}
          </div>
        </div>

        {hasChildren ? (
          <div className="rounded-md border border-dashed border-neutral-300 p-2 dark:border-neutral-700">
            <Label className="text-xs">Also check a child field? (optional)</Label>
            <select
              className={`mt-1 w-full ${selectCls}`}
              value={currentChildKey}
              onChange={(e) => {
                const v = e.target.value;
                onUpdate(ruleIdx, { ...rule, childKey: v || undefined, childValues: v ? [] : undefined });
              }}
            >
              <option value="">(no child condition)</option>
              {childrenFromSelected.map((c) => {
                const key = `${rule.field}__opt_${c.optValue}__c${c.childIdx}`;
                const cType = c.child.inputType ?? "string";
                if (cType !== "boolean" && cType !== "select") return null;
                return (
                  <option key={key} value={key}>
                    {c.child.label ?? `Child ${c.childIdx}`} ({cType})
                  </option>
                );
              })}
            </select>
            {currentChildKey && childOpts.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {childOpts.map((opt) => {
                  const v = String(opt.value ?? "");
                  const checked = currentChildValues.includes(v);
                  return (
                    <label key={v} className="inline-flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked ? currentChildValues.filter((s) => s !== v) : [...currentChildValues, v];
                          onUpdate(ruleIdx, { ...rule, childKey: currentChildKey, childValues: next });
                        }}
                      />
                      {opt.label || v}
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 w-6 p-0"
        onClick={() => onRemove(ruleIdx)}
        title="Remove condition"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function GroupShowWhenConfig({
  value,
  onChange,
  fields,
  excludeFieldId,
  allPackages,
  currentPkg,
  groupLabel,
  logic,
  onLogicChange,
}: {
  value: GroupShowWhen;
  onChange: (next: GroupShowWhen) => void;
  fields: FieldInfo[];
  excludeFieldId?: number;
  allPackages?: { label: string; value: string }[];
  currentPkg?: string;
  groupLabel?: string;
  logic?: "and" | "or";
  onLogicChange?: (next: "and" | "or") => void;
}) {
  const rules = normalizeRules(value);
  const { pkgFieldsCache, loadPkgFields } = usePkgFields();

  React.useEffect(() => {
    for (const rule of rules) {
      if (rule.package && !pkgFieldsCache[rule.package]) {
        void loadPkgFields(rule.package);
      }
    }
  }, [rules, pkgFieldsCache, loadPkgFields]);

  const effectivePkg = currentPkg ?? "";
  const effectivePackages = (allPackages && allPackages.length > 0)
    ? allPackages
    : (effectivePkg ? [{ label: effectivePkg, value: effectivePkg }] : []);

  function updateRule(idx: number, next: GswRule) {
    const updated = [...rules];
    updated[idx] = next;
    onChange(updated.length === 0 ? null : updated);
  }

  function removeRule(idx: number) {
    const updated = rules.filter((_, i) => i !== idx);
    onChange(updated.length === 0 ? null : updated);
  }

  function addRule() {
    onChange([...rules, { field: "", values: [] }]);
  }

  const title = groupLabel
    ? `"${groupLabel}" Group Visibility (groupShowWhen)`
    : "Group Visibility Conditions (groupShowWhen)";
  const desc = groupLabel
    ? `Only show when the "${groupLabel}" group's conditions match.`
    : "Only show this group when all conditions match.";

  return (
    <div className="grid gap-1">
      <Label className="text-xs">{title}</Label>
      <p className="text-xs text-neutral-500">{desc}</p>

      {rules.length > 1 && onLogicChange ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-neutral-500 dark:text-neutral-400">Match:</span>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name={`gsw-logic-${groupLabel ?? "default"}`} checked={logic !== "or"} onChange={() => onLogicChange("and")} />
            ALL conditions (AND)
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name={`gsw-logic-${groupLabel ?? "default"}`} checked={logic === "or"} onChange={() => onLogicChange("or")} />
            ANY condition (OR)
          </label>
        </div>
      ) : null}

      {rules.map((rule, idx) => (
        <RuleRow
          key={idx}
          rule={rule}
          ruleIdx={idx}
          localFields={fields}
          allPackages={effectivePackages}
          currentPkg={effectivePkg}
          excludeFieldId={excludeFieldId}
          onUpdate={updateRule}
          onRemove={removeRule}
          canRemove={rules.length > 1}
          onLoadPkgFields={loadPkgFields}
          pkgFieldsCache={pkgFieldsCache}
        />
      ))}

      <Button type="button" size="sm" variant="secondary" className="w-fit text-xs" onClick={addRule}>
        + Add condition
      </Button>
    </div>
  );
}
