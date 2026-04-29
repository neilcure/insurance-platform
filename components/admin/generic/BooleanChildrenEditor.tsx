"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShowWhenConfig } from "@/components/admin/generic/ShowWhenConfig";
import { EntityPickerConfigEditor, type EntityPickerConfig as EPConfig } from "@/components/admin/generic/EntityPickerConfig";
import type { ShowWhenRule } from "@/lib/types/form";

type InputType = "string" | "number" | "currency" | "date" | "select" | "multi_select" | "boolean" | "repeatable" | "formula";

export type BoolChild = {
  label?: string;
  inputType?: string;
  options?: OptionRow[];
  currencyCode?: string;
  decimals?: number;
  formula?: string;
  defaultValue?: string;
  readOnly?: boolean;
  booleanLabels?: { true?: string; false?: string };
  booleanDisplay?: "radio" | "dropdown";
  booleanChildren?: { true?: BoolChild[]; false?: BoolChild[] };
  showWhen?: ShowWhenRule[];
  [key: string]: unknown;
};

export type OptionRow = {
  label?: string;
  value?: string;
  showWhen?: ShowWhenRule[];
  scrollToGroup?: string;
  scrollToPackage?: string;
  scrollToField?: string;
  [key: string]: unknown;
};

export type SharedProps = {
  allPackages: { label: string; value: string }[];
  crossPkgCategories: Record<string, { label: string; value: string }[]>;
  onLoadCategories: (pkg: string) => void;
  currentPkg?: string;
};

type BranchEditorProps = SharedProps & {
  branchLabel: string;
  branchKey: "true" | "false";
  children: BoolChild[];
  onChange: (next: BoolChild[]) => void;
};

function updateChild(arr: BoolChild[], idx: number, patch: Partial<BoolChild>): BoolChild[] {
  const next = [...arr];
  next[idx] = { ...(next[idx] ?? {}), ...patch };
  return next;
}

function updateChildOption(arr: BoolChild[], childIdx: number, optIdx: number, patch: Partial<OptionRow>): BoolChild[] {
  const next = [...arr];
  const opts = [...(Array.isArray(next[childIdx]?.options) ? (next[childIdx]!.options ?? []) : [])];
  opts[optIdx] = { ...(opts[optIdx] ?? {}), ...patch };
  next[childIdx] = { ...(next[childIdx] ?? {}), options: opts };
  return next;
}

/** Derive a slug-like value from a label (lowercase, underscored, alphanumeric). */
export function deriveOptionValue(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function parseImportedOptions(text: string): OptionRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.includes("|") ? l.split("|") : l.split("=");
      const label = (parts[0] ?? "").trim();
      const value = (parts[1] ?? label).trim();
      return { label, value };
    });
}

type OptionChildConfig = {
  label?: string;
  inputType?: string;
  options?: OptionRow[];
  [key: string]: unknown;
};

export function SelectOptionsEditor({
  options,
  onChange,
  enableChildren,
  ...shared
}: SharedProps & {
  options: OptionRow[];
  onChange: (next: OptionRow[]) => void;
  enableChildren?: boolean;
}) {
  const autoFillValue = (idx: number) => {
    const o = options[idx];
    if (o && (o.value ?? "").trim() === "" && (o.label ?? "").trim() !== "") {
      const next = [...options];
      next[idx] = { ...next[idx], value: deriveOptionValue(o.label ?? "") };
      onChange(next);
    }
  };

  return (
    <div className="col-span-12 mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <Label>Options</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onChange([...options, { label: "", value: "" }])}
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
              if (text) onChange(parseImportedOptions(text));
            }}
          >
            Import
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {options.map((o, oi) => {
          const valueEmpty = (o.value ?? "").trim() === "";
          const labelFilled = (o.label ?? "").trim() !== "";
          return (
            <div key={oi} className="space-y-1">
              <div className="grid grid-cols-12 items-center gap-2">
                <div className="col-span-5">
                  <Input
                    placeholder="Label"
                    value={o.label ?? ""}
                    onChange={(e) => {
                      const next = [...options];
                      next[oi] = { ...next[oi], label: e.target.value };
                      onChange(next);
                    }}
                    onBlur={() => autoFillValue(oi)}
                  />
                </div>
                <div className="col-span-5">
                  <Input
                    placeholder="Value (auto-filled from label)"
                    value={o.value ?? ""}
                    className={valueEmpty && labelFilled ? "border-amber-500 dark:border-amber-500" : ""}
                    onChange={(e) => {
                      const next = [...options];
                      next[oi] = { ...next[oi], value: e.target.value };
                      onChange(next);
                    }}
                    onBlur={() => autoFillValue(oi)}
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
                    onClick={() => onChange(options.filter((_, i) => i !== oi))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <ShowWhenConfig
                compact
                value={Array.isArray(o?.showWhen) ? o.showWhen : []}
                onChange={(sw) => {
                  const next = [...options];
                  next[oi] = { ...next[oi], showWhen: sw };
                  onChange(next);
                }}
                allPackages={shared.allPackages}
                crossPkgCategories={shared.crossPkgCategories}
                onLoadCategories={shared.onLoadCategories}
              />
              {enableChildren && (
                <InlineOptionChildrenEditor
                  optionChildren={Array.isArray((o as any)?.children) ? (o as any).children : []}
                  onChange={(ch) => {
                    const next = [...options];
                    next[oi] = { ...next[oi], children: ch };
                    onChange(next);
                  }}
                  allPackages={shared.allPackages}
                  crossPkgCategories={shared.crossPkgCategories}
                  onLoadCategories={shared.onLoadCategories}
                  currentPkg={shared.currentPkg}
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

function InlineOptionChildrenEditor({
  optionChildren,
  onChange,
  ...shared
}: SharedProps & {
  optionChildren: OptionChildConfig[];
  onChange: (next: OptionChildConfig[]) => void;
}) {
  return (
    <details className="mt-1 rounded border border-dashed border-neutral-300 p-2 dark:border-neutral-700">
      <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
        Sub-fields ({optionChildren.length}) — shown when this option is selected
      </summary>
      <div className="mt-2 space-y-2">
        {optionChildren.map((ch, ci) => (
          <div key={ci} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium">Sub-field #{ci + 1}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onChange(optionChildren.filter((_, i) => i !== ci))}
              >
                Remove
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1">
                <Label className="text-xs">Label</Label>
                <Input
                  placeholder="Sub-field label"
                  value={ch?.label ?? ""}
                  onChange={(e) => {
                    const next = [...optionChildren];
                    next[ci] = { ...next[ci], label: e.target.value };
                    onChange(next);
                  }}
                />
              </div>
              <div className="w-[160px]">
                <Label className="text-xs">Type</Label>
                <select
                  className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={ch?.inputType ?? "string"}
                  onChange={(e) => {
                    const next = [...optionChildren];
                    const t = e.target.value;
                    next[ci] = {
                      ...next[ci],
                      inputType: t,
                      options: t === "select" || t === "multi_select" ? (next[ci]?.options ?? []) : undefined,
                    };
                    onChange(next);
                  }}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                  <option value="multi_select">Multi Select</option>
                  <option value="boolean">Boolean (Yes/No)</option>
                  <option value="repeatable">Repeatable (List)</option>
                  <option value="formula">Formula</option>
                </select>
              </div>
            </div>
            {ch?.inputType && ["select", "multi_select"].includes(ch.inputType) && (
              <SelectOptionsEditor
                options={Array.isArray(ch?.options) ? ch.options : []}
                onChange={(opts) => {
                  const next = [...optionChildren];
                  next[ci] = { ...next[ci], options: opts };
                  onChange(next);
                }}
                allPackages={shared.allPackages}
                crossPkgCategories={shared.crossPkgCategories}
                onLoadCategories={shared.onLoadCategories}
              />
            )}
            {ch?.inputType === "repeatable" && (() => {
              const rep = (ch as any)?.repeatable as RepeatableConfig | undefined;
              const repFields = Array.isArray(rep?.fields) ? rep!.fields : [];
              const targetFields = repFields
                .filter((f) => f?.value)
                .map((f) => ({ label: `${f.label ?? f.value} (${f.value})`, value: f.value! }));
              return (
                <>
                  <RepeatableEditor
                    repeatable={rep}
                    onChange={(r) => {
                      const next = [...optionChildren];
                      next[ci] = { ...next[ci], repeatable: r };
                      onChange(next);
                    }}
                  />
                  {shared.currentPkg && (
                    <div className="mt-2">
                      <EntityPickerConfigEditor
                        value={(ch as any)?.entityPicker as EPConfig | undefined}
                        onChange={(ep) => {
                          const next = [...optionChildren];
                          next[ci] = { ...next[ci], entityPicker: ep };
                          onChange(next);
                        }}
                        currentPkg={shared.currentPkg}
                        targetFields={targetFields}
                      />
                    </div>
                  )}
                </>
              );
            })()}
            {ch?.inputType === "formula" && (
              <div className="mt-2">
                <Label className="text-xs">Formula Expression</Label>
                <Input
                  placeholder="e.g. {field_key} * 0.05"
                  value={String((ch as any)?.formula ?? "")}
                  onChange={(e) => {
                    const next = [...optionChildren];
                    next[ci] = { ...next[ci], formula: e.target.value };
                    onChange(next);
                  }}
                />
              </div>
            )}
            {(ch?.inputType === "currency" || ch?.inputType === "negative_currency") && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Currency Code</Label>
                  <Input
                    placeholder="e.g. HKD"
                    value={String((ch as any)?.currencyCode ?? "")}
                    onChange={(e) => {
                      const next = [...optionChildren];
                      next[ci] = { ...next[ci], currencyCode: e.target.value };
                      onChange(next);
                    }}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Decimal Places</Label>
                  <Input
                    type="number"
                    placeholder="2"
                    value={String((ch as any)?.decimals ?? 2)}
                    onChange={(e) => {
                      const next = [...optionChildren];
                      next[ci] = { ...next[ci], decimals: Number(e.target.value) || 0 };
                      onChange(next);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange([...optionChildren, { label: "", inputType: "string" }])}
        >
          + Add sub-field
        </Button>
      </div>
    </details>
  );
}

type RepeatableConfig = {
  itemLabel?: string;
  min?: number;
  max?: number;
  fields?: { label?: string; value?: string; inputType?: string; options?: OptionRow[]; formula?: string }[];
};

function RepeatableEditor({
  repeatable,
  onChange,
}: {
  repeatable: RepeatableConfig | undefined;
  onChange: (next: RepeatableConfig) => void;
}) {
  const rep = repeatable ?? { fields: [] };
  const fields = Array.isArray(rep.fields) ? rep.fields : [];

  function updateField(idx: number, patch: Record<string, unknown>) {
    const next = [...fields];
    next[idx] = { ...(next[idx] ?? {}), ...patch };
    onChange({ ...rep, fields: next });
  }

  return (
    <div className="col-span-12 mt-2 space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label>Item label</Label>
          <Input
            placeholder="Accessory"
            value={String(rep.itemLabel ?? "")}
            onChange={(e) => onChange({ ...rep, itemLabel: e.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label>Min</Label>
          <Input
            type="number"
            value={String(rep.min ?? 0)}
            onChange={(e) => onChange({ ...rep, min: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="grid gap-1">
          <Label>Max</Label>
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
          onClick={() => onChange({ ...rep, fields: [...fields, { label: "", value: "", inputType: "string" }] })}
        >
          Add field
        </Button>
      </div>
      <div className="grid gap-2">
        {fields.map((rf, rfi) => (
          <div key={rfi}>
            <div className="grid grid-cols-12 items-center gap-2">
              <div className="col-span-4">
                <Input
                  placeholder="Label"
                  value={String(rf?.label ?? "")}
                  onChange={(e) => updateField(rfi, { label: e.target.value })}
                />
              </div>
              <div className="col-span-4">
                <Input
                  placeholder="Value (key)"
                  value={String(rf?.value ?? "")}
                  onChange={(e) => updateField(rfi, { value: e.target.value })}
                />
              </div>
              <div className="col-span-3">
                <select
                  className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={String(rf?.inputType ?? "string")}
                  onChange={(e) => {
                    const t = e.target.value;
                    updateField(rfi, {
                      inputType: t,
                      options: t === "select" || t === "multi_select" ? (rf?.options ?? []) : undefined,
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
                  onClick={() => onChange({ ...rep, fields: fields.filter((_, i) => i !== rfi) })}
                >
                  Remove
                </Button>
              </div>
            </div>
            {rf?.inputType === "formula" && (
              <div className="col-span-12 mt-1">
                <Label>Formula Expression</Label>
                <Input
                  placeholder="e.g. YEARS_BETWEEN(TODAY, {dob})"
                  value={String(rf?.formula ?? "")}
                  onChange={(e) => updateField(rfi, { formula: e.target.value })}
                />
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Reference sibling fields in the same row using {"{field_key}"} syntax. Supports
                  {" "}<strong>YEARS_BETWEEN</strong> / <strong>MONTHS_BETWEEN</strong> /
                  {" "}<strong>DAYS_BETWEEN</strong>, <strong>TODAY</strong>, and
                  {" "}<strong>FLOOR</strong> / <strong>CEIL</strong> / <strong>ROUND</strong>.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NestedBooleanEditor({
  child,
  onUpdate,
  branchKey,
  childIdx,
  parentBranchKey,
  parentChildren,
  onParentChange,
  ...shared
}: SharedProps & {
  child: BoolChild;
  onUpdate: (patch: Partial<BoolChild>) => void;
  branchKey: never;
  childIdx: number;
  parentBranchKey: string;
  parentChildren: BoolChild[];
  onParentChange: (next: BoolChild[]) => void;
}) {
  return (
    <div className="col-span-12 mt-2 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label>Yes Label</Label>
          <Input
            placeholder="Yes"
            value={String(child?.booleanLabels?.true ?? "")}
            onChange={(e) =>
              onUpdate({ booleanLabels: { ...(child?.booleanLabels ?? {}), true: e.target.value } })
            }
          />
        </div>
        <div className="grid gap-1">
          <Label>No Label</Label>
          <Input
            placeholder="No"
            value={String(child?.booleanLabels?.false ?? "")}
            onChange={(e) =>
              onUpdate({ booleanLabels: { ...(child?.booleanLabels ?? {}), false: e.target.value } })
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
                onChange={() => onUpdate({ booleanDisplay: "radio" })}
              />
              Radio buttons
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                checked={child?.booleanDisplay === "dropdown"}
                onChange={() => onUpdate({ booleanDisplay: "dropdown" })}
              />
              Dropdown
            </label>
          </div>
        </div>
      </div>
      {(["true", "false"] as const).map((branch) => {
        const branchLabel = branch === "true" ? "When YES" : "When NO";
        const branchChildren: BoolChild[] = Array.isArray((child?.booleanChildren as any)?.[branch])
          ? (child?.booleanChildren as any)[branch]
          : [];
        return (
          <div key={branch} className="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{branchLabel}</Label>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  const boolCh = { ...(child?.booleanChildren ?? {}) } as Record<string, BoolChild[]>;
                  const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                  bArr.push({ label: "", inputType: "string" });
                  boolCh[branch] = bArr;
                  onUpdate({ booleanChildren: boolCh as any });
                }}
              >
                Add child
              </Button>
            </div>
            {branchChildren.map((bChild, bIdx) => (
              <div key={`${branch}-${bIdx}`} className="rounded border border-neutral-100 p-2 dark:border-neutral-800">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium">Child #{bIdx + 1}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const boolCh = { ...(child?.booleanChildren ?? {}) } as Record<string, BoolChild[]>;
                      const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                      bArr.splice(bIdx, 1);
                      boolCh[branch] = bArr;
                      onUpdate({ booleanChildren: boolCh as any });
                    }}
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-6">
                    <Input
                      placeholder="Label"
                      value={String(bChild?.label ?? "")}
                      onChange={(e) => {
                        const boolCh = { ...(child?.booleanChildren ?? {}) } as Record<string, BoolChild[]>;
                        const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                        bArr[bIdx] = { ...(bArr[bIdx] ?? {}), label: e.target.value };
                        boolCh[branch] = bArr;
                        onUpdate({ booleanChildren: boolCh as any });
                      }}
                    />
                  </div>
                  <div className="col-span-6">
                    <select
                      className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                      value={bChild?.inputType ?? "string"}
                      onChange={(e) => {
                        const boolCh = { ...(child?.booleanChildren ?? {}) } as Record<string, BoolChild[]>;
                        const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                        bArr[bIdx] = {
                          ...(bArr[bIdx] ?? {}),
                          inputType: e.target.value,
                          options:
                            e.target.value === "select" || e.target.value === "multi_select"
                              ? (bArr[bIdx]?.options ?? [])
                              : undefined,
                        };
                        boolCh[branch] = bArr;
                        onUpdate({ booleanChildren: boolCh as any });
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
                  {(bChild?.inputType === "currency" || bChild?.inputType === "negative_currency") && (
                    <>
                      <div className="col-span-6">
                        <Input
                          placeholder="e.g. HKD"
                          value={String(bChild?.currencyCode ?? "")}
                          onChange={(e) => {
                            const boolCh = { ...(child?.booleanChildren ?? {}) } as Record<string, BoolChild[]>;
                            const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                            bArr[bIdx] = { ...(bArr[bIdx] ?? {}), currencyCode: e.target.value };
                            boolCh[branch] = bArr;
                            onUpdate({ booleanChildren: boolCh as any });
                          }}
                        />
                      </div>
                      <div className="col-span-6">
                        <Input
                          type="number"
                          placeholder="2"
                          value={String(bChild?.decimals ?? 2)}
                          onChange={(e) => {
                            const boolCh = { ...(child?.booleanChildren ?? {}) } as Record<string, BoolChild[]>;
                            const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                            bArr[bIdx] = { ...(bArr[bIdx] ?? {}), decimals: Number(e.target.value) || 0 };
                            boolCh[branch] = bArr;
                            onUpdate({ booleanChildren: boolCh as any });
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
  );
}

function SingleChildEditor({
  child,
  childIdx,
  branchKey,
  children,
  onChange,
  ...shared
}: SharedProps & {
  child: BoolChild;
  childIdx: number;
  branchKey: "true" | "false";
  children: BoolChild[];
  onChange: (next: BoolChild[]) => void;
}) {
  const onUpdate = (patch: Partial<BoolChild>) => onChange(updateChild(children, childIdx, patch));

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
            onChange={(e) => onUpdate({ label: e.target.value })}
          />
        </div>
        <div className="w-[200px]">
          <Label>Type</Label>
          <select
            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            value={child?.inputType ?? "string"}
            onChange={(e) => {
              const t = e.target.value as InputType;
              onUpdate({
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
            <option value="repeatable">Repeatable (List)</option>
            <option value="formula">Formula</option>
          </select>
        </div>

        <div className="w-[160px]">
          <Label>Default Value</Label>
          <Input
            placeholder="(none)"
            value={String(child?.defaultValue ?? "")}
            onChange={(e) => onUpdate({ defaultValue: e.target.value || undefined })}
          />
          <p className="mt-0.5 text-[10px] text-neutral-400">Auto-filled when this branch is active</p>
        </div>
        {child?.defaultValue && (
          <label className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 self-center pt-5">
            <input
              type="checkbox"
              checked={Boolean(child?.readOnly)}
              onChange={(e) => onUpdate({ readOnly: e.target.checked || undefined })}
            />
            Read-only
          </label>
        )}

        {child?.inputType === "formula" && (
          <div className="col-span-12 mt-2">
            <Label>Formula Expression</Label>
            <Input
              placeholder="e.g. {field_key} * 0.05"
              value={String(child?.formula ?? "")}
              onChange={(e) => onUpdate({ formula: e.target.value })}
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
                onChange={(e) => onUpdate({ currencyCode: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label>Decimal Places</Label>
              <Input
                type="number"
                className="w-28"
                placeholder="2"
                value={String(child?.decimals ?? 2)}
                onChange={(e) => onUpdate({ decimals: Number(e.target.value) || 0 })}
              />
            </div>
          </div>
        )}

        {child?.inputType === "boolean" && (
          <NestedBooleanEditor
            child={child}
            onUpdate={onUpdate}
            branchKey={branchKey as never}
            childIdx={childIdx}
            parentBranchKey={branchKey}
            parentChildren={children}
            onParentChange={onChange}
            allPackages={shared.allPackages}
            crossPkgCategories={shared.crossPkgCategories}
            onLoadCategories={shared.onLoadCategories}
          />
        )}

        {String(child?.inputType ?? "") === "repeatable" && (() => {
          const rep = (child as any)?.repeatable as RepeatableConfig | undefined;
          const repFields = Array.isArray(rep?.fields) ? rep!.fields : [];
          const targetFields = repFields
            .filter((f) => f?.value)
            .map((f) => ({ label: `${f.label ?? f.value} (${f.value})`, value: f.value! }));
          return (
            <>
              <RepeatableEditor
                repeatable={rep}
                onChange={(r) => onUpdate({ repeatable: r } as any)}
              />
              {shared.currentPkg && (
                <div className="mt-2">
                  <EntityPickerConfigEditor
                    value={(child as any)?.entityPicker as EPConfig | undefined}
                    onChange={(ep) => onUpdate({ entityPicker: ep } as any)}
                    currentPkg={shared.currentPkg}
                    targetFields={targetFields.length > 0 ? targetFields : undefined}
                  />
                </div>
              )}
            </>
          );
        })()}

        {child?.inputType && ["select", "multi_select"].includes(child.inputType) && (
          <SelectOptionsEditor
            options={Array.isArray(child?.options) ? child.options : []}
            onChange={(opts) => onUpdate({ options: opts })}
            enableChildren={child.inputType === "select"}
            allPackages={shared.allPackages}
            crossPkgCategories={shared.crossPkgCategories}
            onLoadCategories={shared.onLoadCategories}
            currentPkg={shared.currentPkg}
          />
        )}

        <div className="mt-2 w-full">
          <ShowWhenConfig
            compact
            value={Array.isArray(child?.showWhen) ? child.showWhen : []}
            onChange={(sw) => onUpdate({ showWhen: sw })}
            allPackages={shared.allPackages}
            crossPkgCategories={shared.crossPkgCategories}
            onLoadCategories={shared.onLoadCategories}
          />
        </div>
      </div>
    </div>
  );
}

function BranchEditor({ branchLabel, branchKey, children, onChange, ...shared }: BranchEditorProps) {
  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium">{branchLabel}</div>
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
          <SingleChildEditor
            key={`${branchKey}-${cIdx}`}
            child={child}
            childIdx={cIdx}
            branchKey={branchKey}
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

export type BooleanChildrenEditorProps = SharedProps & {
  booleanChildren: { true?: BoolChild[]; false?: BoolChild[] } | undefined;
  onChange: (next: { true?: BoolChild[]; false?: BoolChild[] }) => void;
  defaultBoolean?: boolean | null;
  onDefaultBooleanChange: (v: boolean | null) => void;
  booleanLabels?: { true?: string; false?: string };
  onBooleanLabelsChange: (v: { true?: string; false?: string }) => void;
  booleanDisplay?: "radio" | "dropdown";
  onBooleanDisplayChange: (v: "radio" | "dropdown") => void;
};

export function BooleanChildrenEditor({
  booleanChildren,
  onChange,
  defaultBoolean,
  onDefaultBooleanChange,
  booleanLabels,
  onBooleanLabelsChange,
  booleanDisplay,
  onBooleanDisplayChange,
  ...shared
}: BooleanChildrenEditorProps) {
  const bc = booleanChildren ?? {};
  const yesChildren: BoolChild[] = Array.isArray(bc.true) ? bc.true : [];
  const noChildren: BoolChild[] = Array.isArray(bc.false) ? bc.false : [];

  return (
    <div className="grid gap-2">
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="mb-2">
          <Label>Default Selection</Label>
          <div className="mt-2 flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="defaultBoolean"
                className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                checked={defaultBoolean === true}
                onChange={() => onDefaultBooleanChange(true)}
              />
              Yes
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="defaultBoolean"
                className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                checked={defaultBoolean === false}
                onChange={() => onDefaultBooleanChange(false)}
              />
              No
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="defaultBoolean"
                className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                checked={defaultBoolean === undefined || defaultBoolean === null}
                onChange={() => onDefaultBooleanChange(null)}
              />
              None
            </label>
          </div>
        </div>
        <div className="grid gap-1">
          <Label>Display</Label>
          <div className="flex items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="booleanDisplay"
                className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                checked={(booleanDisplay ?? "radio") === "radio"}
                onChange={() => onBooleanDisplayChange("radio")}
              />
              Radio buttons
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="booleanDisplay"
                className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                checked={booleanDisplay === "dropdown"}
                onChange={() => onBooleanDisplayChange("dropdown")}
              />
              Dropdown
            </label>
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Labels</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label className="text-xs text-neutral-500 dark:text-neutral-400">Yes label</Label>
              <Input
                placeholder="Yes"
                value={String(booleanLabels?.true ?? "")}
                onChange={(e) =>
                  onBooleanLabelsChange({ ...(booleanLabels ?? {}), true: e.target.value })
                }
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-neutral-500 dark:text-neutral-400">No label</Label>
              <Input
                placeholder="No"
                value={String(booleanLabels?.false ?? "")}
                onChange={(e) =>
                  onBooleanLabelsChange({ ...(booleanLabels ?? {}), false: e.target.value })
                }
              />
            </div>
          </div>
        </div>
        <div className="mt-2 grid gap-2">
          <Label>Children (optional)</Label>
          <BranchEditor
            branchLabel="Yes branch"
            branchKey="true"
            children={yesChildren}
            onChange={(next) => onChange({ ...bc, true: next })}
            allPackages={shared.allPackages}
            crossPkgCategories={shared.crossPkgCategories}
            onLoadCategories={shared.onLoadCategories}
          />
          <BranchEditor
            branchLabel="No branch"
            branchKey="false"
            children={noChildren}
            onChange={(next) => onChange({ ...bc, false: next })}
            allPackages={shared.allPackages}
            crossPkgCategories={shared.crossPkgCategories}
            onLoadCategories={shared.onLoadCategories}
          />
        </div>
      </div>
    </div>
  );
}

export function MetaJsonPreview({ meta }: { meta: Record<string, unknown> | null | undefined }) {
  const [open, setOpen] = React.useState(false);
  if (!meta) return null;
  return (
    <div className="mt-4 rounded-md border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        onClick={() => setOpen((v) => !v)}
      >
        <span>Debug: Field Config JSON</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <pre className="max-h-80 overflow-auto border-t border-neutral-200 p-3 text-[11px] leading-relaxed text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
          {JSON.stringify(meta, null, 2)}
        </pre>
      )}
    </div>
  );
}
