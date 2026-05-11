"use client";

import * as React from "react";
import { useForm, useWatch, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { maskDDMMYYYY } from "@/lib/format/date";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Radix RadioGroup is available, but insured radios use native inputs for consistent styling
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/ui/form-field";
import { VehicleStep } from "@/components/policies/vehicle-step";
import { PolicyStep } from "@/components/policies/policy-step";
import { AddressTool } from "@/components/policies/address-tool";
import { PackageBlock } from "@/components/policies/PackageBlock";
import { InsuredStep } from "@/components/policies/InsuredStep";
import { buildInsuredDynamicSchema } from "@/lib/validation/insured";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { X, UserPlus, UserSearch, ArrowRight, Check, Loader2, Save } from "lucide-react";
import { extractDisplayName } from "@/lib/import/entity-display-name";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BooleanBranchFields } from "@/components/policies/InlineSelectWithChildren";

type WizardState = {
  step: number;
  insured?: Record<string, unknown>;
  vehicle?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  highestCompletedStep: number;
};

import type { SelectOption, RepeatableFieldConfig, RepeatableConfig } from "@/lib/types/form";
function getRepeatable(raw: unknown): RepeatableConfig {
  if (Array.isArray(raw)) {
    const first = raw[0];
    return (typeof first === "object" && first !== null ? (first as RepeatableConfig) : {}) as RepeatableConfig;
  }
  return (typeof raw === "object" && raw !== null ? (raw as RepeatableConfig) : {}) as RepeatableConfig;
}

/**
 * Boolean Yes/No radio pair bound to RHF.
 *
 * RHF's auto-`checked` matching for radios uses `radio.value === stateValue`
 * with strict equality. Because `setValueAs` coerces clicks into a boolean
 * (and pre-filled values from `extraAttributes` are also booleans),
 * `"true" === true` is `false` and the radios would render unselected on
 * re-load even when the value was actually saved correctly. Driving
 * `checked` explicitly from form state via `String(curr) === "true"`
 * works for both string and boolean state shapes.
 */
function BooleanRadioPair({
  form,
  name,
  yesLabel = "Yes",
  noLabel = "No",
  required,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  yesLabel?: string;
  noLabel?: string;
  required?: boolean;
}) {
  const curr = useWatch({ control: form.control, name: name as string });
  const isYes = String(curr ?? "") === "true";
  const isNo = String(curr ?? "") === "false";
  return (
    <div className="flex items-center gap-6">
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="radio"
          className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
          value="true"
          checked={isYes}
          {...form.register(name as never, {
            required: Boolean(required),
            setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v),
          })}
        />
        {yesLabel}
      </label>
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="radio"
          className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
          value="false"
          checked={isNo}
          {...form.register(name as never, {
            required: Boolean(required),
            setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v),
          })}
        />
        {noLabel}
      </label>
    </div>
  );
}

function applyLabelCase(text: string, mode?: "original" | "upper" | "lower" | "title"): string {
  if (!mode || mode === "original") return text;
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title") return text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

// Memoized inline select with children to avoid remounts and reduce UI flicker
const InlineSelectWithChildrenMemo = React.memo(function InlineSelectWithChildrenMemo({
  form,
  nameBase,
  label,
  required,
  options,
  displayMode = "radio",
}: {
  form: UseFormReturn<Record<string, unknown>>;
  nameBase: string;
  label: string;
  required?: boolean;
  options: { label?: string; value?: string; children?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; booleanChildren?: { true?: any[]; false?: any[] } }[] }[];
  displayMode?: "dropdown" | "radio";
}) {
  const current = useWatch({ control: form.control, name: nameBase as string }) as string | undefined;
  const nodes: React.ReactNode[] = [];
  nodes.push(
    <div key={`${nameBase}__field`} className="space-y-2">
      <div className="space-y-1">
        <Label>
          {label} {required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
        </Label>
        {displayMode === "dropdown" ? (
          <select
            className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            {...form.register(nameBase as never, { required: Boolean(required) })}
            defaultValue={current ?? ""}
          >
            <option value="">-- Select --</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap gap-4">
            {options.map((o) => (
              <label key={o.value} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                  value={o.value}
                  {...form.register(nameBase as never, { required: Boolean(required) })}
                />
                {o.label}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  const match = options.find((o) => o.value === current);
  const children = Array.isArray(match?.children) ? match?.children ?? [] : [];
  if (children.length > 0) {
    children.forEach((child, cIdx) => {
      const cType = child?.inputType ?? "string";
      const cIsNum = cType === "number";
      const cIsDate = cType === "date";
      const name = `${nameBase}__opt_${current ?? "none"}__c${cIdx}`;
      const regOpts: Record<string, unknown> = {};
      if (cIsNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
      if (cIsDate) {
        regOpts.validate = (v: unknown) => {
          if (v === undefined || v === null || v === "") return true;
          return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
        };
        regOpts.onChange = (e: unknown) => {
          const t = e as { target?: { value?: string } };
          const formatted = maskDDMMYYYY(t?.target?.value ?? "");
          form.setValue(name as never, formatted as never, { shouldDirty: true });
        };
      }
      if (cType === "boolean") {
        const yesLabel = String(child?.booleanLabels?.true ?? "").trim() || "Yes";
        const noLabel = String(child?.booleanLabels?.false ?? "").trim() || "No";
        const boolDisplay = child?.booleanDisplay ?? "radio";
        if (boolDisplay === "dropdown") {
          nodes.push(
            <div key={name} className="space-y-1">
              <Label>{child?.label ?? "Details"}</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                {...form.register(name as never, {
                  setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v),
                })}
              >
                <option value="">Select...</option>
                <option value="true">{yesLabel}</option>
                <option value="false">{noLabel}</option>
              </select>
              <BooleanBranchFields form={form} name={name} booleanChildren={child?.booleanChildren} />
            </div>
          );
        } else {
          nodes.push(
            <div key={name} className="space-y-1">
              <Label>{child?.label ?? "Details"}</Label>
              <div className="flex items-center gap-6">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                    value="true"
                    {...form.register(name as never, {
                      setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v),
                    })}
                  />
                  {yesLabel}
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                    value="false"
                    {...form.register(name as never, {
                      setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v),
                    })}
                  />
                  {noLabel}
                </label>
              </div>
              <BooleanBranchFields form={form} name={name} booleanChildren={child?.booleanChildren} />
            </div>
          );
        }
        return;
      }
      if (cType === "select") {
        const opts = (Array.isArray(child?.options) ? child?.options ?? [] : []) as {
          label?: string;
          value?: string;
        }[];
        nodes.push(
          <div key={name} className="space-y-1">
            <Label>{child?.label ?? "Details"}</Label>
            <select
              className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
              {...form.register(name as never)}
            >
              <option value="">-- Select --</option>
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        );
        return;
      }
      if (cType === "multi_select") {
        const opts = (Array.isArray(child?.options) ? child?.options ?? [] : []) as {
          label?: string;
          value?: string;
        }[];
        const _msRaw284 = form.watch(name as never) as unknown;
        const _msCur284: unknown[] = Array.isArray(_msRaw284) ? _msRaw284 : typeof _msRaw284 === "string" && _msRaw284 ? [_msRaw284] : [];
        nodes.push(
          <div key={name} className="space-y-1">
            <Label>{child?.label ?? "Details"}</Label>
            <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
              {opts.map((o) => {
                const _isChk = _msCur284.includes(o.value as unknown);
                return (
                  <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      value={o.value}
                      checked={_isChk}
                      onChange={(e) => {
                        const optVal = o.value as string;
                        const next = e.target.checked ? [..._msCur284.filter((v) => v !== optVal), optVal] : _msCur284.filter((v) => v !== optVal);
                        form.setValue(name as never, next as never, { shouldDirty: true });
                      }}
                    />
                    {o.label}
                  </label>
                );
              })}
              {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
            </div>
          </div>
        );
        return;
      }
      if (cType === "currency" || cType === "negative_currency") {
        const cc = String((child as any)?.currencyCode ?? "").trim();
        const dec = Number((child as any)?.decimals ?? 2);
        const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
        nodes.push(
          <div key={name} className="min-w-[220px] flex-1 space-y-1">
            <Label>{child?.label ?? "Details"}</Label>
            <div className="flex items-center gap-2">
              {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
              <Input type="number" step={step} placeholder="0.00" {...form.register(name as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
            </div>
          </div>
        );
        return;
      }
      nodes.push(
        <div key={name} className="min-w-[220px] flex-1">
          <Field
            label={child?.label ?? "Details"}
            required={false}
            type={cIsNum ? "number" : cIsDate ? "text" : "text"}
            placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
            inputMode={cIsDate ? "numeric" : undefined}
            {...form.register(name as never, regOpts)}
          />
        </div>
      );
    });
  }
  return <>{nodes}</>;
});

// Memoized package block to avoid remounts on unrelated state changes
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PackageBlockMemo = React.memo(function PackageBlockMemo({
  form,
  pkg,
  allowedCategories,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  pkg: string;
  allowedCategories?: string[] | undefined;
}) {
  const [categories, setCategories] = React.useState<{ label: string; value: string; meta?: { labelCase?: "original" | "upper" | "lower" | "title" } | null }[]>([]);
  const catFieldName = `${pkg}__category`;
  React.useEffect(() => {
    let cancelled = false;
    async function loadCats() {
      try {
        const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_category`)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string; meta?: { labelCase?: "original" | "upper" | "lower" | "title" } | null }[];
        const all = Array.isArray(data) ? data : [];
        const filtered =
          Array.isArray(allowedCategories) && allowedCategories.length > 0 ? all.filter((c) => allowedCategories.includes(c.value)) : all;
        if (!cancelled) {
          setCategories(filtered);
          const current = (form.getValues() as Record<string, unknown>)[catFieldName] as string | undefined;
          const hasCurrent = filtered.some((c) => c.value === current);
          if (!hasCurrent && filtered.length > 0) {
            form.setValue(catFieldName as never, filtered[0].value as never);
          }
        }
      } catch {
        if (!cancelled) setCategories([]);
      }
    }
    void loadCats();
    return () => {
      cancelled = true;
    };
  }, [pkg, allowedCategories, catFieldName, form]);

  const selectedCategory = String((useWatch({ control: form.control, name: catFieldName as string }) as string | undefined) ?? "");
  const allFormValues = useWatch({ control: form.control }) as Record<string, unknown>;
  const [pkgFields, setPkgFields] = React.useState<
    { label: string; value: string; valueType: string; sortOrder: number; meta?: unknown }[]
  >([]);
  React.useEffect(() => {
    let cancelled = false;
    async function loadFields() {
      try {
        type OptRow = { label: string; value: string; valueType: string; sortOrder: number; meta?: unknown };
        const asRows = (u: unknown): OptRow[] => (Array.isArray(u) ? (u as OptRow[]).filter(Boolean) : []);
        const dedupeByValue = (rows: OptRow[]): OptRow[] => {
          const seen = new Set<string>();
          const out: OptRow[] = [];
          for (const r of rows) {
            const k = String(r?.value ?? "").trim().toLowerCase();
            if (!k) continue;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(r);
          }
          return out;
        };

        // Try primary group first; for vehicle-like packages, also merge common legacy aliases
        const primaryKey = `${pkg}_fields`;
        const primaryRes = await fetch(`/api/form-options?groupKey=${encodeURIComponent(primaryKey)}`, { cache: "no-store" });
        const primaryJson = (await primaryRes.json()) as unknown;
        let merged = asRows(primaryJson);

        const pkgLower = String(pkg ?? "").toLowerCase();
        const isVehicleLike = /\bvehicle\b/.test(pkgLower) || ["vehicle", "vehicleinfo", "auto", "car"].includes(pkgLower);
        if (isVehicleLike) {
          // Historically, vehicle fields have lived under multiple group keys.
          // Merge them so new fields (e.g. added to `vehicle_fields`) still render even if `vehicleinfo_fields` is non-empty.
          const extras = ["vehicleinfo_fields", "vehicle_fields"].filter((k) => k !== primaryKey);
          for (const fb of extras) {
            try {
              const r = await fetch(`/api/form-options?groupKey=${encodeURIComponent(fb)}`, { cache: "no-store" });
              const j = (await r.json()) as unknown;
              merged = merged.concat(asRows(j));
            } catch {
              // ignore and try next
            }
          }
        }

        const finalRows = dedupeByValue(merged);
        if (!cancelled) setPkgFields(finalRows);
      } catch {
        if (!cancelled) setPkgFields([]);
      }
    }
    void loadFields();
    return () => {
      cancelled = true;
    };
  }, [pkg]);

  // Apply default selections for multi_select package fields when they first load
  React.useEffect(() => {
    if (!Array.isArray(pkgFields) || pkgFields.length === 0) return;
    for (const f of pkgFields) {
      const meta = (f.meta ?? {}) as Record<string, unknown>;
      if (meta.inputType !== "multi_select") continue;
      const opts = Array.isArray(meta.options) ? (meta.options as { value?: string; default?: boolean }[]) : [];
      const defaultVals = opts.filter((o) => o.default).map((o) => o.value).filter(Boolean) as string[];
      if (defaultVals.length === 0) continue;
      const nameBase = `${pkg}__${f.value}`;
      const curr = (form.getValues() as Record<string, unknown>)[nameBase];
      if (curr === undefined || curr === null || (Array.isArray(curr) && (curr as unknown[]).length === 0)) {
        form.setValue(nameBase as never, defaultVals as never, { shouldDirty: false });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkgFields]);

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-6">
          {categories.map((opt) => (
            <label key={opt.value} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                className="appearance-none h-3.5 w-3.5 rounded-full border border-neutral-400 bg-transparent checked:bg-neutral-900 dark:checked:bg-white checked:border-white dark:checked:border-black focus-visible:outline-none focus-visible:ring-0"
                value={opt.value}
                checked={selectedCategory === opt.value}
                onChange={(e) => form.setValue(catFieldName as never, e.target.value as never)}
              />
              {applyLabelCase(opt.label, opt.meta?.labelCase ?? "original")}
            </label>
          ))}
          {categories.length === 0 ? null : null}
        </div>
      </div>
      {/* Grouped fields by meta.group with group-level sorting */}
      <div className="space-y-6">
        {(() => {
          const visible = pkgFields.filter((f) => {
            const meta = (f.meta ?? {}) as {
              inputType?: string;
              required?: boolean;
              categories?: string[];
              options?: { label?: string; value?: string }[];
              booleanChildren?: {
                true?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                false?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
              };
              group?: string;
              groupOrder?: number;
              showWhen?: { package: string; category: string | string[] } | { package: string; category: string | string[] }[];
            };
            const cats = (meta.categories ?? []) as string[];
            if (cats.length > 0 && !cats.includes(selectedCategory as string)) return false;

            if (meta.showWhen) {
              const rules = Array.isArray(meta.showWhen) ? meta.showWhen : [meta.showWhen];
              const pass = rules.every((rule) => {
                const otherPkg = String(rule.package ?? "").trim();
                if (!otherPkg) return true;
                const otherCatKey = `${otherPkg}__category`;
                const otherCatVal = String(allFormValues[otherCatKey] ?? "").trim().toLowerCase();
                const allowed = (Array.isArray(rule.category) ? rule.category : [rule.category])
                  .map((c) => String(c ?? "").trim().toLowerCase())
                  .filter(Boolean);
                return allowed.length === 0 || allowed.includes(otherCatVal);
              });
              if (!pass) return false;
            }

            return true;
          });
          const groupMap = new Map<string, { fields: typeof visible; order: number }>();
          for (const f of visible) {
            const meta = (f.meta ?? {}) as { group?: string; groupOrder?: number };
            const key = meta?.group ?? "";
            const order = typeof meta?.groupOrder === "number" ? meta.groupOrder : 0;
            if (!groupMap.has(key)) groupMap.set(key, { fields: [], order });
            const bucket = groupMap.get(key)!;
            bucket.fields.push(f);
            // keep the minimum order among fields in the same group
            if (typeof meta?.groupOrder === "number") {
              bucket.order = Math.min(bucket.order, meta.groupOrder);
            }
          }
          const entries = Array.from(groupMap.entries()).sort((a, b) => a[1].order - b[1].order);
          return entries.map(([groupLabel, bucket]) => (
            <div key={groupLabel || "default"} className="space-y-2">
              {groupLabel ? (
                <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{groupLabel}</div>
              ) : null}
              <div className="grid grid-cols-2 gap-4">
                {[...bucket.fields]
                  .sort((a, b) => {
                    const ao = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
                    const bo = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
                    if (ao !== bo) return ao - bo;
                    const al = String(a.label ?? "").toLowerCase();
                    const bl = String(b.label ?? "").toLowerCase();
                    if (al !== bl) return al.localeCompare(bl);
                    return String(a.value ?? "").toLowerCase().localeCompare(String(b.value ?? "").toLowerCase());
                  })
                  .map((f) => {
                  const meta = (f.meta ?? {}) as {
                    inputType?: string;
                    required?: boolean;
                    categories?: string[];
                    options?: { label?: string; value?: string }[];
                    booleanChildren?: {
                      true?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                      false?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                    };
                    selectDisplay?: "dropdown" | "radio";
                    repeatable?: RepeatableConfig | RepeatableConfig[];
                    booleanLabels?: { true?: string; false?: string };
                    booleanDisplay?: "radio" | "dropdown";
                    labelCase?: "original" | "upper" | "lower" | "title";
                  };
                  const displayLabel = applyLabelCase(f.label, meta.labelCase);
                  const inputType = meta.inputType ?? "string";
                  const isCurrency = inputType === "currency" || inputType === "negative_currency";
                  const isPercent = inputType === "percent";
                  const isNumber = inputType === "number" || isCurrency || isPercent;
                  const isDate = inputType === "date";
                  const nameBase = `${pkg}__${f.value}`;
                  // Repeatable (list) support
                  if (inputType === "repeatable" || typeof meta.repeatable !== "undefined") {
                    const rep = getRepeatable(meta.repeatable);
                    const itemLabel = String(rep.itemLabel ?? "Item");
                    const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
                    const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
                    const childFields = Array.isArray(rep.fields) ? (rep.fields ?? []) : [];
                    const current = (form.watch(nameBase as never) as unknown[] | undefined) ?? [];
                    const items = Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
                    const canAdd = max <= 0 || items.length < max;
                    const canRemove = (idx: number) => items.length > Math.max(1, min) - 0 && idx >= 0;
                    const addItem = () => {
                      const next = [...items, {}];
                      form.setValue(nameBase as never, next as never, { shouldDirty: true });
                    };
                    const removeItem = (idx: number) => {
                      if (!canRemove(idx)) return;
                      const next = items.filter((_, i) => i !== idx);
                      form.setValue(nameBase as never, next as never, { shouldDirty: true });
                    };
                    return (
                      <div key={nameBase} className="col-span-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>
                            {displayLabel} {Boolean(meta.required) ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                          </Label>
                          <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!canAdd}>
                            Add {itemLabel}
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {(items.length === 0 ? Array.from({ length: Math.max(0, min) }) : items).map((_, idx) => {
                            const baseRowKey = `${nameBase}__row__${idx}`;
                            return (
                              <div key={baseRowKey} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                                <div className="mb-2 flex items-center justify-between">
                                  <div className="text-xs font-medium">
                                    {itemLabel} #{idx + 1}
                                  </div>
                                  <Button type="button" size="sm" variant="outline" onClick={() => removeItem(idx)} disabled={!canRemove(idx)}>
                                    Remove
                                  </Button>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  {childFields.map((cf, cIdx) => {
                                    const cType = String(cf?.inputType ?? "string").trim().toLowerCase();
                                    const childName = `${nameBase}.${idx}.${cf?.value ?? `c${cIdx}`}`;
                                    if (cType === "select") {
                                      const opts = (Array.isArray(cf.options) ? cf.options : []) as { label?: string; value?: string }[];
                                      return (
                                        <div key={`${childName}__sel`} className="space-y-1">
                                          <Label>{cf.label ?? "Select"}</Label>
                                          <select
                                            className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                            {...form.register(childName as never)}
                                          >
                                            <option value="">-- Select --</option>
                                            {opts.map((o) => (
                                              <option key={o.value} value={o.value}>
                                                {o.label}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      );
                                    }
                                    if (cType === "multi_select") {
                                      const opts = (Array.isArray(cf.options) ? cf.options : []) as { label?: string; value?: string }[];
                                      const _msCnRaw = form.watch(childName as never) as unknown;
                                      const _msCnCur: unknown[] = Array.isArray(_msCnRaw) ? _msCnRaw : typeof _msCnRaw === "string" && _msCnRaw ? [_msCnRaw] : [];
                                      return (
                                        <div key={`${childName}__ms`} className="space-y-1">
                                          <Label>{cf.label ?? "Select"}</Label>
                                          <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                            {opts.map((o) => {
                                              const _cnChk = _msCnCur.includes(o.value as unknown);
                                              return (
                                                <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                  <input
                                                    type="checkbox"
                                                    value={o.value}
                                                    checked={_cnChk}
                                                    onChange={(e) => {
                                                      const optVal = o.value as string;
                                                      const next = e.target.checked ? [..._msCnCur.filter((v) => v !== optVal), optVal] : _msCnCur.filter((v) => v !== optVal);
                                                      form.setValue(childName as never, next as never, { shouldDirty: true });
                                                    }}
                                                  />
                                                  {o.label}
                                                </label>
                                              );
                                            })}
                                            {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                          </div>
                                        </div>
                                      );
                                    }
                                    if (cType === "currency" || cType === "negative_currency") {
                                      const cc = String((cf as any)?.currencyCode ?? "").trim();
                                      const dec = Number((cf as any)?.decimals ?? 2);
                                      const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                      return (
                                        <div key={`${childName}__cur`} className="space-y-1">
                                          <Label>{cf.label ?? "Value"}</Label>
                                          <div className="flex items-center gap-2">
                                            {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                            <Input type="number" step={step} placeholder="0.00" {...form.register(childName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                          </div>
                                        </div>
                                      );
                                    }
                                    const regOpts: Record<string, unknown> = {};
                                    if (cType === "number") {
                                      regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                                    }
                                    if (cType === "date") {
                                      regOpts.validate = (v: unknown) => {
                                        if (v === undefined || v === null || v === "") return true;
                                        return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                      };
                                      regOpts.onChange = (e: unknown) => {
                                        const t = e as { target?: { value?: string } };
                                        const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                        form.setValue(childName as never, formatted as never, { shouldDirty: true });
                                      };
                                    }
                                    return (
                                      <div key={`${childName}__fld`} className="space-y-1">
                                        <Label>{cf.label ?? "Value"}</Label>
                                        <Input
                                          type={cType === "number" ? "number" : cType === "date" ? "text" : "text"}
                                          placeholder={cType === "date" ? "DD-MM-YYYY" : undefined}
                                          inputMode={cType === "date" ? "numeric" : undefined}
                                          {...form.register(childName as never, regOpts)}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  if (inputType === "select") {
                    const options = (Array.isArray(meta.options) ? (meta.options as unknown[]) : []) as {
                      label?: string;
                      value?: string;
                      children?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; booleanChildren?: { true?: any[]; false?: any[] } }[];
                    }[];
                    return (
                      <InlineSelectWithChildrenMemo
                        key={nameBase}
                        form={form}
                        nameBase={nameBase}
                        label={displayLabel}
                        required={Boolean(meta.required)}
                        options={options}
                        displayMode={(meta?.selectDisplay ?? "dropdown") === "dropdown" ? "dropdown" : "radio"}

                      />
                    );
                  }
                  if (inputType === "multi_select") {
                    const options = (Array.isArray(meta.options) ? (meta.options as unknown[]) : []) as {
                      label?: string;
                      value?: string;
                      children?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; booleanChildren?: { true?: any[]; false?: any[] } }[];
                    }[];
                    const current = (form.watch(nameBase as never) as string[] | undefined) ?? [];
                    return (
                      <div key={nameBase} className="space-y-2">
                        <div className="space-y-1">
                          <Label>
                            {displayLabel} {meta.required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                          </Label>
                          <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                            {options.map((o) => (
                              <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  value={o.value}
                                  {...form.register(nameBase as never, {
                                    validate: (v) =>
                                      !Boolean(meta.required) ||
                                      (Array.isArray(v) && (v as unknown[]).length > 0) ||
                                      `${displayLabel} is required`,
                                  })}
                                />
                                {o.label}
                              </label>
                            ))}
                            {options.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                          </div>
                        </div>
                        {(() => {
                          const childrenTuples =
                            options
                              .filter((o) => (current as unknown[]).includes(o.value as unknown))
                              .map((o) => ({ opt: o, children: Array.isArray(o.children) ? (o.children ?? []) : [] })) ?? [];
                          if (childrenTuples.length === 0) return null;
                          return (
                            <div className="grid grid-cols-2 gap-4">
                              {childrenTuples.flatMap(({ opt, children }) =>
                                children.map((child, cIdx) => {
                                  const cType = child?.inputType ?? "string";
                                  const cIsNum = cType === "number";
                                  const cIsDate = cType === "date";
                                  const name = `${nameBase}__opt_${opt.value}__c${cIdx}`;
                                  const regOpts: Record<string, unknown> = {};
                                  if (cIsNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                                  if (cIsDate) {
                                    regOpts.validate = (v: unknown) => {
                                      if (v === undefined || v === null || v === "") return true;
                                      return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                    };
                                    regOpts.onChange = (e: unknown) => {
                                      const t = e as { target?: { value?: string } };
                                      const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                      form.setValue(name as never, formatted as never, { shouldDirty: true });
                                    };
                                  }
                                  if (cType === "select") {
                                    const opts = (Array.isArray(child?.options) ? child?.options ?? [] : []) as {
                                      label?: string;
                                      value?: string;
                                    }[];
                                    return (
                                      <div key={name} className="space-y-1">
                                        <Label>{child?.label ?? "Details"}</Label>
                                        <select
                                          className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                          {...form.register(name as never)}
                                        >
                                          <option value="">-- Select --</option>
                                          {opts.map((o) => (
                                            <option key={o.value} value={o.value}>
                                              {o.label}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    );
                                  }
                                  if (cType === "multi_select") {
                                    const opts = (Array.isArray(child?.options) ? child?.options ?? [] : []) as {
                                      label?: string;
                                      value?: string;
                                    }[];
                                    const _msNRaw = form.watch(name as never) as unknown;
                                    const _msNCur: unknown[] = Array.isArray(_msNRaw) ? _msNRaw : typeof _msNRaw === "string" && _msNRaw ? [_msNRaw] : [];
                                    return (
                                      <div key={name} className="space-y-1">
                                        <Label>{child?.label ?? "Details"}</Label>
                                        <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                          {opts.map((o) => {
                                            const _nChk = _msNCur.includes(o.value as unknown);
                                            return (
                                              <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                <input
                                                  type="checkbox"
                                                  value={o.value}
                                                  checked={_nChk}
                                                  onChange={(e) => {
                                                    const optVal = o.value as string;
                                                    const next = e.target.checked ? [..._msNCur.filter((v) => v !== optVal), optVal] : _msNCur.filter((v) => v !== optVal);
                                                    form.setValue(name as never, next as never, { shouldDirty: true });
                                                  }}
                                                />
                                                {o.label}
                                              </label>
                                            );
                                          })}
                                          {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                        </div>
                                      </div>
                                    );
                                  }
                                  if (cType === "currency" || cType === "negative_currency") {
                                    const cc = String((child as any)?.currencyCode ?? "").trim();
                                    const dec = Number((child as any)?.decimals ?? 2);
                                    const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                    return (
                                      <div key={name} className="space-y-1">
                                        <Label>{child?.label ?? "Details"}</Label>
                                        <div className="flex items-center gap-2">
                                          {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                          <Input type="number" step={step} placeholder="0.00" {...form.register(name as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                        </div>
                                      </div>
                                    );
                                  }
                                  return (
                                    <Field
                                      key={name}
                                      label={child?.label ?? "Details"}
                                      required={false}
                                      type={cIsNum ? "number" : cIsDate ? "text" : "text"}
                                      placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
                                      inputMode={cIsDate ? "numeric" : undefined}
                                      {...form.register(name as never, regOpts)}
                                    />
                                  );
                                }),
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  }
                  if (inputType === "boolean") {
                    const yesChildren = (Array.isArray(meta.booleanChildren?.true)
                      ? (meta.booleanChildren?.true as unknown[])
                      : []) as { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                    const noChildren = (Array.isArray(meta.booleanChildren?.false)
                      ? (meta.booleanChildren?.false as unknown[])
                      : []) as { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                    const curr = form.watch(nameBase as never);
                    const isYes = String(curr) === "true";
                    const trueLabel = String((meta?.booleanLabels?.true ?? "Yes"));
                    const falseLabel = String((meta?.booleanLabels?.false ?? "No"));
                    return (
                      <div key={nameBase} className="col-span-2 space-y-2">
                        <div className="space-y-1">
                          <Label>
                            {displayLabel} {meta.required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                          </Label>
                          {(meta?.booleanDisplay ?? "radio") === "dropdown" ? (
                            <select
                              className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                              {...form.register(nameBase as never, {
                                required: Boolean(meta.required),
                                setValueAs: (v) => (v === "" ? undefined : v === "true" ? true : v === "false" ? false : v),
                              })}
                              defaultValue=""
                            >
                              <option value="">-- Select --</option>
                              <option value="true">{trueLabel}</option>
                              <option value="false">{falseLabel}</option>
                            </select>
                          ) : (
                            <div className="flex items-center gap-6">
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="radio"
                                  className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                                  value="true"
                                  {...form.register(nameBase as never, {
                                    required: Boolean(meta.required),
                                    setValueAs: (v) => (v === "true" ? true : v === "false" ? false : v),
                                  })}
                                />
                                {trueLabel}
                              </label>
                              <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="radio"
                                  className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                                  value="false"
                                  {...form.register(nameBase as never, {
                                    required: Boolean(meta.required),
                                    setValueAs: (v) => (v === "true" ? true : v === "false" ? false : v),
                                  })}
                                />
                                {falseLabel}
                              </label>
                            </div>
                          )}
                        </div>
                        {isYes && yesChildren.length > 0 ? (
                          <div className="grid grid-cols-2 gap-4">
                            {yesChildren.map((child: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; booleanChildren?: { true?: any[]; false?: any[] } }, cIdx: number) => {
                              const name = `${nameBase}__true__c${cIdx}`;
                              const cType = child?.inputType ?? "string";
                              if (cType === "boolean") {
                                const yesL = String(child?.booleanLabels?.true ?? "").trim() || "Yes";
                                const noL = String(child?.booleanLabels?.false ?? "").trim() || "No";
                                const bDisp = child?.booleanDisplay ?? "radio";
                                const boolCh = child?.booleanChildren as { true?: any[]; false?: any[] } | undefined;
                                if (bDisp === "dropdown") {
                                  return (
                                    <div key={name} className="space-y-1">
                                      <Label>{child?.label ?? "Details"}</Label>
                                      <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" {...form.register(name as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })}>
                                        <option value="">Select...</option>
                                        <option value="true">{yesL}</option>
                                        <option value="false">{noL}</option>
                                      </select>
                                      <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                                    </div>
                                  );
                                }
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <BooleanRadioPair form={form} name={name} yesLabel={yesL} noLabel={noL} />
                                    <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                                  </div>
                                );
                              }
                              const isRepeatableChild =
                                String(cType).trim().toLowerCase() === "repeatable" ||
                                String(cType).toLowerCase().includes("repeat") ||
                                Boolean((child as { repeatable?: RepeatableConfig | RepeatableConfig[] } | undefined)?.repeatable);
                              if (isRepeatableChild) {
                                const rep = getRepeatable(
                                  (child as { repeatable?: RepeatableConfig | RepeatableConfig[] } | undefined)?.repeatable
                                );
                                const itemLabel = String(rep.itemLabel ?? "Item");
                                const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
                                const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
                                const childFields = Array.isArray(rep.fields) ? (rep.fields ?? []) : [];
                                const current = (form.watch(name as never) as unknown[] | undefined) ?? [];
                                const items = Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
                                const canAdd = max <= 0 || items.length < max;
                                const canRemove = (idx: number) => items.length > Math.max(1, min) - 0 && idx >= 0;
                                const addItem = () => {
                                  const next = [...items, {}];
                                  form.setValue(name as never, next as never, { shouldDirty: true });
                                };
                                const removeItem = (idx: number) => {
                                  if (!canRemove(idx)) return;
                                  const next = items.filter((_, i) => i !== idx);
                                  form.setValue(name as never, next as never, { shouldDirty: true });
                                };
                                return (
                                  <div key={`${name}__rep`} className="col-span-2 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <Label>{child?.label ?? itemLabel}</Label>
                                      <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!canAdd}>
                                        Add {itemLabel}
                                      </Button>
                                    </div>
                                    <div className="space-y-2">
                                      {(items.length === 0 ? [] : items).map((_, rIdx) => {
                                        const baseRowKey = `${name}__row__${rIdx}`;
                                        return (
                                          <div key={baseRowKey} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                                            <div className="mb-2 flex items-center justify-between">
                                              <div className="text-xs font-medium">
                                                {itemLabel} #{rIdx + 1}
                                              </div>
                                              <Button type="button" size="sm" variant="outline" onClick={() => removeItem(rIdx)} disabled={!canRemove(rIdx)}>
                                                Remove
                                              </Button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                              {childFields.map((cf, ccIdx) => {
                                                const ccType = String(cf?.inputType ?? "string").trim().toLowerCase();
                                                const childName = `${name}.${rIdx}.${cf?.value ?? `c${ccIdx}`}`;
                                                if (ccType === "select") {
                                                  const cfOptsSel =
                                                    (cf as { options?: { label?: string; value?: string }[] } | undefined)?.options ?? [];
                                                  const opts = (Array.isArray(cfOptsSel) ? cfOptsSel : []) as { label?: string; value?: string }[];
                                                  return (
                                                    <div key={`${childName}__sel`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Select"}</Label>
                                                      <select
                                                        className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                                        {...form.register(childName as never)}
                                                      >
                                                        <option value="">-- Select --</option>
                                                        {opts.map((o) => (
                                                          <option key={o.value} value={o.value}>
                                                            {o.label}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </div>
                                                  );
                                                }
                                                if (ccType === "multi_select") {
                                                  const cfOptsMs =
                                                    (cf as { options?: { label?: string; value?: string }[] } | undefined)?.options ?? [];
                                                  const opts = (Array.isArray(cfOptsMs) ? cfOptsMs : []) as { label?: string; value?: string }[];
                                                  const _msCcRaw = form.watch(childName as never) as unknown;
                                                  const _msCcCur: unknown[] = Array.isArray(_msCcRaw) ? _msCcRaw : typeof _msCcRaw === "string" && _msCcRaw ? [_msCcRaw] : [];
                                                  return (
                                                    <div key={`${childName}__ms`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Select"}</Label>
                                                      <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                                        {opts.map((o) => {
                                                          const _ccChk = _msCcCur.includes(o.value as unknown);
                                                          return (
                                                            <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                              <input
                                                                type="checkbox"
                                                                value={o.value}
                                                                checked={_ccChk}
                                                                onChange={(e) => {
                                                                  const optVal = o.value as string;
                                                                  const next = e.target.checked ? [..._msCcCur.filter((v) => v !== optVal), optVal] : _msCcCur.filter((v) => v !== optVal);
                                                                  form.setValue(childName as never, next as never, { shouldDirty: true });
                                                                }}
                                                              />
                                                              {o.label}
                                                            </label>
                                                          );
                                                        })}
                                                        {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                                      </div>
                                                    </div>
                                                  );
                                                }
                                                if (ccType === "currency" || ccType === "negative_currency") {
                                                  const cc = String((cf as any)?.currencyCode ?? "").trim();
                                                  const dec = Number((cf as any)?.decimals ?? 2);
                                                  const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                                  return (
                                                    <div key={`${childName}__cur`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Value"}</Label>
                                                      <div className="flex items-center gap-2">
                                                        {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                                        <Input type="number" step={step} placeholder="0.00" {...form.register(childName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                                      </div>
                                                    </div>
                                                  );
                                                }
                                                const regChildOpts: Record<string, unknown> = {};
                                                if (ccType === "number") regChildOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                                                if (ccType === "date") {
                                                  regChildOpts.validate = (v: unknown) => {
                                                    if (v === undefined || v === null || v === "") return true;
                                                    return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                                  };
                                                  regChildOpts.onChange = (e: unknown) => {
                                                    const t = e as { target?: { value?: string } };
                                                    const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                                    form.setValue(childName as never, formatted as never, { shouldDirty: true });
                                                  };
                                                }
                                                return (
                                                  <div key={`${childName}__fld`} className="space-y-1">
                                                    <Label>{cf?.label ?? "Value"}</Label>
                                                    <Input
                                                      type={ccType === "number" ? "number" : ccType === "date" ? "text" : "text"}
                                                      placeholder={ccType === "date" ? "DD-MM-YYYY" : undefined}
                                                      inputMode={ccType === "date" ? "numeric" : undefined}
                                                      {...form.register(childName as never, regChildOpts)}
                                                    />
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              }
                              if (cType === "currency" || cType === "negative_currency") {
                                const cc = String((child as any)?.currencyCode ?? "").trim();
                                const dec = Number((child as any)?.decimals ?? 2);
                                const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <div className="flex items-center gap-2">
                                      {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                      <Input type="number" step={step} placeholder="0.00" {...form.register(name as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                    </div>
                                  </div>
                                );
                              }
                              const cIsNum = cType === "number";
                              const cIsDate = cType === "date";
                              const regOpts: Record<string, unknown> = {};
                              if (cIsNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                              if (cIsDate) {
                                regOpts.validate = (v: unknown) => {
                                  if (v === undefined || v === null || v === "") return true;
                                  return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                };
                                regOpts.onChange = (e: unknown) => {
                                  const t = e as { target?: { value?: string } };
                                  const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                  form.setValue(name as never, formatted as never, { shouldDirty: true });
                                };
                              }
                              return (
                                <div key={name}>
                                  <Field
                                    label={child?.label ?? "Details"}
                                    required={false}
                                    type={cIsNum ? "number" : cIsDate ? "text" : "text"}
                                    placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
                                    inputMode={cIsDate ? "numeric" : undefined}
                                    {...form.register(name as never, regOpts)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {!isYes && noChildren.length > 0 ? (
                          <div className="grid grid-cols-2 gap-4">
                            {noChildren.map((child: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; booleanChildren?: { true?: any[]; false?: any[] } }, cIdx: number) => {
                              const name = `${nameBase}__false__c${cIdx}`;
                              const cType = child?.inputType ?? "string";
                              if (cType === "boolean") {
                                const yesL = String(child?.booleanLabels?.true ?? "").trim() || "Yes";
                                const noL = String(child?.booleanLabels?.false ?? "").trim() || "No";
                                const bDisp = child?.booleanDisplay ?? "radio";
                                const boolCh = child?.booleanChildren as { true?: any[]; false?: any[] } | undefined;
                                if (bDisp === "dropdown") {
                                  return (
                                    <div key={name} className="space-y-1">
                                      <Label>{child?.label ?? "Details"}</Label>
                                      <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" {...form.register(name as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })}>
                                        <option value="">Select...</option>
                                        <option value="true">{yesL}</option>
                                        <option value="false">{noL}</option>
                                      </select>
                                      <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                                    </div>
                                  );
                                }
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <BooleanRadioPair form={form} name={name} yesLabel={yesL} noLabel={noL} />
                                    <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                                  </div>
                                );
                              }
                              const isRepeatableChild =
                                String(cType).trim().toLowerCase() === "repeatable" ||
                                String(cType).toLowerCase().includes("repeat") ||
                                Boolean((child as { repeatable?: RepeatableConfig | RepeatableConfig[] } | undefined)?.repeatable);
                              if (isRepeatableChild) {
                                const rep = getRepeatable(
                                  (child as { repeatable?: RepeatableConfig | RepeatableConfig[] } | undefined)?.repeatable
                                );
                                const itemLabel = String(rep.itemLabel ?? "Item");
                                const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
                                const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
                                const childFields = Array.isArray(rep.fields) ? (rep.fields ?? []) : [];
                                const current = (form.watch(name as never) as unknown[] | undefined) ?? [];
                                const items = Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
                                const canAdd = max <= 0 || items.length < max;
                                const canRemove = (idx: number) => items.length > Math.max(1, min) - 0 && idx >= 0;
                                const addItem = () => {
                                  const next = [...items, {}];
                                  form.setValue(name as never, next as never, { shouldDirty: true });
                                };
                                const removeItem = (idx: number) => {
                                  if (!canRemove(idx)) return;
                                  const next = items.filter((_, i) => i !== idx);
                                  form.setValue(name as never, next as never, { shouldDirty: true });
                                };
                                return (
                                  <div key={`${name}__rep`} className="col-span-2 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <Label>{child?.label ?? itemLabel}</Label>
                                      <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!canAdd}>
                                        Add {itemLabel}
                                      </Button>
                                    </div>
                                    <div className="space-y-2">
                                      {(items.length === 0 ? [] : items).map((_, rIdx) => {
                                        const baseRowKey = `${name}__row__${rIdx}`;
                                        return (
                                          <div key={baseRowKey} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                                            <div className="mb-2 flex items-center justify-between">
                                              <div className="text-xs font-medium">
                                                {itemLabel} #{rIdx + 1}
                                              </div>
                                              <Button type="button" size="sm" variant="outline" onClick={() => removeItem(rIdx)} disabled={!canRemove(rIdx)}>
                                                Remove
                                              </Button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                              {childFields.map((cf, ccIdx) => {
                                                const ccType = String(cf?.inputType ?? "string").trim().toLowerCase();
                                                const childName = `${name}.${rIdx}.${cf?.value ?? `c${ccIdx}`}`;
                                                if (ccType === "select") {
                                                  const cfOptsSel =
                                                    (cf as { options?: { label?: string; value?: string }[] } | undefined)?.options ?? [];
                                                  const opts = (Array.isArray(cfOptsSel) ? cfOptsSel : []) as { label?: string; value?: string }[];
                                                  return (
                                                    <div key={`${childName}__sel`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Select"}</Label>
                                                      <select
                                                        className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                                        {...form.register(childName as never)}
                                                      >
                                                        <option value="">-- Select --</option>
                                                        {opts.map((o) => (
                                                          <option key={o.value} value={o.value}>
                                                            {o.label}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </div>
                                                  );
                                                }
                                                if (ccType === "multi_select") {
                                                  const cfOptsMs =
                                                    (cf as { options?: { label?: string; value?: string }[] } | undefined)?.options ?? [];
                                                  const opts = (Array.isArray(cfOptsMs) ? cfOptsMs : []) as { label?: string; value?: string }[];
                                                  const _msCcRaw = form.watch(childName as never) as unknown;
                                                  const _msCcCur: unknown[] = Array.isArray(_msCcRaw) ? _msCcRaw : typeof _msCcRaw === "string" && _msCcRaw ? [_msCcRaw] : [];
                                                  return (
                                                    <div key={`${childName}__ms`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Select"}</Label>
                                                      <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                                        {opts.map((o) => {
                                                          const _ccChk = _msCcCur.includes(o.value as unknown);
                                                          return (
                                                            <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                              <input
                                                                type="checkbox"
                                                                value={o.value}
                                                                checked={_ccChk}
                                                                onChange={(e) => {
                                                                  const optVal = o.value as string;
                                                                  const next = e.target.checked ? [..._msCcCur.filter((v) => v !== optVal), optVal] : _msCcCur.filter((v) => v !== optVal);
                                                                  form.setValue(childName as never, next as never, { shouldDirty: true });
                                                                }}
                                                              />
                                                              {o.label}
                                                            </label>
                                                          );
                                                        })}
                                                        {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                                      </div>
                                                    </div>
                                                  );
                                                }
                                                if (ccType === "currency" || ccType === "negative_currency") {
                                                  const cc = String((cf as any)?.currencyCode ?? "").trim();
                                                  const dec = Number((cf as any)?.decimals ?? 2);
                                                  const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                                  return (
                                                    <div key={`${childName}__cur`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Value"}</Label>
                                                      <div className="flex items-center gap-2">
                                                        {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                                        <Input type="number" step={step} placeholder="0.00" {...form.register(childName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                                      </div>
                                                    </div>
                                                  );
                                                }
                                                const regChildOpts: Record<string, unknown> = {};
                                                if (ccType === "number") regChildOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                                                if (ccType === "date") {
                                                  regChildOpts.validate = (v: unknown) => {
                                                    if (v === undefined || v === null || v === "") return true;
                                                    return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                                  };
                                                  regChildOpts.onChange = (e: unknown) => {
                                                    const t = e as { target?: { value?: string } };
                                                    const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                                    form.setValue(childName as never, formatted as never, { shouldDirty: true });
                                                  };
                                                }
                                                return (
                                                  <div key={`${childName}__fld`} className="space-y-1">
                                                    <Label>{cf?.label ?? "Value"}</Label>
                                                    <Input
                                                      type={ccType === "number" ? "number" : ccType === "date" ? "text" : "text"}
                                                      placeholder={ccType === "date" ? "DD-MM-YYYY" : undefined}
                                                      inputMode={ccType === "date" ? "numeric" : undefined}
                                                      {...form.register(childName as never, regChildOpts)}
                                                    />
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              }
                              if (cType === "currency" || cType === "negative_currency") {
                                const cc = String((child as any)?.currencyCode ?? "").trim();
                                const dec = Number((child as any)?.decimals ?? 2);
                                const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <div className="flex items-center gap-2">
                                      {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                      <Input type="number" step={step} placeholder="0.00" {...form.register(name as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                    </div>
                                  </div>
                                );
                              }
                              const cIsNum = cType === "number";
                              const cIsDate = cType === "date";
                              const regOpts: Record<string, unknown> = {};
                              if (cIsNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                              if (cIsDate) {
                                regOpts.validate = (v: unknown) => {
                                  if (v === undefined || v === null || v === "") return true;
                                  return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                };
                                regOpts.onChange = (e: unknown) => {
                                  const t = e as { target?: { value?: string } };
                                  const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                  form.setValue(name as never, formatted as never, { shouldDirty: true });
                                };
                              }
                              return (
                                <div key={name}>
                                  <Field
                                    label={child?.label ?? "Details"}
                                    required={false}
                                    type={cIsNum ? "number" : cIsDate ? "text" : "text"}
                                    placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
                                    inputMode={cIsDate ? "numeric" : undefined}
                                    {...form.register(name as never, regOpts)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  }
                  const options: Record<string, unknown> = {};
                  if (isNumber) options.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                  if (isDate) {
                    options.validate = (v: unknown) => {
                      if (v === undefined || v === null || v === "") return true;
                      return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                    };
                    options.onChange = (e: unknown) => {
                      const t = e as { target?: { value?: string } };
                      const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                      form.setValue(nameBase as never, formatted as never, { shouldDirty: true });
                    };
                  }
                  options.required = Boolean(meta.required);
                  if (isCurrency) {
                    const currencyCode = String((meta as any)?.currencyCode ?? "").trim();
                    const decimals = Number((meta as any)?.decimals ?? 2);
                    const step = `0.${"0".repeat(Math.max(0, decimals - 1))}1`;
                    return (
                      <div key={nameBase} className="space-y-1">
                        <Label>
                          {displayLabel} {Boolean(meta.required) ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                        </Label>
                        <div className="flex items-center gap-2">
                          {currencyCode ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{currencyCode}</span> : null}
                          <Input
                            type="number"
                            step={step}
                            placeholder={`0.${"0".repeat(decimals)}`}
                            {...form.register(nameBase as never, options)}
                          />
                        </div>
                      </div>
                    );
                  }
                  if (isPercent) {
                    const decimals = Number((meta as any)?.decimals ?? 2);
                    const step = `0.${"0".repeat(Math.max(0, decimals - 1))}1`;
                    return (
                      <div key={nameBase} className="space-y-1">
                        <Label>
                          {displayLabel} {Boolean(meta.required) ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            step={step}
                            placeholder={`0.${"0".repeat(decimals)}`}
                            {...form.register(nameBase as never, options)}
                          />
                          <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">%</span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <Field
                      key={nameBase}
                      label={displayLabel}
                      required={Boolean(meta.required)}
                      type={isNumber ? "number" : isDate ? "text" : "text"}
                      placeholder={isDate ? "DD-MM-YYYY" : isCurrency ? "0.00" : undefined}
                      inputMode={isDate ? "numeric" : undefined}
                      {...form.register(nameBase as never, options)}
                    />
                  );
                })}
              </div>
            </div>
          ));
        })()}
      </div>
    </section>
  );
});

export default function NewPolicyStep1Page() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [flowLabel, setFlowLabel] = React.useState<string>("Policy");
  const [packagesOptions, setPackagesOptions] = React.useState<{ label: string; value: string }[]>([]);
  const [flowKey, setFlowKey] = React.useState<string | null>(null);
  const [steps, setSteps] = React.useState<
    {
      id: number;
      label: string;
      value: string;
      sortOrder: number;
      meta?: {
        packages?: string[];
        packageCategories?: Record<string, string[]>;
        packageShowWhen?: Record<string, { package: string; category: string | string[] }[]>;
        packageGroupLabelsHidden?: Record<string, boolean>;
        categoryStepVisibility?: Record<string, string[]>;
        isFinal?: boolean;
        wizardStep?: number;
        wizardStepLabel?: string;
        embeddedFlow?: string;
        embeddedFlowLabel?: string;
      };
    }[]
  >([]);
  const [refreshTick, setRefreshTick] = React.useState(0);

  // Refetch configuration when tab regains focus or becomes visible
  React.useEffect(() => {
    // Removed to avoid double refresh on mount which caused UI flash
  }, []);
  // Bump refresh when route path changes (client navigation back to this page)
  React.useEffect(() => {
    setRefreshTick((t) => t + 1);
  }, [pathname]);
  // Load flow name from admin-configured flows; ?flow=<key> selects one; default to first active
  React.useEffect(() => {
    let cancelled = false;
    async function loadFlow() {
      try {
        const res = await fetch("/api/form-options?groupKey=flows", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        const list = Array.isArray(data) ? data : [];
        const requested = searchParams.get("flow");
        const chosen = (requested ? list.find((f) => f.value === requested) : list[0]) ?? { label: "Policy", value: "" };
        if (!cancelled) {
          setFlowLabel(chosen.label ?? "Policy");
          setFlowKey(chosen.value ?? null);
        }
      } catch {
        if (!cancelled) {
          setFlowLabel("Policy");
          setFlowKey(null);
        }
      }
    }
    void loadFlow();
    return () => {
      cancelled = true;
    };
  }, [searchParams, refreshTick]);
  // Load packages options for display labels
  React.useEffect(() => {
    let cancelled = false;
    async function loadPkgs() {
      try {
        const res = await fetch("/api/form-options?groupKey=packages", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        if (!cancelled) setPackagesOptions(Array.isArray(data) ? data : []);
      } catch {
        // keep previous options on error to avoid flicker
      }
    }
    void loadPkgs();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);
  const [stepsLoading, setStepsLoading] = React.useState(true);
  type StepShape = {
    id: number;
    label: string;
    value: string;
    sortOrder: number;
    meta?: {
      packages?: string[];
      packageCategories?: Record<string, string[]>;
      packageShowWhen?: Record<string, { package: string; category: string | string[] }[]>;
      packageGroupLabelsHidden?: Record<string, boolean>;
      categoryStepVisibility?: Record<string, string[]>;
      isFinal?: boolean;
      wizardStep?: number;
      wizardStepLabel?: string;
      embeddedFlow?: string;
      embeddedFlowLabel?: string;
    };
  };
  React.useEffect(() => {
    let cancelled = false;
    async function loadSteps() {
      setStepsLoading(true);
      if (!flowKey) {
        setStepsLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`flow_${flowKey}_steps`)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as StepShape[];
        const raw = Array.isArray(data) ? data : [];
        const sorted = [...raw].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

        const expanded: StepShape[] = [];
        let wizardStepCounter = 1;

        for (const step of sorted) {
          const meta = step.meta ?? {};
          if (meta.embeddedFlow) {
            const embedRes = await fetch(
              `/api/form-options?groupKey=${encodeURIComponent(`flow_${meta.embeddedFlow}_steps`)}`,
              { cache: "no-store" }
            );
            if (!embedRes.ok || cancelled) continue;
            const embedData = (await embedRes.json()) as StepShape[];
            const embedSteps = Array.isArray(embedData)
              ? [...embedData].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              : [];
            const labelOverride = meta.embeddedFlowLabel?.trim();
            const byStep = new Map<number, StepShape[]>();
            for (const es of embedSteps) {
              const n = Number(es.meta?.wizardStep ?? 0) || 999;
              if (!byStep.has(n)) byStep.set(n, []);
              byStep.get(n)!.push(es);
            }
            const sortedGroupKeys = [...byStep.keys()].sort((a, b) => a - b);
            for (const k of sortedGroupKeys) {
              const group = byStep.get(k) ?? [];
              for (const es of group) {
                expanded.push({
                  ...es,
                  id: es.id * 10000 + wizardStepCounter,
                  meta: {
                    ...es.meta,
                    wizardStep: wizardStepCounter,
                    wizardStepLabel: labelOverride || es.meta?.wizardStepLabel,
                  },
                });
              }
              wizardStepCounter++;
            }
          } else {
            expanded.push({
              ...step,
              meta: { ...meta, wizardStep: wizardStepCounter },
            });
            wizardStepCounter++;
          }
        }
        if (!cancelled) setSteps(expanded);
      } catch {
        // keep previous steps on error to avoid flicker
      } finally {
        if (!cancelled) setStepsLoading(false);
      }
    }
    void loadSteps();
    return () => {
      cancelled = true;
    };
  }, [flowKey, refreshTick]);
  // Agent selection (admin/internal only) for Step 3 (drawer UX)
  const [currentUserType, setCurrentUserType] = React.useState<string>("");
  const [agentPickerOpen, setAgentPickerOpen] = React.useState(false);
  const [agentDrawerOpen, setAgentDrawerOpen] = React.useState(false);
  const [agentRows, setAgentRows] = React.useState<Array<{ id: number; userNumber?: string | null; name?: string | null; email: string; isActive?: boolean; hasCompletedSetup?: boolean }>>([]);
  const [agentSearch, setAgentSearch] = React.useState("");
  const [loadingAgentList, setLoadingAgentList] = React.useState(false);
  const [selectedAgent, setSelectedAgent] = React.useState<{ id: number; label: string } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/account/info", { cache: "no-store" });
        if (!meRes.ok) return;
        const me = (await meRes.json()) as { user?: { userType?: string } | null };
        if (cancelled) return;
        const ut = String(me?.user?.userType ?? "");
        setCurrentUserType(ut);
      } finally {
        // no-op
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Animate agent drawer
  React.useEffect(() => {
    if (agentPickerOpen) {
      setAgentDrawerOpen(false);
      requestAnimationFrame(() => setAgentDrawerOpen(true));
    } else {
      setAgentDrawerOpen(false);
    }
  }, [agentPickerOpen]);
  // Load agents when drawer opens
  React.useEffect(() => {
    let cancelled = false;
    async function loadAgents() {
      if (!agentPickerOpen) return;
      setLoadingAgentList(true);
      try {
        const res = await fetch("/api/agents?limit=500", { cache: "no-store" });
        if (!res.ok) return;
        type AgentLite = {
          id: number;
          userNumber?: string | null;
          name?: string | null;
          email: string;
          isActive?: boolean;
          hasCompletedSetup?: boolean;
        };
        const raw = await res.json();
        const list: AgentLite[] = Array.isArray(raw)
          ? (raw as AgentLite[])
          : Array.isArray(raw?.rows)
            ? (raw.rows as AgentLite[])
            : [];
        if (!cancelled) setAgentRows(list);
      } catch {
        if (!cancelled) setAgentRows([]);
      } finally {
        if (!cancelled) setLoadingAgentList(false);
      }
    }
    void loadAgents();
    return () => {
      cancelled = true;
    };
  }, [agentPickerOpen]);
  const filteredAgents = React.useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return agentRows;
    return agentRows.filter((a) => {
      const hay = `${a.userNumber ?? ""} ${a.name ?? ""} ${a.email}`.toLowerCase();
      return hay.includes(q);
    });
  }, [agentRows, agentSearch]);
  function chooseAgent(id: number) {
    const agent = agentRows.find((a) => a.id === id);
    const label =
      (agent?.userNumber ? `${agent.userNumber} — ` : "") +
      (agent?.name ?? "") +
      ` <${agent?.email ?? ""}>`;
    setWizard((w) => ({
      ...w,
      policy: { ...(w.policy ?? {}), agentId: id },
    }));
    setSelectedAgent({ id, label: label.trim() || `#${id}` });
    if (agent?.hasCompletedSetup === false) {
      // Pre-assign is allowed but the admin should know the agent
      // hasn't accepted their invite yet — they can't log in or
      // receive in-app notifications until they do.
      toast.warning(`Agent assigned, but ${agent.name ?? agent.email ?? "they"} hasn't activated their account yet.`, {
        description: "They'll see this work once they accept the invite.",
      });
    } else {
      toast.success(`Agent selected: ${label || `#${id}`}`);
    }
    setAgentPickerOpen(false);
  }
  // moved below wizard initialization
  const form = useForm<Record<string, unknown>>({
    defaultValues: {
      insuredType: "company",
    },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });
  const wizardFormValues = useWatch({ control: form.control }) as Record<string, unknown>;
  // If deep-linked with intent=create_client, pre-select "Create a New Client" and stay on Step 1
  const intentHandledRef = React.useRef(false);
  React.useEffect(() => {
    if (intentHandledRef.current) return;
    const intent = searchParams.get("intent");
    if (intent !== "create_client") return;
    intentHandledRef.current = true;
    try {
      const createVal = "createNClient";
      const keys = ["existOrCreateClient", "newExistingClient", "newOrExistingClient", "existingOrNewClient"];
      for (const k of keys) {
        try {
          form.setValue(k as never, createVal as never, { shouldDirty: false, shouldTouch: false });
        } catch {}
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Existing client picker
  const [clientPickerOpen, setClientPickerOpen] = React.useState(false);
  const [clientDrawerOpen, setClientDrawerOpen] = React.useState(false);
  const [clientRows, setClientRows] = React.useState<
    { id: number; clientNumber: string; category: string; displayName: string }[]
  >([]);
  const [loadingClients, setLoadingClients] = React.useState(false);
  const [clientSearch, setClientSearch] = React.useState("");
  // Animate drawer when opening
  React.useEffect(() => {
    if (clientPickerOpen) {
      setClientDrawerOpen(false);
      requestAnimationFrame(() => setClientDrawerOpen(true));
    } else {
      setClientDrawerOpen(false);
    }
  }, [clientPickerOpen]);
  React.useEffect(() => {
    let cancelled = false;
    async function loadClients() {
      if (!clientPickerOpen) return;
      setLoadingClients(true);
      try {
        // Find the client flow key from available flows
        const flowsRes = await fetch("/api/form-options?groupKey=flows", { cache: "no-store" });
        const flows = flowsRes.ok ? ((await flowsRes.json()) as Array<{ value?: string }>) : [];
        const clientFlow = flows.find((f) => String(f.value ?? "").toLowerCase().includes("client"));
        const clientFlowKey = clientFlow?.value ?? "clientSet";
        const res = await fetch(`/api/policies?flow=${encodeURIComponent(clientFlowKey)}&limit=500&_t=${Date.now()}`, { cache: "no-store" });
        const raw = res.ok ? await res.json() : null;
        const json: Array<Record<string, unknown>> = Array.isArray(raw)
          ? (raw as Array<Record<string, unknown>>)
          : Array.isArray(raw?.rows)
            ? (raw.rows as Array<Record<string, unknown>>)
            : [];
        if (!cancelled) {
          setClientRows(
            json
              .map((r: Record<string, unknown>) => {
                const policyId = Number(r.policyId ?? r.id ?? 0);
                const policyNumber = String(r.policyNumber ?? r.policy_number ?? "");
                const extra = (r.carExtra ?? r.extraAttributes ?? r.extra_attributes ?? null) as Record<string, unknown> | null;
                const insured = (extra?.insuredSnapshot ?? {}) as Record<string, unknown>;
                const rawType = String(insured?.insuredType ?? insured?.insured__category ?? "").trim().toLowerCase();
                const category = rawType === "company" || rawType === "personal" ? rawType : "";
                // Use the shared canonical extractor so:
                //  - keys like `insured__companyName`, `insured_companyName`,
                //    or bare `companyName` all resolve through `insuredGet`
                //    (handles legacy snapshots where multiple key variants
                //    coexist and the wrong one would otherwise win).
                //  - the picker label matches what the rest of the app shows
                //    for the same client (header chips, PDF templates, etc.).
                const displayName = extractDisplayName(extra ?? undefined);
                return { id: policyId, clientNumber: policyNumber, category, displayName };
              })
              .filter((r) => Number.isFinite(r.id) && r.id > 0),
          );
        }
      } catch {
        if (!cancelled) setClientRows([]);
      } finally {
        if (!cancelled) setLoadingClients(false);
      }
    }
    void loadClients();
    return () => {
      cancelled = true;
    };
  }, [clientPickerOpen]);
  const filteredClients = React.useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clientRows;
    return clientRows.filter((r) => {
      const hay = `${r.clientNumber} ${r.displayName} ${r.category}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clientRows, clientSearch]);
  async function chooseExistingClient(id: number) {
    try {
      const res = await fetch(`/api/policies/${id}?_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        toast.error("Failed to load client");
        return;
      }
      const detail = (await res.json()) as {
        policyId: number;
        id?: number;
        policyNumber?: string;
        clientNumber?: string;
        category?: string;
        displayName?: string;
        extraAttributes?: Record<string, unknown> | null;
        // CRITICAL: this picker fetches policies/cars (entries from the `clientSet` flow),
        // so `policyId` is the cars table id — NOT a real client id. The GET endpoint
        // resolves and returns the actual `clientId` from the linked clients row,
        // which we MUST use for any client PATCH / link-back operations. Without it,
        // PATCH /api/clients/{policyId} 404s and dirty edits (DOB, occupation, etc.)
        // silently fail to persist.
        clientId?: number | null;
        client?: { id?: number | null } | null;
      };
      const rawExtra = (detail?.extraAttributes ?? {}) as Record<string, unknown>;
      const insured = (rawExtra.insuredSnapshot ?? {}) as Record<string, unknown>;
      const derivedCategory = String(insured?.insuredType ?? insured?.insured__category ?? "").trim().toLowerCase();
      const extra = insured;
      if (!detail.category) (detail as any).category = derivedCategory || undefined;
      if (!detail.id) (detail as any).id = detail.policyId;
      if (!detail.clientNumber) (detail as any).clientNumber = detail.policyNumber;
      // Resolve the real clients-table id. Fall back to the car id only when the
      // policy has no linked client (legacy data / unsupported flow).
      const realClientId = (() => {
        const a = Number(detail.clientId);
        if (Number.isFinite(a) && a > 0) return a;
        const b = Number(detail.client?.id);
        if (Number.isFinite(b) && b > 0) return b;
        return Number(detail.id);
      })();
      // Baseline for delete detection should come from the stored client data (extraAttributes),
      // not RHF dirty tracking, since cleared number inputs often become undefined/omitted.
      try {
        const baseline: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(extra ?? {})) {
          const ck = canonicalizePrefixedKey(k);
          if (!ck) continue;
          if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
          baseline[ck] = v;
        }
        existingClientBaselineRef.current = baseline;
        existingClientBaselineIdRef.current = realClientId;
        const cat = String(detail.category ?? "").trim().toLowerCase();
        existingClientBaselineCategoryRef.current =
          cat === "company" || cat === "personal" ? (cat as "company" | "personal") : null;
      } catch {
        existingClientBaselineRef.current = null;
        existingClientBaselineIdRef.current = null;
        existingClientBaselineCategoryRef.current = null;
      }
      setSelectedExistingClientForInsuredFill({ id: realClientId, category: detail.category, extra });
      const isEmpty = (v: unknown) =>
        typeof v === "undefined" ||
        v === null ||
        (typeof v === "string" && v.trim() === "");
      const setIfEmpty = (name: string, v: unknown) => {
        try {
          const curr = (form.getValues() as Record<string, unknown>)[name];
          if (!isEmpty(curr)) return;
          // Programmatic fill from an existing client must NOT mark fields dirty,
          // otherwise Step 2 will always think the user "changed" client info.
          form.setValue(name as never, (v as never), { shouldDirty: false, shouldTouch: false });
          try {
            form.resetField(name as never, { defaultValue: v as never });
          } catch {
            // ignore if field isn't registered
          }
        } catch {
          // ignore
        }
      };
      const canonicalizeKey = (k: string): string => {
        let out = String(k ?? "").trim();
        if (!out) return "";
        if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
        if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
        return out.toLowerCase();
      };
      const meaningToken = (k: string) =>
        canonicalizeKey(k)
          .replace(/^(insured|contactinfo)_/i, "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
      const groupOf = (k: string): "insured" | "contactinfo" | null => {
        const c = canonicalizeKey(k);
        return c.startsWith("insured_") ? "insured" : c.startsWith("contactinfo_") ? "contactinfo" : null;
      };
      const scoreKeyShape = (rawKey: string): number => {
        const lower = rawKey === rawKey.toLowerCase() ? 10 : 0;
        const single = rawKey.startsWith("insured_") || rawKey.startsWith("contactinfo_") ? 6 : 0;
        const dbl = rawKey.startsWith("insured__") || rawKey.startsWith("contactinfo__") ? -2 : 0;
        return lower + single + dbl;
      };
      // Canonical dynamic map (single underscore, lowercase) as the primary source of truth.
      // `GET /api/clients/:id` returns resolved `extraAttributes` now, so these canonical keys
      // should already reflect the latest values.
      const canonicalDyn: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(extra)) {
        if (typeof k !== "string") continue;
        const ck = canonicalizeKey(k);
        if (!ck) continue;
        if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
        // Never prefill null/empty values into the form; nulls become "delete intents" later.
        if (v === null || typeof v === "undefined") continue;
        if (typeof v === "string" && v.trim() === "") continue;
        // Prefer the canonical key itself if present.
        if (typeof canonicalDyn[ck] === "undefined" || k === ck) canonicalDyn[ck] = v;
      }
      // Canonical lookup by group+meaning token (prevents stale insured variants).
      const canonicalByGroupToken = new Map<string, unknown>();
      for (const [k, v] of Object.entries(canonicalDyn)) {
        if (typeof k !== "string") continue;
        const group = k.startsWith("insured_") ? "insured" : k.startsWith("contactinfo_") ? "contactinfo" : null;
        if (!group) continue;
        const token = meaningToken(k);
        if (!token) continue;
        canonicalByGroupToken.set(`${group}:${token}`, v);
      }
      // Fill insured/contact fields from client's extraAttributes using canonical resolution:
      // - normalize keys (lowercase, single underscore)
      // - dedupe by meaning token so we don't accidentally pick old alias variants
      const bestByGroupToken = new Map<string, { value: unknown; score: number }>();
      for (const [k, v] of Object.entries(extra)) {
        if (typeof k !== "string") continue;
        const group = groupOf(k);
        if (!group) continue;
        if (v === undefined || v === null) continue;
        if (typeof v === "string" && v.trim() === "") continue;
        const token = meaningToken(k);
        if (!token) continue;
        const mapKey = `${group}:${token}`;
        const score = scoreKeyShape(k);
        const prev = bestByGroupToken.get(mapKey);
        if (!prev || score > prev.score) bestByGroupToken.set(mapKey, { value: v, score });
      }

      // 1) Fill Step 2 insured fields using the *configured* insured_fields keys (exact RHF names).
      // This is critical: if admin stored keys like `insured_companyName`, RHF registers that exact name,
      // so setting `insured_companyname` will NOT populate the input.
      const insuredFieldKeysRaw = (Array.isArray(dynamicFields) ? dynamicFields : [])
        .map((f) => String(f?.value ?? "").trim())
        .filter(Boolean);
      for (const key of insuredFieldKeysRaw) {
        const lower = key.toLowerCase();
        const group: "insured" | "contactinfo" =
          lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__") ? "contactinfo" : "insured";
        const token = meaningToken(key);
        if (!token) continue;
        const mapKey = `${group}:${token}`;
        // Insured must come from canonical map (audit-last-wins). Contactinfo can fall back.
        const picked =
          (canonicalByGroupToken.has(mapKey) ? canonicalByGroupToken.get(mapKey) : undefined) ??
          (group === "contactinfo" ? bestByGroupToken.get(mapKey)?.value : undefined);
        if (typeof picked === "undefined" || picked === null) continue;
        if (group === "insured") {
          // Option A: canonical insured field keys in the form are always `insured__<fieldKey>`.
          const canonName = insuredFormFieldNameFromConfiguredValue(key);
          if (canonName) setIfEmpty(canonName, picked);
        } else {
          setIfEmpty(key, picked);
        }
      }

      // 2) Fill contactinfo package fields (registered as `contactinfo__<fieldKey>`).
      // We derive `<fieldKey>` from the client's stored `contactinfo_*` token.
      for (const [mapKey, rec] of bestByGroupToken.entries()) {
        if (!mapKey.startsWith("contactinfo:")) continue;
        const token = mapKey.slice("contactinfo:".length);
        if (!token) continue;
        const val =
          canonicalByGroupToken.has(`contactinfo:${token}`) ? canonicalByGroupToken.get(`contactinfo:${token}`) : rec.value;
        // We can't reliably reconstruct original casing, but contactinfo package keys are typically lower/snaked.
        // We attempt both: `contactinfo__${token}` and `contactinfo__${token}`-as-is (same), plus prefixed.
        setIfEmpty(`contactinfo__${token}`, val);
        setIfEmpty(`contactinfo_${token}`, val);
        setIfEmpty(`contactinfo__${token}`.toLowerCase(), val);
      }

      // 3) Also fill insured package-style keys if present (registered as `insured__<fieldKey>` in some older configs).
      for (const [mapKey, rec] of bestByGroupToken.entries()) {
        if (!mapKey.startsWith("insured:")) continue;
        const token = mapKey.slice("insured:".length);
        if (!token) continue;
        const val =
          canonicalByGroupToken.has(`insured:${token}`) ? canonicalByGroupToken.get(`insured:${token}`) : rec.value;
        setIfEmpty(`insured__${token}`, val);
        setIfEmpty(`insured_${token}`, val);
      }
      // Align insuredType with client category if provided (company/personal) without prompting
      if (detail?.category === "company" || detail?.category === "personal") {
        // When selecting an existing client, treat the client's category as the source of truth.
        // Only skip if the user has manually edited insuredType in this session.
        const currType = String((form.getValues() as Record<string, unknown>)?.insuredType ?? "").trim().toLowerCase();
        const nextType = String(detail.category).trim().toLowerCase();
        const dirty = (() => {
          try {
            const df = (form.formState.dirtyFields ?? {}) as Record<string, unknown>;
            return Boolean(df["insuredType"]);
          } catch {
            return false;
          }
        })();
        if (!dirty && nextType && currType !== nextType) {
          // set a suppression flag so InsuredStep won't show confirm dialog
          form.setValue("_suppressInsuredTypeConfirm" as never, true as never, { shouldDirty: false });
          form.setValue("insuredType" as never, nextType as never, { shouldDirty: false, shouldTouch: false });
        }
        // Also align the namespaced category key used by `PackageBlock` (pkg="insured").
        // This avoids cases where the UI is set to "Company" but we only updated `insuredType`.
        try {
          const df = (form.formState.dirtyFields ?? {}) as Record<string, unknown>;
          const isDirtyPkg = Boolean(df["insured__category"]);
          const currPkg = String((form.getValues() as Record<string, unknown>)?.["insured__category"] ?? "")
            .trim()
            .toLowerCase();
          if (!isDirtyPkg && nextType && currPkg !== nextType) {
            form.setValue("insured__category" as never, nextType as never, { shouldDirty: false, shouldTouch: false });
          }
        } catch {
          // ignore
        }
      }
      // CRITICAL: after populating the form from an existing client, we must treat those populated
      // values as the new "defaults". Otherwise, clearing a field back to empty/undefined can look
      // "not dirty" to RHF (because defaultValues were empty), and deletes will never be sent.
      try {
        form.reset(form.getValues());
      } catch {
        // ignore
      }
      // Set clientId on the policy state
      setClientWasCreatedByButton(false);
      setWizard((w) => ({
        ...w,
        // Use the resolved real clients-table id, NOT the policyId. Otherwise
        // PATCH /api/clients/{id} 404s and the new policy row links to the
        // wrong record (or no record at all).
        policy: { ...(w.policy ?? {}), clientId: realClientId },
      }));
      // After the step advances, dynamic insured fields may mount/register on the next render.
      // Run the same fill again in the next frame so insured fields never stay blank.
      requestAnimationFrame(() => {
        try {
          // Re-apply only if still empty (setIfEmpty prevents overwriting user edits)
          const insuredFieldKeysRaw = (Array.isArray(dynamicFields) ? dynamicFields : [])
            .map((f) => String(f?.value ?? "").trim())
            .filter(Boolean);
          for (const key of insuredFieldKeysRaw) {
            const lower = key.toLowerCase();
            const group: "insured" | "contactinfo" =
              lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__") ? "contactinfo" : "insured";
            const token = meaningToken(key);
            if (!token) continue;
            const mapKey = `${group}:${token}`;
            const picked =
              (canonicalByGroupToken.has(mapKey) ? canonicalByGroupToken.get(mapKey) : undefined) ??
              (group === "contactinfo" ? bestByGroupToken.get(mapKey)?.value : undefined);
            if (typeof picked === "undefined") continue;
            if (group === "insured") {
              const canonName = insuredFormFieldNameFromConfiguredValue(key);
              if (canonName) setIfEmpty(canonName, picked);
            } else {
              setIfEmpty(key, picked);
            }
          }
        } catch {
          // ignore
        }
      });
      toast.success(`Selected client ${detail.clientNumber ?? detail.id}`);
      setClientPickerOpen(false);
      // Clear suppression flag after selection applied
      try {
        form.setValue("_suppressInsuredTypeConfirm" as never, false as never, { shouldDirty: false });
      } catch {}
    } catch {
      toast.error("Failed to select client");
    }
  }

  const insuredType = form.watch("insuredType") as string;
  // No static personal/company fields; dynamic only
  const [insuredTypes, setInsuredTypes] = React.useState<{ label: string; value: string }[]>([]);
  // no-op placeholder removed; InsuredStep handles insured type changes internally
  // Guard: confirm on actual changes even if a different control updates the field
  React.useEffect(() => {
    let cancelled = false;
    async function loadInsuredTypes() {
      try {
        const res = await fetch("/api/form-options?groupKey=insured_category", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        if (!cancelled) {
          // IMPORTANT: do NOT set `insuredType` here.
          // `InsuredStep` (the UI) owns insuredType and normalizes its value; setting it here causes
          // racey "snap back" behavior where the user changes Company/Personal but async load overwrites it.
          const normalize = (v: unknown): string => {
            const s = String(v ?? "").trim();
            const lower = s.toLowerCase();
            return lower === "company" || lower === "personal" ? lower : s;
          };
          setInsuredTypes(
            Array.isArray(data)
              ? data.map((d) => ({ label: String(d?.label ?? d?.value ?? ""), value: normalize(d?.value) }))
              : [],
          );
        }
      } catch {
        // ignore
      }
    }
    void loadInsuredTypes();
    return () => {
      cancelled = true;
    };
  }, []);
  const [dynamicFields, setDynamicFields] = React.useState<
    {
      label: string;
      value: string;
      valueType: string;
      sortOrder: number;
      meta?: {
        inputType?: string;
        required?: boolean;
        categories?: string[];
        options?: unknown[];
        booleanChildren?: { true?: unknown[]; false?: unknown[] };
      };
    }[]
  >([]);

  const insuredBaseKeyFromConfiguredValue = React.useCallback((raw: string): string => {
    const k = String(raw ?? "").trim();
    const lower = k.toLowerCase();
    if (!k) return "";
    if (lower.startsWith("insured__")) return k.slice("insured__".length);
    if (lower.startsWith("insured_")) return k.slice("insured_".length);
    return k;
  }, []);

  const insuredFormFieldNameFromConfiguredValue = React.useCallback(
    (raw: string): string => {
      const base = insuredBaseKeyFromConfiguredValue(raw);
      return base ? `insured__${base}` : "";
    },
    [insuredBaseKeyFromConfiguredValue],
  );

  // If a client is selected before `insured_fields` finishes loading, insured fields can remain blank.
  // Keep the latest selected client payload and re-apply insured fill once dynamicFields are available.
  const [selectedExistingClientForInsuredFill, setSelectedExistingClientForInsuredFill] = React.useState<{
    id: number;
    category?: string;
    extra: Record<string, unknown>;
  } | null>(null);

  // Baseline snapshot of client-related form fields after selecting an existing client.
  // We use this to detect deletes reliably even when RHF dirtyFields is inconsistent
  // for cleared number inputs (which often become `undefined` and/or omitted).
  const existingClientBaselineRef = React.useRef<Record<string, unknown> | null>(null);
  const existingClientBaselineIdRef = React.useRef<number | null>(null);
  const existingClientBaselineCategoryRef = React.useRef<"company" | "personal" | null>(null);
  const isEmptyClientValue = React.useCallback((v: unknown) => {
    return (
      typeof v === "undefined" ||
      v === null ||
      (typeof v === "string" && v.trim() === "")
    );
  }, []);

  const canonicalizePrefixedKey = React.useCallback((k: string): string => {
    let out = String(k ?? "").trim();
    if (!out) return "";
    const lower = out.toLowerCase();
    if (lower.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
    if (lower.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
    return out.toLowerCase();
  }, []);

  React.useEffect(() => {
    if (!selectedExistingClientForInsuredFill) return;
    if (!Array.isArray(dynamicFields) || dynamicFields.length === 0) return;
    try {
      const detail = selectedExistingClientForInsuredFill;
      const extra = detail.extra ?? {};
      const canonicalizeKey = (k: string): string => {
        let out = String(k ?? "").trim();
        if (!out) return "";
        if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
        if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
        return out.toLowerCase();
      };
      const meaningToken = (k: string) =>
        canonicalizeKey(k)
          .replace(/^(insured|contactinfo)_/i, "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
      const canonicalDyn: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(extra)) {
        const ck = canonicalizeKey(k);
        if (!ck) continue;
        if (!ck.startsWith("insured_")) continue;
        // Never prefill null/empty values into the form; it creates false "changes".
        if (v === null || typeof v === "undefined") continue;
        if (typeof v === "string" && v.trim() === "") continue;
        if (typeof canonicalDyn[ck] === "undefined" || k === ck) canonicalDyn[ck] = v;
      }
      const canonicalByToken = new Map<string, unknown>();
      for (const [k, v] of Object.entries(canonicalDyn)) {
        const token = meaningToken(k);
        if (!token) continue;
        canonicalByToken.set(token, v);
      }
      const insuredFieldKeysRaw = (Array.isArray(dynamicFields) ? dynamicFields : [])
        .map((f) => String(f?.value ?? "").trim())
        .filter(Boolean);
      for (const key of insuredFieldKeysRaw) {
        const token = meaningToken(key);
        if (!token) continue;
        const picked = canonicalByToken.get(token);
        if (typeof picked === "undefined" || picked === null) continue;
        const name = insuredFormFieldNameFromConfiguredValue(key);
        if (!name) continue;
        const curr = (form.getValues() as Record<string, unknown>)[name];
        const empty = typeof curr === "undefined" || curr === null || (typeof curr === "string" && curr.trim() === "");
        if (!empty) continue;
        form.setValue(name as never, picked as never, { shouldDirty: false, shouldTouch: false });
      }
    } catch {
      // ignore
    }
  }, [selectedExistingClientForInsuredFill, dynamicFields, form, insuredFormFieldNameFromConfiguredValue]);

  function buildInsuredSnapshot(values: Record<string, unknown>, dirtyFieldNames?: Set<string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const isDirty = (name: string): boolean => {
      if (!dirtyFieldNames) return false;
      const base = String(name ?? "").split(".")[0] ?? "";
      return dirtyFieldNames.has(name) || (base ? dirtyFieldNames.has(base) : false);
    };
    const canonicalizePrefixedKey = (k: string): string => {
      let out = String(k ?? "").trim();
      if (!out) return "";
      const lower = out.toLowerCase();
      if (lower.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
      if (lower.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
      return out.toLowerCase();
    };
    const addCanon = (canonKey: string, v: unknown, allowDelete: boolean) => {
      const ck = canonicalizePrefixedKey(canonKey);
      if (!ck) return;
      if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) return;
      // Once deleted, never allow a value to overwrite it
      if (Object.prototype.hasOwnProperty.call(out, ck) && out[ck] === null) {
        if (!(v === null || (typeof v === "string" && v.trim() === ""))) return;
      }
      if (typeof v === "undefined") {
        if (allowDelete) out[ck] = null;
        return;
      }
      if (v === null) {
        out[ck] = null;
        return;
      }
      if (typeof v === "string" && v.trim() === "") {
        if (allowDelete) out[ck] = null;
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(out, ck)) out[ck] = typeof v === "string" ? v.trim() : v;
    };
    // CRITICAL: RHF may omit keys entirely when cleared (especially number inputs).
    // Ensure cleared dirty fields override previous wizard snapshot values.
    if (dirtyFieldNames && dirtyFieldNames.size > 0) {
      for (const rawName of Array.from(dirtyFieldNames)) {
        const name = String(rawName ?? "").split(".")[0] ?? "";
        if (!name) continue;
        const lower = name.toLowerCase();
        if (
          lower.startsWith("insured_") ||
          lower.startsWith("insured__") ||
          lower.startsWith("contactinfo_") ||
          lower.startsWith("contactinfo__")
        ) {
          const v = (values as Record<string, unknown>)[name];
          if (typeof v === "undefined" || v === null || (typeof v === "string" && v.trim() === "")) {
            out[name] = null;
          }
        }
      }
    }

    // Also handle nested package keys like `newExistingClient__contactinfo_tel`:
    // map their tail to canonical `contactinfo_tel` / `insured_*` keys so policy snapshots don't keep old values.
    for (const [k, v] of Object.entries(values ?? {})) {
      const kk = String(k ?? "");
      if (!kk.includes("__")) continue;
      const tail = kk.split("__").pop() ?? "";
      const tailCanon = canonicalizePrefixedKey(tail);
      if (!(tailCanon.startsWith("insured_") || tailCanon.startsWith("contactinfo_"))) continue;
      const allowDelete = isDirty(kk) || isDirty(tailCanon) || isDirty(tail);
      addCanon(tailCanon, v, allowDelete);
    }
    // Build an insured snapshot from `insured_fields` regardless of whether the stored config keys are:
    // - unprefixed: `companyName`
    // - single-underscore prefixed: `insured_companyName`
    // - double-underscore prefixed (package-style): `insured__companyName`
    //
    // This prevents the "sometimes editable, sometimes not" issue where the UI binds to `companyName`
    // but the save path only persists `insured_*` keys (or vice versa).
    const rawKeys = (Array.isArray(dynamicFields) ? dynamicFields : [])
      .map((f) => String(f?.value ?? "").trim())
      .filter(Boolean);
    const baseKeys = new Set<string>();
    for (const raw of rawKeys) {
      const lower = raw.toLowerCase();
      // Ignore contactinfo keys if they ever appear in insured_fields by mistake
      if (lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")) continue;
      if (lower.startsWith("insured__")) baseKeys.add(raw.slice("insured__".length));
      else if (lower.startsWith("insured_")) baseKeys.add(raw.slice("insured_".length));
      else baseKeys.add(raw);
    }
    for (const baseKey of baseKeys) {
      const key = String(baseKey ?? "").trim();
      if (!key) continue;
      const vDirect = values[key];
      const vPref1 = values[`insured_${key}`];
      const vPref2 = values[`insured__${key}`];
      const vCanon = values[`insured__${key}`];
      // Also consider the case where the configured key itself is prefixed and exists in values
      const vFromRaw = (() => {
        for (const raw of rawKeys) {
          const lower = raw.toLowerCase();
          if (lower === `insured_${key}`.toLowerCase() || lower === `insured__${key}`.toLowerCase()) {
            const vv = values[raw];
            if (typeof vv !== "undefined") return vv;
          }
        }
        return undefined;
      })();
      const v =
        typeof vCanon !== "undefined"
          ? vCanon
          : typeof vDirect !== "undefined"
          ? vDirect
          : typeof vPref1 !== "undefined"
            ? vPref1
            : typeof vPref2 !== "undefined"
              ? vPref2
              : vFromRaw;
      const dirty =
        isDirty(key) ||
        isDirty(`insured_${key}`) ||
        isDirty(`insured__${key}`) ||
        rawKeys.some((rk) => {
          const lower = String(rk ?? "").toLowerCase();
          return (
            lower === key.toLowerCase() ||
            lower === `insured_${key}`.toLowerCase() ||
            lower === `insured__${key}`.toLowerCase()
          ) && isDirty(String(rk));
        });
      if (typeof v === "undefined") {
        // Clearing numeric inputs often becomes `undefined`. If dirty, emit a delete tombstone.
        if (dirty) {
          const prefixed = `insured_${key}`;
          if (typeof out[prefixed] === "undefined") out[prefixed] = null;
        }
        continue;
      }
      if (v === null || (typeof v === "string" && v.trim() === "")) {
        // Only treat empty/null as an explicit delete when the field is dirty.
        if (dirty) {
          const prefixed = `insured_${key}`;
          if (typeof out[prefixed] === "undefined") out[prefixed] = null;
        }
        continue;
      }
      const prefixed = `insured_${key}`;
      if (typeof out[prefixed] === "undefined") out[prefixed] = typeof v === "string" ? v.trim() : v;
    }
    for (const [k, v] of Object.entries(values ?? {})) {
      if (typeof k !== "string") continue;
      const lower = k.toLowerCase();
      const isInsured = lower.startsWith("insured_") || lower.startsWith("insured__");
      const isContact = lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__");
      if (!isInsured && !isContact) continue;
      addCanon(k, v, isDirty(k));
    }
    const insuredTypeVal = values?.insuredType;
    if (typeof insuredTypeVal === "string") {
      const t = insuredTypeVal.trim().toLowerCase();
      if (t === "company" || t === "personal") out["insuredType"] = t;
    }
    return out;
  }

  function normalizePrefixedKeysForClientUpdate(
    snapshot: Record<string, unknown>,
    dirtyFieldNames?: Set<string>,
  ): Record<string, unknown> {
    // The client PATCH endpoint merges only `insured_*` and `contactinfo_*` keys (single underscore).
    // Normalize legacy double-underscore keys to the preferred single-underscore form.
    const out: Record<string, unknown> = {};
    const bestByKey = new Map<
      string,
      { value: unknown; isDelete: boolean; isDirty: boolean; score: number }
    >();
    const isDirty = (rawKey: string): boolean => {
      if (!dirtyFieldNames) return false;
      const base = String(rawKey ?? "").split(".")[0] ?? "";
      const lower = base.toLowerCase();
      return (
        dirtyFieldNames.has(base) ||
        dirtyFieldNames.has(lower) ||
        (base ? dirtyFieldNames.has(base.toLowerCase()) : false)
      );
    };
    for (const [k, v] of Object.entries(snapshot ?? {})) {
      if (typeof k !== "string") continue;
      const lower = k.toLowerCase();
      const isInsured = lower.startsWith("insured_") || lower.startsWith("insured__");
      const isContact = lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__");
      if (!isInsured && !isContact) continue;
      const normKey = lower.startsWith("insured__")
        ? `insured_${lower.slice("insured__".length)}`
        : lower.startsWith("contactinfo__")
          ? `contactinfo_${lower.slice("contactinfo__".length)}`
          : lower;
      // Drop obviously broken keys produced by double-prefixing (e.g. `insured_insured_companyname`)
      const rest = normKey.replace(/^(insured|contactinfo)_/i, "");
      if (rest.startsWith("insured_") || rest.startsWith("contactinfo_")) continue;
      if (typeof v === "undefined") continue;

      const deleteIntent = v === null || (typeof v === "string" && v.trim() === "");
      const cand = {
        value: deleteIntent ? null : v,
        isDelete: deleteIntent,
        isDirty: isDirty(k),
        // Prefer values that are coming from the actual package form fields (`__`),
        // because those are what users edit in the UI. If a single-underscore variant exists
        // in `values` (often stale), it must not override a dirty `__` field.
        score:
          (k === k.toLowerCase() ? 10 : 0) +
          (lower.startsWith("insured__") || lower.startsWith("contactinfo__") ? 8 : 0) +
          (lower.startsWith("insured_") || lower.startsWith("contactinfo_") ? 4 : 0),
      };

      const prev = bestByKey.get(normKey);
      if (!prev) {
        bestByKey.set(normKey, cand);
        continue;
      }
      // Deletions always win.
      if (prev.isDelete && !cand.isDelete) continue;
      if (cand.isDelete && !prev.isDelete) {
        bestByKey.set(normKey, cand);
        continue;
      }
      // Otherwise, prefer dirty sources, then higher score.
      if (cand.isDirty && !prev.isDirty) {
        bestByKey.set(normKey, cand);
        continue;
      }
      if (!cand.isDirty && prev.isDirty) continue;
      if (cand.score > prev.score) {
        bestByKey.set(normKey, cand);
        continue;
      }
    }
    for (const [k, rec] of bestByKey.entries()) out[k] = rec.value;
    return out;
  }

  function filterClientUpdatePayload(
    normalized: Record<string, unknown>,
    dirtyFieldNames?: Set<string>,
  ): Record<string, unknown> {
    // For client PATCH we should only send:
    // - explicit deletes (null tombstones)
    // - keys the user actually edited (dirty)
    // Otherwise Step 2 will constantly think there are "changes" just because we prefilled values.
    const touched = new Set<string>();
    if (dirtyFieldNames && dirtyFieldNames.size > 0) {
      for (const raw of Array.from(dirtyFieldNames)) {
        const base = String(raw ?? "").split(".")[0] ?? "";
        if (!base) continue;
        const ck = canonicalizePrefixedKey(base);
        if (ck && (ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) {
          touched.add(ck.toLowerCase());
        }
        if (base.toLowerCase().includes("__")) {
          const tail = base.toLowerCase().split("__").pop() ?? "";
          const tailCanon = canonicalizePrefixedKey(tail);
          if (tailCanon && (tailCanon.startsWith("insured_") || tailCanon.startsWith("contactinfo_"))) {
            touched.add(tailCanon.toLowerCase());
          }
        }
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(normalized ?? {})) {
      const kk = String(k ?? "").toLowerCase();
      if (!kk) continue;
      if (v === null) {
        out[kk] = null;
        continue;
      }
      if (touched.size > 0 && touched.has(kk)) {
        out[kk] = v;
      }
    }
    return out;
  }
  React.useEffect(() => {
    let cancelled = false;
    async function loadFields() {
      try {
        const res = await fetch("/api/form-options?groupKey=insured_fields", { cache: "no-store" });
        if (!res.ok) return;
        type DynamicField = {
          label: string;
          value: string;
          valueType: string;
          sortOrder: number;
          meta?: {
            inputType?: string;
            required?: boolean;
            categories?: string[];
            options?: unknown[];
            booleanChildren?: { true?: unknown[]; false?: unknown[] };
            defaultBoolean?: boolean | null;
          };
        };
        const data = (await res.json()) as unknown[];
        if (!cancelled) setDynamicFields(Array.isArray(data) ? (data as DynamicField[]) : []);
      } catch {
        if (!cancelled) setDynamicFields([]);
      }
    }
    void loadFields();
    return () => {
      cancelled = true;
    };
  }, []);
  // Apply default values for boolean fields after dynamicFields loaded
  React.useEffect(() => {
    if (!Array.isArray(dynamicFields) || dynamicFields.length === 0) return;
    for (const f of dynamicFields) {
      const meta: Record<string, unknown> = (f.meta as Record<string, unknown>) ?? {};
      if ((meta?.inputType ?? "string") === "boolean" && typeof meta?.defaultBoolean === "boolean") {
        const all = form.getValues() as unknown as Record<string, unknown>;
        const nameBase = insuredFormFieldNameFromConfiguredValue(String(f?.value ?? ""));
        if (!nameBase) continue;
        const curr = all[nameBase];
        if (typeof curr === "undefined" || curr === null || curr === "") {
          form.setValue(nameBase as never, (meta.defaultBoolean as boolean) as never, { shouldDirty: false });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicFields]);
  // Build dynamic insured schema from configured fields
  const InsuredSchema = React.useMemo(() => {
    const allowed = new Set(["string", "number", "boolean", "date"]);
    return buildInsuredDynamicSchema(
      (dynamicFields ?? []).map((f) => ({
        value: insuredFormFieldNameFromConfiguredValue(String(f?.value ?? "")),
        meta: {
          inputType: allowed.has(String(f.meta?.inputType))
            ? (String(f.meta?.inputType) as "string" | "number" | "boolean" | "date")
            : "string",
          required: !!f.meta?.required,
          categories: Array.isArray(f.meta?.categories) ? (f.meta?.categories as string[]) : [],
        },
      }))
    );
  }, [dynamicFields, insuredFormFieldNameFromConfiguredValue]);
  // Re-subscribe when dynamicFields changes so we have the latest mapping
  React.useEffect(() => {
    const sub = form.watch((all, { name }) => {
      if (name !== "insuredType") return;
      const nextType = String((all as Record<string, unknown>)?.insuredType ?? "");
      const prevType = String(insuredType ?? "");
      // No prompt, no auto-clearing; accept change silently
      if (!prevType || prevType === nextType) return;
      try {
        const suppress = (form.getValues() as Record<string, unknown>)?._suppressInsuredTypeConfirm;
        if (suppress === true) {
          form.setValue("_suppressInsuredTypeConfirm" as never, false as never, { shouldDirty: false });
        }
      } catch {}
    });
    return () => sub.unsubscribe && sub.unsubscribe();
  }, [form, insuredType, dynamicFields]);


  // Discover address field mappings across dynamic insured fields and active package fields
  const [addressFieldMap, setAddressFieldMap] = React.useState<Record<string, string>>({});
  const [areaOptionsForTool, setAreaOptionsForTool] = React.useState<{ label?: string; value?: string }[]>([]);
  // Mirror wizard.step for hooks that run before wizard is declared.
  const [wizardStepForAddressDiscover, setWizardStepForAddressDiscover] = React.useState(1);
  React.useEffect(() => {
    let cancelled = false;
    async function discover() {
      const nextMap: Record<string, string> = {};
      const setIf = (k: string, v?: string) => {
        if (v && !nextMap[k]) nextMap[k] = v;
      };
      const normalize = (s?: string) => String(s ?? "").toLowerCase();
      const includesAny = (hay: string, subs: string[]) => subs.some((sub) => hay.includes(sub));
      const findByTokens = (rows: { label?: string; value?: string }[], tokens: string[]) => {
        for (const r of rows) {
          const l = normalize(r.label);
          const v = normalize(r.value);
          if (includesAny(l, tokens) || includesAny(v, tokens)) return r.value;
        }
        return undefined;
      };
      const tokens = {
        flatNumber: ["flat", "unit", "room", "rm", "室"],
        floorNumber: ["floor", "flr", "level", "lvl", "/f", "樓"],
        blockNumber: ["blockno", "block number", "blkno", "blk no"],
        blockName: ["blockname", "block name", "building name", "estate name", "tower name"],
        streetNumber: ["streetno", "street no", "no.", "no:", "門牌", "streetnumber"],
        streetName: ["street", "road", "rd", "avenue", "ave", "lane", "ln", "drive", "dr"],
        propertyName: ["property", "building", "estate", "mansion", "court", "residence", "residences", "plaza"],
        districtName: ["district"],
        area: ["area", "areacode"],
        verifiedAddress: ["formatted address", "formattedaddress", "full address", "fulladdress", "verified address", "geocoded address"],
        latitude: ["latitude", "lat"],
        longitude: ["longitude", "lng", "lon"],
        placeId: ["place id", "placeid"],
      };
      try {
        // From insured_fields
        const insured = Array.isArray(dynamicFields) ? dynamicFields : [];
        const insuredRows = insured.map((r) => ({ label: r.label, value: r.value }));
        const mapInsuredKey = (raw?: string) => (raw ? insuredFormFieldNameFromConfiguredValue(raw) : undefined);
        setIf("flatNumber", mapInsuredKey(findByTokens(insuredRows, tokens.flatNumber)));
        setIf("floorNumber", mapInsuredKey(findByTokens(insuredRows, tokens.floorNumber)));
        setIf("blockNumber", mapInsuredKey(findByTokens(insuredRows, tokens.blockNumber)));
        setIf("blockName", mapInsuredKey(findByTokens(insuredRows, tokens.blockName)));
        setIf("streetNumber", mapInsuredKey(findByTokens(insuredRows, tokens.streetNumber)));
        setIf("streetName", mapInsuredKey(findByTokens(insuredRows, tokens.streetName)));
        setIf("propertyName", mapInsuredKey(findByTokens(insuredRows, tokens.propertyName)));
        setIf("districtName", mapInsuredKey(findByTokens(insuredRows, tokens.districtName)));
        const insuredAreaKey = findByTokens(insuredRows, tokens.area);
        setIf("area", mapInsuredKey(insuredAreaKey));
        setIf("verifiedAddress", mapInsuredKey(findByTokens(insuredRows, tokens.verifiedAddress)));
        setIf("latitude", mapInsuredKey(findByTokens(insuredRows, tokens.latitude)));
        setIf("longitude", mapInsuredKey(findByTokens(insuredRows, tokens.longitude)));
        setIf("placeId", mapInsuredKey(findByTokens(insuredRows, tokens.placeId)));
        // If the area field is a select in insured_fields, capture its options for the Address Tool
        if (insuredAreaKey) {
          const match = insured.find((r) => String(r.value ?? "") === String(insuredAreaKey));
          const opts = (() => {
            const options = match?.meta?.options;
            if (!Array.isArray(options)) return [];
            return options
              .map((o) => {
                if (!o || typeof o !== "object") return null;
                const rec = o as Record<string, unknown>;
                return { label: String(rec["label"] ?? ""), value: String(rec["value"] ?? "") };
              })
              .filter((v): v is { label: string; value: string } => Boolean(v));
          })();
          if (!cancelled && opts.length > 0) setAreaOptionsForTool(opts);
        }

        // Scan ALL active packages for address fields (not just step packages)
        const pkgsToScan = new Set<string>();
        // From step packages
        if (Array.isArray(steps) && steps.length > 0) {
          const sorted = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          for (const step of sorted) {
            for (const p of (Array.isArray(step?.meta?.packages) ? step!.meta!.packages as string[] : [])) pkgsToScan.add(p);
          }
        }
        // Always include contactinfo — address fields commonly live here
        pkgsToScan.add("contactinfo");
        // Also include any packages loaded from packages list
        try {
          const pkgListRes = await fetch("/api/form-options?groupKey=packages", { cache: "no-store" });
          if (pkgListRes.ok) {
            const allPkgs = (await pkgListRes.json()) as { value?: string }[];
            for (const p of allPkgs) if (p.value) pkgsToScan.add(p.value);
          }
        } catch { /* ignore */ }

        const usedFieldValues = new Set<string>();
        for (const pkg of pkgsToScan) {
          try {
            const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`, { cache: "no-store" });
            if (!res.ok) continue;
            const rows = (await res.json()) as { label?: string; value?: string; meta?: { options?: { label?: string; value?: string }[] } }[];
            const toPkgName = (raw?: string) => {
              const k = String(raw ?? "").trim();
              if (!k) return undefined;
              if (k.startsWith(`${pkg}__`)) return k;
              const fieldKey = k.startsWith(`${pkg}_`) ? k.slice(`${pkg}_`.length) : k;
              return `${pkg}__${fieldKey}`;
            };
            const findByTokensExclusive = (allRows: { label?: string; value?: string }[], tkns: string[]) => {
              for (const r of allRows) {
                const fv = String(r.value ?? "");
                if (usedFieldValues.has(`${pkg}:${fv}`)) continue;
                const l = normalize(r.label);
                const v = normalize(fv);
                if (includesAny(l, tkns) || includesAny(v, tkns)) {
                  usedFieldValues.add(`${pkg}:${fv}`);
                  return fv;
                }
              }
              return undefined;
            };
            const compact = rows.map((r) => ({ label: r.label ?? "", value: r.value ?? "" }));
            setIf("flatNumber", toPkgName(findByTokensExclusive(compact, tokens.flatNumber)));
            setIf("floorNumber", toPkgName(findByTokensExclusive(compact, tokens.floorNumber)));
            setIf("blockNumber", toPkgName(findByTokensExclusive(compact, tokens.blockNumber)));
            setIf("blockName", toPkgName(findByTokensExclusive(compact, tokens.blockName)));
            setIf("streetNumber", toPkgName(findByTokensExclusive(compact, tokens.streetNumber)));
            setIf("streetName", toPkgName(findByTokensExclusive(compact, tokens.streetName)));
            setIf("propertyName", toPkgName(findByTokensExclusive(compact, tokens.propertyName)));
            setIf("districtName", toPkgName(findByTokensExclusive(compact, tokens.districtName)));
            const areaKey = findByTokensExclusive(compact, tokens.area);
            setIf("area", toPkgName(areaKey));
            setIf("verifiedAddress", toPkgName(findByTokensExclusive(compact, tokens.verifiedAddress)));
            setIf("latitude", toPkgName(findByTokensExclusive(compact, tokens.latitude)));
            setIf("longitude", toPkgName(findByTokensExclusive(compact, tokens.longitude)));
            setIf("placeId", toPkgName(findByTokensExclusive(compact, tokens.placeId)));
            if (areaKey) {
              const areaRow = rows.find((r) => String(r.value ?? "") === areaKey);
              const opts = (Array.isArray(areaRow?.meta?.options) ? (areaRow?.meta?.options as { label?: string; value?: string }[]) : []) || [];
              if (!cancelled && opts.length > 0) setAreaOptionsForTool(opts);
            }
          } catch {
            // ignore per pkg
          }
        }
      } finally {
        if (!cancelled) setAddressFieldMap(nextMap);
      }
    }
    void discover();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicFields, steps, wizardStepForAddressDiscover]);
  // Generic package block renderer
  /*
  function PackageBlock({
    pkg,
    allowedCategories,
    title,
  }: {
    pkg: string;
    allowedCategories?: string[] | undefined;
    title?: string;
  }) {
    const [categories, setCategories] = React.useState<{ label: string; value: string }[]>([]);
    const catFieldName = `${pkg}__category`;
    React.useEffect(() => {
      let cancelled = false;
      async function loadCats() {
        try {
          const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_category`)}`, { cache: "no-store" });
          if (!res.ok) return;
          const data = (await res.json()) as { label: string; value: string }[];
          const all = Array.isArray(data) ? data : [];
          const filtered =
            Array.isArray(allowedCategories) && allowedCategories.length > 0
              ? all.filter((c) => allowedCategories.includes(c.value))
              : all;
          if (!cancelled) {
            setCategories(filtered);
            const current = (form.getValues() as Record<string, unknown>)[catFieldName] as string | undefined;
            const hasCurrent = filtered.some((c) => c.value === current);
            if (!hasCurrent && filtered.length > 0) {
              form.setValue(catFieldName as never, filtered[0].value as never);
            }
          }
        } catch {
          if (!cancelled) setCategories([]);
        }
      }
      void loadCats();
      return () => {
        cancelled = true;
      };
    }, [pkg, allowedCategories, catFieldName]);

    const selectedCategory = String((useWatch({ control: form.control, name: catFieldName as string }) as string | undefined) ?? "");
    const [pkgFields, setPkgFields] = React.useState<
      { label: string; value: string; valueType: string; sortOrder: number; meta?: unknown }[]
    >([]);
    React.useEffect(() => {
      let cancelled = false;
      async function loadFields() {
        try {
          const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`, { cache: "no-store" });
          const data = (await res.json()) as unknown[];
          if (!cancelled)
            setPkgFields(
              Array.isArray(data)
                ? (data as { label: string; value: string; valueType: string; sortOrder: number; meta?: unknown }[])
                : [],
            );
        } catch {
          if (!cancelled) setPkgFields([]);
        }
      }
      void loadFields();
      return () => {
        cancelled = true;
      };
    }, [pkg, selectedCategory]);

    // Apply default selections for multi_select package fields when they first load
    React.useEffect(() => {
      if (!Array.isArray(pkgFields) || pkgFields.length === 0) return;
      for (const f of pkgFields) {
        const meta = (f.meta ?? {}) as Record<string, unknown>;
        if (meta.inputType !== "multi_select") continue;
        const opts = Array.isArray(meta.options) ? (meta.options as { value?: string; default?: boolean }[]) : [];
        const defaultVals = opts.filter((o) => o.default).map((o) => o.value).filter(Boolean) as string[];
        if (defaultVals.length === 0) continue;
        const nameBase = `${pkg}__${f.value}`;
        const curr = (form.getValues() as Record<string, unknown>)[nameBase];
        if (curr === undefined || curr === null || (Array.isArray(curr) && (curr as unknown[]).length === 0)) {
          form.setValue(nameBase as never, defaultVals as never, { shouldDirty: false });
        }
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pkgFields]);

    return (
      <section className="space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-6">
            {categories.map((opt) => (
              <label key={opt.value} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  className="appearance-none h-3.5 w-3.5 rounded-full border border-neutral-400 bg-transparent checked:bg-neutral-900 dark:checked:bg-white checked:border-white dark:checked:border-black focus-visible:outline-none focus-visible:ring-0"
                  value={opt.value}
                  checked={selectedCategory === opt.value}
                  onChange={(e) => form.setValue(catFieldName as never, e.target.value as never)}
                />
                {opt.label}
              </label>
            ))}
            {categories.length === 0 ? null : null}
          </div>
        </div>
        <div className="space-y-6">
          {(() => {
            // Filter visible fields by selected category
            const visible = pkgFields.filter((f) => {
              const meta = (f.meta ?? {}) as {
                inputType?: string;
                required?: boolean;
                categories?: string[];
                options?: { label?: string; value?: string }[];
                booleanChildren?: {
                  true?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                  false?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                };
                group?: string;
              };
              const cats = (meta.categories ?? []) as string[];
              return cats.length === 0 || cats.includes(selectedCategory as string);
            });
            // Group by meta.group for readability
            const groupMap = new Map<string, typeof visible>();
            for (const f of visible) {
              const meta = (f.meta ?? {}) as { group?: string };
              const key = meta?.group ?? "";
              if (!groupMap.has(key)) groupMap.set(key, []);
              groupMap.get(key)!.push(f);
            }
            const entries = Array.from(groupMap.entries());
            return entries.map(([groupLabel, fields]) => (
              <div key={groupLabel || "default"} className="space-y-2">
                {groupLabel ? <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{groupLabel}</div> : null}
                <div className="grid grid-cols-2 gap-4">
                  {fields.map((f) => {
              const meta = (f.meta ?? {}) as {
                inputType?: string;
                required?: boolean;
                categories?: string[];
                options?: { label?: string; value?: string }[];
                booleanChildren?: {
                  true?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                  false?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                };
                selectDisplay?: "dropdown" | "radio";
                repeatable?: RepeatableConfig | RepeatableConfig[];
                booleanLabels?: { true?: string; false?: string };
                booleanDisplay?: "radio" | "dropdown";
                defaultBoolean?: boolean | null;
              };
              const inputType = meta.inputType ?? "string";
              const isNumber = inputType === "number" || inputType === "percent";
              const isDate = inputType === "date";
              const nameBase = `${pkg}__${f.value}`;
              if (inputType === "select") {
                const options = (Array.isArray(meta.options) ? (meta.options as unknown[]) : []) as {
                  label?: string;
                  value?: string;
                  children?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; booleanChildren?: { true?: any[]; false?: any[] } }[];
                }[];
                return (
                  <InlineSelectWithChildren
                    key={nameBase}
                    nameBase={nameBase}
                    label={f.label}
                    required={Boolean(meta.required)}
                    options={options}
                    displayMode={(meta?.selectDisplay ?? "dropdown") === "dropdown" ? "dropdown" : "radio"}
                  />
                );
              }
              if (inputType === "multi_select") {
                const options = (Array.isArray(meta.options) ? (meta.options as unknown[]) : []) as {
                  label?: string;
                  value?: string;
                  children?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; booleanChildren?: { true?: any[]; false?: any[] } }[];
                }[];
                const current = (form.watch(nameBase as never) as string[] | undefined) ?? [];
                return (
                  <div key={nameBase} className="space-y-2">
                    <div className="space-y-1">
                      <Label>
                        {f.label} {meta.required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                      </Label>
                      <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                        {options.map((o) => (
                          <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              value={o.value}
                              {...form.register(nameBase as never, {
                                validate: (v) =>
                                  !Boolean(meta.required) || (Array.isArray(v) && (v as unknown[]).length > 0) || `${f.label} is required`,
                              })}
                            />
                            {o.label}
                          </label>
                        ))}
                        {options.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                      </div>
                    </div>
                    {(() => {
                      const childrenTuples =
                        options
                          .filter((o) => (current as unknown[]).includes(o.value as unknown))
                          .map((o) => ({ opt: o, children: Array.isArray(o.children) ? (o.children ?? []) : [] })) ?? [];
                      if (childrenTuples.length === 0) return null;
                      return (
                        <div className="grid grid-cols-2 gap-4">
                          {childrenTuples.flatMap(({ opt, children }) =>
                            children.map((child, cIdx) => {
                              const cType = child?.inputType ?? "string";
                              const cIsNum = cType === "number";
                              const cIsDate = cType === "date";
                              const name = `${nameBase}__opt_${opt.value}__c${cIdx}`;
                              const regOpts: Record<string, unknown> = {};
                              if (cIsNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                              if (cIsDate) {
                                regOpts.validate = (v: unknown) => {
                                  if (v === undefined || v === null || v === "") return true;
                                  return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                };
                                regOpts.onChange = (e: unknown) => {
                                  const t = e as { target?: { value?: string } };
                                  const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                  form.setValue(name as never, formatted as never, { shouldDirty: true });
                                };
                              }
                              if (cType === "select") {
                                const opts = (Array.isArray(child?.options) ? child?.options ?? [] : []) as {
                                  label?: string;
                                  value?: string;
                                }[];
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <select
                                      className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                      {...form.register(name as never)}
                                    >
                                      <option value="">-- Select --</option>
                                      {opts.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              }
                              if (cType === "multi_select") {
                                const opts = (Array.isArray(child?.options) ? child?.options ?? [] : []) as {
                                  label?: string;
                                  value?: string;
                                }[];
                                const _msN2Raw = form.watch(name as never) as unknown;
                                const _msN2Cur: unknown[] = Array.isArray(_msN2Raw) ? _msN2Raw : typeof _msN2Raw === "string" && _msN2Raw ? [_msN2Raw] : [];
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                      {opts.map((o) => {
                                        const _n2Chk = _msN2Cur.includes(o.value as unknown);
                                        return (
                                          <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                            <input
                                              type="checkbox"
                                              value={o.value}
                                              checked={_n2Chk}
                                              onChange={(e) => {
                                                const optVal = o.value as string;
                                                const next = e.target.checked ? [..._msN2Cur.filter((v) => v !== optVal), optVal] : _msN2Cur.filter((v) => v !== optVal);
                                                form.setValue(name as never, next as never, { shouldDirty: true });
                                              }}
                                            />
                                            {o.label}
                                          </label>
                                        );
                                      })}
                                      {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                    </div>
                                  </div>
                                );
                              }
                              if (cType === "currency" || cType === "negative_currency") {
                                const cc = String((child as any)?.currencyCode ?? "").trim();
                                const dec = Number((child as any)?.decimals ?? 2);
                                const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <div className="flex items-center gap-2">
                                      {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                      <Input type="number" step={step} placeholder="0.00" {...form.register(name as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <Field
                                  key={name}
                                  label={child?.label ?? "Details"}
                                  required={false}
                                  type={cIsNum ? "number" : cIsDate ? "text" : "text"}
                                  placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
                                  inputMode={cIsDate ? "numeric" : undefined}
                                  {...form.register(name as never, regOpts)}
                                />
                              );
                            }),
                          )}
                        </div>
                      );

                    })()}
                  </div>
                );
              }
              if (inputType === "boolean") {
                // Support both array and object-map storage for branch children
                const yesRaw = (meta?.booleanChildren as { true?: unknown } | undefined)?.true;
                const noRaw = (meta?.booleanChildren as { false?: unknown } | undefined)?.false;
                const yesChildren = toArray<ChildConfig>(yesRaw as ChildConfig | ChildConfig[] | undefined);
                const noChildren = toArray<ChildConfig>(noRaw as ChildConfig | ChildConfig[] | undefined);
                const currVal = form.watch(nameBase as never) as unknown;
                const defaultYes = (meta as Record<string, unknown> | undefined)?.defaultBoolean === true;
                const isYes =
                  (typeof currVal === "boolean" ? currVal : String(currVal) === "true") ||
                  (typeof currVal === "undefined" && defaultYes);
                return (
                  <div key={nameBase} className="col-span-2 space-y-2">
                    <div className="space-y-1">
                      <Label>
                        {f.label} {meta.required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                      </Label>
                      <BooleanRadioPair form={form} name={nameBase} required={Boolean(meta.required)} />
                    </div>
                    {yesChildren.length > 0 ? (
                      <div className="grid grid-cols-2 gap-4" style={{ display: isYes ? "grid" : "none" }}>
                        {yesChildren.map((child: ChildConfig, cIdx: number) => {
                          const name = `${nameBase}__true__c${cIdx}`;
                          const cType = String(child?.inputType ?? "string").trim().toLowerCase();
                          if (cType === "boolean") {
                            const yesL = String((child as any)?.booleanLabels?.true ?? "").trim() || "Yes";
                            const noL = String((child as any)?.booleanLabels?.false ?? "").trim() || "No";
                            const bDisp = (child as any)?.booleanDisplay ?? "radio";
                            const boolCh = (child as any)?.booleanChildren as { true?: any[]; false?: any[] } | undefined;
                            if (bDisp === "dropdown") {
                              return (
                                <div key={name} className="space-y-1">
                                  <Label>{child?.label ?? "Details"}</Label>
                                  <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" {...form.register(name as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })}>
                                    <option value="">Select...</option>
                                    <option value="true">{yesL}</option>
                                    <option value="false">{noL}</option>
                                  </select>
                                  <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                                </div>
                              );
                            }
                            return (
                              <div key={name} className="space-y-1">
                                <Label>{child?.label ?? "Details"}</Label>
                                <BooleanRadioPair form={form} name={name} yesLabel={yesL} noLabel={noL} />
                                <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                              </div>
                            );
                          }
                          const isRepeatableChild = cType === "repeatable" || cType.includes("repeat") || Boolean(child.repeatable);
                          if (isRepeatableChild) {
                            const rep = getRepeatable(child.repeatable);
                            const itemLabel = String(rep.itemLabel ?? "Item");
                            const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
                            const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
                            const childFields = Array.isArray(rep.fields) ? (rep.fields ?? []) : [];
                            const current = (form.watch(name as never) as unknown[] | undefined) ?? [];
                            const items = Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
                            const canAdd = max <= 0 || items.length < max;
                            const canRemove = (idx: number) => items.length > Math.max(1, min) - 0 && idx >= 0;
                            const addItem = () => {
                              const next = [...items, {}];
                              form.setValue(name as never, next as never, { shouldDirty: true });
                            };
                            const removeItem = (idx: number) => {
                              if (!canRemove(idx)) return;
                              const next = items.filter((_, i) => i !== idx);
                              form.setValue(name as never, next as never, { shouldDirty: true });
                            };
                            return (
                              <div key={`${name}__rep`} className="col-span-2 space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label>{child?.label ?? itemLabel}</Label>
                                  <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!canAdd}>
                                    Add {itemLabel}
                                  </Button>
                                </div>
                                <div className="space-y-2">
                                  {(items.length === 0 ? [] : items).map((_, rIdx) => {
                                    const baseRowKey = `${name}__row__${rIdx}`;
                                    return (
                                      <div key={baseRowKey} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                                        <div className="mb-2 flex items-center justify-between">
                                          <div className="text-xs font-medium">
                                            {itemLabel} #{rIdx + 1}
                                          </div>
                                          <Button type="button" size="sm" variant="outline" onClick={() => removeItem(rIdx)} disabled={!canRemove(rIdx)}>
                                            Remove
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                          {childFields.map((cf, ccIdx) => {
                                            const ccType = String(cf?.inputType ?? "string").trim().toLowerCase();
                                            const childName = `${name}.${rIdx}.${cf?.value ?? `c${ccIdx}`}`;
                                            if (ccType === "select") {
                                              const opts = (Array.isArray(cf.options) ? cf.options : []) as { label?: string; value?: string }[];
                                              return (
                                                <div key={`${childName}__sel`} className="space-y-1">
                                                  <Label>{cf.label ?? "Select"}</Label>
                                                  <select
                                                    className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                                    {...form.register(childName as never)}
                                                  >
                                                    <option value="">-- Select --</option>
                                                    {opts.map((o) => (
                                                      <option key={o.value} value={o.value}>
                                                        {o.label}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </div>
                                              );
                                            }
                                            if (ccType === "multi_select") {
                                              const opts = (Array.isArray(cf.options) ? cf.options : []) as { label?: string; value?: string }[];
                                              const _msRpRaw = form.watch(childName as never) as unknown;
                                              const _msRpCur: unknown[] = Array.isArray(_msRpRaw) ? _msRpRaw : typeof _msRpRaw === "string" && _msRpRaw ? [_msRpRaw] : [];
                                              return (
                                                <div key={`${childName}__ms`} className="space-y-1">
                                                  <Label>{cf.label ?? "Select"}</Label>
                                                  <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                                    {opts.map((o) => {
                                                      const _rpChk = _msRpCur.includes(o.value as unknown);
                                                      return (
                                                        <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                          <input
                                                            type="checkbox"
                                                            value={o.value}
                                                            checked={_rpChk}
                                                            onChange={(e) => {
                                                              const optVal = o.value as string;
                                                              const next = e.target.checked ? [..._msRpCur.filter((v) => v !== optVal), optVal] : _msRpCur.filter((v) => v !== optVal);
                                                              form.setValue(childName as never, next as never, { shouldDirty: true });
                                                            }}
                                                          />
                                                          {o.label}
                                                        </label>
                                                      );
                                                    })}
                                                    {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                                  </div>
                                                </div>
                                              );
                                            }
                                            if (ccType === "currency" || ccType === "negative_currency") {
                                              const cc = String((cf as any)?.currencyCode ?? "").trim();
                                              const dec = Number((cf as any)?.decimals ?? 2);
                                              const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                              return (
                                                <div key={`${childName}__cur`} className="space-y-1">
                                                  <Label>{cf.label ?? "Value"}</Label>
                                                  <div className="flex items-center gap-2">
                                                    {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                                    <Input type="number" step={step} placeholder="0.00" {...form.register(childName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                                  </div>
                                                </div>
                                              );
                                            }
                                            const regChildOpts: Record<string, unknown> = {};
                                            if (ccType === "number") regChildOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                                            if (ccType === "date") {
                                              regChildOpts.validate = (v: unknown) => {
                                                if (v === undefined || v === null || v === "") return true;
                                                return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                              };
                                              regChildOpts.onChange = (e: unknown) => {
                                                const t = e as { target?: { value?: string } };
                                                const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                                form.setValue(childName as never, formatted as never, { shouldDirty: true });
                                              };
                                            }
                                            return (
                                              <div key={`${childName}__fld`} className="space-y-1">
                                                <Label>{cf.label ?? "Value"}</Label>
                                                <Input
                                                  type={ccType === "number" ? "number" : ccType === "date" ? "text" : "text"}
                                                  placeholder={ccType === "date" ? "DD-MM-YYYY" : undefined}
                                                  inputMode={ccType === "date" ? "numeric" : undefined}
                                                  {...form.register(childName as never, regChildOpts)}
                                                />
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          // Default child types
                          if (cType === "currency" || cType === "negative_currency") {
                            const cc = String((child as any)?.currencyCode ?? "").trim();
                            const dec = Number((child as any)?.decimals ?? 2);
                            const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                            return (
                              <div key={name} className="space-y-1">
                                <Label>{child?.label ?? "Details"}</Label>
                                <div className="flex items-center gap-2">
                                  {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                  <Input type="number" step={step} placeholder="0.00" {...form.register(name as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                </div>
                              </div>
                            );
                          }
                          const cIsNum = cType === "number";
                          const cIsDate = cType === "date";
                          const regOpts: Record<string, unknown> = {};
                          if (cIsNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                          if (cIsDate) {
                            regOpts.validate = (v: unknown) => {
                              if (v === undefined || v === null || v === "") return true;
                              return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                            };
                            regOpts.onChange = (e: unknown) => {
                              const t = e as { target?: { value?: string } };
                              const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                              form.setValue(name as never, formatted as never, { shouldDirty: true });
                            };
                          }
                          return (
                            <div key={name}>
                              <Field
                                label={child?.label ?? "Details"}
                                required={false}
                                type={cIsNum ? "number" : cIsDate ? "text" : "text"}
                                placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
                                inputMode={cIsDate ? "numeric" : undefined}
                                {...form.register(name as never, regOpts)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {noChildren.length > 0 ? (
                      <div className="grid grid-cols-2 gap-4" style={{ display: !isYes ? "grid" : "none" }}>
                        {noChildren.map((child: ChildConfig, cIdx: number) => {
                          const name = `${nameBase}__false__c${cIdx}`;
                          const cType = String(child?.inputType ?? "string").trim().toLowerCase();
                          if (cType === "boolean") {
                            const yesL = String((child as any)?.booleanLabels?.true ?? "").trim() || "Yes";
                            const noL = String((child as any)?.booleanLabels?.false ?? "").trim() || "No";
                            const bDisp = (child as any)?.booleanDisplay ?? "radio";
                            const boolCh = (child as any)?.booleanChildren as { true?: any[]; false?: any[] } | undefined;
                            if (bDisp === "dropdown") {
                              return (
                                <div key={name} className="space-y-1">
                                  <Label>{child?.label ?? "Details"}</Label>
                                  <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" {...form.register(name as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })}>
                                    <option value="">Select...</option>
                                    <option value="true">{yesL}</option>
                                    <option value="false">{noL}</option>
                                  </select>
                                  <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                                </div>
                              );
                            }
                            return (
                              <div key={name} className="space-y-1">
                                <Label>{child?.label ?? "Details"}</Label>
                                <BooleanRadioPair form={form} name={name} yesLabel={yesL} noLabel={noL} />
                                <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                              </div>
                            );
                          }
                          const isRepeatableChild = cType === "repeatable" || cType.includes("repeat") || Boolean(child.repeatable);
                          if (isRepeatableChild) {
                            const rep = getRepeatable(child.repeatable);
                            const itemLabel = String(rep.itemLabel ?? "Item");
                            const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
                            const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
                            const childFields = Array.isArray(rep.fields) ? (rep.fields ?? []) : [];
                            const current = (form.watch(name as never) as unknown[] | undefined) ?? [];
                            const items = Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
                            const canAdd = max <= 0 || items.length < max;
                            const canRemove = (idx: number) => items.length > Math.max(1, min) - 0 && idx >= 0;
                            const addItem = () => {
                              const next = [...items, {}];
                              form.setValue(name as never, next as never, { shouldDirty: true });
                            };
                            const removeItem = (idx: number) => {
                              if (!canRemove(idx)) return;
                              const next = items.filter((_, i) => i !== idx);
                              form.setValue(name as never, next as never, { shouldDirty: true });
                            };
                            return (
                              <div key={`${name}__rep`} className="col-span-2 space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label>{child?.label ?? itemLabel}</Label>
                                  <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!canAdd}>
                                    Add {itemLabel}
                                  </Button>
                                </div>
                                <div className="space-y-2">
                                  {(items.length === 0 ? [] : items).map((_, rIdx) => {
                                    const baseRowKey = `${name}__row__${rIdx}`;
                                    return (
                                      <div key={baseRowKey} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                                        <div className="mb-2 flex items-center justify-between">
                                          <div className="text-xs font-medium">
                                            {itemLabel} #{rIdx + 1}
                                          </div>
                                          <Button type="button" size="sm" variant="outline" onClick={() => removeItem(rIdx)} disabled={!canRemove(rIdx)}>
                                            Remove
                                          </Button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                          {childFields.map((cf, ccIdx) => {
                                            const ccType = String(cf?.inputType ?? "string").trim().toLowerCase();
                                            const childName = `${name}.${rIdx}.${cf?.value ?? `c${ccIdx}`}`;
                                            if (ccType === "select") {
                                              const opts = (Array.isArray(cf.options) ? cf.options : []) as { label?: string; value?: string }[];
                                              return (
                                                <div key={`${childName}__sel`} className="space-y-1">
                                                  <Label>{cf.label ?? "Select"}</Label>
                                                  <select
                                                    className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                                    {...form.register(childName as never)}
                                                  >
                                                    <option value="">-- Select --</option>
                                                    {opts.map((o) => (
                                                      <option key={o.value} value={o.value}>
                                                        {o.label}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </div>
                                              );
                                            }
                                            if (ccType === "multi_select") {
                                              const opts = (Array.isArray(cf.options) ? cf.options : []) as { label?: string; value?: string }[];
                                              const _msRpRaw = form.watch(childName as never) as unknown;
                                              const _msRpCur: unknown[] = Array.isArray(_msRpRaw) ? _msRpRaw : typeof _msRpRaw === "string" && _msRpRaw ? [_msRpRaw] : [];
                                              return (
                                                <div key={`${childName}__ms`} className="space-y-1">
                                                  <Label>{cf.label ?? "Select"}</Label>
                                                  <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                                    {opts.map((o) => {
                                                      const _rpChk = _msRpCur.includes(o.value as unknown);
                                                      return (
                                                        <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                          <input
                                                            type="checkbox"
                                                            value={o.value}
                                                            checked={_rpChk}
                                                            onChange={(e) => {
                                                              const optVal = o.value as string;
                                                              const next = e.target.checked ? [..._msRpCur.filter((v) => v !== optVal), optVal] : _msRpCur.filter((v) => v !== optVal);
                                                              form.setValue(childName as never, next as never, { shouldDirty: true });
                                                            }}
                                                          />
                                                          {o.label}
                                                        </label>
                                                      );
                                                    })}
                                                    {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                                  </div>
                                                </div>
                                              );
                                            }
                                            if (ccType === "currency" || ccType === "negative_currency") {
                                              const cc = String((cf as any)?.currencyCode ?? "").trim();
                                              const dec = Number((cf as any)?.decimals ?? 2);
                                              const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                              return (
                                                <div key={`${childName}__cur`} className="space-y-1">
                                                  <Label>{cf.label ?? "Value"}</Label>
                                                  <div className="flex items-center gap-2">
                                                    {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                                    <Input type="number" step={step} placeholder="0.00" {...form.register(childName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                                  </div>
                                                </div>
                                              );
                                            }
                                            const regChildOpts: Record<string, unknown> = {};
                                            if (ccType === "number") regChildOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                                            if (ccType === "date") {
                                              regChildOpts.validate = (v: unknown) => {
                                                if (v === undefined || v === null || v === "") return true;
                                                return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                                              };
                                              regChildOpts.onChange = (e: unknown) => {
                                                const t = e as { target?: { value?: string } };
                                                const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                                                form.setValue(childName as never, formatted as never, { shouldDirty: true });
                                              };
                                            }
                                            return (
                                              <div key={`${childName}__fld`} className="space-y-1">
                                                <Label>{cf.label ?? "Value"}</Label>
                                                <Input
                                                  type={ccType === "number" ? "number" : ccType === "date" ? "text" : "text"}
                                                  placeholder={ccType === "date" ? "DD-MM-YYYY" : undefined}
                                                  inputMode={ccType === "date" ? "numeric" : undefined}
                                                  {...form.register(childName as never, regChildOpts)}
                                                />
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          // Default child types
                          if (cType === "currency" || cType === "negative_currency") {
                            const cc = String((child as any)?.currencyCode ?? "").trim();
                            const dec = Number((child as any)?.decimals ?? 2);
                            const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                            return (
                              <div key={name} className="space-y-1">
                                <Label>{child?.label ?? "Details"}</Label>
                                <div className="flex items-center gap-2">
                                  {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                                  <Input type="number" step={step} placeholder="0.00" {...form.register(name as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                </div>
                              </div>
                            );
                          }
                          const cIsNum = cType === "number";
                          const cIsDate = cType === "date";
                          const regOpts: Record<string, unknown> = {};
                          if (cIsNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                          if (cIsDate) {
                            regOpts.validate = (v: unknown) => {
                              if (v === undefined || v === null || v === "") return true;
                              return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                            };
                            regOpts.onChange = (e: unknown) => {
                              const t = e as { target?: { value?: string } };
                              const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                              form.setValue(name as never, formatted as never, { shouldDirty: true });
                            };
                          }
                          return (
                            <div key={name}>
                              <Field
                                label={child?.label ?? "Details"}
                                required={false}
                                type={cIsNum ? "number" : cIsDate ? "text" : "text"}
                                placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
                                inputMode={cIsDate ? "numeric" : undefined}
                                {...form.register(name as never, regOpts)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              }
              const options: Record<string, unknown> = {};
              if (isNumber) options.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
              if (isDate) {
                options.validate = (v: unknown) => {
                  if (v === undefined || v === null || v === "") return true;
                  return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                };
                options.onChange = (e: unknown) => {
                  const t = e as { target?: { value?: string } };
                  const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                  form.setValue(nameBase as never, formatted as never, { shouldDirty: true });
                };
              }
              options.required = Boolean(meta.required);
              return (
                <Field
                  key={nameBase}
                  label={f.label}
                  required={Boolean(meta.required)}
                  type={isNumber ? "number" : isDate ? "text" : "text"}
                  placeholder={isDate ? "DD-MM-YYYY" : undefined}
                  inputMode={isDate ? "numeric" : undefined}
                  {...form.register(nameBase as never, options)}
                />
              );
            })}
            </div>
          </div>
        ));
      })()}
        </div>
      </section>
    );
  }
  */
  const [wizard, setWizard] = React.useState<WizardState>({
    step: 1,
    highestCompletedStep: 1,
  });
  const wizardAgentId = React.useMemo(() => {
    const raw = wizard.policy?.["agentId"];
    return typeof raw === "number" ? raw : undefined;
  }, [wizard.policy]);
  // Keep the address mapping discovery in sync with wizard step.
  React.useEffect(() => {
    setWizardStepForAddressDiscover((prev) => (prev === wizard.step ? prev : wizard.step));
  }, [wizard.step]);
  const [selectedRowByStep, setSelectedRowByStep] = React.useState<Record<number, string | undefined>>({});
  // Resolve selectedAgent label after wizard is initialized
  React.useEffect(() => {
    (async () => {
      try {
        const aid = wizardAgentId;
        if (typeof aid !== "number" || selectedAgent?.id === aid) return;
        // Try local list first
        const local = agentRows.find((a) => a.id === aid);
        if (local) {
          const label =
            (local.userNumber ? `${local.userNumber} — ` : "") +
            (local.name ?? "") +
            ` <${local.email}>`;
          setSelectedAgent({ id: aid, label: label.trim() || `#${aid}` });
          return;
        }
        // Fallback: fetch single agent
        const res = await fetch(`/api/agents/${aid}`, { cache: "no-store" });
        if (!res.ok) return;
        const a = (await res.json()) as { id: number; userNumber?: string | null; name?: string | null; email: string };
        const label =
          (a.userNumber ? `${a.userNumber} — ` : "") + (a.name ?? "") + ` <${a.email}>`;
        setSelectedAgent({ id: aid, label: label.trim() || `#${aid}` });
      } catch {
        // ignore
      }
    })();
  }, [wizardAgentId, agentRows, selectedAgent?.id]);
  // Helper to safely read numeric clientId without using 'any'
  const getClientId = React.useCallback((obj: unknown): number | undefined => {
    if (!obj || typeof obj !== "object") return undefined;
    const maybe = obj as { clientId?: unknown };
    const n = Number(maybe.clientId as unknown);
    return Number.isFinite(n) ? n : undefined;
  }, []);

  const [creatingClient, setCreatingClient] = React.useState(false);
  const [clientWasCreatedByButton, setClientWasCreatedByButton] = React.useState(false);

  const isCreateNewClientMode = React.useMemo(() => {
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    let namespacedResult: boolean | null = null;
    let rawResult: boolean | null = null;
    for (const [k, v] of Object.entries(wizardFormValues ?? {})) {
      const nk = normalize(k);
      const isField =
        nk.includes("existorcreateclient") ||
        nk.includes("newexistingclient") ||
        nk.includes("neworexistingclient") ||
        nk.includes("existingornewclient") ||
        nk.includes("newexisting") ||
        nk.includes("existcreate") ||
        nk.includes("existingclient");
      if (!isField) continue;
      const nv = normalize(String(v ?? ""));
      let result: boolean | null = null;
      if (nv.includes("create") || nv.includes("new")) result = true;
      else if (nv.includes("existing") || nv.includes("choose")) result = false;
      if (result !== null) {
        if (k.includes("__")) namespacedResult = result;
        else rawResult = result;
      }
    }
    return namespacedResult ?? rawResult ?? false;
  }, [wizardFormValues]);

  const handleCreateClient = React.useCallback(async () => {
    setCreatingClient(true);
    try {
      const values = form.getValues() as Record<string, unknown>;
      const insuredOut: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (typeof k !== "string") continue;
        const lower = k.toLowerCase();
        const isInsured =
          lower.startsWith("insured_") ||
          lower.startsWith("insured__") ||
          lower.includes("__insured_") ||
          lower.includes("__insured__");
        const isContact =
          lower.startsWith("contactinfo_") ||
          lower.startsWith("contactinfo__") ||
          lower.includes("__contactinfo_") ||
          lower.includes("__contactinfo__");
        if (!isInsured && !isContact) continue;
        if (v === undefined || v === null) continue;
        if (typeof v === "string" && v.trim() === "") continue;
        insuredOut[k] = v;
      }
      const getAlias = (name: string): unknown => {
        const direct = values[name];
        if (typeof direct !== "undefined") return direct;
        const nameNorm = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const [kk, vv] of Object.entries(values)) {
          const nk = kk.toLowerCase();
          if (nk.endsWith(`__${nameNorm}`) || nk.endsWith(`_${nameNorm}`)) {
            const sv = typeof vv === "string" ? vv : (vv as any)?.toString?.();
            if (typeof sv === "string" && sv.trim() !== "") return sv;
            if (vv !== undefined && vv !== null && typeof vv !== "string") return vv;
          }
        }
        return undefined;
      };
      let insuredTypeVal = values["insuredType"] as unknown;
      if (typeof insuredTypeVal !== "string" || !insuredTypeVal.trim()) {
        insuredTypeVal = getAlias("category") ?? getAlias("insuredType");
      }
      if (typeof insuredTypeVal === "string") {
        const t = insuredTypeVal.trim().toLowerCase();
        if (t === "company" || t === "personal") insuredOut["insuredType"] = t;
      }
      if (!insuredOut["insuredType"]) {
        const cat = (values["insured__category"] ?? getAlias("category")) as unknown;
        if (typeof cat === "string" && cat.trim()) insuredOut["insuredType"] = cat.trim().toLowerCase();
      }
      const addIfMissing = (destKey: string, val: unknown) => {
        if (typeof insuredOut[destKey] === "undefined") {
          if (typeof val === "string" ? val.trim() !== "" : typeof val !== "undefined" && val !== null) {
            insuredOut[destKey] = typeof val === "string" ? val.trim() : val;
          }
        }
      };
      addIfMissing("insured_companyName", getAlias("companyName"));
      addIfMissing("insured_brNumber", getAlias("brNumber"));
      addIfMissing("insured_ciNumber", getAlias("ciNumber"));
      addIfMissing("insured_firstName", getAlias("firstName"));
      addIfMissing("insured_lastName", getAlias("lastName"));
      addIfMissing("insured_fullName", getAlias("fullName"));
      addIfMissing("insured_idNumber", getAlias("idNumber"));
      addIfMissing("insured_contactPhone", getAlias("contactPhone"));
      addIfMissing("insured_contactName", getAlias("contactName"));
      addIfMissing("insured_contactEmail", getAlias("contactEmail"));
      if (Object.keys(insuredOut).length === 0) {
        toast.error("Please provide insured/contact information to create client.");
        return;
      }
      const resClient = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ insured: insuredOut }),
      });
      const jClient = (await resClient.json().catch(() => ({}))) as Record<string, unknown>;
      if (resClient.ok && typeof jClient?.clientId === "number") {
        setWizard((w) => ({
          ...w,
          policy: { ...(w.policy ?? {}), clientId: jClient.clientId },
        }));
        setClientWasCreatedByButton(true);
        toast.success(
          `${jClient.existed ? "Existing client" : "Client created"}: ${jClient.clientNumber ?? jClient.clientId}`,
        );
      } else {
        toast.error((jClient?.error as string) ?? "Failed to create/find client");
      }
    } catch {
      toast.error("Failed to create/find client");
    } finally {
      setCreatingClient(false);
    }
  }, [form, setWizard]);

  // Ensure baseline exists whenever an existing clientId is set (Step 1 or later).
  // Users can select an existing client at Step 1 and edit fields before clicking Continue,
  // so the baseline must be available for change detection at any step.
  React.useEffect(() => {
    const cid = getClientId(wizard.policy);
    if (typeof cid !== "number" || !Number.isFinite(cid) || cid <= 0) return;
    if (existingClientBaselineIdRef.current === cid && existingClientBaselineRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clients/${cid}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as
          | { category?: unknown; extraAttributes?: Record<string, unknown> | null }
          | null;
        const extra = (json?.extraAttributes ?? {}) as Record<string, unknown>;
        const baseline: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(extra ?? {})) {
          const ck = canonicalizePrefixedKey(k);
          if (!ck) continue;
          if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
          baseline[ck] = v;
        }
        if (cancelled) return;
        existingClientBaselineRef.current = baseline;
        existingClientBaselineIdRef.current = cid;
        const cat = String(json?.category ?? "").trim().toLowerCase();
        existingClientBaselineCategoryRef.current =
          cat === "company" || cat === "personal" ? (cat as "company" | "personal") : null;
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizard.step, getClientId(wizard.policy)]);

  // Step 2 (Existing client): confirm before persisting client edits
  const [clientUpdateConfirmOpen, setClientUpdateConfirmOpen] = React.useState(false);
  const [clientUpdateConfirmBusy, setClientUpdateConfirmBusy] = React.useState(false);
  const [clientUpdateDirtyKeys, setClientUpdateDirtyKeys] = React.useState<string[]>([]);
  const [updateClientBusy, setUpdateClientBusy] = React.useState(false);
  const pendingClientUpdateRef = React.useRef<null | {
    clientId: number;
    proceed: () => void | Promise<void>;
    autoProceedAfterSave?: boolean;
  }>(null);

  const insuredConfigKeysLower = React.useMemo(() => {
    const keys = (Array.isArray(dynamicFields) ? dynamicFields : [])
      .map((f) => String(f?.value ?? "").trim())
      .filter(Boolean)
      .map((k) => k.toLowerCase());
    return new Set(keys);
  }, [dynamicFields]);

  const collectDirtyFieldNames = React.useCallback((dirty: unknown): string[] => {
    const out: string[] = [];
    const walk = (obj: unknown, prefix = "") => {
      if (!obj || typeof obj !== "object") return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v === true) out.push(key);
        else if (v && typeof v === "object") walk(v, key);
      }
    };
    walk(dirty);
    return out;
  }, []);

  const getDirtyClientInfoFieldNames = React.useCallback((): string[] => {
    try {
      const dirtyRaw = (form.formState.dirtyFields ?? {}) as unknown;
      const dirtyNames = collectDirtyFieldNames(dirtyRaw);
      const isClientInfo = (name: string) => {
        const full = String(name ?? "").trim();
        if (!full) return false;
        const base = full.split(".")[0] ?? "";
        const lower = base.toLowerCase();
        if (lower === "insuredtype") return true;
        if (
          lower.startsWith("insured_") ||
          lower.startsWith("insured__") ||
          lower.startsWith("contactinfo_") ||
          lower.startsWith("contactinfo__")
        )
          return true;
        // Nested package keys: e.g. `newExistingClient__contactinfo_tel` or `newExistingClient__insured_name`
        if (lower.includes("__")) {
          const tail = lower.split("__").pop() ?? "";
          if (
            tail.startsWith("insured_") ||
            tail.startsWith("insured__") ||
            tail.startsWith("contactinfo_") ||
            tail.startsWith("contactinfo__")
          )
            return true;
        }
        // Dotted nested: e.g. `newExistingClient.contactinfo_tel`
        if (full.includes(".")) {
          const tail = full.split(".").pop() ?? "";
          const tailLower = tail.toLowerCase();
          if (
            tailLower.startsWith("insured_") ||
            tailLower.startsWith("insured__") ||
            tailLower.startsWith("contactinfo_") ||
            tailLower.startsWith("contactinfo__") ||
            tailLower === "insuredtype"
          )
            return true;
        }
        if (insuredConfigKeysLower.has(lower)) return true;
        return false;
      };
      return dirtyNames.filter(isClientInfo);
    } catch {
      return [];
    }
  }, [form.formState.dirtyFields, collectDirtyFieldNames, insuredConfigKeysLower]);

  const humanizeClientFieldName = React.useCallback((name: string): string => {
    const base = String(name ?? "").split(".")[0] ?? "";
    const stripped = base.replace(/^(insured|contactinfo)__?/i, "");
    const spaced = stripped
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return spaced ? spaced.replace(/^./, (c) => c.toUpperCase()) : base;
  }, []);

  const patchClientInfoNow = React.useCallback(
    async (
      clientId: number,
      normalized: Record<string, unknown>,
      category?: "company" | "personal",
    ) => {
      try {
        const deletedKeys = Object.entries(normalized ?? {})
          .filter(([, v]) => v === null)
          .map(([k]) => String(k));
        const hasDeletedKeys = deletedKeys.length > 0;
        const hasInsured = Boolean(normalized && Object.keys(normalized).length > 0);
        const hasCategory = category === "company" || category === "personal";
        if (!hasInsured && !hasCategory && !hasDeletedKeys) {
          toast.success("No client fields to update.", { duration: 1200 });
          return { ok: true as const, verified: true as const };
        }
        const patch = await fetch(`/api/clients/${clientId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-debug": "1" },
          body: JSON.stringify({
            ...(hasInsured ? { insured: normalized } : {}),
            ...(hasDeletedKeys ? { deletedKeys } : {}),
            ...(hasCategory ? { category } : {}),
          }),
        });
        if (patch.ok) {
          // Read response for optional debug payload (helps diagnose "delete didn't apply")
          const j = await patch.json().catch(() => null);
          try {
            const debug = (() => {
              if (!j || typeof j !== "object") return null;
              const d = (j as Record<string, unknown>)["debug"];
              if (!d || typeof d !== "object") return null;
              return d as Record<string, unknown>;
            })();
            if (debug) {
              console.log("PATCH /api/clients debug", debug);
              const received = debug["receivedDeletedKeys"];
              const dk = Array.isArray(received)
                ? received.map((x) => String(x ?? "")).filter(Boolean).join(", ")
                : "";
              // Only show debug toasts when explicitly enabled (keeps normal UX clean).
              const debugToastEnabled = (() => {
                try {
                  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
                } catch {
                  return false;
                }
              })();
              if (dk && debugToastEnabled) toast.message(`Client PATCH debug: deletedKeys=[${dk}]`, { duration: 2500 });
            }
          } catch {
            // ignore debug handling
          }
          // Best-effort verify immediately (helps catch "saved only after next step" confusion)
          let verified = true;
          try {
            const resAfter = await fetch(`/api/clients/${clientId}`, { cache: "no-store" });
            if (resAfter.ok) {
              const after = (await resAfter.json().catch(() => null)) as
                | { category?: unknown; extraAttributes?: Record<string, unknown> | null }
                | null;
              const extra = (after?.extraAttributes ?? null) as Record<string, unknown> | null;
              // CRITICAL: sync the canonical values we just saved back into RHF state.
              // Otherwise `POST /api/policies` may snapshot stale values still in the form ("one policy behind").
              try {
                const touchedCanon = new Set<string>();
                for (const k of Object.keys(normalized ?? {})) {
                  const ck = canonicalizePrefixedKey(String(k));
                  if (!ck) continue;
                  if (ck.startsWith("insured_") || ck.startsWith("contactinfo_")) touchedCanon.add(ck);
                }

                // Apply category from server if present (keep insuredType + insured__category aligned).
                const serverCategory = String(after?.category ?? "").trim().toLowerCase();
                if (serverCategory === "company" || serverCategory === "personal") {
                  form.setValue("_suppressInsuredTypeConfirm" as never, true as never, { shouldDirty: false, shouldTouch: false });
                  form.setValue("insuredType" as never, serverCategory as never, { shouldDirty: false, shouldTouch: false });
                  form.setValue("insured__category" as never, serverCategory as never, { shouldDirty: false, shouldTouch: false });
                  form.setValue("insured_category" as never, serverCategory as never, { shouldDirty: false, shouldTouch: false });
                  form.setValue("_suppressInsuredTypeConfirm" as never, false as never, { shouldDirty: false, shouldTouch: false });
                  existingClientBaselineCategoryRef.current = serverCategory as "company" | "personal";
                }

                if (extra && typeof extra === "object") {
                  // Build canonical snapshot (used as the new baseline too)
                  const canonExtra: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(extra)) {
                    const ck = canonicalizePrefixedKey(String(k));
                    if (!ck) continue;
                    if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
                    canonExtra[ck] = v;
                  }
                  existingClientBaselineRef.current = canonExtra;
                  existingClientBaselineIdRef.current = clientId;

                  // Clear all existing form keys that map to touched canonical keys (removes stale variants like `contactinfo__tel`).
                  const valuesNow = form.getValues() as Record<string, unknown>;
                  for (const name of Object.keys(valuesNow)) {
                    const ck = canonicalizePrefixedKey(name);
                    if (!touchedCanon.has(ck)) continue;
                    form.setValue(name as never, "" as never, { shouldDirty: false, shouldTouch: false });
                    try {
                      form.resetField(name as never, { defaultValue: "" as never });
                    } catch {
                      // ignore (field may not be registered)
                    }
                  }

                  const toPkgFormName = (canonKey: string): string => {
                    const lower = canonKey.toLowerCase();
                    if (lower.startsWith("insured_")) return `insured__${canonKey.slice("insured_".length)}`;
                    if (lower.startsWith("contactinfo_")) return `contactinfo__${canonKey.slice("contactinfo_".length)}`;
                    return canonKey;
                  };

                  // Re-apply server values (or clear if deleted/missing) into the canonical UI key shape.
                  for (const ck of Array.from(touchedCanon)) {
                    const v = Object.prototype.hasOwnProperty.call(canonExtra, ck) ? canonExtra[ck] : undefined;
                    const namePkg = toPkgFormName(ck);
                    const baseUnderscore =
                      ck.startsWith("insured_")
                        ? `insured_${ck.slice("insured_".length)}`
                        : ck.startsWith("contactinfo_")
                          ? `contactinfo_${ck.slice("contactinfo_".length)}`
                          : ck;

                    const nextValue =
                      typeof v === "undefined" || v === null ? "" : typeof v === "string" ? v : (v as unknown);

                    // Prefer setting the PackageBlock key (`__`) so the input definitely updates.
                    form.setValue(namePkg as never, nextValue as never, { shouldDirty: false, shouldTouch: false });
                    // Also set underscore variant if it exists in the current form (legacy configs).
                    try {
                      const cur = form.getValues() as Record<string, unknown>;
                      if (Object.prototype.hasOwnProperty.call(cur, baseUnderscore)) {
                        form.setValue(baseUnderscore as never, nextValue as never, { shouldDirty: false, shouldTouch: false });
                      }
                    } catch {
                      // ignore
                    }

                    try {
                      form.resetField(namePkg as never, { defaultValue: nextValue as never });
                    } catch {
                      // ignore
                    }
                  }
                }
              } catch {
                // ignore sync failures; server save still succeeded
              }
              if (hasCategory) {
                const cat = String(after?.category ?? "").trim().toLowerCase();
                if (cat !== category) verified = false;
              }
              if (hasInsured && extra && typeof extra === "object") {
                for (const [k, v] of Object.entries(normalized)) {
                  const got = extra ? extra[k] : undefined;
                  const same =
                    typeof got === "object" || typeof v === "object"
                      ? (() => {
                          try {
                            return JSON.stringify(got) === JSON.stringify(v);
                          } catch {
                            return String(got ?? "") === String(v ?? "");
                          }
                        })()
                      : v === null
                        ? (typeof got === "undefined" || got === null || String(got ?? "").trim() === "")
                        : String(got ?? "") === String(v ?? "");
                  if (!same) {
                    verified = false;
                    break;
                  }
                }
              }
            } else {
              verified = false;
            }
          } catch {
            verified = false;
          }

          const noop = j && typeof j === "object" ? (j as Record<string, unknown>)["noop"] : undefined;
          if (noop === true) {
            toast.success("Client information already up to date.", { duration: 1200 });
          } else if (verified) {
            toast.success("Client information updated.", { duration: 1200 });
          } else {
            toast.warning("Client saved, but please refresh to confirm changes.", { duration: 2500 });
          }
          return { ok: true as const, verified };
        } else {
          const txt = await patch.text().catch(() => "");
          console.warn("PATCH /api/clients failed", patch.status, txt);
          toast.warning(`Failed to update client (${patch.status}).`, { duration: 2200 });
          return { ok: false as const, verified: false as const };
        }
      } catch {
        toast.warning("Failed to update client.", { duration: 2200 });
        return { ok: false as const, verified: false as const };
      }
    },
    [canonicalizePrefixedKey, form]
  );

  const getCategoryFromValues = React.useCallback((values: Record<string, unknown>): "company" | "personal" | undefined => {
    const cand =
      String(values?.insuredType ?? "").trim().toLowerCase() ||
      String(values?.["insured__category"] ?? "").trim().toLowerCase() ||
      String(values?.["insured_category"] ?? "").trim().toLowerCase();
    return cand === "company" || cand === "personal" ? cand : undefined;
  }, []);

  // Extract any client-update-relevant fields from the form values.
  // IMPORTANT: do not rely solely on buildInsuredSnapshot() here — some deployments register
  // client fields under different key shapes, and we still want to persist anything that looks
  // like insured/contactinfo data.
  const extractClientSnapshotFromValues = React.useCallback(
    (values: Record<string, unknown>, dirtyFieldNames?: Set<string>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      const isDirty = (name: string): boolean => {
        if (!dirtyFieldNames) return false;
        const base = String(name ?? "").split(".")[0] ?? "";
        return dirtyFieldNames.has(name) || (base ? dirtyFieldNames.has(base) : false);
      };
      const add = (k: string, v: unknown, allowNullWhenCleared = false) => {
        if (typeof k !== "string") return;
        // IMPORTANT: once a key is marked deleted (null tombstone), never allow later variants
        // to overwrite it with a non-null value. This prevents duplicate package field variants
        // (e.g. `contactinfo__tel` vs `newExistingClient__contactinfo_tel`) from "reviving" deleted data.
        if (Object.prototype.hasOwnProperty.call(out, k) && out[k] === null) {
          // Still allow overriding with null (idempotent), but block non-null.
          if (!(v === null || (typeof v === "string" && v.trim() === ""))) return;
        }
        // IMPORTANT: some RHF fields (notably number inputs) map clearing to `undefined` via setValueAs.
        // If the field is dirty and becomes `undefined`, treat it as an explicit delete by sending `null`.
        if (typeof v === "undefined") {
          if (allowNullWhenCleared) out[k] = null;
          return;
        }
        if (v === null) {
          out[k] = null;
          return;
        }
        if (typeof v === "string" && v.trim() === "") {
          if (allowNullWhenCleared) out[k] = null;
          return;
        }
        // Do not overwrite an existing non-null value with another non-null value here.
        // We only need *some* value, and we want deletes to be authoritative.
        if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
      };

      // CRITICAL: RHF may omit keys entirely when cleared (e.g. number inputs -> `undefined`).
      // Use dirty field names as the source of truth so deletes are never missed.
      if (dirtyFieldNames && dirtyFieldNames.size > 0) {
        for (const rawName of Array.from(dirtyFieldNames)) {
          const name = String(rawName ?? "").split(".")[0] ?? "";
          if (!name) continue;
          const lower = name.toLowerCase();
          const v = (values as Record<string, unknown>)[name];
          if (
            lower.startsWith("insured_") ||
            lower.startsWith("insured__") ||
            lower.startsWith("contactinfo_") ||
            lower.startsWith("contactinfo__")
          ) {
            add(name, v, true);
            continue;
          }
          // Support nested package keys like `newExistingClient__contactinfo_tel`
          // (i.e., key is namespaced by another package but still represents contactinfo_/insured_ data).
          if (lower.includes("__")) {
            const tail = lower.split("__").pop() ?? "";
            const tailCanon = canonicalizePrefixedKey(tail);
            if (tailCanon.startsWith("insured_") || tailCanon.startsWith("contactinfo_")) {
              add(tailCanon, v, true);
              continue;
            }
          }
          if (lower === "insuredtype") {
            add("insuredType", (values as Record<string, unknown>)["insuredType"], true);
            continue;
          }
          // Unprefixed but configured insured field keys (e.g. "blockName" stored under contactinfo package elsewhere)
          if (insuredConfigKeysLower.has(lower)) {
            const synthetic = `insured__${name}`;
            add(synthetic, v, true);
            continue;
          }
        }
      }

      // Baseline diff: if a value existed when the client was selected, but is now empty,
      // treat it as an explicit delete even if RHF didn't flag the field as dirty.
      try {
        const baseline = existingClientBaselineRef.current;
        if (baseline && typeof baseline === "object") {
          // Lowercased view of current values by key for robust lookups
          const valuesByLower = new Map<string, unknown>();
          for (const [kk, vv] of Object.entries(values ?? {})) {
            valuesByLower.set(String(kk ?? "").toLowerCase(), vv);
          }
          const readCurrentByCanonical = (canonKey: string): { hasAny: boolean; anyEmpty: boolean; anyValue: boolean } => {
            const ck = String(canonKey ?? "").toLowerCase();
            if (!ck) return { hasAny: false, anyEmpty: false, anyValue: false };
            // Form keys for packages often use `__` (e.g. contactinfo__tel)
            const dbl =
              ck.startsWith("contactinfo_")
                ? `contactinfo__${ck.slice("contactinfo_".length)}`
                : ck.startsWith("insured_")
                  ? `insured__${ck.slice("insured_".length)}`
                  : ck;
            const candidates: unknown[] = [];
            if (valuesByLower.has(ck)) candidates.push(valuesByLower.get(ck));
            if (valuesByLower.has(dbl)) candidates.push(valuesByLower.get(dbl));
            // Also accept nested package keys like `newExistingClient__contactinfo_tel`
            for (const [kk, vv] of valuesByLower.entries()) {
              if (kk.endsWith(`__${ck}`) || kk.endsWith(`__${dbl}`)) candidates.push(vv);
            }
            const hasAny = candidates.length > 0;
            const anyEmpty = candidates.some((v) => isEmptyClientValue(v));
            const anyValue = candidates.some((v) => !isEmptyClientValue(v));
            return { hasAny, anyEmpty, anyValue };
          };
          for (const [k, before] of Object.entries(baseline)) {
            const ck = canonicalizePrefixedKey(k);
            if (!ck) continue;
            if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
            const now = readCurrentByCanonical(ck);
            // Only treat as cleared if the field is actually present in the current form values.
            // If the form doesn't have *any* representation of this key, do NOT assume deletion.
            // (Otherwise Step 2 will always pop the "update client" dialog for fields not rendered on this step.)
            const isCleared = now.hasAny && now.anyEmpty && !now.anyValue;
            if (!isEmptyClientValue(before) && isCleared) {
              // Send canonical key so the server delete logic hits the right stored field.
              out[ck] = null;
            }
          }
        }
      } catch {
        // ignore
      }

      for (const [k, v] of Object.entries(values ?? {})) {
        const lower = String(k ?? "").toLowerCase();
        // Direct prefixed keys (any casing): insured_*, insured__*, contactinfo_*, contactinfo__*
        if (
          lower.startsWith("insured_") ||
          lower.startsWith("insured__") ||
          lower.startsWith("contactinfo_") ||
          lower.startsWith("contactinfo__")
        ) {
          add(k, v, isDirty(k));
          continue;
        }
        // Nested package keys: e.g. `newExistingClient__contactinfo_tel` → `contactinfo_tel`
        if (lower.includes("__")) {
          const tail = lower.split("__").pop() ?? "";
          const tailCanon = canonicalizePrefixedKey(tail);
          if (tailCanon.startsWith("insured_") || tailCanon.startsWith("contactinfo_")) {
            add(tailCanon, v, isDirty(k));
            continue;
          }
        }
        // Unprefixed but configured insured field keys (e.g. "companyName") — treat as insured
        if (insuredConfigKeysLower.has(lower)) {
          const synthetic = `insured__${k}`;
          add(synthetic, v, isDirty(k) || isDirty(synthetic));
          continue;
        }
      }
      // Also carry insuredType explicitly (used for category patch + some configs)
      if (typeof values?.insuredType !== "undefined") add("insuredType", values.insuredType, isDirty("insuredType"));
      return out;
    },
    [insuredConfigKeysLower, isEmptyClientValue, canonicalizePrefixedKey],
  );

  const handleUpdateClient = React.useCallback(async () => {
    const clientId = getClientId(wizard.policy);
    if (typeof clientId !== "number") return;
    const dirtyKeys = getDirtyClientInfoFieldNames();
    if (!dirtyKeys.length) {
      toast.success("No changes to save.", { duration: 1000 });
      return;
    }
    setUpdateClientBusy(true);
    try {
      const valuesNow = form.getValues() as Record<string, unknown>;
      const dirtySetNow = new Set(
        dirtyKeys
          .map((k) => String(k ?? "").split(".")[0] ?? "")
          .filter((s) => Boolean(s))
      );
      const snapshotNow = extractClientSnapshotFromValues(valuesNow, dirtySetNow);
      const normalizedNowAll = normalizePrefixedKeysForClientUpdate(snapshotNow, dirtySetNow);
      const normalizedNow = filterClientUpdatePayload(normalizedNowAll, dirtySetNow);
      const categoryNow = getCategoryFromValues(valuesNow);
      const result = await patchClientInfoNow(clientId, normalizedNow, categoryNow);
      if (result?.ok) {
        try {
          const baseline = existingClientBaselineRef.current ?? {};
          const nextBaseline: Record<string, unknown> = { ...(baseline as Record<string, unknown>) };
          const normalizedLower = Object.fromEntries(
            Object.entries(normalizedNow ?? {}).map(([k, v]) => [String(k ?? "").toLowerCase(), v]),
          ) as Record<string, unknown>;
          for (const [k, v] of Object.entries(normalizedLower)) {
            const ck = canonicalizePrefixedKey(k);
            if (!ck || !(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
            if (v === null) delete nextBaseline[ck];
            else nextBaseline[ck] = v;
          }
          existingClientBaselineRef.current = nextBaseline;
          existingClientBaselineIdRef.current = clientId;
          if (categoryNow === "company" || categoryNow === "personal") {
            existingClientBaselineCategoryRef.current = categoryNow;
          }
        } catch {
          /* ignore */
        }
        try {
          form.reset(form.getValues());
        } catch {
          /* ignore */
        }
      }
    } finally {
      setUpdateClientBusy(false);
    }
  }, [
    wizard.policy,
    getClientId,
    getDirtyClientInfoFieldNames,
    extractClientSnapshotFromValues,
    normalizePrefixedKeysForClientUpdate,
    filterClientUpdatePayload,
    getCategoryFromValues,
    patchClientInfoNow,
    form,
    canonicalizePrefixedKey,
  ]);

  const hasUnsavedClientEdits = (() => {
    const cid = getClientId(wizard.policy);
    if (typeof cid !== "number") return false;
    if (!form.formState.isDirty) return false;
    const dirty = getDirtyClientInfoFieldNames();
    return dirty.length > 0;
  })();

  const goto = (step: number) => {
    // Allow going back freely
    if (step < wizard.step) {
      setWizard((w) => ({ ...w, step }));
      return;
    }
    // Disallow jumping forward via dots; enforce using Continue buttons
    if (step > wizard.step) {
      toast.error("Please use the Continue button to proceed.");
      return;
    }
  };

  async function saveDraft() {
    try {
      const values = form.getValues() as Record<string, unknown>;
      const dirtyKeys = getDirtyClientInfoFieldNames();
      const dirtySet = new Set(
        (dirtyKeys ?? [])
          .map((k) => String(k ?? "").split(".")[0] ?? "")
          .filter((s) => Boolean(s))
      );
      const insured = buildInsuredSnapshot(values, dirtySet);
      const wizardState = {
        ...wizard,
        insured: { ...(wizard.insured ?? {}), ...insured },
      };
      const res = await fetch("/api/policies/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wizardState, currentStep: wizard.step }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      toast.success(`Draft saved (id: ${data.draftId})`, { duration: 1000 });
    } catch (err: unknown) {
      const message = (err as { message?: string } | undefined)?.message ?? "Failed to save draft";
      toast.error(message);
        }
      }

// (Unused helper removed)

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {stepsLoading ? (
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
            </div>
          ) : Array.isArray(steps) && steps.length > 0 ? (
            (() => {
              const sorted = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
              const defined = sorted
                .map((s) => Number(s.meta?.wizardStep ?? 0))
                .filter((n) => Number.isFinite(n) && n > 0) as number[];
              let auto = defined.length > 0 ? Math.max(...defined) : 0;
              const wizardNums: number[] = [];
              for (const s of sorted) {
                let n = Number(s.meta?.wizardStep ?? 0);
                if (!Number.isFinite(n) || n <= 0) n = ++auto;
                if (!wizardNums.includes(n)) wizardNums.push(n);
              }
              if (wizardNums.length <= 1) return null;
              return wizardNums.map((n) => (
                <StepDot key={n} n={n} active={wizard.step === n} done={wizard.highestCompletedStep >= n} onClick={() => goto(n)} />
              ));
            })()
          ) : (
            <>
              <StepDot n={1} active={wizard.step === 1} done={wizard.highestCompletedStep >= 1} onClick={() => goto(1)} />
              <StepDot n={2} active={wizard.step === 2} done={wizard.highestCompletedStep >= 2} onClick={() => goto(2)} />
              <StepDot n={3} active={wizard.step === 3} done={wizard.highestCompletedStep >= 3} onClick={() => goto(3)} />
              <StepDot n={4} active={wizard.step === 4} done={wizard.highestCompletedStep >= 4} onClick={() => goto(4)} />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {wizard.step === 3 && (currentUserType === "admin" || currentUserType === "internal_staff") ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setAgentPickerOpen(true)}
                title="Select Agent"
              >
                Select Agent
              </Button>
            </>
          ) : null}
          {Object.keys(addressFieldMap).length > 0 ? (
            <AddressTool form={form} fieldMap={addressFieldMap} areaOptions={areaOptionsForTool} />
          ) : null}
          <Button variant="secondary" onClick={saveDraft}>Save Draft</Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-yellow-500">
            {Array.isArray(steps) && steps.length > 0
              ? (() => {
                  const sorted = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                  const defined = sorted.map((s) => Number(s.meta?.wizardStep ?? 0)).filter((n) => Number.isFinite(n) && n > 0) as number[];
                  let auto = defined.length > 0 ? Math.max(...defined) : 0;
                  const groups: Record<number, (typeof steps)[number][]> = {};
                  for (const s of sorted) {
                    let n = Number(s.meta?.wizardStep ?? 0);
                    if (!Number.isFinite(n) || n <= 0) n = ++auto;
                    if (!groups[n]) groups[n] = [];
                    groups[n]!.push(s);
                  }
                  const totalSteps = Object.keys(groups).length;
                  const group = groups[wizard.step] ?? [];
                  const base = totalSteps <= 1 ? flowLabel : `${flowLabel} — Step ${wizard.step}`;
                  // Prefer explicit Wizard Step Label if provided on any row in the group
                  const stepLbl = String(
                    (group.find((r) => typeof r.meta?.wizardStepLabel === "string" && r.meta?.wizardStepLabel)?.meta?.wizardStepLabel ??
                      "") || "",
                  ).trim();
                  if (stepLbl) return totalSteps <= 1 ? `${flowLabel}: ${stepLbl}` : `${base}: ${stepLbl}`;
                  return base;
                })()
              : flowLabel}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Agent summary inside the step window */}
          {wizard.step === 3 ? (
            <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">Agent</div>
              <div className="flex items-center justify-between gap-2">
                <div
                  className="max-w-[70%] truncate text-sm"
                  title={selectedAgent?.label || (currentUserType === "agent" ? "You (will be assigned)" : "Not selected")}
                >
                  {selectedAgent?.label || (currentUserType === "agent" ? "You (will be assigned)" : "Not selected")}
                </div>
                {(currentUserType === "admin" || currentUserType === "internal_staff") ? (
                  <Button size="sm" variant="secondary" onClick={() => setAgentPickerOpen(true)}>
                    Change
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {Array.isArray(steps) && steps.length === 0 ? (
            <>
          <div className="flex items-center justify-between">
            <div />
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  try {
                    form.setValue("_suppressInsuredTypeConfirm" as never, true as never, { shouldDirty: false });
                  } catch {}
                  setClientPickerOpen(true);
                }}
              >
                Select Existing Client
              </Button>
            </div>
          </div>
          <InsuredStep form={form} />
            </>
          ) : null}

          {/* Generic flow packages for this step (configured in Flows → Steps) */}
          {(() => {
            if (stepsLoading) {
              return (
                <div className="space-y-4">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-5/6" />
                </div>
              );
            }
            if (!Array.isArray(steps) || steps.length === 0) return null;
            const sorted = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            const defined = sorted
              .map((s) => Number(s.meta?.wizardStep ?? 0))
              .filter((n) => Number.isFinite(n) && n > 0) as number[];
            let auto = defined.length > 0 ? Math.max(...defined) : 0;
            const groups: Record<number, (typeof steps)[number][]> = {};
            for (const s of sorted) {
              let n = Number(s.meta?.wizardStep ?? 0);
              if (!Number.isFinite(n) || n <= 0) n = ++auto;
              if (!groups[n]) groups[n] = [];
              groups[n]!.push(s);
            }
            const group = groups[wizard.step] ?? [];
            if (group.length === 0) return null;
            // If multiple rows map to this wizard step, treat as branches; require selection
            const selectedRowValue = selectedRowByStep[wizard.step];
            const selectedRow = group.length === 1 ? group[0] : group.find((r) => r.value === selectedRowValue) ?? null;
            // Render branch selector if needed
            return (
              <div className="space-y-8">
                {group.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <Label>Choose:</Label>
                    <div className="flex flex-wrap items-center gap-4">
                      {group.map((r) => (
                        <label key={r.value} className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black"
                            value={r.value}
                            checked={selectedRowValue === r.value}
                            onChange={(e) =>
                              setSelectedRowByStep((m) => ({
                                ...m,
                                [wizard.step]: e.target.value || undefined,
                              }))
                            }
                          />
                          {r.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                {(() => {
                  if (!selectedRow && group.length > 1) {
                    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Please select an option above to continue.</p>;
                  }
                  const row = (selectedRow ?? group[0])!;
                  const pkgs = Array.isArray(row?.meta?.packages) ? (row!.meta!.packages as string[]) : [];
                  const pkgCats = (row?.meta?.packageCategories ?? {}) as Record<string, string[]>;
                  const pkgShowWhen = (row?.meta?.packageShowWhen ?? {}) as Record<string, { package: string; category: string | string[] }[]>;
                  const pkgGrpHidden = (row?.meta?.packageGroupLabelsHidden ?? {}) as Record<string, boolean>;
                  const activePkgs = pkgs
                    .filter((p) => packagesOptions.some((po) => po.value === p))
                    .filter((p) => {
                      const rules = pkgShowWhen[p];
                      if (!rules || rules.length === 0) return true;
                      return rules.every((rule) => {
                        const catKey = `${rule.package}__category`;
                        const currentVal = String(wizardFormValues[catKey] ?? "");
                        if (!currentVal) return false;
                        const allowed = Array.isArray(rule.category) ? rule.category : [rule.category];
                        return allowed.includes(currentVal);
                      });
                    });
                  if (activePkgs.length === 0) return null;
                  const csv = (row?.meta?.categoryStepVisibility ?? {}) as Record<string, string[]>;
                  const allSelectedBranches = new Set(
                    Object.entries(selectedRowByStep)
                      .filter(([stepNum]) => Number(stepNum) !== wizard.step)
                      .map(([, val]) => val)
                      .filter(Boolean) as string[],
                  );
                  let csvFilteredCats: string[] | undefined;
                  if (Object.keys(csv).length > 0 && allSelectedBranches.size > 0) {
                    csvFilteredCats = Object.entries(csv)
                      .filter(([, targetSteps]) => targetSteps.some((ts) => allSelectedBranches.has(ts)))
                      .map(([catVal]) => catVal);
                  }
                  return activePkgs.map((p) => {
                    const baseCats = pkgCats[p];
                    const finalAllowedCats = csvFilteredCats
                      ? baseCats
                        ? baseCats.filter((c) => csvFilteredCats!.includes(c))
                        : csvFilteredCats
                      : baseCats;
                    return (
                      <PackageBlock
                        key={`${p}-${refreshTick}`}
                        form={form}
                        pkg={p}
                        allowedCategories={finalAllowedCats}
                        isAdmin={currentUserType === "admin"}
                        viewerUserType={currentUserType ?? undefined}
                        hideGroupLabels={!!pkgGrpHidden[p]}
                      />
                    );
                  });
                })()}
              </div>
            );
          })()}

          {typeof getClientId(wizard.policy) === "number" ? (
            <div className={`rounded-md border p-3 text-sm flex items-center justify-between ${
              clientWasCreatedByButton
                ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300"
                : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
            }`}>
              <span>
                Client #{getClientId(wizard.policy)} {clientWasCreatedByButton ? "created successfully" : "selected"}.
              </span>
              <button
                type="button"
                className="underline text-xs"
                onClick={() => {
                  setClientWasCreatedByButton(false);
                  setWizard((w) => ({ ...w, policy: { ...(w.policy ?? {}), clientId: undefined } }));
                }}
              >
                Clear
              </button>
            </div>
          ) : null}

          <Separator />

          {/* Agent picker drawer (admin/internal only) */}
          {wizard.step === 3 && (currentUserType === "admin" || currentUserType === "internal_staff") && agentPickerOpen ? (
            <SlideDrawer open={agentDrawerOpen} onClose={() => setAgentPickerOpen(false)} title="Select Agent">
              <div className="p-3 text-sm space-y-2">
                <Input
                  placeholder="Search agents…"
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                />
                <div className="max-h-[70vh] overflow-auto space-y-2">
                  {loadingAgentList ? (
                    <div className="text-neutral-500 dark:text-neutral-400">Loading…</div>
                  ) : filteredAgents.length === 0 ? (
                    <div className="text-neutral-500 dark:text-neutral-400">No agents.</div>
                  ) : (
                    filteredAgents.map((a) => {
                      const label =
                        (a.userNumber ? `${a.userNumber} — ` : "") +
                        (a.name ?? "") +
                        ` <${a.email}>`;
                      const isPending = a.hasCompletedSetup === false;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => chooseAgent(a.id)}
                          className="flex w-full items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1 text-left transition-colors hover:border-green-500 hover:bg-green-50 hover:text-green-700 dark:border-neutral-800 dark:hover:border-green-500 dark:hover:bg-green-900/30 dark:hover:text-green-300"
                          title={isPending ? "Account created but the agent has not completed the invite flow yet." : undefined}
                        >
                          <span className="min-w-0 truncate">{label}</span>
                          {isPending && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                              Setup Pending
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </SlideDrawer>
          ) : null}

          {(() => {
            // If dynamic flow exists, handle navigation dynamically
            if (Array.isArray(steps) && steps.length > 0) {
              const sorted = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
              const defined = sorted
                .map((s) => Number(s.meta?.wizardStep ?? 0))
                .filter((n) => Number.isFinite(n) && n > 0) as number[];
              let auto = defined.length > 0 ? Math.max(...defined) : 0;
              const groups: Record<number, (typeof steps)[number][]> = {};
              for (const s of sorted) {
                let n = Number(s.meta?.wizardStep ?? 0);
                if (!Number.isFinite(n) || n <= 0) n = ++auto;
                if (!groups[n]) groups[n] = [];
                groups[n]!.push(s);
              }
              const maxStep = Object.keys(groups).map((k) => Number(k)).reduce((a, b) => Math.max(a, b), 0);
              const group = groups[wizard.step] ?? [];
              const requiresSelection = group.length > 1;
              const isFinal = wizard.step >= maxStep || group.some((r) => Boolean(r.meta?.isFinal));
              // Compute branch now to set button label
              const selectedRowValueForLabel = selectedRowByStep[wizard.step];
              const selectedRowForLabel =
                group.length === 1 ? group[0] : group.find((r) => r.value === selectedRowValueForLabel) ?? null;
              const selectedLabelForLabel = String(selectedRowForLabel?.label ?? "").toLowerCase();
              const selectedValueForLabel = String(selectedRowForLabel?.value ?? "").toLowerCase();
              const metaHintRawForLabel = String(
                (selectedRowForLabel?.meta as Record<string, unknown> | undefined)?.["branch"] ??
                  (selectedRowForLabel?.meta as Record<string, unknown> | undefined)?.["branchType"] ??
                  (selectedRowForLabel?.meta as Record<string, unknown> | undefined)?.["mode"] ??
                  "",
              ).toLowerCase();
              const hasWordForLabel = (s: string, w: string) => new RegExp(`(?:^|[^a-z])${w}(?:[^a-z]|$)`).test(s);
              const metaExistingForLabel = ["existing", "existing_client", "existingclient"].includes(metaHintRawForLabel);
              const metaCreateForLabel = ["new", "create", "new_client", "create_client"].includes(metaHintRawForLabel);
              const labelExistingForLabel = hasWordForLabel(selectedLabelForLabel, "existing");
              const labelCreateForLabel = hasWordForLabel(selectedLabelForLabel, "create") || hasWordForLabel(selectedLabelForLabel, "new");
              const valueExistingForLabel = hasWordForLabel(selectedValueForLabel, "existing");
              const valueCreateForLabel = hasWordForLabel(selectedValueForLabel, "create") || hasWordForLabel(selectedValueForLabel, "new");
              let isExistingBranchForLabel = false;
              if (metaExistingForLabel || metaCreateForLabel) {
                isExistingBranchForLabel = metaExistingForLabel && !metaCreateForLabel;
              } else if (labelExistingForLabel || labelCreateForLabel) {
                isExistingBranchForLabel = labelExistingForLabel && !labelCreateForLabel;
              } else {
                isExistingBranchForLabel = valueExistingForLabel && !valueCreateForLabel;
              }
              // If on Step 1, infer from field keys (same aliases as click handler)
              if (wizard.step === 1) {
                try {
                  const allValues = form.getValues() as Record<string, unknown>;
                  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
                  const keyCandidates = Object.keys(allValues).filter((k) => {
                    const nk = normalize(k);
                    return (
                      nk.includes("existorcreateclient") ||
                      nk.includes("newexistingclient") ||
                      nk.includes("neworexistingclient") ||
                      nk.includes("existingornewclient") ||
                      nk.includes("newexisting") ||
                      nk.includes("existcreate") ||
                      nk.includes("existingclient")
                    );
                  });
                  for (const k of keyCandidates) {
                    const raw = allValues[k];
                    const vs = typeof raw === "string" ? raw : "";
                    const nv = normalize(vs);
                    if (nv === "chooseclient" || nv === "chooseexistingclient" || (/^choose/.test(nv) && nv.includes("client"))) {
                      isExistingBranchForLabel = true;
                      break;
                    }
                    if (nv === "createnclient" || nv.includes("create") || nv.includes("new")) {
                      isExistingBranchForLabel = false;
                      break;
                    }
                  }
                } catch {}
              }
              const buttonText =
                !isFinal &&
                wizard.step === 2 &&
                !isExistingBranchForLabel &&
                !(typeof getClientId(wizard.policy) === "number")
                  ? "Create Client"
                  : isFinal
                    ? "Finish"
                    : "Continue";
              return (
                <div className="pt-2 flex items-center justify-end gap-2">
                  <Button variant="outline" onClick={() => window.history.back()}>
                    <X className="h-4 w-4 sm:hidden lg:inline" />
                    <span className="hidden sm:inline">Cancel</span>
                  </Button>
                  {typeof getClientId(wizard.policy) !== "number" ? (
                    isCreateNewClientMode ? (
                      <Button variant="secondary" onClick={handleCreateClient} disabled={creatingClient}>
                        {creatingClient ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <UserPlus className="h-4 w-4 sm:hidden lg:inline" />
                        )}
                        <span className="hidden sm:inline">{creatingClient ? "Creating…" : "Create Client"}</span>
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => setClientPickerOpen(true)}>
                        <UserSearch className="h-4 w-4 sm:hidden lg:inline" />
                        <span className="hidden sm:inline">Select Existing Client</span>
                      </Button>
                    )
                  ) : null}
                  {hasUnsavedClientEdits ? (
                    <Button
                      variant="secondary"
                      onClick={() => void handleUpdateClient()}
                      disabled={updateClientBusy}
                    >
                      {updateClientBusy ? (
                        <Loader2 className="h-4 w-4 sm:hidden lg:inline animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 sm:hidden lg:inline" />
                      )}
                      <span className="hidden sm:inline">{updateClientBusy ? "Saving…" : "Update Client"}</span>
                    </Button>
                  ) : null}
              <Button
              onClick={() => {
                    (async () => {
                      try {
                        // Determine selected branch for this wizard step (if any)
                        const selectedRowValue = selectedRowByStep[wizard.step];
                        // If multiple choices are presented, require an explicit selection BEFORE any branch logic
                        if (requiresSelection && !selectedRowByStep[wizard.step]) {
                          toast.error("Please choose an option to continue.");
                          return;
                        }
                        const selectedRow =
                          group.length === 1 ? group[0] : group.find((r) => r.value === selectedRowValue) ?? null;
                        const selectedLabel = String(selectedRow?.label ?? "").toLowerCase();
                        const selectedValue = String(selectedRow?.value ?? "").toLowerCase();
                        // Branch detection priorities:
                        // 1) Explicit meta hints if present
                        // 2) Label tokens (preferred over value)
                        // 3) Value tokens as fallback
                        const metaHintRaw = String(
                          (selectedRow?.meta as Record<string, unknown> | undefined)?.["branch"] ??
                          (selectedRow?.meta as Record<string, unknown> | undefined)?.["branchType"] ??
                          (selectedRow?.meta as Record<string, unknown> | undefined)?.["mode"] ??
                          ""
                        ).toLowerCase();
                        const metaExisting = ["existing", "existing_client", "existingclient"].includes(metaHintRaw);
                        const metaCreate = ["new", "create", "new_client", "create_client"].includes(metaHintRaw);
                        const hasWord = (s: string, w: string) => new RegExp(`(?:^|[^a-z])${w}(?:[^a-z]|$)`).test(s);
                        const labelExisting = hasWord(selectedLabel, "existing");
                        const labelCreate = hasWord(selectedLabel, "create") || hasWord(selectedLabel, "new");
                        const valueExisting = hasWord(selectedValue, "existing");
                        const valueCreate = hasWord(selectedValue, "create") || hasWord(selectedValue, "new");
                        let isExistingBranch = false;
                        if (metaExisting || metaCreate) {
                          isExistingBranch = metaExisting && !metaCreate;
                        } else if (labelExisting || labelCreate) {
                          isExistingBranch = labelExisting && !labelCreate;
                        } else {
                          isExistingBranch = valueExisting && !valueCreate;
                        }
                        // Step-1 heuristic override: infer user's explicit choice from form field VALUES.
                        // Namespaced keys (containing "__") take priority over raw keys set by intent handler.
                        if (wizard.step === 1) {
                          const allValues = form.getValues() as Record<string, unknown>;
                          const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
                          const keyCandidates = Object.keys(allValues).filter((k) => {
                            const nk = normalize(k);
                            return (
                              nk.includes("existorcreateclient") ||
                              nk.includes("newexistingclient") ||
                              nk.includes("neworexistingclient") ||
                              nk.includes("existingornewclient") ||
                              nk.includes("newexisting") ||
                              nk.includes("existcreate") ||
                              nk.includes("existingclient")
                            );
                          });
                          let nsBranch: "existing" | "create" | null = null;
                          let rawBranch: "existing" | "create" | null = null;
                          for (const k of keyCandidates) {
                            const raw = allValues[k];
                            const vs = typeof raw === "string" ? raw : "";
                            const nv = normalize(vs);
                            let branch: "existing" | "create" | null = null;
                            if (nv === "chooseclient" || nv === "chooseexistingclient" || (/^choose/.test(nv) && nv.includes("client"))) {
                              branch = "existing";
                            } else if (nv === "createnclient" || nv.includes("create") || nv.includes("new")) {
                              branch = "create";
                            } else if (/\bexisting\b/.test(vs.toLowerCase())) {
                              branch = "existing";
                            } else if (/\b(create|new)\b/.test(vs.toLowerCase())) {
                              branch = "create";
                            }
                            if (branch !== null) {
                              if (k.includes("__")) nsBranch = branch;
                              else rawBranch = branch;
                            }
                          }
                          const branchFromField = nsBranch ?? rawBranch;
                          if (branchFromField) {
                            isExistingBranch = branchFromField === "existing";
                          }
                        }
                        // Second pass: read the user's explicit selection from form fields inside packages.
                        // Namespaced keys (containing "__") take priority over raw keys.
                        if (wizard.step === 1) {
                          const allValues = form.getValues() as Record<string, unknown>;
                          let nsExisting = false, nsCreate = false;
                          let rawExisting = false, rawCreate = false;
                          for (const [k, v] of Object.entries(allValues)) {
                            const kLower = String(k ?? "").toLowerCase();
                            const vLower = typeof v === "string" ? v.toLowerCase() : "";
                            const keyRelevant =
                              /\bclient\b/.test(kLower) &&
                              (/\bexisting\b/.test(kLower) || /\bnew\b/.test(kLower) || /\bcreate\b/.test(kLower));
                            const valExisting =
                              /\bexisting\b/.test(vLower) || ["existing", "existing_client", "existingclient", "use_existing"].includes(vLower);
                            const valCreate = /\b(new|create)\b/.test(vLower) || ["new", "create", "new_client", "create_client"].includes(vLower);
                            if (keyRelevant || valExisting || valCreate) {
                              if (k.includes("__")) {
                                nsExisting ||= valExisting && !valCreate;
                                nsCreate ||= valCreate && !valExisting;
                              } else {
                                rawExisting ||= valExisting && !valCreate;
                                rawCreate ||= valCreate && !valExisting;
                              }
                            }
                          }
                          const hasNs = nsExisting || nsCreate;
                          const saysExistingForm = hasNs ? nsExisting : rawExisting;
                          const saysCreateForm = hasNs ? nsCreate : rawCreate;
                          if (saysExistingForm || saysCreateForm) {
                            isExistingBranch = saysExistingForm && !saysCreateForm;
                          }
                        }
                        // If user chose "existing client" but no clientId yet, open picker and stop here
                        if (isExistingBranch) {
                          const hasClientId = typeof getClientId(wizard.policy) === "number";
                          if (!hasClientId) {
                            setClientPickerOpen(true);
                            return;
                          }
                          // When clientId present, still snapshot insured/contact updates (do not discard user edits)
                          const values = form.getValues() as Record<string, unknown>;
                          const dirtyKeys = getDirtyClientInfoFieldNames();
                          const dirtySet = new Set(
                            (dirtyKeys ?? [])
                              .map((k) => String(k ?? "").split(".")[0] ?? "")
                              .filter((s) => Boolean(s))
                          );
                          const insured = buildInsuredSnapshot(values, dirtySet);
                          const clientId = getClientId(wizard.policy);
                          const proceed = async () => {
                            setWizard((w) => ({
                              ...w,
                              insured: { ...(w.insured ?? {}), ...insured },
                              step: isFinal ? w.step : w.step + 1,
                              highestCompletedStep: Math.max(w.highestCompletedStep, w.step),
                            }));
                            if (isFinal) {
                              toast.success("Completed", { duration: 1000 });
                              router.push(flowKey ? `/dashboard/flows/${encodeURIComponent(flowKey)}` : "/dashboard");
                            }
                          };
                          if (typeof clientId === "number") {
                            const dirtyKeys = getDirtyClientInfoFieldNames();
                            const dirtySetForCheck = new Set(
                              (dirtyKeys ?? [])
                                .map((k) => String(k ?? "").split(".")[0] ?? "")
                                .filter((s) => Boolean(s))
                            );
                            const snapshotForCheck = extractClientSnapshotFromValues(values, dirtySetForCheck);
                            const normalizedForCheckAll = normalizePrefixedKeysForClientUpdate(snapshotForCheck, dirtySetForCheck);
                            const normalizedForCheck = filterClientUpdatePayload(normalizedForCheckAll, dirtySetForCheck);
                            const categoryForCheck = getCategoryFromValues(values);
                            const baseCategory = existingClientBaselineCategoryRef.current ?? null;
                            const hasCategoryChange =
                              typeof categoryForCheck !== "undefined" &&
                              (categoryForCheck === "company" || categoryForCheck === "personal") &&
                              categoryForCheck !== baseCategory;
                            const hasClientChanges = Object.keys(normalizedForCheck).length > 0 || hasCategoryChange;
                            if (hasClientChanges) {
                              try {
                                const debugEnabled =
                                  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
                                if (debugEnabled) {
                                  console.log("Client-update check (existing branch)", {
                                    step: wizard.step,
                                    dirtyKeys,
                                    normalizedForCheckAll,
                                    normalizedForCheck,
                                    baseCategory,
                                    categoryForCheck,
                                    hasCategoryChange,
                                  });
                                }
                              } catch {
                                // ignore debug logging
                              }
                              pendingClientUpdateRef.current = { clientId, proceed, autoProceedAfterSave: true };
                              // If RHF dirtyFields missed changes (common for cleared number inputs),
                              // fall back to listing the computed keys.
                              const keysForDisplay =
                                dirtyKeys.length > 0
                                  ? dirtyKeys
                                  : Object.keys(normalizedForCheck).length > 0
                                    ? Object.keys(normalizedForCheck)
                                    : hasCategoryChange
                                      ? ["insuredType"]
                                      : [];
                              setClientUpdateDirtyKeys(keysForDisplay);
                              setClientUpdateConfirmOpen(true);
                              return;
                            }
                          }
                          proceed();
                          return;
                        }
                        // For Step 1 "Create a New Client" branch: advance to next step (skip when isFinal — let finish logic handle it)
                        if (wizard.step === 1 && !isExistingBranch && !isFinal) {
                          const values = form.getValues() as Record<string, unknown>;
                          setWizard((w) => ({
                            ...w,
                            insured: { ...(w.insured ?? {}), ...values },
                            step: w.step + 1,
                            highestCompletedStep: Math.max(w.highestCompletedStep, w.step),
                          }));
                          return;
                        }
                        // For other steps/branches, validate insured fields as configured
                        const ok = await form.trigger();
                        if (!ok) {
                          toast.error("Please fill in the required fields.");
                          return;
                        }
                        const values = form.getValues() as Record<string, unknown>;
                        // Persist local insured values only (do not advance yet for create-branch on step 2)
                        setWizard((w) => ({
                          ...w,
                          insured: { ...(w.insured ?? {}), ...values },
                        }));
                        if (wizard.step === 2) {
                          const clientId = getClientId(wizard.policy);
                          if (typeof clientId === "number") {
                            const dirtyKeys = getDirtyClientInfoFieldNames();
                            // If the user edited existing client info, confirm before persisting.
                            // The actual payload is computed at click-time in the dialog, so we don't miss late edits.
                            const dirtySetForCheck = new Set(
                              (dirtyKeys ?? [])
                                .map((k) => String(k ?? "").split(".")[0] ?? "")
                                .filter((s) => Boolean(s))
                            );
                            const snapshotForCheck = extractClientSnapshotFromValues(values, dirtySetForCheck);
                            const normalizedForCheckAll = normalizePrefixedKeysForClientUpdate(snapshotForCheck, dirtySetForCheck);
                            const normalizedForCheck = filterClientUpdatePayload(normalizedForCheckAll, dirtySetForCheck);
                            const categoryForCheck = getCategoryFromValues(values);
                            const baseCategory = existingClientBaselineCategoryRef.current ?? null;
                            const hasCategoryChange =
                              typeof categoryForCheck !== "undefined" &&
                              (categoryForCheck === "company" || categoryForCheck === "personal") &&
                              categoryForCheck !== baseCategory;
                            if (Object.keys(normalizedForCheck).length > 0 || hasCategoryChange) {
                              try {
                                const debugEnabled =
                                  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";
                                if (debugEnabled) {
                                  console.log("Step2 client-update check (step2 continue)", {
                                    dirtyKeys,
                                    normalizedForCheckAll,
                                    normalizedForCheck,
                                    baseCategory,
                                    categoryForCheck,
                                    hasCategoryChange,
                                  });
                                }
                              } catch {
                                // ignore debug logging
                              }
                              const proceed = () => {
                                setWizard((w) => ({
                                  ...w,
                                  step: isFinal ? w.step : w.step + 1,
                                  highestCompletedStep: Math.max(w.highestCompletedStep, w.step),
                                }));
                              };
                              pendingClientUpdateRef.current = { clientId, proceed, autoProceedAfterSave: true };
                              const keysForDisplay =
                                dirtyKeys.length > 0
                                  ? dirtyKeys
                                  : Object.keys(normalizedForCheck).length > 0
                                    ? Object.keys(normalizedForCheck)
                                    : hasCategoryChange
                                      ? ["insuredType"]
                                      : [];
                              setClientUpdateDirtyKeys(keysForDisplay);
                              setClientUpdateConfirmOpen(true);
                              return;
                            }
                          } else {
                            toast.success("Client information saved.", { duration: 1000 });
                          }
                        }
                    // For create-branch without a selected clientId, attempt client creation (Step 2 flow)
                    if (!isExistingBranch && !isFinal && !(typeof getClientId(wizard.policy) === "number")) {
                      try {
                        // Build insured_* by collecting all Step 1 fields with insured_/insured__ or contactinfo_/contactinfo__ prefix (same as policy package handling)
                        const insuredOut: Record<string, unknown> = {};
                        for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
                          if (typeof k !== "string") continue;
                          const lower = k.toLowerCase();
                          const isInsured = lower.startsWith("insured_") || lower.startsWith("insured__");
                          const isContact = lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__");
                          if (!isInsured && !isContact) continue;
                          if (v === undefined || v === null) continue;
                          if (typeof v === "string" && v.trim() === "") continue;
                          insuredOut[k] = v;
                        }
                        // Also include explicit insuredType if present
                        const insuredTypeVal = (values as Record<string, unknown>)["insuredType"];
                        if (typeof insuredTypeVal === "string") {
                          const t = insuredTypeVal.trim().toLowerCase();
                          if (t === "company" || t === "personal") insuredOut["insuredType"] = t;
                        }

                        // Backward-compat: if user fields were added without the insured_ prefix, map common aliases
                        const getAlias = (name: string): unknown => {
                          const all = values as Record<string, unknown>;
                          const direct = all[name];
                          if (typeof direct !== "undefined") return direct;
                          // Accept legacy double-underscore suffix convention: anything__fieldName
                          for (const [k, v] of Object.entries(all)) {
                            const kk = String(k ?? "");
                            if (kk.toLowerCase().endsWith(`__${name.toLowerCase()}`)) return v;
                          }
                          return undefined;
                        };
                        const addIfMissing = (destKey: string, val: unknown) => {
                          if (typeof (insuredOut as Record<string, unknown>)[destKey] === "undefined") {
                            if (typeof val === "string" ? val.trim() !== "" : typeof val !== "undefined" && val !== null) {
                              (insuredOut as Record<string, unknown>)[destKey] = typeof val === "string" ? val.trim() : val;
                            }
                          }
                        };
                        addIfMissing("insured_companyName", getAlias("companyName"));
                        addIfMissing("insured_brNumber", getAlias("brNumber"));
                        addIfMissing("insured_ciNumber", getAlias("ciNumber"));
                        addIfMissing("insured_firstName", getAlias("firstName"));
                        addIfMissing("insured_lastName", getAlias("lastName"));
                        addIfMissing("insured_fullName", getAlias("fullName"));
                        addIfMissing("insured_idNumber", getAlias("idNumber"));
                        addIfMissing("insured_contactPhone", getAlias("contactPhone"));
                        addIfMissing("insured_contactName", getAlias("contactName"));
                        addIfMissing("insured_contactEmail", getAlias("contactEmail"));

                        const hasAnyInsured = Object.keys(insuredOut).length > 0;
                        if (hasAnyInsured) {
                          const ok = window.confirm("Confirm create a new client account?");
                          if (!ok) return;
                          const resClient = await fetch("/api/clients", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ insured: insuredOut }),
                          });
                          const jClient = await resClient.json().catch(() => ({}));
                          if (resClient.ok && typeof jClient?.clientId === "number") {
                            setWizard((w) => ({
                              ...w,
                              policy: { ...(w.policy ?? {}), clientId: jClient.clientId },
                            }));
                            toast.success(
                              `${jClient.existed ? "Existing client" : "Client created"}: ${jClient.clientNumber ?? jClient.clientId}`
                            );
                            // Ask to continue creating a new policy
                            const cont = window.confirm("Continue to create new policy?");
                            if (cont) {
                              setWizard((w) => ({
                                ...w,
                                step: isFinal ? w.step : w.step + 1,
                                highestCompletedStep: Math.max(w.highestCompletedStep, w.step),
                              }));
                            } else {
                              // End the flow and return to dashboard
                              router.push(flowKey ? `/dashboard/flows/${encodeURIComponent(flowKey)}` : "/dashboard");
                            }
                          } else {
                            toast.error(jClient?.error ?? "Failed to create/find client");
                          }
                        } else {
                          toast.error("Please provide insured/contact information to create client.");
                          return;
                        }
                      } catch {
                        toast.error("Failed to create/find client");
                      }
                    } else {
                      // Not a create-branch requiring client creation: advance normally
                      setWizard((w) => ({
                        ...w,
                        step: isFinal ? w.step : w.step + 1,
                        highestCompletedStep: Math.max(w.highestCompletedStep, w.step),
                      }));
                    }
                        if (isFinal) {
                          if (isCreateNewClientMode && typeof getClientId(wizard.policy) !== "number") {
                            toast.error("Please click \"Create Client\" to create the client first.");
                            return;
                          }
                          // Build packages payload from ALL configured steps, not just the current step
                          const sortedAll = [...steps].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
                          const allPkgs = Array.from(
                            new Set(
                              sortedAll.flatMap((s) =>
                                Array.isArray(s?.meta?.packages) ? ((s.meta!.packages as string[]) ?? []) : []
                              )
                            )
                          ) as string[];
                          const packagesPayload: Record<string, { category?: string; values: Record<string, unknown> }> = {};
                          const dirtyAllNames = (() => {
                            try {
                              const dirtyRaw = (form.formState.dirtyFields ?? {}) as unknown;
                              return collectDirtyFieldNames(dirtyRaw);
                            } catch {
                              return [] as string[];
                            }
                          })();
                          const dirtyAllSet = new Set(
                            (dirtyAllNames ?? [])
                              .map((k) => String(k ?? "").split(".")[0] ?? "")
                              .filter((s) => Boolean(s))
                          );

                          for (const p of allPkgs) {
                            const prefixes = [`${p}__`, `${p}_`];
                            const categoryKeys = [`${p}_category`, `${p}__category`];
                            const pkgValues: Record<string, unknown> = {};
                            const bestByToken = new Map<string, { fieldKey: string; value: unknown; score: number }>();
                            for (const [k, v] of Object.entries(values)) {
                              if (categoryKeys.includes(k)) continue;
                              if (k.includes("___linked")) continue;
                              const matchPrefix = prefixes.find((pre) => k.startsWith(pre));
                              if (!matchPrefix) continue;
                              const fieldKey = k.slice(matchPrefix.length);
                              if (!fieldKey) continue;
                              const isLegacy = matchPrefix.endsWith("__");
                              const token = fieldKey.toLowerCase().replace(/[^a-z0-9]/g, "");
                              if (!token) continue;
                              const isDirty = dirtyAllSet.has(k) || dirtyAllSet.has(k.toLowerCase());
                              // Prefer the actual PackageBlock key (`__`) and prefer user-edited (dirty) values.
                              const score = (isDirty ? 100 : 0) + (isLegacy ? 10 : 0) + (k === k.toLowerCase() ? 1 : 0);
                              const prev = bestByToken.get(token);
                              if (!prev || score > prev.score) {
                                bestByToken.set(token, { fieldKey, value: v, score });
                              }
                            }
                            for (const rec of bestByToken.values()) {
                              pkgValues[rec.fieldKey] = rec.value;
                            }
                            let categoryValue: string | undefined = undefined;
                            for (const ck of categoryKeys) {
                              if (typeof values[ck] !== "undefined" && values[ck] !== null && String(values[ck]).trim() !== "") {
                                categoryValue = String(values[ck]);
                                break;
                              }
                            }
                            packagesPayload[p] = {
                              category: categoryValue,
                              values: pkgValues,
                            };
                          }
                          const res = await fetch("/api/policies", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              packages: packagesPayload,
                              // IMPORTANT: create the policy snapshot from canonical client-info keys only,
                              // so we don't store duplicate legacy variants in `insuredSnapshot`.
                              insured: (() => {
                                const snapshot = extractClientSnapshotFromValues(values as Record<string, unknown>, dirtyAllSet);
                                const normalized = normalizePrefixedKeysForClientUpdate(snapshot, dirtyAllSet);
                                return normalized;
                              })(),
                              policy: (wizard.policy ?? {}),
                              ...(flowKey ? { flowKey } : {}),
                            }),
                          });
                          const json = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            throw new Error(json?.error ?? "Submit failed");
                          }
                          toast.success("Policy created", { duration: 1000 });
                          router.push(flowKey ? `/dashboard/flows/${encodeURIComponent(flowKey)}` : "/dashboard");
                        }
                      } catch (err: unknown) {
                        const message = (err as { message?: string } | undefined)?.message ?? "Validation failed";
                        toast.error(message);
                      }
                    })();
                  }}
                >
                  {isFinal ? (
                    <Check className="h-4 w-4 sm:hidden lg:inline" />
                  ) : (
                    <ArrowRight className="h-4 w-4 sm:hidden lg:inline" />
                  )}
                  <span className="hidden sm:inline">{buttonText}</span>
                </Button>
                </div>
              );
            }
            // Fallback legacy flow
            return (
              <>
          {wizard.step === 1 ? (
            <div className="pt-2 flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => window.history.back()}>
                Cancel
              </Button>
              {hasUnsavedClientEdits ? (
                <Button
                  variant="secondary"
                  onClick={() => void handleUpdateClient()}
                  disabled={updateClientBusy}
                >
                  {updateClientBusy ? (
                    <Loader2 className="h-4 w-4 sm:hidden lg:inline animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 sm:hidden lg:inline" />
                  )}
                  <span className="hidden sm:inline">{updateClientBusy ? "Saving…" : "Update Client"}</span>
                </Button>
              ) : null}
              <Button
                      disabled={insuredTypes.length === 0}
                onClick={() => {
                  (async () => {
                    try {
                      // If an existing client has been selected already, skip creation and proceed
                      if (typeof getClientId(wizard.policy) === "number") {
                        setWizard((w) => ({
                          ...w,
                          step: 2,
                          highestCompletedStep: Math.max(w.highestCompletedStep, 1),
                        }));
                        return;
                      }
                      const ok = await form.trigger();
                      if (!ok) {
                        toast.error("Please fill in the required fields.");
                        return;
                      }
                      const values = form.getValues();
                      // Step 1 only: ask before attempting to create/find client (legacy flow) — only if minimum data present
                      let shouldCreate = false;
                      {
                        const getVal = (key: string): unknown => {
                          const direct = (values as Record<string, unknown>)[key];
                          if (typeof direct !== "undefined") return direct;
                          const lower = key.toLowerCase();
                          for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
                            const kk = String(k ?? "");
                            const nk = kk.toLowerCase();
                            if (nk.endsWith(`__${lower}`) || nk === lower) return v;
                          }
                          return undefined;
                        };
                        const pickByTokens = (tokens: string[]): unknown => {
                          for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
                            const nk = String(k ?? "").toLowerCase();
                            if (tokens.some((t) => nk.includes(t))) {
                              if (typeof v === "string" && v.trim().length > 0) return v;
                            }
                          }
                          return undefined;
                        };
                        const hasCompanyMin =
                          Boolean(getVal("companyName") ?? pickByTokens(["insured_companyname","companyname","organisationname","orgname","company name","company","org"])) ||
                          Boolean(getVal("brNumber") ?? pickByTokens(["insured_brnumber","br number","brnumber","businessreg","brno","registration"])) ||
                          Boolean(getVal("ciNumber") ?? pickByTokens(["insured_cinumber","cinumber","ci number","ci"]));
                        const firstName = getVal("firstName") ?? pickByTokens(["insured_firstname","firstname","first name"]);
                        const lastName = getVal("lastName") ?? pickByTokens(["insured_lastname","lastname","last name","surname","family"]);
                        const fullName = getVal("fullName") ?? pickByTokens(["insured_fullname","fullname","name"]);
                        const idNumber = getVal("idNumber") ?? pickByTokens(["insured_idnumber","hkid","idnumber","id"]);
                        const hasPersonalMin = Boolean(fullName) || Boolean(idNumber) || (Boolean(firstName) && Boolean(lastName));
                        const hasMinimum = hasCompanyMin || hasPersonalMin;
                        shouldCreate = hasMinimum ? window.confirm("confirm Create a New Client Account? ") : false;
                      }
                      if (shouldCreate) {
                      try {
                        const getVal = (key: string): unknown => {
                          const direct = (values as Record<string, unknown>)[key];
                          if (typeof direct !== "undefined") return direct;
                          const lower = key.toLowerCase();
                          for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
                            const kk = String(k ?? "");
                            const nk = kk.toLowerCase();
                            if (nk.endsWith(`__${lower}`) || nk === lower) return v;
                          }
                          return undefined;
                        };
                        const pickByTokens = (tokens: string[]): unknown => {
                          for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
                            const nk = String(k ?? "").toLowerCase();
                            if (tokens.some((t) => nk.includes(t))) {
                              if (typeof v === "string" && v.trim().length > 0) return v;
                            }
                          }
                          return undefined;
                        };
                        const insuredPayload: Record<string, unknown> = {
                          insuredType: (getVal("insuredType") ?? values.insuredType) as unknown,
                        };
                        const insuredType = String(insuredPayload.insuredType ?? "").trim();
                        if (insuredType === "company") {
                          insuredPayload.companyName =
                            getVal("companyName") ??
                            pickByTokens(["companyname", "organisationname", "orgname", "company name", "company", "org"]);
                          insuredPayload.brNumber =
                            getVal("brNumber") ?? pickByTokens(["br number", "brnumber", "businessreg", "brno", "registration"]);
                          const ciNum = getVal("ciNumber") ?? pickByTokens(["cinumber", "ci number", "ci"]);
                          if (!insuredPayload.brNumber && ciNum) {
                            insuredPayload.brNumber = ciNum;
                          }
                          insuredPayload.contactName = getVal("contactName");
                          insuredPayload.contactPhone = getVal("contactPhone") ?? pickByTokens(["phone", "mobile"]);
                        } else if (insuredType === "personal") {
                          const firstName = getVal("firstName") ?? pickByTokens(["firstname", "first name"]);
                          const lastName = getVal("lastName") ?? pickByTokens(["lastname", "last name", "surname", "family"]);
                          const nameField = getVal("fullName") ?? pickByTokens(["fullname", "name"]);
                          insuredPayload.fullName =
                            typeof nameField === "string" && nameField.trim()
                              ? nameField
                              : [lastName, firstName].map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join(" ");
                          insuredPayload.idNumber = getVal("idNumber") ?? pickByTokens(["hkid", "idnumber", "id"]);
                          insuredPayload.dob = getVal("dob") ?? pickByTokens(["dob", "birth", "birthdate", "date of birth"]);
                          const hdl = getVal("hasDrivingLicense");
                          if (typeof hdl !== "undefined") {
                            insuredPayload.hasDrivingLicense = hdl;
                          }
                          const d1 = getVal("driver1");
                          if (typeof d1 !== "undefined") {
                            insuredPayload.driver1 = d1;
                          }
                        }
                        const parsed = InsuredSchema.safeParse(insuredPayload);
                        if (parsed.success) {
                          const resClient = await fetch("/api/clients", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ insured: parsed.data as Record<string, unknown> }),
                          });
                          const jClient = await resClient.json().catch(() => ({}));
                          if (resClient.ok && typeof jClient?.clientId === "number") {
                            setWizard((w) => ({
                              ...w,
                              policy: { ...(w.policy ?? {}), clientId: jClient.clientId },
                            }));
                            toast.success(
                              `${jClient.existed ? "Existing client" : "Client created"}: ${jClient.clientNumber ?? jClient.clientId}`
                            );
                          } else {
                            toast.error(jClient?.error ?? "Failed to create/find client");
                          }
                        }
                      } catch {
                        toast.error("Failed to create/find client");
                      }
                      } // end shouldCreate
                      setWizard((w) => ({
                        ...w,
                        insured: values,
                        step: 2,
                              highestCompletedStep: Math.max(w.highestCompletedStep, 1),
                      }));
                    } catch (err: unknown) {
                            const message = (err as { message?: string } | undefined)?.message ?? "Validation failed";
                            toast.error(message);
                    }
                  })();
                }}
              >
                Continue
              </Button>
            </div>
          ) : null}
              </>
            );
          })()}
        </CardContent>
      </Card>
      {/* Existing Client Picker - left drawer (like policy details) */}
      <Drawer
        open={clientPickerOpen}
        onOpenChange={(open) => {
          if (open) {
            setClientPickerOpen(true);
          } else {
            // play exit animation briefly before unmount
            setClientDrawerOpen(false);
            setTimeout(() => setClientPickerOpen(false), 320);
          }
        }}
        overlayClassName={`transition-opacity duration-300 ${clientDrawerOpen ? "opacity-60" : "opacity-0"}`}
      >
        <DrawerContent
          className={`${clientDrawerOpen ? "translate-x-0" : "-translate-x-full"} w-[280px] sm:w-[320px] md:w-[380px]`}
        >
          <DrawerHeader>
            <DrawerTitle>Select Existing Client</DrawerTitle>
          </DrawerHeader>
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search by client no., name, category…"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
              />
            </div>
            <div className="max-h-[65vh] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
              {loadingClients ? (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-5/6" />
                  <Skeleton className="h-6 w-4/6" />
                </div>
              ) : filteredClients.length === 0 ? (
                <div className="p-3 text-sm text-neutral-500 dark:text-neutral-400">No clients found.</div>
              ) : (
                <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {filteredClients.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{r.clientNumber}</div>
                        <div className="truncate">{r.displayName}</div>
                        <div className="text-xs capitalize text-neutral-500 dark:text-neutral-400">{r.category}</div>
                      </div>
                      <Button size="sm" onClick={() => void chooseExistingClient(r.id)}>
                        Select
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
      {Array.isArray(steps) && steps.length === 0 && wizard.step >= 2 ? (
        <>
          <div className="py-8">
            <Separator />
          </div>
          {wizard.step === 2 ? (
            <VehicleStep
              initialValues={wizard.vehicle as Record<string, unknown>}
              onComplete={(v) =>
                setWizard((w) => ({
                  ...w,
                  vehicle: v,
                  step: 3,
                  highestCompletedStep: (Math.max(w.highestCompletedStep, 2) as 1 | 2 | 3 | 4),
                }))
              }
            />
          ) : null}
        </>
      ) : null}

      {Array.isArray(steps) && steps.length === 0 && wizard.step >= 3 ? (
        <>
          <div className="py-8">
            <Separator />
          </div>
          {wizard.step === 3 ? (
            <PolicyStep
              initialValues={wizard.policy as Partial<Record<string, unknown>>}
              flowKey={flowKey}
              onComplete={(p) =>
                setWizard((w) => ({
                  ...w,
                  policy: p,
                  step: 4,
                  highestCompletedStep: (Math.max(w.highestCompletedStep, 3) as 1 | 2 | 3 | 4),
                }))
              }
            />
          ) : null}
        </>
      ) : null}


      <Dialog
        open={clientUpdateConfirmOpen}
        onOpenChange={(open) => {
          // Allow closing without continuing (Cancel)
          if (!open && clientUpdateConfirmBusy) return;
          if (!open) {
            pendingClientUpdateRef.current = null;
            setClientUpdateDirtyKeys([]);
          }
          setClientUpdateConfirmOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update client information?</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-neutral-600 dark:text-neutral-300 space-y-2">
            <div>
              You changed existing client details. Do you want to save these changes to the client record now?
              This will update the client even if you don’t finish creating a new policy.
            </div>
            {clientUpdateDirtyKeys.length > 0 ? (
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Changes detected:{" "}
                {clientUpdateDirtyKeys
                  .slice(0, 6)
                  .map((k) => humanizeClientFieldName(k))
                  .join(", ")}
                {clientUpdateDirtyKeys.length > 6 ? "…" : ""}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (clientUpdateConfirmBusy) return;
                // Stay on the current step
                pendingClientUpdateRef.current = null;
                setClientUpdateDirtyKeys([]);
                setClientUpdateConfirmOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (clientUpdateConfirmBusy) return;
                const pending = pendingClientUpdateRef.current;
                pendingClientUpdateRef.current = null;
                setClientUpdateDirtyKeys([]);
                setClientUpdateConfirmOpen(false);
                void pending?.proceed();
              }}
            >
              No, continue
            </Button>
            <Button
              onClick={() => {
                (async () => {
                  const pending = pendingClientUpdateRef.current;
                  if (!pending) {
                    setClientUpdateConfirmOpen(false);
                    return;
                  }
                  setClientUpdateConfirmBusy(true);
                  try {
                    // Recompute payload *now* to avoid missing late edits.
                    const valuesNow = form.getValues() as Record<string, unknown>;
                    const dirtyNow = getDirtyClientInfoFieldNames();
                    const dirtySetNow = new Set(
                      (dirtyNow ?? [])
                        .map((k) => String(k ?? "").split(".")[0] ?? "")
                        .filter((s) => Boolean(s))
                    );
                    const snapshotNow = extractClientSnapshotFromValues(valuesNow, dirtySetNow);
                    const normalizedNowAll = normalizePrefixedKeysForClientUpdate(snapshotNow, dirtySetNow);
                    const normalizedNow = filterClientUpdatePayload(normalizedNowAll, dirtySetNow);
                    const categoryNow = getCategoryFromValues(valuesNow);
                    const result = await patchClientInfoNow(pending.clientId, normalizedNow, categoryNow);
                    // IMPORTANT: Do NOT require moving to the next step for client updates to persist.
                  // If this dialog was triggered by clicking Continue, proceed after saving.
                    if (result?.ok) {
                      // Sync wizard cache so policy creation doesn't re-add deleted fields.
                      // Without this, `wizard.insured` can still contain stale values and later POST /api/policies
                      // can merge them back into the client record.
                      try {
                        setWizard((w) => {
                          const base = ((w.insured ?? {}) as unknown) as Record<string, unknown>;
                          const next: Record<string, unknown> = { ...base };
                          for (const [k, v] of Object.entries(normalizedNow ?? {})) {
                            const kk = String(k ?? "").trim();
                            if (!kk) continue;
                            if (v === null) {
                              delete next[kk];
                            } else {
                              next[kk] = v;
                            }
                          }
                          return { ...w, insured: next };
                        });
                      } catch {
                        // ignore sync failures
                      }
                      // CRITICAL: also sync the canonical, just-saved values back into the RHF form state.
                      // Otherwise, after we clear dirty fields, later policy submission can pick stale prefilled variants
                      // (e.g. `insured__companyName`) and the new policy snapshot becomes "one policy behind".
                      try {
                        const current = form.getValues() as Record<string, unknown>;
                        const normalizedLower = Object.fromEntries(
                          Object.entries(normalizedNow ?? {}).map(([k, v]) => [String(k ?? "").toLowerCase(), v]),
                        ) as Record<string, unknown>;
                        for (const rawKey of Object.keys(current ?? {})) {
                          const k = String(rawKey ?? "");
                          if (!k) continue;
                          const lower = k.toLowerCase();
                          // Direct package-style keys (preferred in UI): `insured__*` / `contactinfo__*`
                          if (lower.startsWith("insured__") || lower.startsWith("contactinfo__")) {
                            const canon = canonicalizePrefixedKey(k);
                            if (canon && Object.prototype.hasOwnProperty.call(normalizedLower, canon)) {
                              const nv = normalizedLower[canon];
                              form.setValue(k as never, ((nv === null ? "" : nv) as never), { shouldDirty: false, shouldTouch: false });
                            }
                            continue;
                          }
                          // Nested package keys: `something__contactinfo_tel` → sync from canonical tail
                          if (lower.includes("__")) {
                            const tail = lower.split("__").pop() ?? "";
                            const tailCanon = canonicalizePrefixedKey(tail);
                            if (tailCanon && Object.prototype.hasOwnProperty.call(normalizedLower, tailCanon)) {
                              const nv = normalizedLower[tailCanon];
                              form.setValue(k as never, ((nv === null ? "" : nv) as never), { shouldDirty: false, shouldTouch: false });
                            }
                          }
                        }
                        // Keep the delete-baseline aligned with what we just saved.
                        const baseline = existingClientBaselineRef.current ?? {};
                        const nextBaseline: Record<string, unknown> = { ...(baseline as Record<string, unknown>) };
                        for (const [k, v] of Object.entries(normalizedLower)) {
                          const ck = canonicalizePrefixedKey(k);
                          if (!ck) continue;
                          if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
                          if (v === null) delete nextBaseline[ck];
                          else nextBaseline[ck] = v;
                        }
                        existingClientBaselineRef.current = nextBaseline;
                        existingClientBaselineIdRef.current = pending.clientId;
                        if (categoryNow === "company" || categoryNow === "personal") {
                          existingClientBaselineCategoryRef.current = categoryNow;
                        }
                      } catch {
                        // ignore form sync failures
                      }
                      try {
                        // Clear RHF dirty state so clicking Continue again doesn't re-prompt.
                        form.reset(form.getValues());
                      } catch {
                        // ignore
                      }
                    if (pending.autoProceedAfterSave) {
                      await pending?.proceed();
                    }
                    }
                    pendingClientUpdateRef.current = null;
                    setClientUpdateDirtyKeys([]);
                    setClientUpdateConfirmOpen(false);
                  } finally {
                    setClientUpdateConfirmBusy(false);
                  }
                })();
              }}
              disabled={clientUpdateConfirmBusy}
              aria-busy={clientUpdateConfirmBusy}
            >
              {clientUpdateConfirmBusy ? "Saving…" : "Yes, save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Small helper field */
// Field extracted to @/components/ui/form-field

function StepDot({
  n,
  active,
  done,
  onClick,
}: {
  n: number;
  active?: boolean;
  done?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-8 items-center gap-2 rounded-md px-3 text-sm ${active ? "bg-neutral-200 dark:bg-neutral-800" : ""}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${done ? "bg-green-500" : active ? "bg-blue-500" : "bg-neutral-400"}`}
      />
      Step {n}
    </button>
  );
}


