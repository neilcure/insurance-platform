"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

type GswRule = {
  field: string;
  values: string[];
  childKey?: string;
  childValues?: string[];
};

type GroupShowWhen = GswRule | GswRule[] | null;

type FieldInfo = {
  id: number;
  value: string;
  label: string;
  isActive?: boolean;
  meta: {
    inputType?: string;
    options?: { label?: string; value?: string; children?: ChildMeta[] }[];
    booleanLabels?: { true?: string; false?: string };
  } | null;
};

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

function RuleRow({
  rule,
  ruleIdx,
  fields,
  excludeFieldId,
  onUpdate,
  onRemove,
  canRemove,
}: {
  rule: GswRule;
  ruleIdx: number;
  fields: FieldInfo[];
  excludeFieldId?: number;
  onUpdate: (idx: number, next: GswRule) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}) {
  const selectCls = "rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900";

  const triggerCandidates = fields.filter(
    (r) => r.id !== excludeFieldId && (r.meta?.inputType === "select" || r.meta?.inputType === "boolean") && r.isActive !== false,
  );

  const triggerField = rule.field ? fields.find((r) => r.value === rule.field) : null;
  const triggerType = triggerField?.meta?.inputType;

  const topOpts: { label?: string; value?: string; children?: ChildMeta[] }[] =
    triggerType === "boolean"
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
        <select
          className={`w-full ${selectCls}`}
          value={rule.field}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate(ruleIdx, v ? { field: v, values: [] } : { field: "", values: [] });
          }}
        >
          <option value="">-- Select field --</option>
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
                      onUpdate(ruleIdx, { field: rule.field, values: next });
                    }}
                  />
                  {opt.label || v}
                </label>
              );
            })}
          </div>
        ) : rule.field ? (
          <p className="text-xs text-neutral-500">No options found for this field.</p>
        ) : null}

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
      {canRemove ? (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="mt-1 h-6 w-6 shrink-0 px-0! py-0!"
          onClick={() => onRemove(ruleIdx)}
          title="Remove condition"
        >
          <X className="h-3 w-3" />
        </Button>
      ) : null}
    </div>
  );
}

export function GroupShowWhenConfig({
  value,
  onChange,
  fields,
  excludeFieldId,
}: {
  value: GroupShowWhen;
  onChange: (next: GroupShowWhen) => void;
  fields: FieldInfo[];
  excludeFieldId?: number;
}) {
  const rules = normalizeRules(value);

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

  return (
    <div className="grid gap-2">
      <Label>Group Visibility Conditions (optional)</Label>
      <p className="text-xs text-neutral-500">
        Only show this group when <strong>all</strong> conditions match. Add multiple conditions for AND logic.
      </p>

      {rules.length === 0 ? (
        <p className="text-xs text-neutral-400 italic">Always visible (no conditions set).</p>
      ) : null}

      {rules.map((rule, idx) => (
        <RuleRow
          key={idx}
          rule={rule}
          ruleIdx={idx}
          fields={fields}
          excludeFieldId={excludeFieldId}
          onUpdate={updateRule}
          onRemove={removeRule}
          canRemove={rules.length > 1}
        />
      ))}

      <div className="flex gap-2">
        <Button type="button" size="sm" variant="secondary" className="text-xs" onClick={addRule}>
          + Add condition
        </Button>
        {rules.length > 0 ? (
          <Button type="button" size="sm" variant="destructive" className="text-xs" onClick={() => onChange(null)}>
            Clear all
          </Button>
        ) : null}
      </div>
    </div>
  );
}
