"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShowWhenConfig } from "@/components/admin/generic/ShowWhenConfig";
import {
  SelectOptionsEditor,
  parseImportedOptions,
  deriveOptionValue,
  type SharedProps,
  type OptionRow,
} from "@/components/admin/generic/BooleanChildrenEditor";

type InputType = "string" | "number" | "currency" | "date" | "select" | "multi_select" | "boolean" | "repeatable" | "formula";

export type ChildField = {
  label?: string;
  inputType?: string;
  options?: OptionRow[];
  currencyCode?: string;
  decimals?: number;
  formula?: string;
  booleanLabels?: { true?: string; false?: string };
  booleanDisplay?: "radio" | "dropdown";
  booleanChildren?: { true?: ChildField[]; false?: ChildField[] };
  showWhen?: unknown[];
  [key: string]: unknown;
};

type RepeatableField = {
  label?: string;
  value?: string;
  inputType?: string;
  options?: OptionRow[];
  formula?: string;
  [key: string]: unknown;
};

type RepeatableConfig = {
  itemLabel?: string;
  min?: number;
  max?: number;
  fields?: RepeatableField[];
};

/* ─── Top-level Select / Multi-select editor ─── */

export function TopLevelSelectEditor({
  inputType,
  selectDisplay,
  onSelectDisplayChange,
  options,
  onOptionsChange,
  children: optionChildren,
  onChildrenChange,
  groupNames,
  ...shared
}: SharedProps & {
  inputType: string;
  selectDisplay: string;
  onSelectDisplayChange: (v: string) => void;
  options: OptionRow[];
  onOptionsChange: (next: OptionRow[]) => void;
  children?: ChildField[][];
  onChildrenChange?: (optIdx: number, next: ChildField[]) => void;
  groupNames?: string[];
}) {
  const [pkgFieldsCache, setPkgFieldsCache] = React.useState<Record<string, { label: string; value: string }[]>>({});
  const pkgFieldsLoadingRef = React.useRef<Set<string>>(new Set());
  const loadPkgFields = React.useCallback(async (pkgKey: string) => {
    if (pkgFieldsLoadingRef.current.has(pkgKey)) return;
    pkgFieldsLoadingRef.current.add(pkgKey);
    try {
      const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkgKey}_fields`)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { label: string; value: string }[];
      setPkgFieldsCache((prev) => ({ ...prev, [pkgKey]: Array.isArray(data) ? data : [] }));
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => {
    for (const o of options) {
      if (o.scrollToPackage && !pkgFieldsCache[o.scrollToPackage] && !pkgFieldsLoadingRef.current.has(o.scrollToPackage)) {
        void loadPkgFields(o.scrollToPackage);
      }
    }
  }, [options, pkgFieldsCache, loadPkgFields]);

  const autoFillValue = (idx: number) => {
    const o = options[idx];
    if (o && (o.value ?? "").trim() === "" && (o.label ?? "").trim() !== "") {
      const next = [...options];
      next[idx] = { ...next[idx], value: deriveOptionValue(o.label ?? "") };
      onOptionsChange(next);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="grid gap-1">
        <Label>Display</Label>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
              checked={(selectDisplay ?? "dropdown") === "dropdown"}
              onChange={() => onSelectDisplayChange("dropdown")}
            />
            Dropdown
          </label>
          {inputType === "select" ? (
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                checked={selectDisplay === "radio"}
                onChange={() => onSelectDisplayChange("radio")}
              />
              Radio buttons
            </label>
          ) : (
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                checked={selectDisplay === "checkbox"}
                onChange={() => onSelectDisplayChange("checkbox")}
              />
              Checkboxes
            </label>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label>Options</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onOptionsChange([...options, { label: "", value: "" }])}
          >
            Add option
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const text = window.prompt(
                'Paste options, one per line. Use "Label|value" or "Label=value". If no separator, label is used as value.'
              );
              if (text) onOptionsChange(parseImportedOptions(text));
            }}
          >
            Import
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {options.map((opt, idx) => {
          const valueEmpty = (opt.value ?? "").trim() === "";
          const labelFilled = (opt.label ?? "").trim() !== "";
          return (
            <div key={idx}>
              <div className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-5">
                  <Input
                    placeholder="Label"
                    value={opt.label ?? ""}
                    onChange={(e) => {
                      const next = [...options];
                      next[idx] = { ...next[idx], label: e.target.value };
                      onOptionsChange(next);
                    }}
                    onBlur={() => autoFillValue(idx)}
                  />
                </div>
                <div className="col-span-5">
                  <Input
                    placeholder="Value (auto-filled from label)"
                    value={opt.value ?? ""}
                    className={valueEmpty && labelFilled ? "border-amber-500 dark:border-amber-500" : ""}
                    onChange={(e) => {
                      const next = [...options];
                      next[idx] = { ...next[idx], value: e.target.value };
                      onOptionsChange(next);
                    }}
                    onBlur={() => autoFillValue(idx)}
                  />
                  {valueEmpty && labelFilled && (
                    <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      Value will be auto-filled on save
                    </p>
                  )}
                </div>
                <div className="col-span-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => onOptionsChange(options.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {shared.allPackages && shared.allPackages.length > 0 && (
                <div className="mt-1 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">Scroll to section:</span>
                    <select
                      className="h-7 flex-1 rounded border border-neutral-200 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                      value={String(opt.scrollToPackage ?? "")}
                      onChange={(e) => {
                        const next = [...options];
                        next[idx] = { ...next[idx], scrollToPackage: e.target.value || undefined, scrollToField: undefined };
                        onOptionsChange(next);
                      }}
                    >
                      <option value="">— none —</option>
                      {shared.allPackages.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  {opt.scrollToPackage && (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">Highlight field:</span>
                      <select
                        className="h-7 flex-1 rounded border border-neutral-200 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                        value={String(opt.scrollToField ?? "")}
                        onChange={(e) => {
                          const next = [...options];
                          next[idx] = { ...next[idx], scrollToField: e.target.value || undefined };
                          onOptionsChange(next);
                        }}
                      >
                        <option value="">— entire section —</option>
                        {(pkgFieldsCache[opt.scrollToPackage] ?? []).map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {onChildrenChange && (
                <OptionChildrenEditor
                  children={optionChildren?.[idx] ?? []}
                  onChange={(next) => onChildrenChange(idx, next)}
                  allPackages={shared.allPackages}
                  crossPkgCategories={shared.crossPkgCategories}
                  onLoadCategories={shared.onLoadCategories}
                />
              )}
            </div>
          );
        })}
        {options.length === 0 && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            No options yet. Click &quot;Add option&quot; or &quot;Import&quot;.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Option Children Editor (children of a select option) ─── */

function SingleOptionChild({
  child,
  childIdx,
  children,
  onChange,
  ...shared
}: SharedProps & {
  child: ChildField;
  childIdx: number;
  children: ChildField[];
  onChange: (next: ChildField[]) => void;
}) {
  function update(patch: Partial<ChildField>) {
    const next = [...children];
    next[childIdx] = { ...(next[childIdx] ?? {}), ...patch };
    onChange(next);
  }

  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <Label>Child #{childIdx + 1}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange(children.filter((_, i) => i !== childIdx))}
        >
          Remove
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Label>Label</Label>
          <Input
            placeholder="Child field label"
            value={child?.label ?? ""}
            onChange={(e) => update({ label: e.target.value })}
          />
        </div>
        <div className="w-[200px]">
          <Label>Type</Label>
          <select
            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            value={child?.inputType ?? "string"}
            onChange={(e) => {
              const t = e.target.value as InputType;
              update({
                inputType: t,
                options: t === "select" || t === "multi_select" ? (child?.options ?? []) : undefined,
              });
            }}
          >
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="currency">Currency</option>
            <option value="date">Date</option>
            <option value="select">Select</option>
            <option value="multi_select">Multi Select</option>
            <option value="boolean">Boolean (Yes/No)</option>
            <option value="formula">Formula</option>
          </select>
        </div>
      </div>

      {child?.inputType === "formula" && (
        <div className="col-span-12 mt-2">
          <Label>Formula Expression</Label>
          <Input
            placeholder="e.g. {field_key} * 0.05"
            value={String(child?.formula ?? "")}
            onChange={(e) => update({ formula: e.target.value })}
          />
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Reference sibling fields using {"{field_key}"} syntax.
          </p>
        </div>
      )}

      {(child?.inputType === "currency" || child?.inputType === "negative_currency") && (
        <div className="col-span-12 mt-2 grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label>Currency Code</Label>
            <Input
              placeholder="e.g. HKD, USD"
              value={String(child?.currencyCode ?? "")}
              onChange={(e) => update({ currencyCode: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label>Decimal Places</Label>
            <Input
              type="number"
              className="w-28"
              placeholder="2"
              value={String(child?.decimals ?? 2)}
              onChange={(e) => update({ decimals: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
      )}

      {child?.inputType === "boolean" && (
        <div className="col-span-12 mt-2 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>Yes Label</Label>
              <Input
                placeholder="Yes"
                value={String(child?.booleanLabels?.true ?? "")}
                onChange={(e) =>
                  update({ booleanLabels: { ...(child?.booleanLabels ?? {}), true: e.target.value } })
                }
              />
            </div>
            <div className="grid gap-1">
              <Label>No Label</Label>
              <Input
                placeholder="No"
                value={String(child?.booleanLabels?.false ?? "")}
                onChange={(e) =>
                  update({ booleanLabels: { ...(child?.booleanLabels ?? {}), false: e.target.value } })
                }
              />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label>Display</Label>
              <div className="flex items-center gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={(child?.booleanDisplay ?? "radio") === "radio"}
                    onChange={() => update({ booleanDisplay: "radio" })}
                  />
                  Radio buttons
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={child?.booleanDisplay === "dropdown"}
                    onChange={() => update({ booleanDisplay: "dropdown" })}
                  />
                  Dropdown
                </label>
              </div>
            </div>
          </div>
          {(["true", "false"] as const).map((branch) => {
            const branchLabel = branch === "true" ? "When YES" : "When NO";
            const branchChildren: ChildField[] = Array.isArray(
              (child?.booleanChildren as Record<string, ChildField[]>)?.[branch]
            )
              ? ((child?.booleanChildren as Record<string, ChildField[]>)[branch] ?? [])
              : [];
            return (
              <div
                key={branch}
                className="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800"
              >
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{branchLabel}</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const bc = { ...(child?.booleanChildren ?? {}) } as Record<string, ChildField[]>;
                      const arr = Array.isArray(bc[branch]) ? [...bc[branch]] : [];
                      arr.push({ label: "", inputType: "string" });
                      bc[branch] = arr;
                      update({ booleanChildren: bc as any });
                    }}
                  >
                    Add child
                  </Button>
                </div>
                {branchChildren.map((bc, bIdx) => (
                  <div
                    key={`${branch}-${bIdx}`}
                    className="rounded border border-neutral-100 p-2 dark:border-neutral-800"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium">Child #{bIdx + 1}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const bCh = { ...(child?.booleanChildren ?? {}) } as Record<string, ChildField[]>;
                          const arr = Array.isArray(bCh[branch]) ? [...bCh[branch]] : [];
                          arr.splice(bIdx, 1);
                          bCh[branch] = arr;
                          update({ booleanChildren: bCh as any });
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-6">
                        <Input
                          placeholder="Label"
                          value={String(bc?.label ?? "")}
                          onChange={(e) => {
                            const bCh = { ...(child?.booleanChildren ?? {}) } as Record<string, ChildField[]>;
                            const arr = Array.isArray(bCh[branch]) ? [...bCh[branch]] : [];
                            arr[bIdx] = { ...(arr[bIdx] ?? {}), label: e.target.value };
                            bCh[branch] = arr;
                            update({ booleanChildren: bCh as any });
                          }}
                        />
                      </div>
                      <div className="col-span-6">
                        <select
                          className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                          value={bc?.inputType ?? "string"}
                          onChange={(e) => {
                            const bCh = { ...(child?.booleanChildren ?? {}) } as Record<string, ChildField[]>;
                            const arr = Array.isArray(bCh[branch]) ? [...bCh[branch]] : [];
                            arr[bIdx] = {
                              ...(arr[bIdx] ?? {}),
                              inputType: e.target.value,
                              options:
                                e.target.value === "select" || e.target.value === "multi_select"
                                  ? (arr[bIdx]?.options ?? [])
                                  : undefined,
                            };
                            bCh[branch] = arr;
                            update({ booleanChildren: bCh as any });
                          }}
                        >
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="currency">Currency</option>
                          <option value="date">Date</option>
                          <option value="select">Select</option>
                          <option value="multi_select">Multi Select</option>
                          <option value="formula">Formula</option>
                        </select>
                      </div>
                      {(bc?.inputType === "currency" || bc?.inputType === "negative_currency") && (
                        <>
                          <div className="col-span-6">
                            <Input
                              placeholder="e.g. HKD"
                              value={String(bc?.currencyCode ?? "")}
                              onChange={(e) => {
                                const bCh = { ...(child?.booleanChildren ?? {}) } as Record<string, ChildField[]>;
                                const arr = Array.isArray(bCh[branch]) ? [...bCh[branch]] : [];
                                arr[bIdx] = { ...(arr[bIdx] ?? {}), currencyCode: e.target.value };
                                bCh[branch] = arr;
                                update({ booleanChildren: bCh as any });
                              }}
                            />
                          </div>
                          <div className="col-span-6">
                            <Input
                              type="number"
                              placeholder="2"
                              value={String(bc?.decimals ?? 2)}
                              onChange={(e) => {
                                const bCh = { ...(child?.booleanChildren ?? {}) } as Record<string, ChildField[]>;
                                const arr = Array.isArray(bCh[branch]) ? [...bCh[branch]] : [];
                                arr[bIdx] = { ...(arr[bIdx] ?? {}), decimals: Number(e.target.value) || 0 };
                                bCh[branch] = arr;
                                update({ booleanChildren: bCh as any });
                              }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {branchChildren.length === 0 && (
                  <p className="text-xs text-neutral-400">No children configured.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {child?.inputType && ["select", "multi_select"].includes(child.inputType) && (
        <SelectOptionsEditor
          options={Array.isArray(child?.options) ? child.options : []}
          onChange={(opts) => update({ options: opts })}
          allPackages={shared.allPackages}
          crossPkgCategories={shared.crossPkgCategories}
          onLoadCategories={shared.onLoadCategories}
        />
      )}

      <div className="mt-2 w-full">
        <ShowWhenConfig
          compact
          value={Array.isArray(child?.showWhen) ? (child.showWhen as any) : []}
          onChange={(sw) => update({ showWhen: sw })}
          allPackages={shared.allPackages}
          crossPkgCategories={shared.crossPkgCategories}
          onLoadCategories={shared.onLoadCategories}
        />
      </div>
    </div>
  );
}

export function OptionChildrenEditor({
  children,
  onChange,
  ...shared
}: SharedProps & {
  children: ChildField[];
  onChange: (next: ChildField[]) => void;
}) {
  return (
    <div className="col-span-12 mt-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <Label>Children</Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange([...children, { label: "", inputType: "string", options: [] }])}
        >
          Add child
        </Button>
      </div>
      <div className="grid gap-3">
        {children.map((child, cIdx) => (
          <SingleOptionChild
            key={cIdx}
            child={child}
            childIdx={cIdx}
            children={children}
            onChange={onChange}
            allPackages={shared.allPackages}
            crossPkgCategories={shared.crossPkgCategories}
            onLoadCategories={shared.onLoadCategories}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Top-level Repeatable editor ─── */

export function TopLevelRepeatableEditor({
  repeatable,
  onChange,
  ...shared
}: SharedProps & {
  repeatable: RepeatableConfig | undefined;
  onChange: (next: RepeatableConfig) => void;
}) {
  const rep = repeatable ?? { fields: [] };
  const fields: RepeatableField[] = Array.isArray(rep.fields) ? rep.fields : [];

  function updateField(idx: number, patch: Record<string, unknown>) {
    const next = [...fields];
    next[idx] = { ...(next[idx] ?? {}), ...patch };
    onChange({ ...rep, fields: next });
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label>Repeatable — Item label</Label>
        <Input
          placeholder="Accessory"
          value={String(rep.itemLabel ?? "")}
          onChange={(e) => onChange({ ...rep, itemLabel: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label>Min items</Label>
          <Input
            type="number"
            value={String(rep.min ?? 0)}
            onChange={(e) => onChange({ ...rep, min: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="grid gap-1">
          <Label>Max items</Label>
          <Input
            type="number"
            value={String(rep.max ?? 0)}
            onChange={(e) => onChange({ ...rep, max: Number(e.target.value) || 0 })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label>Item fields</Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange({ ...rep, fields: [...fields, { label: "", value: "", inputType: "string" }] })
          }
        >
          Add field
        </Button>
      </div>
      <div className="grid gap-2">
        {fields.map((fld, idx) => (
          <div key={idx}>
            <div className="grid grid-cols-12 items-center gap-2">
              <div className="col-span-4">
                <Input
                  placeholder="Label"
                  value={String(fld?.label ?? "")}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                />
              </div>
              <div className="col-span-4">
                <Input
                  placeholder="Value (key)"
                  value={String(fld?.value ?? "")}
                  onChange={(e) => updateField(idx, { value: e.target.value })}
                />
              </div>
              <div className="col-span-3">
                <select
                  className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={String(fld?.inputType ?? "string")}
                  onChange={(e) => {
                    const t = e.target.value;
                    updateField(idx, {
                      inputType: t,
                      options:
                        t === "select" || t === "multi_select" ? (fld?.options ?? []) : undefined,
                    });
                  }}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                  <option value="multi_select">Multi Select</option>
                  <option value="boolean">Boolean (Yes/No)</option>
                  <option value="formula">Formula</option>
                </select>
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => onChange({ ...rep, fields: fields.filter((_, i) => i !== idx) })}
                >
                  Remove
                </Button>
              </div>
            </div>
            {fld?.inputType === "formula" && (
              <div className="col-span-12 mt-1">
                <Label>Formula Expression</Label>
                <Input
                  placeholder="e.g. {cost} * 1.1"
                  value={String(fld?.formula ?? "")}
                  onChange={(e) => updateField(idx, { formula: e.target.value })}
                />
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Reference sibling fields using {"{field_key}"} syntax.
                </p>
              </div>
            )}
            {fld?.inputType && ["select", "multi_select"].includes(fld.inputType) && (
              <div className="col-span-12 mt-1 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                <SelectOptionsEditor
                  options={Array.isArray(fld?.options) ? fld.options : []}
                  onChange={(opts) => updateField(idx, { options: opts })}
                  allPackages={shared.allPackages}
                  crossPkgCategories={shared.crossPkgCategories}
                  onLoadCategories={shared.onLoadCategories}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
