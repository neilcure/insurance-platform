"use client";

import * as React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineSelectWithChildren, BooleanBranchFields } from "@/components/policies/InlineSelectWithChildren";

type SelectOption = { label?: string; value?: string };
type RepeatableFieldConfig = {
  label?: string;
  value?: string;
  inputType?: string;
  options?: SelectOption[];
};
type RepeatableConfig = {
  itemLabel?: string;
  min?: number;
  max?: number;
  fields?: RepeatableFieldConfig[];
};
function getRepeatable(raw: unknown): RepeatableConfig {
  if (Array.isArray(raw)) {
    const first = raw[0];
    return (typeof first === "object" && first !== null ? (first as RepeatableConfig) : {}) as RepeatableConfig;
  }
  return (typeof raw === "object" && raw !== null ? (raw as RepeatableConfig) : {}) as RepeatableConfig;
}

function applyLabelCase(text: string, mode?: "original" | "upper" | "lower" | "title"): string {
  if (!mode || mode === "original") return text;
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title") return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

function parseAnyDate(s: string): Date | null {
  const trimmed = String(s ?? "").trim();
  if (!trimmed) return null;
  const ddmmyyyy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (yyyymmdd) {
    const d = new Date(Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function fmtDateDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function resolveFieldValue(
  key: string,
  formValues: Record<string, unknown>,
  pkg: string,
): string {
  const direct = [
    formValues[`${pkg}__${key}`],
    formValues[key],
  ];
  for (const v of direct) {
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  const keyLower = key.toLowerCase();
  for (const [fk, fv] of Object.entries(formValues)) {
    if (fv === undefined || fv === null || fv === "") continue;
    const suffix = fk.includes("__") ? fk.split("__").pop()! : fk;
    if (suffix.toLowerCase() === keyLower) return String(fv);
  }
  return "";
}

function computeFormula(
  formula: string,
  refs: Record<string, string>,
): string {
  if (Object.values(refs).some((v) => v === "")) return "";

  const hasDate = Object.values(refs).some((v) => parseAnyDate(v) !== null);

  if (hasDate) {
    const dateMatch = /^\{([^}]+)\}\s*([+-])\s*(\d+)\s*(d|days?)?$/i.exec(formula.trim());
    if (dateMatch) {
      const refVal = refs[dateMatch[1].trim()] ?? "";
      const baseDate = parseAnyDate(refVal);
      if (!baseDate) return "";
      const offset = Number(dateMatch[3]) * (dateMatch[2] === "-" ? -1 : 1);
      const result = new Date(baseDate);
      result.setDate(result.getDate() + offset);
      return fmtDateDDMMYYYY(result);
    }
    return "";
  }

  const resolved = formula.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const raw = refs[key.trim()] || "0";
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : "0";
  });
  if (!/^[\d\s+\-*/().]+$/.test(resolved)) return "";
  const result = new Function(`"use strict"; return (${resolved});`)() as number;
  if (!Number.isFinite(result)) return "";
  return String(Math.round(result * 100) / 100);
}

function evaluateFormula(
  formula: string,
  formValues: Record<string, unknown>,
  pkg: string,
): string {
  if (!formula) return "";
  try {
    const refs: Record<string, string> = {};
    formula.replace(/\{([^}]+)\}/g, (_, key: string) => {
      refs[key.trim()] = resolveFieldValue(key.trim(), formValues, pkg);
      return "";
    });
    return computeFormula(formula, refs);
  } catch {
    return "";
  }
}

function evaluateRowFormula(
  formula: string,
  rowValues: Record<string, unknown>,
): string {
  if (!formula) return "";
  try {
    const refs: Record<string, string> = {};
    formula.replace(/\{([^}]+)\}/g, (_, key: string) => {
      const v = rowValues[key.trim()];
      refs[key.trim()] = v !== undefined && v !== null && v !== "" ? String(v) : "";
      return "";
    });
    return computeFormula(formula, refs);
  } catch {
    return "";
  }
}

function FormulaField({
  form,
  name,
  formula,
  label,
  required,
  pkg,
  formatDDMMYYYY,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  formula: string;
  label: string;
  required?: boolean;
  pkg: string;
  formatDDMMYYYY: (raw: string) => string;
}) {
  const lastFormula = React.useRef("");
  const isDateResult = React.useRef(false);

  React.useEffect(() => {
    function calc() {
      const vals = form.getValues() as Record<string, unknown>;
      return evaluateFormula(formula, vals, pkg);
    }

    const initial = calc();
    if (initial) {
      isDateResult.current = parseAnyDate(initial) !== null;
      lastFormula.current = initial;
      const current = String(form.getValues(name as never) ?? "").trim();
      if (!current) {
        form.setValue(name as never, initial as never, { shouldDirty: true });
      }
    }

    const sub = form.watch(() => {
      const next = calc();
      if (next && next !== lastFormula.current) {
        isDateResult.current = parseAnyDate(next) !== null;
        lastFormula.current = next;
        form.setValue(name as never, next as never, { shouldDirty: true });
      }
    });
    return () => sub.unsubscribe();
  }, [form, formula, pkg, name]);

  const dateOpts: Record<string, unknown> = {};
  if (isDateResult.current) {
    dateOpts.placeholder = "DD-MM-YYYY";
    dateOpts.inputMode = "numeric";
    dateOpts.onChange = (e: unknown) => {
      const t = e as { target?: { value?: string } };
      const formatted = formatDDMMYYYY(t?.target?.value ?? "");
      form.setValue(name as never, formatted as never, { shouldDirty: true });
    };
  }

  return (
    <div className="space-y-1">
      <Label>
        {label} {required ? <span className="text-red-600">*</span> : null}
      </Label>
      <Input
        type="text"
        {...form.register(name as never, dateOpts)}
      />
    </div>
  );
}

function evaluateShowWhen(
  showWhen: { package: string; category: string | string[] }[] | undefined,
  formValues: Record<string, unknown>,
): boolean {
  if (!showWhen || !Array.isArray(showWhen) || showWhen.length === 0) return true;
  return showWhen.every((rule) => {
    const otherPkg = String(rule.package ?? "").trim();
    if (!otherPkg) return true;
    const otherCatVal = String(formValues[`${otherPkg}__category`] ?? "").trim().toLowerCase();
    const allowed = (Array.isArray(rule.category) ? rule.category : [rule.category])
      .map((c) => String(c ?? "").trim().toLowerCase())
      .filter(Boolean);
    return allowed.length === 0 || allowed.includes(otherCatVal);
  });
}

export function PackageBlock({
  form,
  pkg,
  allowedCategories,
  formatDDMMYYYY,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  pkg: string;
  allowedCategories?: string[] | undefined;
  formatDDMMYYYY: (raw: string) => string;
}) {
  const [categories, setCategories] = React.useState<{ id: number; label: string; value: string; sortOrder: number; meta?: { labelCase?: "original" | "upper" | "lower" | "title" } | null }[]>([]);
  const catFieldName = `${pkg}__category`;
  const normalizeCategoryValue = React.useCallback(
    (v: unknown): string => {
      const s = String(v ?? "").trim();
      const lower = s.toLowerCase();
      // Common normalization for insured/contact category values
      if (lower === "company" || lower === "personal") return lower;
      return s;
    },
    [],
  );
  React.useEffect(() => {
    let cancelled = false;
    async function loadCats() {
      try {
        const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_category`)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Array<{ id?: unknown; label?: unknown; value?: unknown; sortOrder?: unknown; meta?: { labelCase?: "original" | "upper" | "lower" | "title" } | null }>;
        const all = (Array.isArray(data) ? data : [])
          .map((c) => ({
            id: Number(c?.id),
            label: String(c?.label ?? c?.value ?? ""),
            value: normalizeCategoryValue(c?.value),
            sortOrder: Number(c?.sortOrder) || 0,
            meta: (c?.meta ?? null) as { labelCase?: "original" | "upper" | "lower" | "title" } | null,
          }))
          .filter((c) => Number.isFinite(c.id) && Boolean(c.value));
        const filteredRaw =
          Array.isArray(allowedCategories) && allowedCategories.length > 0
            ? all.filter((c) => allowedCategories.includes(c.value))
            : all;
        // Deduplicate by canonical value (prevents React key collisions and category mismatch bugs).
        const filtered = (() => {
          const sorted = [...filteredRaw].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
          const seen = new Set<string>();
          const out: typeof sorted = [];
          for (const c of sorted) {
            if (seen.has(c.value)) continue;
            seen.add(c.value);
            out.push(c);
          }
          return out;
        })();
        if (!cancelled) {
          setCategories(filtered);
          const currentRaw = (form.getValues() as Record<string, unknown>)[catFieldName] as string | undefined;
          const current = normalizeCategoryValue(currentRaw);
          const hasCurrent = filtered.some((c) => c.value === current);
          if (!hasCurrent && filtered.length > 0) {
            form.setValue(catFieldName as never, filtered[0].value as never, { shouldDirty: false, shouldTouch: false });
          } else if (currentRaw && current && currentRaw !== current) {
            // Canonicalize casing (e.g. "Company" -> "company") without dirtying.
            form.setValue(catFieldName as never, current as never, { shouldDirty: false, shouldTouch: false });
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
  }, [pkg, allowedCategories, catFieldName, form, normalizeCategoryValue]);

  const selectedCategory = normalizeCategoryValue(
    (useWatch({ control: form.control, name: catFieldName as string }) as string | undefined) ?? "",
  );

  const allFormValues = useWatch({ control: form.control }) as Record<string, unknown>;
  const [pkgFields, setPkgFields] = React.useState<
    { label: string; value: string; valueType: string; sortOrder: number; meta?: unknown }[]
  >([]);
  React.useEffect(() => {
    let cancelled = false;
    async function loadFields() {
      try {
        // Try primary group first; if empty, fall back to common aliases
        const primaryRes = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`, { cache: "no-store" });
        let data = (await primaryRes.json()) as unknown[];
        // Only apply vehicle fallbacks when the selected package is a vehicle-like package.
        if ((!Array.isArray(data) || data.length === 0)) {
          const pkgLower = String(pkg ?? "").toLowerCase();
          const isVehicleLike = /\bvehicle\b/.test(pkgLower) || ["vehicle", "vehicleinfo", "auto", "car"].includes(pkgLower);
          if (isVehicleLike) {
            const fallbacks = ["vehicleinfo_fields", "vehicle_fields"];
            for (const fb of fallbacks) {
              try {
                const r = await fetch(`/api/form-options?groupKey=${encodeURIComponent(fb)}`, { cache: "no-store" });
                const j = (await r.json()) as unknown[];
                if (Array.isArray(j) && j.length > 0) {
                  data = j;
                  break;
                }
              } catch {
                // ignore and try next
              }
            }
          }
        }
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
  }, [pkg]);

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-6">
          {categories.map((opt) => (
            <label key={opt.id} className="inline-flex items-center gap-2 text-sm">
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
            const canonCats = cats.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean);
            const sel = String(selectedCategory ?? "").trim().toLowerCase();
            if (canonCats.length > 0 && !canonCats.includes(sel)) return false;

            if (!evaluateShowWhen(
              Array.isArray(meta.showWhen) ? meta.showWhen : (meta.showWhen ? [meta.showWhen] : undefined),
              allFormValues,
            )) return false;

            return true;
          });
          // Deduplicate fields by their final RHF name (prevents duplicate keys when legacy prefixed rows exist).
          const seenNameBase = new Set<string>();
          const dedupedVisible: typeof visible = [];
          for (const f of visible) {
            const rawFieldKey = String((f as any)?.value ?? "").trim();
            if (!rawFieldKey) continue;
            const fieldKey = rawFieldKey.startsWith(`${pkg}__`)
              ? rawFieldKey.slice(`${pkg}__`.length)
              : rawFieldKey.startsWith(`${pkg}_`)
                ? rawFieldKey.slice(`${pkg}_`.length)
                : rawFieldKey;
            const nameBase = `${pkg}__${fieldKey}`;
            if (seenNameBase.has(nameBase)) continue;
            seenNameBase.add(nameBase);
            dedupedVisible.push(f);
          }

          const groupMap = new Map<string, { fields: typeof dedupedVisible; order: number }>();
          for (const f of dedupedVisible) {
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
          const entries = Array.from(groupMap.entries())
            .sort((a, b) => a[1].order - b[1].order)
            .filter(([, bucket]) => {
              type GswRule = { field: string; values: string[]; childKey?: string; childValues?: string[] };
              const raw = bucket.fields
                .map((f) => (f.meta as { groupShowWhen?: GswRule | GswRule[] | null } | null)?.groupShowWhen)
                .find((g) => g != null);
              if (!raw) return true;
              const rules: GswRule[] = Array.isArray(raw) ? raw : [raw];
              if (rules.length === 0 || !rules[0]?.field) return true;
              return rules.every((gsw) => {
                if (!gsw.field) return true;
                const fieldVal = String(allFormValues[`${pkg}__${gsw.field}`] ?? "").trim().toLowerCase();
                const allowed = (gsw.values ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
                if (allowed.length > 0 && !allowed.includes(fieldVal)) return false;
                if (gsw.childKey) {
                  const optMatch = gsw.childKey.match(/__opt_([^_]+)__c\d+$/);
                  const childOwnerOpt = optMatch ? optMatch[1].toLowerCase() : "";
                  if (!childOwnerOpt || fieldVal === childOwnerOpt) {
                    const childVal = String(allFormValues[`${pkg}__${gsw.childKey}`] ?? "").trim().toLowerCase();
                    const childAllowed = (gsw.childValues ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
                    if (childAllowed.length > 0 && !childAllowed.includes(childVal)) return false;
                  }
                }
                return true;
              });
            });
          return entries.map(([groupLabel, bucket]) => (
            <div key={groupLabel || "default"} className="space-y-2">
              {groupLabel ? (
                <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{groupLabel}</div>
              ) : null}
              <div className="grid grid-cols-2 gap-4">
                {bucket.fields.map((f) => {
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
                  const isCurrency = inputType === "currency";
                  const isNumber = inputType === "number" || isCurrency;
                  const isDate = inputType === "date";
                  // Field keys in `${pkg}_fields` should be stored as the *field key* (unprefixed),
                  // since we namespace them in the form as `${pkg}__${fieldKey}`.
                  // Some deployments accidentally store prefixed values like `contactinfo_tel` or `contactinfo__tel`.
                  // If we double-prefix here, it breaks matching and makes fields look "missing".
                  const rawFieldKey = String(f.value ?? "").trim();
                  const fieldKey = rawFieldKey.startsWith(`${pkg}__`)
                    ? rawFieldKey.slice(`${pkg}__`.length)
                    : rawFieldKey.startsWith(`${pkg}_`)
                      ? rawFieldKey.slice(`${pkg}_`.length)
                      : rawFieldKey;
                  const nameBase = `${pkg}__${fieldKey}`;
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
                            {displayLabel} {Boolean(meta.required) ? <span className="text-red-600">*</span> : null}
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
                                      return (
                                        <div key={`${childName}__ms`} className="space-y-1">
                                          <Label>{cf.label ?? "Select"}</Label>
                                          <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                            {opts.map((o) => (
                                              <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                <input type="checkbox" value={o.value} {...form.register(childName as never)} />
                                                {o.label}
                                              </label>
                                            ))}
                                            {opts.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                                          </div>
                                        </div>
                                      );
                                    }
                                    if (cType === "formula") {
                                      const rowVals = (items[idx] ?? {}) as Record<string, unknown>;
                                      const computed = evaluateRowFormula(String((cf as any)?.formula ?? ""), rowVals);
                                      return (
                                        <div key={`${childName}__formula`} className="space-y-1">
                                          <Label>{cf.label ?? "Value"}</Label>
                                          <Input type="text" readOnly value={computed} className="bg-neutral-50 dark:bg-neutral-800 cursor-default" />
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
                                        const formatted = formatDDMMYYYY(t?.target?.value ?? "");
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
                      <InlineSelectWithChildren
                        key={nameBase}
                        form={form}
                        nameBase={nameBase}
                        label={displayLabel}
                        required={Boolean(meta.required)}
                        options={options}
                        displayMode={(meta?.selectDisplay ?? "dropdown") === "dropdown" ? "dropdown" : "radio"}
                        formatDDMMYYYY={formatDDMMYYYY}
                      />
                    );
                  }
                  if (inputType === "multi_select") {
                    const options = (Array.isArray(meta.options) ? (meta.options as unknown[]) : []) as {
                      label?: string;
                      value?: string;
                      children?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number }[];
                    }[];
                    const currentRaw = form.watch(nameBase as never) as unknown;
                    const current = Array.isArray(currentRaw)
                      ? (currentRaw as unknown[])
                      : typeof currentRaw === "string" && currentRaw
                        ? [currentRaw]
                        : [];
                    return (
                      <div key={nameBase} className="space-y-2">
                        <div className="space-y-1">
                          <Label>
                            {displayLabel} {meta.required ? <span className="text-red-600">*</span> : null}
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
                            {options.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                          </div>
                        </div>
                        {(() => {
                          const childrenTuples =
                            options
                              .filter((o) => current.includes(o.value as unknown))
                              .map((o) => ({ opt: o, children: Array.isArray(o.children) ? (o.children ?? []) : [] })) ?? [];
                          if (childrenTuples.length === 0) return null;
                          return (
                            <div className="grid grid-cols-2 gap-4">
                              {childrenTuples.flatMap(({ opt, children }) =>
                                children.map((child, cIdx) => {
                                  if (!evaluateShowWhen((child as any)?.showWhen, allFormValues)) return null;
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
                                      const formatted = formatDDMMYYYY(t?.target?.value ?? "");
                                      form.setValue(name as never, formatted as never, { shouldDirty: true });
                                    };
                                  }
                                  if (cType === "formula") {
                                    return (
                                      <FormulaField
                                        key={name}
                                        form={form}
                                        name={name}
                                        formula={String((child as any)?.formula ?? "")}
                                        label={child?.label ?? "Value"}
                                        pkg={pkg}
                                        formatDDMMYYYY={formatDDMMYYYY}
                                      />
                                    );
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
                                    return (
                                      <div key={name} className="space-y-1">
                                        <Label>{child?.label ?? "Details"}</Label>
                                        <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                          {opts.map((o) => (
                                            <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                              <input type="checkbox" value={o.value} {...form.register(name as never)} />
                                              {o.label}
                                            </label>
                                          ))}
                                          {opts.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                                        </div>
                                      </div>
                                    );
                                  }
                                  if (cType === "currency") {
                                    const cc = String((child as any)?.currencyCode ?? "").trim();
                                    const dec = Number((child as any)?.decimals ?? 2);
                                    const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                    return (
                                      <div key={name} className="space-y-1">
                                        <Label>{child?.label ?? "Details"}</Label>
                                        <div className="flex items-center gap-2">
                                          {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500">{cc}</span> : null}
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
                            {displayLabel} {meta.required ? <span className="text-red-600">*</span> : null}
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
                            {yesChildren.map((child: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; showWhen?: { package: string; category: string | string[] }[] }, cIdx: number) => {
                              if (!evaluateShowWhen(child?.showWhen, allFormValues)) return null;
                              const name = `${nameBase}__true__c${cIdx}`;
                              const cType = child?.inputType ?? "string";
                              if (cType === "formula") {
                                return (
                                  <FormulaField
                                    key={name}
                                    form={form}
                                    name={name}
                                    formula={String((child as any)?.formula ?? "")}
                                    label={child?.label ?? "Value"}
                                    pkg={pkg}
                                    formatDDMMYYYY={formatDDMMYYYY}
                                  />
                                );
                              }
                              if (cType === "boolean") {
                                const yesL = String(child?.booleanLabels?.true ?? "").trim() || "Yes";
                                const noL = String(child?.booleanLabels?.false ?? "").trim() || "No";
                                const bDisp = child?.booleanDisplay ?? "radio";
                                const boolCh = (child as any)?.booleanChildren as { true?: any[]; false?: any[] } | undefined;
                                if (bDisp === "dropdown") {
                                  return (
                                    <div key={name} className="space-y-1">
                                      <Label>{child?.label ?? "Details"}</Label>
                                      <select
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        {...form.register(name as never, {
                                          setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v),
                                        })}
                                      >
                                        <option value="">Select...</option>
                                        <option value="true">{yesL}</option>
                                        <option value="false">{noL}</option>
                                      </select>
                                      <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} formatDDMMYYYY={formatDDMMYYYY} />
                                    </div>
                                  );
                                }
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <div className="flex items-center gap-6">
                                      <label className="inline-flex items-center gap-2 text-sm">
                                        <input type="radio" className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0" value="true" {...form.register(name as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })} />
                                        {yesL}
                                      </label>
                                      <label className="inline-flex items-center gap-2 text-sm">
                                        <input type="radio" className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0" value="false" {...form.register(name as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })} />
                                        {noL}
                                      </label>
                                    </div>
                                    <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} formatDDMMYYYY={formatDDMMYYYY} />
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
                                                  return (
                                                    <div key={`${childName}__ms`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Select"}</Label>
                                                      <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                                        {opts.map((o) => (
                                                          <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                            <input type="checkbox" value={o.value} {...form.register(childName as never)} />
                                                            {o.label}
                                                          </label>
                                                        ))}
                                                        {opts.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                                                      </div>
                                                    </div>
                                                  );
                                                }
                                                if (ccType === "currency") {
                                                  const cc = String((cf as any)?.currencyCode ?? "").trim();
                                                  const dec = Number((cf as any)?.decimals ?? 2);
                                                  const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                                  return (
                                                    <div key={`${childName}__cur`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Value"}</Label>
                                                      <div className="flex items-center gap-2">
                                                        {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500">{cc}</span> : null}
                                                        <Input type="number" step={step} placeholder="0.00" {...form.register(childName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                                      </div>
                                                    </div>
                                                  );
                                                }
                                                if (ccType === "formula") {
                                                  const rowVals = (items[rIdx] ?? {}) as Record<string, unknown>;
                                                  const fComputed = evaluateRowFormula(String((cf as any)?.formula ?? ""), rowVals);
                                                  return (
                                                    <div key={`${childName}__formula`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Value"}</Label>
                                                      <Input type="text" readOnly value={fComputed} className="bg-neutral-50 dark:bg-neutral-800 cursor-default" />
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
                                                    const formatted = formatDDMMYYYY(t?.target?.value ?? "");
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
                              if (cType === "currency") {
                                const cc = String((child as any)?.currencyCode ?? "").trim();
                                const dec = Number((child as any)?.decimals ?? 2);
                                const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <div className="flex items-center gap-2">
                                      {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500">{cc}</span> : null}
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
                                  const formatted = formatDDMMYYYY(t?.target?.value ?? "");
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
                            {noChildren.map((child: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; showWhen?: { package: string; category: string | string[] }[] }, cIdx: number) => {
                              if (!evaluateShowWhen(child?.showWhen, allFormValues)) return null;
                              const name = `${nameBase}__false__c${cIdx}`;
                              const cType = child?.inputType ?? "string";
                              if (cType === "formula") {
                                return (
                                  <FormulaField
                                    key={name}
                                    form={form}
                                    name={name}
                                    formula={String((child as any)?.formula ?? "")}
                                    label={child?.label ?? "Value"}
                                    pkg={pkg}
                                    formatDDMMYYYY={formatDDMMYYYY}
                                  />
                                );
                              }
                              if (cType === "boolean") {
                                const yesL = String(child?.booleanLabels?.true ?? "").trim() || "Yes";
                                const noL = String(child?.booleanLabels?.false ?? "").trim() || "No";
                                const bDisp = child?.booleanDisplay ?? "radio";
                                const boolCh = (child as any)?.booleanChildren as { true?: any[]; false?: any[] } | undefined;
                                if (bDisp === "dropdown") {
                                  return (
                                    <div key={name} className="space-y-1">
                                      <Label>{child?.label ?? "Details"}</Label>
                                      <select
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        {...form.register(name as never, {
                                          setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v),
                                        })}
                                      >
                                        <option value="">Select...</option>
                                        <option value="true">{yesL}</option>
                                        <option value="false">{noL}</option>
                                      </select>
                                      <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} formatDDMMYYYY={formatDDMMYYYY} />
                                    </div>
                                  );
                                }
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <div className="flex items-center gap-6">
                                      <label className="inline-flex items-center gap-2 text-sm">
                                        <input type="radio" className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0" value="true" {...form.register(name as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })} />
                                        {yesL}
                                      </label>
                                      <label className="inline-flex items-center gap-2 text-sm">
                                        <input type="radio" className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0" value="false" {...form.register(name as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })} />
                                        {noL}
                                      </label>
                                    </div>
                                    <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} formatDDMMYYYY={formatDDMMYYYY} />
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
                                                  return (
                                                    <div key={`${childName}__ms`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Select"}</Label>
                                                      <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                                        {opts.map((o) => (
                                                          <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                                            <input type="checkbox" value={o.value} {...form.register(childName as never)} />
                                                            {o.label}
                                                          </label>
                                                        ))}
                                                        {opts.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                                                      </div>
                                                    </div>
                                                  );
                                                }
                                                if (ccType === "currency") {
                                                  const cc = String((cf as any)?.currencyCode ?? "").trim();
                                                  const dec = Number((cf as any)?.decimals ?? 2);
                                                  const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                                  return (
                                                    <div key={`${childName}__cur`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Value"}</Label>
                                                      <div className="flex items-center gap-2">
                                                        {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500">{cc}</span> : null}
                                                        <Input type="number" step={step} placeholder="0.00" {...form.register(childName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                                                      </div>
                                                    </div>
                                                  );
                                                }
                                                if (ccType === "formula") {
                                                  const rowVals = (items[rIdx] ?? {}) as Record<string, unknown>;
                                                  const fComputed = evaluateRowFormula(String((cf as any)?.formula ?? ""), rowVals);
                                                  return (
                                                    <div key={`${childName}__formula`} className="space-y-1">
                                                      <Label>{cf?.label ?? "Value"}</Label>
                                                      <Input type="text" readOnly value={fComputed} className="bg-neutral-50 dark:bg-neutral-800 cursor-default" />
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
                                                    const formatted = formatDDMMYYYY(t?.target?.value ?? "");
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
                              if (cType === "currency") {
                                const cc = String((child as any)?.currencyCode ?? "").trim();
                                const dec = Number((child as any)?.decimals ?? 2);
                                const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                                return (
                                  <div key={name} className="space-y-1">
                                    <Label>{child?.label ?? "Details"}</Label>
                                    <div className="flex items-center gap-2">
                                      {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500">{cc}</span> : null}
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
                                  const formatted = formatDDMMYYYY(t?.target?.value ?? "");
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
                  if (inputType === "formula") {
                    return (
                      <FormulaField
                        key={nameBase}
                        form={form}
                        name={nameBase}
                        formula={String((meta as any)?.formula ?? "")}
                        label={displayLabel}
                        required={Boolean(meta.required)}
                        pkg={pkg}
                        formatDDMMYYYY={formatDDMMYYYY}
                      />
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
                      const formatted = formatDDMMYYYY(t?.target?.value ?? "");
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
                          {displayLabel} {Boolean(meta.required) ? <span className="text-red-600">*</span> : null}
                        </Label>
                        <div className="flex items-center gap-2">
                          {currencyCode ? <span className="shrink-0 text-sm font-medium text-neutral-500">{currencyCode}</span> : null}
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
}

function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; required?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>
        {label} {props.required ? <span className="text-red-600">*</span> : null}
      </Label>
      <Input {...props} />
    </div>
  );
}

