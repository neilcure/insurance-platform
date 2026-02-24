"use client";

import * as React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

type BooleanBranchChild = {
  label?: string;
  inputType?: string;
  options?: { label?: string; value?: string }[];
  currencyCode?: string;
  decimals?: number;
};

type ShowWhenRule = { package: string; category: string | string[] };

type SelectChild = {
  label?: string;
  inputType?: string;
  options?: { label?: string; value?: string }[];
  currencyCode?: string;
  decimals?: number;
  booleanLabels?: { true?: string; false?: string };
  booleanDisplay?: "radio" | "dropdown";
  booleanChildren?: { true?: BooleanBranchChild[]; false?: BooleanBranchChild[] };
  showWhen?: ShowWhenRule[];
};

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

function resolveFieldValueBroad(
  key: string,
  vals: Record<string, unknown>,
): string {
  const v = vals[key];
  if (v !== undefined && v !== null && v !== "") return String(v);
  const keyLower = key.toLowerCase();
  for (const [fk, fv] of Object.entries(vals)) {
    if (fv === undefined || fv === null || fv === "") continue;
    const suffix = fk.includes("__") ? fk.split("__").pop()! : fk;
    if (suffix.toLowerCase() === keyLower) return String(fv);
  }
  return "";
}

function evalFormulaWithDates(formula: string, vals: Record<string, unknown>): string {
  if (!formula) return "";
  try {
    const refs: Record<string, string> = {};
    formula.replace(/\{([^}]+)\}/g, (_, key: string) => {
      refs[key.trim()] = resolveFieldValueBroad(key.trim(), vals);
      return "";
    });
    const hasDate = Object.values(refs).some((v) => parseAnyDate(v) !== null);
    if (hasDate) {
      const dm = /^\{([^}]+)\}\s*([+-])\s*(\d+)\s*(d|days?)?$/i.exec(formula.trim());
      if (dm) {
        const base = parseAnyDate(refs[dm[1].trim()] ?? "");
        if (!base) return "";
        const off = Number(dm[3]) * (dm[2] === "-" ? -1 : 1);
        const r = new Date(base);
        r.setDate(r.getDate() + off);
        return fmtDateDDMMYYYY(r);
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
  } catch {
    return "";
  }
}

function evaluateChildShowWhen(
  showWhen: ShowWhenRule[] | undefined,
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

export function BooleanBranchFields({
  form,
  name,
  booleanChildren,
  formatDDMMYYYY,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  booleanChildren?: { true?: BooleanBranchChild[]; false?: BooleanBranchChild[] };
  formatDDMMYYYY: (raw: string) => string;
}) {
  const val = useWatch({ control: form.control, name: name as string });
  const isYes = val === true || val === "true";
  const isNo = val === false || val === "false";
  const branch = isYes ? booleanChildren?.true : isNo ? booleanChildren?.false : undefined;
  const arr = Array.isArray(branch) ? branch : [];
  if (arr.length === 0) return null;
  return (
    <div className="mt-1 grid grid-cols-2 gap-3">
      {arr.map((bc, bIdx) => {
        const bcName = `${name}__${isYes ? "true" : "false"}__bc${bIdx}`;
        const bcType = bc?.inputType ?? "string";
        if (bcType === "currency") {
          const cc = String(bc?.currencyCode ?? "").trim();
          const dec = Number(bc?.decimals ?? 2);
          const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
          return (
            <div key={bcName} className="space-y-1">
              <Label>{bc?.label ?? "Value"}</Label>
              <div className="flex items-center gap-2">
                {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500">{cc}</span> : null}
                <Input type="number" step={step} placeholder={`0.${"0".repeat(dec)}`} {...form.register(bcName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
              </div>
            </div>
          );
        }
        if (bcType === "formula") {
          const computed = evalFormulaWithDates(String((bc as any)?.formula ?? ""), form.getValues() as Record<string, unknown>);
          return (
            <div key={bcName} className="space-y-1">
              <Label>{bc?.label ?? "Value"}</Label>
              <Input type="text" readOnly value={computed} className="bg-neutral-50 dark:bg-neutral-800 cursor-default" />
            </div>
          );
        }
        if (bcType === "select" || bcType === "multi_select") {
          const opts = Array.isArray(bc?.options) ? bc.options : [];
          return (
            <div key={bcName} className="space-y-1">
              <Label>{bc?.label ?? "Select"}</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" {...form.register(bcName as never)}>
                <option value="">-- Select --</option>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          );
        }
        const isNum = bcType === "number";
        const isDate = bcType === "date";
        const regOpts: Record<string, unknown> = {};
        if (isNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
        if (isDate) {
          regOpts.validate = (v: unknown) => { if (v === undefined || v === null || v === "") return true; return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY"; };
          regOpts.onChange = (e: unknown) => { const t = e as { target?: { value?: string } }; form.setValue(bcName as never, formatDDMMYYYY(t?.target?.value ?? "") as never, { shouldDirty: true }); };
        }
        return (
          <div key={bcName} className="space-y-1">
            <Label>{bc?.label ?? "Details"}</Label>
            <Input type={isNum ? "number" : "text"} placeholder={isDate ? "DD-MM-YYYY" : undefined} inputMode={isDate ? "numeric" : undefined} {...form.register(bcName as never, regOpts)} />
          </div>
        );
      })}
    </div>
  );
}

export type InlineSelectWithChildrenProps = {
  form: UseFormReturn<Record<string, unknown>>;
  nameBase: string;
  label: string;
  required?: boolean;
  options: { label?: string; value?: string; children?: SelectChild[] }[];
  displayMode?: "dropdown" | "radio";
  formatDDMMYYYY: (raw: string) => string;
};

export const InlineSelectWithChildren = React.memo(function InlineSelectWithChildren({
  form,
  nameBase,
  label,
  required,
  options,
  displayMode = "dropdown",
  formatDDMMYYYY,
}: InlineSelectWithChildrenProps) {
  const current = useWatch({ control: form.control, name: nameBase as string }) as string | undefined;
  const allFormValues = useWatch({ control: form.control }) as Record<string, unknown>;
  const nodes: React.ReactNode[] = [];
  nodes.push(
    <div key={`${nameBase}__field`} className="space-y-2">
      <div className="space-y-1">
        <Label>
          {label} {required ? <span className="text-red-600">*</span> : null}
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
      if (!evaluateChildShowWhen(child?.showWhen, allFormValues)) return;
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
          const formatted = formatDDMMYYYY(t?.target?.value ?? "");
          form.setValue(name as never, formatted as never, { shouldDirty: true });
        };
      }
      if (cType === "formula") {
        const computed = evalFormulaWithDates(String((child as any)?.formula ?? ""), allFormValues);
        nodes.push(
          <div key={name} className="space-y-1">
            <Label>{child?.label ?? "Value"}</Label>
            <Input type="text" readOnly value={computed} className="bg-neutral-50 dark:bg-neutral-800 cursor-default" />
          </div>
        );
        return;
      }
      if (cType === "boolean") {
        const yesLabel = String(child?.booleanLabels?.true ?? "").trim() || "Yes";
        const noLabel = String(child?.booleanLabels?.false ?? "").trim() || "No";
        const boolDisplay = child?.booleanDisplay ?? "radio";
        const hasBranchChildren = (Array.isArray(child?.booleanChildren?.true) && child.booleanChildren.true.length > 0) || (Array.isArray(child?.booleanChildren?.false) && child.booleanChildren.false.length > 0);
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
              {hasBranchChildren ? <BooleanBranchFields form={form} name={name} booleanChildren={child.booleanChildren} formatDDMMYYYY={formatDDMMYYYY} /> : null}
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
              {hasBranchChildren ? <BooleanBranchFields form={form} name={name} booleanChildren={child.booleanChildren} formatDDMMYYYY={formatDDMMYYYY} /> : null}
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
        nodes.push(
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
        return;
      }
      if (cType === "currency") {
        const cc = String(child?.currencyCode ?? "").trim();
        const dec = Number(child?.decimals ?? 2);
        const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
        nodes.push(
          <div key={name} className="min-w-[220px] flex-1 space-y-1">
            <Label>{child?.label ?? "Details"}</Label>
            <div className="flex items-center gap-2">
              {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500">{cc}</span> : null}
              <Input
                type="number"
                step={step}
                placeholder={`0.${"0".repeat(dec)}`}
                {...form.register(name as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })}
              />
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

