"use client";

import * as React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InlineSelectWithChildren, BooleanBranchFields } from "@/components/policies/InlineSelectWithChildren";
import { CreatableSelect } from "@/components/ui/creatable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { maskDDMMYYYY, parseAnyDate } from "@/lib/format/date";
import { Field } from "@/components/ui/form-field";
import { resolveFieldValue, evaluateFormula } from "@/lib/formula";
import type { SelectOption, RepeatableFieldConfig, RepeatableConfig } from "@/lib/types/form";
import { EntityPickerDrawer, type EntityPickerSelection } from "@/components/policies/EntityPickerDrawer";
import { AgentPickerDrawer, type AgentPickerSelection } from "@/components/policies/AgentPickerDrawer";
import { LinkedPolicyCard } from "@/components/policies/LinkedPolicyCard";
import { Search } from "lucide-react";
import { getInsuredDisplayName, getInsuredType } from "@/lib/field-resolver";

type EntityPickerFieldMapping = {
  sourceField: string;
  targetField: string;
};

type EntityPickerMeta = {
  flow: string;
  buttonLabel?: string;
  mappings: EntityPickerFieldMapping[];
};

function resolveInsuredVirtuals(snap: Record<string, unknown> | null): Record<string, string> {
  if (!snap) return {};
  const result: Record<string, string> = {};
  const displayName = getInsuredDisplayName(snap);
  if (displayName) result.insuredDisplayName = displayName;
  const insuredType = getInsuredType(snap);
  if (insuredType) result.insuredType = insuredType;
  return result;
}

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

function evaluateRowFormula(
  formula: string,
  rowValues: Record<string, unknown>,
): string {
  return evaluateFormula(formula, rowValues);
}

type OptionChild = { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number };
type OptionWithChildren = { label?: string; value?: string; children?: OptionChild[]; showWhen?: unknown };

function SubFieldRepeatable({
  form,
  name,
  label,
  required,
  repeatable: rawRep,
  entityPicker,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  label?: string;
  required?: boolean;
  repeatable?: unknown;
  entityPicker?: EntityPickerMeta;
}) {
  const rep = getRepeatable(rawRep);
  const itemLabel = String(rep.itemLabel ?? "Item");
  const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
  const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
  const childFields = Array.isArray(rep.fields) ? rep.fields : [];
  const current = (form.watch(name as never) as unknown[] | undefined) ?? [];
  const items = Array.isArray(current) ? (current as Record<string, unknown>[]) : [];
  const canAdd = max <= 0 || items.length < max;
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerRowIdx, setPickerRowIdx] = React.useState<number | null>(null);

  const handlePickerSelect = React.useCallback(
    (selection: EntityPickerSelection) => {
      if (!entityPicker || pickerRowIdx === null) return;
      const extra = selection.extraAttributes;
      const pkgs = (extra?.packagesSnapshot ?? {}) as Record<string, unknown>;
      const insuredSnap = (extra?.insuredSnapshot ?? null) as Record<string, unknown> | null;
      const topLevel: Record<string, unknown> = {
        policyNumber: selection.policyNumber,
        policyId: selection.policyId,
        ...resolveInsuredVirtuals(insuredSnap),
      };
      const findValue = (sourceField: string): unknown => {
        if (sourceField in topLevel) return topLevel[sourceField];
        for (const [, data] of Object.entries(pkgs)) {
          if (!data || typeof data !== "object") continue;
          const values = (data as { values?: Record<string, unknown> }).values ?? (data as Record<string, unknown>);
          if (sourceField in values) return values[sourceField];
          for (const [k, v] of Object.entries(values)) {
            const kTail = k.includes("__") ? k.split("__").pop() : k;
            if (kTail === sourceField) return v;
          }
        }
        if (insuredSnap) {
          if (sourceField in insuredSnap) return insuredSnap[sourceField];
          for (const [k, v] of Object.entries(insuredSnap)) {
            const kTail = k.includes("__") ? k.split("__").pop() : k.includes("_") ? k.split("_").pop() : k;
            if (kTail === sourceField) return v;
          }
        }
        return undefined;
      };
      for (const m of entityPicker.mappings) {
        if (!m.sourceField || !m.targetField) continue;
        const val = findValue(m.sourceField);
        if (val !== undefined && val !== null && val !== "") {
          const targetKey = `${name}.${pickerRowIdx}.${m.targetField}`;
          form.setValue(targetKey as never, val as never, { shouldDirty: true });
        }
      }
      toast.success(`${entityPicker.buttonLabel || "Record"} selected: ${selection.policyNumber}`, { duration: 1500 });
      setPickerOpen(false);
      setPickerRowIdx(null);
    },
    [entityPicker, pickerRowIdx, name, form],
  );

  return (
    <div className="col-span-2 space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label ?? itemLabel} {required ? <span className="text-red-600 dark:text-red-400">*</span> : null}</Label>
        <Button type="button" size="sm" variant="secondary" onClick={() => form.setValue(name as never, [...items, {}] as never, { shouldDirty: true })} disabled={!canAdd}>
          Add {itemLabel}
        </Button>
      </div>
      {items.map((_, rIdx) => {
        const epTargetKeys = new Set(entityPicker?.mappings?.map((m) => m.targetField).filter(Boolean) ?? []);
        const firstTarget = entityPicker?.mappings?.[0]?.targetField;
        let pickerRendered = false;

        const pickerBtn = entityPicker?.flow ? (
          <button
            type="button"
            className="group/ep relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-all duration-300 ease-out hover:w-auto hover:gap-1.5 hover:px-2.5 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            onClick={() => { setPickerRowIdx(rIdx); setPickerOpen(true); }}
            title={entityPicker.buttonLabel || "Browse"}
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap text-[11px] font-medium opacity-0 transition-all duration-300 ease-out group-hover/ep:max-w-48 group-hover/ep:opacity-100">
              {entityPicker.buttonLabel || "Browse"}
            </span>
          </button>
        ) : null;

        const shouldAttachPicker = (fieldValue: string) => {
          if (!pickerBtn || pickerRendered) return false;
          if (firstTarget && fieldValue === firstTarget) return true;
          if (epTargetKeys.has(fieldValue)) return true;
          return false;
        };

        return (
          <div key={`${name}__row__${rIdx}`} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium">{itemLabel} #{rIdx + 1}</div>
              <Button type="button" size="sm" variant="outline" onClick={() => { const next = items.filter((__, i) => i !== rIdx); form.setValue(name as never, next as never, { shouldDirty: true }); }} disabled={items.length <= Math.max(1, min)}>
                Remove
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {childFields.map((cf, ccIdx) => {
                const cfKey = cf?.value ?? `c${ccIdx}`;
                const childName = `${name}.${rIdx}.${cfKey}`;
                const ccType = String(cf?.inputType ?? "string").trim().toLowerCase();
                const attachPicker = shouldAttachPicker(cfKey);
                if (attachPicker) pickerRendered = true;

                if (ccType === "select") {
                  const cfOpts = Array.isArray((cf as any)?.options) ? (cf as any).options : [];
                  return (
                    <div key={childName} className="space-y-1">
                      <Label>{cf?.label ?? "Select"}</Label>
                      <div className="flex items-center gap-1.5">
                        <select className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100" {...form.register(childName as never)}>
                          <option value="">-- Select --</option>
                          {cfOpts.map((o: any, oIdx: number) => <option key={`${o.value}_${oIdx}`} value={o.value}>{o.label}</option>)}
                        </select>
                        {attachPicker && pickerBtn}
                      </div>
                    </div>
                  );
                }
                if (ccType === "multi_select") {
                  const cfOpts = Array.isArray((cf as any)?.options) ? (cf as any).options : [];
                  return (
                    <div key={childName} className="space-y-1">
                      <Label>{cf?.label ?? "Select"}</Label>
                      <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                        {cfOpts.map((o: any, oIdx: number) => (
                          <label key={`${o.value}_${oIdx}`} className="mr-4 inline-flex items-center gap-2 text-sm">
                            <input type="checkbox" value={o.value} {...form.register(childName as never)} />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (ccType === "currency" || ccType === "negative_currency") {
                  const cc = String((cf as any)?.currencyCode ?? "").trim();
                  const dec = Number((cf as any)?.decimals ?? 2);
                  const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
                  return (
                    <div key={childName} className="space-y-1">
                      <Label>{cf?.label ?? "Value"}</Label>
                      <div className="flex items-center gap-1.5">
                        {cc && <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span>}
                        <Input type="number" step={step} placeholder="0.00" {...form.register(childName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                        {attachPicker && pickerBtn}
                      </div>
                    </div>
                  );
                }
                if (ccType === "formula") {
                  const rowVals = (items[rIdx] ?? {}) as Record<string, unknown>;
                  const fComputed = evaluateRowFormula(String((cf as any)?.formula ?? ""), rowVals);
                  return (
                    <div key={childName} className="space-y-1">
                      <Label>{cf?.label ?? "Value"}</Label>
                      <Input type="text" readOnly value={fComputed} className="bg-neutral-50 dark:bg-neutral-800 cursor-default" />
                    </div>
                  );
                }
                const isNum = ccType === "number";
                const isDate = ccType === "date";
                const rfRegOpts: Record<string, unknown> = {};
                if (isNum) rfRegOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                if (isDate) {
                  rfRegOpts.validate = (v: unknown) => { if (v === undefined || v === null || v === "") return true; return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY"; };
                  rfRegOpts.onChange = (e: unknown) => { const t = e as { target?: { value?: string } }; form.setValue(childName as never, maskDDMMYYYY(t?.target?.value ?? "") as never, { shouldDirty: true }); };
                }
                return (
                  <div key={childName} className="space-y-1">
                    <Label>{cf?.label ?? "Value"}</Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="flex-1"
                        type={isNum ? "number" : "text"}
                        placeholder={isDate ? "DD-MM-YYYY" : undefined}
                        inputMode={isDate ? "numeric" : undefined}
                        {...form.register(childName as never, rfRegOpts)}
                      />
                      {attachPicker && pickerBtn}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {entityPicker?.flow && pickerOpen && (
        <EntityPickerDrawer
          open={pickerOpen}
          onClose={() => { setPickerOpen(false); setPickerRowIdx(null); }}
          flowKey={entityPicker.flow}
          title={entityPicker.buttonLabel || "Select Record"}
          onSelect={handlePickerSelect}
        />
      )}
    </div>
  );
}

function SelectWithOptionChildren({
  form,
  name,
  label,
  options,
  allFormValues,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  label: string;
  options: OptionWithChildren[];
  allFormValues: Record<string, unknown>;
}) {
  const selectedVal = useWatch({ control: form.control, name: name as string }) as string | undefined;
  const visibleOpts = options.filter((o) => evaluateShowWhen((o as any)?.showWhen, allFormValues));
  const matchedOpt = options.find((o) => o.value === selectedVal);
  const optChildren = Array.isArray(matchedOpt?.children) ? matchedOpt.children : [];

  return (
    <div className="col-span-2 space-y-2">
      <div className="space-y-1">
        <Label>{label}</Label>
        <select
          className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          {...form.register(name as never)}
        >
          <option value="">-- Select --</option>
          {visibleOpts.map((o, oIdx) => (
            <option key={`${o.value ?? ""}_${oIdx}`} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      {selectedVal && optChildren.length > 0 && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-neutral-100 bg-neutral-50/50 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          {optChildren.map((oc, ocIdx) => {
            const ocName = `${name}__opt_${selectedVal}__sc${ocIdx}`;
            const ocType = oc?.inputType ?? "string";
            if (ocType === "select") {
              const ocOpts = Array.isArray(oc?.options) ? oc.options : [];
              return (
                <div key={ocName} className="space-y-1">
                  <Label>{oc?.label ?? "Details"}</Label>
                  <select
                    className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                    {...form.register(ocName as never)}
                  >
                    <option value="">-- Select --</option>
                    {ocOpts.map((so, soIdx) => (
                      <option key={`${so.value ?? ""}_${soIdx}`} value={so.value}>{so.label}</option>
                    ))}
                  </select>
                </div>
              );
            }
            if (ocType === "multi_select") {
              const ocOpts = Array.isArray(oc?.options) ? oc.options : [];
              return (
                <div key={ocName} className="space-y-1">
                  <Label>{oc?.label ?? "Details"}</Label>
                  <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                    {ocOpts.map((so, soIdx) => (
                      <label key={`${so.value ?? ""}_${soIdx}`} className="mr-4 inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" value={so.value} {...form.register(ocName as never)} />
                        {so.label}
                      </label>
                    ))}
                    {ocOpts.length === 0 && <p className="text-xs text-neutral-500">No options configured.</p>}
                  </div>
                </div>
              );
            }
            if (ocType === "boolean") {
              const yesL = String((oc as any)?.booleanLabels?.true ?? "").trim() || "Yes";
              const noL = String((oc as any)?.booleanLabels?.false ?? "").trim() || "No";
              return (
                <div key={ocName} className="space-y-1">
                  <Label>{oc?.label ?? "Details"}</Label>
                  <div className="flex items-center gap-6">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="radio" className="accent-neutral-900 dark:accent-white" value="true" {...form.register(ocName as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })} />
                      {yesL}
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="radio" className="accent-neutral-900 dark:accent-white" value="false" {...form.register(ocName as never, { setValueAs: (v: string) => (v === "true" ? true : v === "false" ? false : v) })} />
                      {noL}
                    </label>
                  </div>
                  <BooleanBranchFields form={form} name={ocName} booleanChildren={(oc as any)?.booleanChildren} />
                </div>
              );
            }
            if (ocType === "formula") {
              return (
                <FormulaField key={ocName} form={form} name={ocName} formula={String((oc as any)?.formula ?? "")} label={oc?.label ?? "Value"} pkg="" />
              );
            }
            if (ocType === "repeatable" || String(ocType).includes("repeat")) {
              const epConfig = (oc as any)?.entityPicker as EntityPickerMeta | undefined;
              return (
                <SubFieldRepeatable
                  key={ocName}
                  form={form}
                  name={ocName}
                  label={oc?.label}
                  repeatable={(oc as any)?.repeatable}
                  entityPicker={epConfig}
                />
              );
            }
            if (ocType === "currency" || ocType === "negative_currency") {
              const cc = String(oc?.currencyCode ?? "").trim();
              const dec = Number(oc?.decimals ?? 2);
              const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
              return (
                <div key={ocName} className="space-y-1">
                  <Label>{oc?.label ?? "Value"}</Label>
                  <div className="flex items-center gap-2">
                    {cc && <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span>}
                    <Input type="number" step={step} placeholder="0.00" {...form.register(ocName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
                  </div>
                </div>
              );
            }
            const isNum = ocType === "number";
            const isDate = ocType === "date";
            const regOpts: Record<string, unknown> = {};
            if (isNum) regOpts.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
            if (isDate) {
              regOpts.validate = (v: unknown) => { if (v === undefined || v === null || v === "") return true; return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY"; };
              regOpts.onChange = (e: unknown) => { const t = e as { target?: { value?: string } }; form.setValue(ocName as never, maskDDMMYYYY(t?.target?.value ?? "") as never, { shouldDirty: true }); };
            }
            return (
              <div key={ocName} className="space-y-1">
                <Label>{oc?.label ?? "Details"}</Label>
                <Input
                  type={isNum ? "number" : "text"}
                  placeholder={isDate ? "DD-MM-YYYY" : undefined}
                  inputMode={isDate ? "numeric" : undefined}
                  {...form.register(ocName as never, regOpts)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DefaultValueSetter({ form, name, defaultValue }: { form: UseFormReturn<Record<string, unknown>>; name: string; defaultValue: string }) {
  React.useEffect(() => {
    const cur: unknown = form.getValues(name as never);
    if (cur === undefined || cur === null || cur === "") {
      form.setValue(name as never, defaultValue as never, { shouldDirty: false });
    }
  }, [form, name, defaultValue]);
  return null;
}

function FormulaField({
  form,
  name,
  formula,
  label,
  required,
  pkg,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  formula: string;
  label: string;
  required?: boolean;
  pkg: string;
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
      const formatted = maskDDMMYYYY(t?.target?.value ?? "");
      form.setValue(name as never, formatted as never, { shouldDirty: true });
    };
  }

  return (
    <div className="space-y-1">
      <Label>
        {label} {required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
      </Label>
      <Input
        type="text"
        {...form.register(name as never, dateOpts)}
      />
    </div>
  );
}

function evaluateShowWhen(
  showWhen: { package: string; category: string | string[]; field?: string; fieldValues?: string[]; childKey?: string; childValues?: string[] }[] | undefined,
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
    if (allowed.length > 0 && !allowed.includes(otherCatVal)) return false;
    if (rule.field) {
      const fv = String(formValues[`${otherPkg}__${rule.field}`] ?? "").trim().toLowerCase();
      const allowedVals = (rule.fieldValues ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
      if (allowedVals.length > 0 && !allowedVals.includes(fv)) return false;
    }
    if (rule.childKey && rule.field) {
      const parentVal = String(formValues[`${otherPkg}__${rule.field}`] ?? "").trim();
      const idxMatch = rule.childKey.match(/[cs]c?(\d+)$/);
      if (idxMatch && parentVal) {
        const childFormKey = `${otherPkg}__${rule.field}__opt_${parentVal}__c${idxMatch[1]}`;
        const cv = String(formValues[childFormKey] ?? "").trim().toLowerCase();
        const allowedChildVals = (rule.childValues ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
        if (allowedChildVals.length > 0 && !allowedChildVals.includes(cv)) return false;
      } else if (!parentVal) {
        return false;
      }
    }
    return true;
  });
}

type FieldUpdateResult = { option?: { label: string; value: string }; field?: { meta?: unknown } } | null;

async function appendOptionToField(
  fieldId: number,
  label: string,
): Promise<FieldUpdateResult> {
  try {
    const res = await fetch(`/api/admin/form-options/${fieldId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      toast.error(err.error ?? "Failed to add option");
      return null;
    }
    const data = (await res.json()) as { option?: { label: string; value: string }; field?: { meta?: unknown }; message?: string };
    if (data.message) toast.info(data.message);
    else toast.success(`Option "${label}" added`);
    return data;
  } catch {
    toast.error("Failed to add option");
    return null;
  }
}

async function removeOptionFromField(
  fieldId: number,
  value: string,
): Promise<FieldUpdateResult> {
  try {
    const res = await fetch(`/api/admin/form-options/${fieldId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      toast.error(err.error ?? "Failed to remove option");
      return null;
    }
    const data = (await res.json()) as { field?: { meta?: unknown } };
    toast.success("Option removed");
    return data;
  } catch {
    toast.error("Failed to remove option");
    return null;
  }
}

function ListField({
  form,
  name,
  label,
  required,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  label: string;
  required?: boolean;
}) {
  const [inputValue, setInputValue] = React.useState("");
  const raw = useWatch({ control: form.control, name: name as string });
  const items: string[] = React.useMemo(() => {
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "");
    if (typeof raw === "string" && raw.trim()) return raw.split("\n").filter(Boolean);
    return [];
  }, [raw]);

  const addItem = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (items.includes(trimmed)) return;
    const next = [...items, trimmed];
    form.setValue(name as never, next as never, { shouldDirty: true });
    setInputValue("");
  };

  const removeItem = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    form.setValue(name as never, next as never, { shouldDirty: true });
  };

  return (
    <div className="col-span-2 space-y-2">
      <Label>
        {label} {required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="Type and press Enter to add..."
          className="flex-1"
        />
        <Button type="button" size="sm" variant="secondary" disabled={!inputValue.trim()} onClick={addItem}>
          Add
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, idx) => (
            <li
              key={`${item}_${idx}`}
              className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <span>{item}</span>
              <button
                type="button"
                onClick={() => removeItem(idx)}
                className="ml-2 shrink-0 rounded text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      {required && items.length === 0 && (
        <input type="hidden" {...form.register(name as never, { validate: () => items.length > 0 || `${label} is required` })} />
      )}
    </div>
  );
}

function AdminAddOption({
  fieldId,
  existingOptions,
  onFieldUpdated,
}: {
  fieldId: number;
  existingOptions: { label?: string; value?: string }[];
  onFieldUpdated: (updatedField: { meta?: unknown }) => void;
}) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [confirmAdd, setConfirmAdd] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<{ value: string; label: string } | null>(null);

  const handleAddConfirmed = async () => {
    const label = confirmAdd;
    if (!label || busy) return;
    setBusy(true);
    try {
      const result = await appendOptionToField(fieldId, label);
      if (result?.field) {
        onFieldUpdated(result.field);
        setValue("");
      }
    } finally {
      setBusy(false);
      setConfirmAdd(null);
    }
  };

  const handleRemoveConfirmed = async () => {
    if (!confirmRemove || removing) return;
    const optValue = confirmRemove.value;
    setRemoving(optValue);
    try {
      const result = await removeOptionFromField(fieldId, optValue);
      if (result?.field) onFieldUpdated(result.field);
    } finally {
      setRemoving(null);
      setConfirmRemove(null);
    }
  };

  const requestAdd = () => {
    const label = value.trim();
    if (!label) return;
    const lower = label.toLowerCase();
    if (existingOptions.some((o) => (o.label ?? "").toLowerCase() === lower || (o.value ?? "").toLowerCase() === lower)) {
      toast.info("This option already exists");
      return;
    }
    setConfirmAdd(label);
  };

  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              requestAdd();
            }
          }}
          placeholder="Add new option..."
          className="h-7 flex-1 rounded border border-neutral-200 bg-white px-2 text-xs outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <Button type="button" size="xs" variant="secondary" disabled={busy || !value.trim()} onClick={requestAdd}>
          {busy ? "..." : "+"}
        </Button>
      </div>
      {existingOptions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
            Manage options ({existingOptions.length})
          </summary>
          <div className="mt-1 flex flex-wrap gap-1">
            {existingOptions.map((o, oIdx) => (
              <span
                key={`${o.value ?? ""}_${oIdx}`}
                className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800 dark:text-neutral-200"
              >
                {o.label ?? o.value}
                <button
                  type="button"
                  onClick={() => setConfirmRemove({ value: o.value ?? "", label: o.label ?? o.value ?? "" })}
                  disabled={removing === o.value}
                  className="rounded text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                  title="Remove option"
                >
                  {removing === o.value ? "..." : "×"}
                </button>
              </span>
            ))}
          </div>
        </details>
      )}

      {/* Confirm Add Dialog */}
      <Dialog open={!!confirmAdd} onOpenChange={(v) => { if (!v) setConfirmAdd(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add new option</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Are you sure you want to add <strong className="text-neutral-900 dark:text-neutral-100">&ldquo;{confirmAdd}&rdquo;</strong> as
            a new option? This will be available to all users.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmAdd(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleAddConfirmed()} disabled={busy}>
              {busy ? "Adding..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Remove Dialog */}
      <Dialog open={!!confirmRemove} onOpenChange={(v) => { if (!v) setConfirmRemove(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove option</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Are you sure you want to remove <strong className="text-neutral-900 dark:text-neutral-100">&ldquo;{confirmRemove?.label}&rdquo;</strong>?
            This will remove it from the list for all users.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmRemove(null)} disabled={!!removing}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleRemoveConfirmed()} disabled={!!removing}>
              {removing ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryTabs({
  categories,
  selectedCategory,
  onSelect,
  applyLabelCase,
}: {
  categories: { id: number; label: string; value: string; meta?: { labelCase?: "original" | "upper" | "lower" | "title" } | null }[];
  selectedCategory: string;
  onSelect: (v: string) => void;
  applyLabelCase: (text: string, mode?: "original" | "upper" | "lower" | "title") => string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = React.useState({ left: 0, width: 0 });

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLButtonElement>("[data-active=true]");
    if (active) {
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth,
      });
    }
  }, [selectedCategory, categories]);

  return (
    <div ref={containerRef} className="relative flex gap-1">
      <div
        className="absolute top-0 h-full rounded-md bg-neutral-100 shadow-sm transition-all duration-300 ease-in-out dark:bg-neutral-800"
        style={{ left: indicator.left, width: indicator.width }}
      />
      {categories.map((opt) => (
        <button
          key={opt.id}
          type="button"
          data-active={selectedCategory === opt.value}
          className={`relative z-10 rounded-md px-5 py-2 text-sm font-medium transition-colors duration-200 ${
            selectedCategory === opt.value
              ? "text-neutral-900 dark:text-white"
              : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          }`}
          onClick={() => onSelect(opt.value)}
        >
          {applyLabelCase(opt.label, opt.meta?.labelCase ?? "original")}
        </button>
      ))}
    </div>
  );
}

export function PackageBlock({
  form,
  pkg,
  allowedCategories,
  isAdmin,
  hideGroupLabels,
  onAutoScrollGroup,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  pkg: string;
  allowedCategories?: string[] | undefined;
  isAdmin?: boolean;
  hideGroupLabels?: boolean;
  onAutoScrollGroup?: (groupName: string, pkg: string) => void;
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
            // Try to auto-match based on another package's selected category
            let best = filtered[0].value;
            const formVals = form.getValues() as Record<string, unknown>;
            for (const [key, val] of Object.entries(formVals)) {
              if (key.endsWith("__category") && key !== catFieldName && val) {
                const otherCat = String(val).trim().toLowerCase();
                if (otherCat) {
                  const match = filtered.find((c) => c.value.toLowerCase().includes(otherCat));
                  if (match) { best = match.value; break; }
                }
              }
            }
            form.setValue(catFieldName as never, best as never, { shouldDirty: false, shouldTouch: false });
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

  // On mount/load: inject linked policy snapshot values so showWhen/groupShowWhen can evaluate
  const linkedSnapshotsRef = React.useRef<string>("");
  React.useEffect(() => {
    // Find all ___linkedPackagesSnapshot fields in the form (scoped per field)
    const snapshotEntries: string[] = [];
    for (const key of Object.keys(allFormValues)) {
      if (key.endsWith("___linkedPackagesSnapshot")) {
        const raw = String(allFormValues[key] ?? "");
        if (raw) snapshotEntries.push(raw);
      }
    }
    const fingerprint = snapshotEntries.join("|");
    if (!fingerprint || fingerprint === linkedSnapshotsRef.current) return;
    linkedSnapshotsRef.current = fingerprint;
    for (const raw of snapshotEntries) {
      try {
        const snap = JSON.parse(raw) as Record<string, unknown>;
        for (const [pkgKey, data] of Object.entries(snap)) {
          if (!data || typeof data !== "object") continue;
          const structured = data as { values?: Record<string, unknown> };
          const vals = structured.values ?? (data as Record<string, unknown>);
          if (!vals || typeof vals !== "object") continue;
          for (const [fieldKey, fieldVal] of Object.entries(vals)) {
            if (fieldVal === undefined || fieldVal === null || typeof fieldVal === "object") continue;
            const fk = fieldKey.startsWith(`${pkgKey}__`) ? fieldKey : `${pkgKey}__${fieldKey}`;
            form.setValue(fk as never, fieldVal as never, { shouldDirty: false });
          }
        }
      } catch { /* ignore */ }
    }
  }, [allFormValues, form]);

  // Auto-sync: when another package's category changes, re-match our category
  React.useEffect(() => {
    if (categories.length <= 1) return;
    const otherCatKeys = Object.keys(allFormValues).filter(
      (k) => k.endsWith("__category") && k !== catFieldName,
    );
    if (otherCatKeys.length === 0) return;
    for (const key of otherCatKeys) {
      const otherCat = String(allFormValues[key] ?? "").trim().toLowerCase();
      if (!otherCat) continue;
      const match = categories.find((c) => c.value.toLowerCase().includes(otherCat));
      if (match && match.value !== selectedCategory) {
        form.setValue(catFieldName as never, match.value as never, { shouldDirty: false, shouldTouch: false });
        return;
      }
    }
  }, [allFormValues, categories, catFieldName, form, selectedCategory]);

  const [pkgFields, setPkgFields] = React.useState<
    { id: number; label: string; value: string; valueType: string; sortOrder: number; meta?: unknown }[]
  >([]);
  React.useEffect(() => {
    let cancelled = false;
    async function loadFields() {
      try {
        // Try primary group first; if empty, fall back to common aliases
        const primaryRes = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}&_t=${Date.now()}`, { cache: "no-store" });
        let data = (await primaryRes.json()) as unknown[];
        // Only apply vehicle fallbacks when the selected package is a vehicle-like package.
        if ((!Array.isArray(data) || data.length === 0)) {
          const pkgLower = String(pkg ?? "").toLowerCase();
          const isVehicleLike = /\bvehicle\b/.test(pkgLower) || ["vehicle", "vehicleinfo", "auto", "car"].includes(pkgLower);
          if (isVehicleLike) {
            const fallbacks = ["vehicleinfo_fields", "vehicle_fields"];
            for (const fb of fallbacks) {
              try {
                const r = await fetch(`/api/form-options?groupKey=${encodeURIComponent(fb)}&_t=${Date.now()}`, { cache: "no-store" });
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
              ? (data as { id: number; label: string; value: string; valueType: string; sortOrder: number; meta?: unknown }[])
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

  // Auto-fill: when a boolean field with autoFill config changes to the trigger value,
  // copy values from source package fields into this package's fields.
  const autoFillPrevRef = React.useRef<Record<string, string>>({});
  React.useEffect(() => {
    if (pkgFields.length === 0) return;
    for (const f of pkgFields) {
      const meta = (f.meta ?? {}) as { inputType?: string; autoFill?: { when: string; mappings: { sourcePackage: string; sourceField: string; targetPackage?: string; targetField: string }[] } };
      if (meta.inputType !== "boolean" || !meta.autoFill?.mappings?.length) continue;
      const key = `${pkg}__${f.value}`;
      const currentVal = String(allFormValues[key] ?? "");
      const prevVal = autoFillPrevRef.current[key];
      if (currentVal === prevVal) continue;
      autoFillPrevRef.current[key] = currentVal;
      if (currentVal !== meta.autoFill.when) continue;
      for (const mapping of meta.autoFill.mappings) {
        if (!mapping.sourcePackage || !mapping.sourceField || !mapping.targetField) continue;
        const sourceKey = `${mapping.sourcePackage}__${mapping.sourceField}`;
        const tPkg = mapping.targetPackage || pkg;
        const targetKey = `${tPkg}__${mapping.targetField}`;
        const sourceVal = allFormValues[sourceKey];
        if (sourceVal !== undefined && sourceVal !== null && sourceVal !== "") {
          form.setValue(targetKey as never, sourceVal as never, { shouldDirty: true });
        }
      }
    }
  }, [allFormValues, pkgFields, pkg, form]);

  const [activeEntityPicker, setActiveEntityPicker] = React.useState<EntityPickerMeta | null>(null);
  const [activeEntityPickerField, setActiveEntityPickerField] = React.useState<string>("");
  const [agentPickerOpen, setAgentPickerOpen] = React.useState(false);
  const [agentPickerTarget, setAgentPickerTarget] = React.useState<string>("");

  const handleAgentPickerSelect = React.useCallback(
    (agent: AgentPickerSelection) => {
      const display = (agent.userNumber ? `${agent.userNumber} — ` : "") + (agent.name ?? agent.email);
      form.setValue(agentPickerTarget as never, display as never, { shouldDirty: true });
      form.setValue("_agentId" as never, agent.id as never, { shouldDirty: true });
      toast.success(`Agent selected: ${display}`, { duration: 1500 });
    },
    [form, agentPickerTarget],
  );

  const handleEntityPickerSelect = React.useCallback(
    (picker: EntityPickerMeta, selection: EntityPickerSelection, triggerField?: string) => {
      const extra = selection.extraAttributes;
      const pkgs = (extra?.packagesSnapshot ?? {}) as Record<string, unknown>;
      const insuredSnap = (extra?.insuredSnapshot ?? null) as Record<string, unknown> | null;
      const topLevel: Record<string, unknown> = {
        policyNumber: selection.policyNumber,
        policyId: selection.policyId,
        ...resolveInsuredVirtuals(insuredSnap),
      };

      const findValue = (sourceField: string): unknown => {
        if (sourceField in topLevel) return topLevel[sourceField];
        for (const [, data] of Object.entries(pkgs)) {
          if (!data || typeof data !== "object") continue;
          const structured = data as { values?: Record<string, unknown> };
          const values = structured.values ?? (data as Record<string, unknown>);
          if (sourceField in values) return values[sourceField];
          for (const [k, v] of Object.entries(values)) {
            const kTail = k.includes("__") ? k.split("__").pop() : k;
            if (kTail === sourceField) return v;
          }
        }
        if (insuredSnap) {
          if (sourceField in insuredSnap) return insuredSnap[sourceField];
          for (const [k, v] of Object.entries(insuredSnap)) {
            const kTail = k.includes("__") ? k.split("__").pop() : k.includes("_") ? k.split("_").pop() : k;
            if (kTail === sourceField) return v;
          }
        }
        return undefined;
      };

      const triggerFieldInMappings = triggerField
        ? picker.mappings.some((m) => {
            if (!m.targetField) return false;
            const tk = m.targetField.includes("__") ? m.targetField : `${pkg}__${m.targetField}`;
            return tk === triggerField;
          })
        : true;

      let firstMappingRedirected = false;
      for (const m of picker.mappings) {
        if (!m.sourceField || !m.targetField) continue;
        const val = findValue(m.sourceField);
        if (val !== undefined && val !== null && val !== "") {
          let targetKey = m.targetField.includes("__") ? m.targetField : `${pkg}__${m.targetField}`;
          if (triggerField && !triggerFieldInMappings && !firstMappingRedirected) {
            targetKey = triggerField;
            firstMappingRedirected = true;
          }
          form.setValue(targetKey as never, val as never, { shouldDirty: true });
        }
      }

      const flowKey = String(extra?.flowKey ?? "");
      const fieldBase = triggerField || `${pkg}___default`;

      // Clear previously injected linked-policy values BEFORE writing the new snapshot
      const prevSnapJson = String(form.getValues(`${fieldBase}___linkedPackagesSnapshot` as never) ?? "");
      if (prevSnapJson) {
        try {
          const old = JSON.parse(prevSnapJson) as Record<string, unknown>;
          for (const [pkgKey, data] of Object.entries(old)) {
            if (!data || typeof data !== "object") continue;
            const structured = data as { values?: Record<string, unknown> };
            const vals = structured.values ?? (data as Record<string, unknown>);
            if (!vals || typeof vals !== "object") continue;
            for (const [fieldKey] of Object.entries(vals)) {
              const fk = fieldKey.startsWith(`${pkgKey}__`) ? fieldKey : `${pkgKey}__${fieldKey}`;
              form.setValue(fk as never, "" as never, { shouldDirty: false });
            }
          }
        } catch { /* ignore */ }
      }

      form.setValue(`${fieldBase}___linkedPolicyId` as never, selection.policyId as never, { shouldDirty: true });
      form.setValue(`${fieldBase}___linkedPolicyNumber` as never, selection.policyNumber as never, { shouldDirty: true });
      form.setValue(`${fieldBase}___linkedInsuredSnapshot` as never, JSON.stringify(insuredSnap ?? {}) as never, { shouldDirty: true });
      form.setValue(`${fieldBase}___linkedPackagesSnapshot` as never, JSON.stringify(pkgs ?? {}) as never, { shouldDirty: true });
      form.setValue(`${fieldBase}___linkedFlowKey` as never, flowKey as never, { shouldDirty: true });
      form.setValue(`${fieldBase}___linkedAgent` as never, JSON.stringify(selection.agent ?? null) as never, { shouldDirty: true });

      // Inject new linked policy's package values so showWhen/groupShowWhen conditions work
      for (const [pkgKey, data] of Object.entries(pkgs)) {
        if (!data || typeof data !== "object") continue;
        const structured = data as { values?: Record<string, unknown> };
        const vals = structured.values ?? (data as Record<string, unknown>);
        if (!vals || typeof vals !== "object") continue;
        for (const [fieldKey, fieldVal] of Object.entries(vals)) {
          if (fieldVal === undefined || fieldVal === null || typeof fieldVal === "object") continue;
          const fk = fieldKey.startsWith(`${pkgKey}__`) ? fieldKey : `${pkgKey}__${fieldKey}`;
          form.setValue(fk as never, fieldVal as never, { shouldDirty: false });
        }
      }

      toast.success(`${picker.buttonLabel || "Record"} selected: ${selection.policyNumber}`, { duration: 1500 });
    },
    [form, pkg],
  );

  // Auto-scroll: when a select option has scrollToPackage or scrollToGroup, notify parent
  // Skip the initial mount — only fire when the user actually changes a value
  const prevScrollTargetRef = React.useRef<string | null>(null);
  const autoScrollMountedRef = React.useRef(false);
  React.useEffect(() => {
    if (!onAutoScrollGroup) return;

    let currentTarget: string | undefined;
    for (const f of pkgFields) {
      const meta = (f.meta ?? {}) as {
        inputType?: string;
        options?: { value?: string; scrollToPackage?: string; scrollToGroup?: string; scrollToField?: string }[];
      };
      if (meta.inputType !== "select" || !Array.isArray(meta.options)) continue;
      const rawFieldKey = String(f.value ?? "").trim();
      const fieldKey = rawFieldKey.startsWith(`${pkg}__`) ? rawFieldKey : rawFieldKey.startsWith(`${pkg}_`) ? rawFieldKey.slice(`${pkg}_`.length) : rawFieldKey;
      const nameBase = rawFieldKey.startsWith(`${pkg}__`) ? rawFieldKey : `${pkg}__${fieldKey}`;
      const currentVal = String(allFormValues[nameBase] ?? "").trim();
      if (!currentVal) { prevScrollTargetRef.current = null; continue; }

      const matchOpt = meta.options.find((o) => o.value === currentVal);
      const fieldSuffix = matchOpt?.scrollToField ? `|field:${matchOpt.scrollToField}` : "";
      const target = matchOpt?.scrollToPackage
        ? `pkg:${matchOpt.scrollToPackage}${fieldSuffix}`
        : matchOpt?.scrollToGroup
          ? `grp:${matchOpt.scrollToGroup}${fieldSuffix}`
          : undefined;

      if (target) currentTarget = target;

      if (target && target !== prevScrollTargetRef.current) {
        prevScrollTargetRef.current = target;
        if (autoScrollMountedRef.current) {
          onAutoScrollGroup(target, pkg);
        }
      } else if (!target) {
        prevScrollTargetRef.current = null;
      }
    }

    if (!autoScrollMountedRef.current) {
      prevScrollTargetRef.current = currentTarget ?? null;
      autoScrollMountedRef.current = true;
    }
  }, [allFormValues, pkgFields, pkg, onAutoScrollGroup]);

  return (
    <section id={`pkg-block-${pkg}`} data-pkg-block={pkg} className="space-y-4 scroll-mt-20">
      {categories.length > 1 ? (
        <CategoryTabs
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={(v) => form.setValue(catFieldName as never, v as never)}
          applyLabelCase={applyLabelCase}
        />
      ) : categories.length === 1 ? (
        <input type="hidden" value={categories[0].value} {...form.register(catFieldName as never)} />
      ) : null}
      {/* Grouped fields by meta.group with group-level sorting */}
      <div className="space-y-6">
        {(() => {
          const debugRows: { label: string; value: string; group: string; catPass: boolean; catDetail: string; swPass: boolean; swDetail: string; visible: boolean }[] = [];
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
              showWhen?: { package: string; category: string | string[]; field?: string; fieldValues?: string[]; childKey?: string; childValues?: string[] } | { package: string; category: string | string[]; field?: string; fieldValues?: string[]; childKey?: string; childValues?: string[] }[];
            };
            const cats = (meta.categories ?? []) as string[];
            const canonCats = cats.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean);
            const sel = String(selectedCategory ?? "").trim().toLowerCase();
            const catPass = canonCats.length === 0 || canonCats.includes(sel);
            const catDetail = canonCats.length === 0
              ? "all (no filter)"
              : `needs [${canonCats.join(", ")}], selected="${sel}", ${catPass ? "PASS" : "FAIL"}`;

            const swRules = Array.isArray(meta.showWhen) ? meta.showWhen : (meta.showWhen ? [meta.showWhen] : undefined);
            const swPass = evaluateShowWhen(swRules, allFormValues);
            let swDetail = "none";
            if (swRules && swRules.length > 0) {
              swDetail = swRules.map((r) => {
                const p = r.package;
                const catVal = String(allFormValues[`${p}__category`] ?? "").trim();
                const allowed = (Array.isArray(r.category) ? r.category : [r.category]).filter(Boolean);
                let detail = `pkg="${p}" cat="${catVal}" allowed=[${allowed.join(",")}]`;
                if (r.field) {
                  const fv = String(allFormValues[`${p}__${r.field}`] ?? "").trim();
                  detail += ` field="${r.field}" val="${fv}" allowedVals=[${(r.fieldValues ?? []).join(",")}]`;
                }
                if (r.childKey && r.field) {
                  const pv = String(allFormValues[`${p}__${r.field}`] ?? "").trim();
                  const idxM = r.childKey.match(/[cs]c?(\d+)$/);
                  const ck = idxM && pv ? `${p}__${r.field}__opt_${pv}__c${idxM[1]}` : `${p}__${r.field}__${r.childKey}`;
                  const childVal = String(allFormValues[ck] ?? "").trim();
                  detail += ` childKey="${r.childKey}" resolvedKey="${ck}" childVal="${childVal}" allowedChildVals=[${(r.childValues ?? []).join(",")}]`;
                }
                return detail;
              }).join(" | ");
            }

            debugRows.push({
              label: (f as { label?: string }).label ?? "?",
              value: (f as { value?: string }).value ?? "?",
              group: Array.isArray(meta.group) ? meta.group.join(", ") : (meta.group ?? "(none)"),
              catPass,
              catDetail,
              swPass,
              swDetail,
              visible: catPass && swPass,
            });

            if (!catPass) return false;
            if (!swPass) return false;

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
            const meta = (f.meta ?? {}) as { group?: string | string[]; groupOrder?: number };
            const rawGroup = meta?.group;
            const fieldGroups = Array.isArray(rawGroup)
              ? (rawGroup.length > 0 ? rawGroup : [""])
              : [String(rawGroup ?? "")];
            const order = typeof meta?.groupOrder === "number" ? meta.groupOrder : 0;
            for (const key of fieldGroups) {
              if (!groupMap.has(key)) groupMap.set(key, { fields: [], order });
              const bucket = groupMap.get(key)!;
              bucket.fields.push(f);
              if (typeof meta?.groupOrder === "number") {
                bucket.order = Math.min(bucket.order, meta.groupOrder);
              }
            }
          }
          type GswRule = { package?: string; field: string; values: string[]; childKey?: string; childValues?: string[] };
          type GswMap = Record<string, GswRule[] | null>;
          const debugGroupRows: { group: string; fieldCount: number; visible: boolean; detail: string }[] = [];
          const allGroupEntries = Array.from(groupMap.entries())
            .sort((a, b) => a[1].order - b[1].order);
          const entries = allGroupEntries
            .filter(([groupLabel, bucket]) => {
              let raw: GswRule | GswRule[] | null | undefined;
              let gswLogic: "and" | "or" = "and";
              for (const f of bucket.fields) {
                const meta = f.meta as { groupShowWhen?: GswRule | GswRule[] | GswMap | null; groupShowWhenMap?: GswMap; groupShowWhenLogic?: "and" | "or"; groupShowWhenLogicMap?: Record<string, "and" | "or"> } | null;
                const map = meta?.groupShowWhenMap;
                if (map && groupLabel && typeof map === "object" && !Array.isArray(map) && groupLabel in map) {
                  raw = map[groupLabel];
                  gswLogic = meta?.groupShowWhenLogicMap?.[groupLabel] ?? meta?.groupShowWhenLogic ?? "and";
                  break;
                }
                const legacy = meta?.groupShowWhen;
                if (legacy != null) {
                  if (typeof legacy === "object" && !Array.isArray(legacy) && !("field" in legacy)) {
                    if (groupLabel && groupLabel in (legacy as GswMap)) {
                      raw = (legacy as GswMap)[groupLabel];
                      gswLogic = meta?.groupShowWhenLogicMap?.[groupLabel] ?? meta?.groupShowWhenLogic ?? "and";
                      break;
                    }
                  } else {
                    raw = legacy as GswRule | GswRule[];
                    gswLogic = meta?.groupShowWhenLogic ?? "and";
                    break;
                  }
                }
              }
              if (!raw) {
                debugGroupRows.push({ group: groupLabel || "(default)", fieldCount: bucket.fields.length, visible: true, detail: "no groupShowWhen" });
                return true;
              }
              const rules: GswRule[] = Array.isArray(raw) ? raw : [raw];
              if (rules.length === 0 || !rules[0]?.field) {
                debugGroupRows.push({ group: groupLabel || "(default)", fieldCount: bucket.fields.length, visible: true, detail: "empty rules" });
                return true;
              }
              const evalRule = (gsw: GswRule) => {
                if (!gsw.field) return true;
                const rulePkg = gsw.package || pkg;
                const fieldVal = String(allFormValues[`${rulePkg}__${gsw.field}`] ?? "").trim().toLowerCase();
                const allowed = (gsw.values ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
                if (allowed.length > 0 && !allowed.includes(fieldVal)) return false;
                if (gsw.childKey) {
                  const optMatch = gsw.childKey.match(/__opt_([^_]+)__c\d+$/);
                  const childOwnerOpt = optMatch ? optMatch[1].toLowerCase() : "";
                  if (!childOwnerOpt || fieldVal === childOwnerOpt) {
                    const childVal = String(allFormValues[`${rulePkg}__${gsw.childKey}`] ?? "").trim().toLowerCase();
                    const childAllowed = (gsw.childValues ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
                    if (childAllowed.length > 0 && !childAllowed.includes(childVal)) return false;
                  }
                }
                return true;
              };
              const pass = gswLogic === "or" ? rules.some(evalRule) : rules.every(evalRule);
              const logicLabel = gswLogic === "or" ? "OR" : "AND";
              const detail = rules.map((gsw) => {
                const rulePkg = gsw.package || pkg;
                const fk = `${rulePkg}__${gsw.field}`;
                const fv = String(allFormValues[fk] ?? "").trim();
                let d = `pkg="${rulePkg}" field="${gsw.field}" val="${fv}" allowed=[${(gsw.values ?? []).join(",")}]`;
                if (gsw.childKey) {
                  const cv = String(allFormValues[`${rulePkg}__${gsw.childKey}`] ?? "").trim();
                  d += ` childKey="${gsw.childKey}" childVal="${cv}" childAllowed=[${(gsw.childValues ?? []).join(",")}]`;
                }
                return d;
              }).join(` ${logicLabel} `);
              debugGroupRows.push({ group: groupLabel || "(default)", fieldCount: bucket.fields.length, visible: pass, detail: `${pass ? "PASS" : "FAIL"} (${logicLabel}): ${detail}` });
              return pass;
            });
          const seenInGroups = new Set<number>();
          for (const [, bucket] of entries) {
            bucket.fields = bucket.fields.filter((f) => {
              if (seenInGroups.has((f as any).id)) return false;
              seenInGroups.add((f as any).id);
              return true;
            });
          }
          const groupedElements = entries
            .filter(([, bucket]) => bucket.fields.length > 0)
            .map(([groupLabel, bucket]) => {
            const groupSlug = (groupLabel || "default").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            return (
            <div
              key={groupLabel || "default"}
              id={`pkg-group-${pkg}-${groupSlug}`}
              data-group-name={groupLabel || "default"}
              data-pkg={pkg}
              className="space-y-2 scroll-mt-24"
            >
              {groupLabel && !hideGroupLabels ? (
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
                    entityPicker?: EntityPickerMeta;
                  };
                  const displayLabel = applyLabelCase(f.label, meta.labelCase);
                  const inputType = meta.inputType ?? "string";
                  const isCurrency = inputType === "currency" || inputType === "negative_currency";
                  const isNegativeCurrency = inputType === "negative_currency";
                  const isPercent = inputType === "percent";
                  const isNumber = inputType === "number" || isCurrency || isPercent;
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
                    const epMeta = meta.entityPicker as EntityPickerMeta | undefined;
                    return (
                      <SubFieldRepeatable
                        key={nameBase}
                        form={form}
                        name={nameBase}
                        label={displayLabel}
                        required={Boolean(meta.required)}
                        repeatable={meta.repeatable}
                        entityPicker={epMeta}
                      />
                    );
                  }
                  if (inputType === "select") {
                    const options = (Array.isArray(meta.options) ? (meta.options as unknown[]) : []) as {
                      label?: string;
                      value?: string;
                      children?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; booleanChildren?: { true?: any[]; false?: any[] } }[];
                    }[];
                    const fieldId = (f as any).id as number | undefined;
                    const selectEl = (
                      <InlineSelectWithChildren
                        key={nameBase}
                        form={form}
                        nameBase={nameBase}
                        label={displayLabel}
                        required={Boolean(meta.required)}
                        options={options}
                        displayMode={(meta?.selectDisplay ?? "dropdown") === "dropdown" ? "dropdown" : "radio"}
                        isAdmin={isAdmin}
                        fieldId={fieldId}
                        onFieldUpdated={(updatedField) => {
                          const idx = pkgFields.findIndex((pf) => pf.id === fieldId);
                          if (idx >= 0) {
                            const updated = [...pkgFields];
                            updated[idx] = { ...updated[idx], meta: updatedField.meta };
                            setPkgFields(updated);
                          }
                        }}
                      />
                    );
                    if (meta.entityPicker?.flow) {
                      return (
                        <div key={`${nameBase}__ep`} className="space-y-1">
                          {selectEl}
                          <button
                            type="button"
                            className="group/ep relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-all duration-300 ease-out hover:w-auto hover:gap-1.5 hover:px-3 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                            onClick={() => { setActiveEntityPicker(meta.entityPicker!); setActiveEntityPickerField(nameBase); }}
                            title={meta.entityPicker.buttonLabel || "Browse"}
                          >
                            <Search className="h-3.5 w-3.5 shrink-0" />
                            <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 transition-all duration-300 ease-out group-hover/ep:max-w-48 group-hover/ep:opacity-100">
                              {meta.entityPicker.buttonLabel || "Browse"}
                            </span>
                          </button>
                        </div>
                      );
                    }
                    return selectEl;
                  }
                  if (inputType === "multi_select") {
                    const options = (Array.isArray(meta.options) ? (meta.options as unknown[]) : []) as {
                      label?: string;
                      value?: string;
                      children?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; currencyCode?: string; decimals?: number }[];
                    }[];
                    const fieldId = (f as any).id as number | undefined;
                    const currentRaw = form.watch(nameBase as never) as unknown;
                    const current = Array.isArray(currentRaw)
                      ? (currentRaw as unknown[])
                      : typeof currentRaw === "string" && currentRaw
                        ? [currentRaw]
                        : [];
                    return (
                      <div key={nameBase} className="col-span-2 space-y-2">
                        <div className="space-y-1">
                          <Label>
                            {displayLabel} {meta.required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                          </Label>
                          <div className="space-y-4 pt-1">
                            {options.map((o, oIdx) => {
                              const isChecked = current.includes(o.value as unknown);
                              const children = isChecked && Array.isArray(o.children) ? o.children : [];
                              return (
                                <div key={`${o.value ?? ""}_${oIdx}`} className="space-y-3">
                                  <label className="flex items-start gap-2 text-sm leading-snug">
                                    <input
                                      type="checkbox"
                                      value={o.value}
                                      className="mt-0.5 shrink-0"
                                      {...form.register(nameBase as never, {
                                        validate: (v) =>
                                          !Boolean(meta.required) ||
                                          (Array.isArray(v) && (v as unknown[]).length > 0) ||
                                          `${displayLabel} is required`,
                                      })}
                                    />
                                    <span>{o.label}</span>
                                  </label>
                                  {children.length > 0 && (
                                    <div className="ml-6 grid grid-cols-2 gap-4 border-l-2 border-neutral-200 pl-4 dark:border-neutral-700">
                                      {children.map((child, cIdx) => {
                                        if (!evaluateShowWhen((child as any)?.showWhen, allFormValues)) return null;
                                        const cType = child?.inputType ?? "string";
                                        const cIsNum = cType === "number";
                                        const cIsDate = cType === "date";
                                        const name = `${nameBase}__opt_${o.value}__c${cIdx}`;
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
                                        if (cType === "formula") {
                                          return (
                                            <FormulaField
                                              key={name}
                                              form={form}
                                              name={name}
                                              formula={String((child as any)?.formula ?? "")}
                                              label={child?.label ?? "Value"}
                                              pkg={pkg}
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
                                                {opts.map((so, soIdx) => (
                                                  <option key={`${so.value ?? ""}_${soIdx}`} value={so.value}>
                                                    {so.label}
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
                                            <div key={name} className="col-span-2 space-y-2">
                                              <Label>{child?.label ?? "Details"}</Label>
                                              <div className="space-y-3">
                                                {opts.map((so, soIdx) => (
                                                  <label key={`${so.value ?? ""}_${soIdx}`} className="flex items-start gap-2 text-sm leading-snug">
                                                    <input type="checkbox" value={so.value} className="mt-0.5 shrink-0" {...form.register(name as never)} />
                                                    <span>{so.label}</span>
                                                  </label>
                                                ))}
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
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {options.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                          </div>
                          {isAdmin && fieldId && (
                            <AdminAddOption
                              fieldId={fieldId}
                              existingOptions={options}
                              onFieldUpdated={(updatedField) => {
                                const idx = pkgFields.findIndex((pf) => pf.id === fieldId);
                                if (idx >= 0) {
                                  const updated = [...pkgFields];
                                  updated[idx] = { ...updated[idx], meta: updatedField.meta };
                                  setPkgFields(updated);
                                }
                              }}
                            />
                          )}
                        </div>
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
                    const curr: unknown = form.watch(nameBase as never);
                    const hasSelection = curr !== undefined && curr !== null && curr !== "";
                    const isYes = hasSelection && String(curr) === "true";
                    const isNo = hasSelection && String(curr) === "false";
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
                            {yesChildren.map((child: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; showWhen?: { package: string; category: string | string[] }[]; defaultValue?: string; readOnly?: boolean }, cIdx: number) => {
                              if (!evaluateShowWhen(child?.showWhen, allFormValues)) return null;
                              const name = `${nameBase}__true__c${cIdx}`;
                              const hasDefault = child?.defaultValue !== undefined && child.defaultValue !== "";
                              const dvNode = hasDefault ? <DefaultValueSetter form={form} name={name} defaultValue={child.defaultValue!} /> : null;
                              if (child?.readOnly && child?.defaultValue) {
                                return (
                                  <React.Fragment key={name}>
                                    {dvNode}
                                    <div className="space-y-1">
                                      <Label>{child?.label ?? "Value"}</Label>
                                      <div className="flex h-9 items-center rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                        {child.defaultValue}
                                      </div>
                                    </div>
                                  </React.Fragment>
                                );
                              }
                              const cType = child?.inputType ?? "string";
                              if (cType === "formula") {
                                return (
                                  <React.Fragment key={name}>
                                    {dvNode}
                                    <FormulaField
                                      form={form}
                                      name={name}
                                      formula={String((child as any)?.formula ?? "")}
                                      label={child?.label ?? "Value"}
                                      pkg={pkg}
            
                                    />
                                  </React.Fragment>
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
                                      {dvNode}
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
                                      <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
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
                                    <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                                  </div>
                                );
                              }
                              const isRepeatableChild =
                                String(cType).trim().toLowerCase() === "repeatable" ||
                                String(cType).toLowerCase().includes("repeat") ||
                                Boolean((child as { repeatable?: RepeatableConfig | RepeatableConfig[] } | undefined)?.repeatable);
                              if (isRepeatableChild) {
                                const childEp = ((child as any)?.entityPicker ?? meta.entityPicker) as EntityPickerMeta | undefined;
                                return (
                                  <SubFieldRepeatable
                                    key={`${name}__rep`}
                                    form={form}
                                    name={name}
                                    label={child?.label}
                                    repeatable={(child as { repeatable?: unknown })?.repeatable}
                                    entityPicker={childEp}
                                  />
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
                              if (cType === "select") {
                                const allOpts = (Array.isArray(child?.options) ? child.options : []) as OptionWithChildren[];
                                const hasAnyChildren = allOpts.some((o) => Array.isArray(o.children) && o.children.length > 0);
                                if (hasAnyChildren) {
                                  return (
                                    <React.Fragment key={name}>
                                      {dvNode}
                                      <SelectWithOptionChildren form={form} name={name} label={child?.label ?? "Select"} options={allOpts} allFormValues={allFormValues} />
                                    </React.Fragment>
                                  );
                                }
                                const opts = allOpts.filter((o) => evaluateShowWhen((o as any)?.showWhen, allFormValues));
                                return (
                                  <div key={name} className="space-y-1">
                                    {dvNode}
                                    <Label>{child?.label ?? "Select"}</Label>
                                    <select
                                      className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                      {...form.register(name as never)}
                                    >
                                      <option value="">-- Select --</option>
                                      {opts.map((o, oIdx) => (
                                        <option key={`${o.value ?? ""}_${oIdx}`} value={o.value}>{o.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              }
                              if (cType === "multi_select") {
                                const allOpts = (Array.isArray(child?.options) ? child.options : []) as { label?: string; value?: string; showWhen?: unknown }[];
                                const opts = allOpts.filter((o) => evaluateShowWhen((o as any)?.showWhen, allFormValues));
                                return (
                                  <div key={name} className="space-y-1">
                                    {dvNode}
                                    <Label>{child?.label ?? "Select"}</Label>
                                    <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                      {opts.map((o, oIdx) => (
                                        <label key={`${o.value ?? ""}_${oIdx}`} className="mr-4 inline-flex items-center gap-2 text-sm">
                                          <input type="checkbox" value={o.value} {...form.register(name as never)} />
                                          {o.label}
                                        </label>
                                      ))}
                                      {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
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
                                <React.Fragment key={name}>
                                  {dvNode}
                                  <div>
                                    <Field
                                      label={child?.label ?? "Details"}
                                      required={false}
                                      type={cIsNum ? "number" : cIsDate ? "text" : "text"}
                                      placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
                                      inputMode={cIsDate ? "numeric" : undefined}
                                      {...form.register(name as never, regOpts)}
                                    />
                                  </div>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        ) : null}
                        {isNo && noChildren.length > 0 ? (
                          <div className="grid grid-cols-2 gap-4">
                            {noChildren.map((child: { label?: string; inputType?: string; options?: { label?: string; value?: string }[]; booleanLabels?: { true?: string; false?: string }; booleanDisplay?: "radio" | "dropdown"; showWhen?: { package: string; category: string | string[] }[]; defaultValue?: string; readOnly?: boolean }, cIdx: number) => {
                              if (!evaluateShowWhen(child?.showWhen, allFormValues)) return null;
                              const name = `${nameBase}__false__c${cIdx}`;
                              const hasDefault = child?.defaultValue !== undefined && child.defaultValue !== "";
                              const dvNode = hasDefault ? <DefaultValueSetter form={form} name={name} defaultValue={child.defaultValue!} /> : null;
                              if (child?.readOnly && child?.defaultValue) {
                                return (
                                  <React.Fragment key={name}>
                                    {dvNode}
                                    <div className="space-y-1">
                                      <Label>{child?.label ?? "Value"}</Label>
                                      <div className="flex h-9 items-center rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                        {child.defaultValue}
                                      </div>
                                    </div>
                                  </React.Fragment>
                                );
                              }
                              const cType = child?.inputType ?? "string";
                              if (cType === "formula") {
                                return (
                                  <React.Fragment key={name}>
                                    {dvNode}
                                    <FormulaField
                                      form={form}
                                      name={name}
                                      formula={String((child as any)?.formula ?? "")}
                                      label={child?.label ?? "Value"}
                                      pkg={pkg}
            
                                    />
                                  </React.Fragment>
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
                                      {dvNode}
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
                                      <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
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
                                    <BooleanBranchFields form={form} name={name} booleanChildren={boolCh} />
                                  </div>
                                );
                              }
                              const isRepeatableChild =
                                String(cType).trim().toLowerCase() === "repeatable" ||
                                String(cType).toLowerCase().includes("repeat") ||
                                Boolean((child as { repeatable?: RepeatableConfig | RepeatableConfig[] } | undefined)?.repeatable);
                              if (isRepeatableChild) {
                                const childEp = ((child as any)?.entityPicker ?? meta.entityPicker) as EntityPickerMeta | undefined;
                                return (
                                  <SubFieldRepeatable
                                    key={`${name}__rep`}
                                    form={form}
                                    name={name}
                                    label={child?.label}
                                    repeatable={(child as { repeatable?: unknown })?.repeatable}
                                    entityPicker={childEp}
                                  />
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
                              if (cType === "select") {
                                const allOpts = (Array.isArray(child?.options) ? child.options : []) as OptionWithChildren[];
                                const hasAnyChildren = allOpts.some((o) => Array.isArray(o.children) && o.children.length > 0);
                                if (hasAnyChildren) {
                                  return (
                                    <React.Fragment key={name}>
                                      {dvNode}
                                      <SelectWithOptionChildren form={form} name={name} label={child?.label ?? "Select"} options={allOpts} allFormValues={allFormValues} />
                                    </React.Fragment>
                                  );
                                }
                                const opts = allOpts.filter((o) => evaluateShowWhen((o as any)?.showWhen, allFormValues));
                                return (
                                  <div key={name} className="space-y-1">
                                    {dvNode}
                                    <Label>{child?.label ?? "Select"}</Label>
                                    <select
                                      className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                      {...form.register(name as never)}
                                    >
                                      <option value="">-- Select --</option>
                                      {opts.map((o, oIdx) => (
                                        <option key={`${o.value ?? ""}_${oIdx}`} value={o.value}>{o.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              }
                              if (cType === "multi_select") {
                                const allOpts = (Array.isArray(child?.options) ? child.options : []) as { label?: string; value?: string; showWhen?: unknown }[];
                                const opts = allOpts.filter((o) => evaluateShowWhen((o as any)?.showWhen, allFormValues));
                                return (
                                  <div key={name} className="space-y-1">
                                    {dvNode}
                                    <Label>{child?.label ?? "Select"}</Label>
                                    <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                      {opts.map((o, oIdx) => (
                                        <label key={`${o.value ?? ""}_${oIdx}`} className="mr-4 inline-flex items-center gap-2 text-sm">
                                          <input type="checkbox" value={o.value} {...form.register(name as never)} />
                                          {o.label}
                                        </label>
                                      ))}
                                      {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
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
                                <React.Fragment key={name}>
                                  {dvNode}
                                  <div>
                                    <Field
                                      label={child?.label ?? "Details"}
                                      required={false}
                                      type={cIsNum ? "number" : cIsDate ? "text" : "text"}
                                      placeholder={cIsDate ? "DD-MM-YYYY" : undefined}
                                      inputMode={cIsDate ? "numeric" : undefined}
                                      {...form.register(name as never, regOpts)}
                                    />
                                  </div>
                                </React.Fragment>
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

                      />
                    );
                  }
                  if (inputType === "list") {
                    return (
                      <ListField
                        key={nameBase}
                        form={form}
                        name={nameBase}
                        label={displayLabel}
                        required={Boolean(meta.required)}
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
                      const formatted = maskDDMMYYYY(t?.target?.value ?? "");
                      form.setValue(nameBase as never, formatted as never, { shouldDirty: true });
                    };
                  }
                  options.required = Boolean(meta.required);
                  if (isCurrency) {
                    const currencyCode = String((meta as any)?.currencyCode ?? "").trim();
                    const decimals = Number((meta as any)?.decimals ?? 2);
                    const step = `0.${"0".repeat(Math.max(0, decimals - 1))}1`;
                    if (isNegativeCurrency) {
                      const reg = form.register(nameBase as never, options);
                      const origOnBlur = reg.onBlur;
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
                              placeholder={`-0.${"0".repeat(decimals)}`}
                              className="text-red-600 dark:text-red-400"
                              {...reg}
                              onBlur={(e) => {
                                const n = parseFloat(e.target.value);
                                if (!isNaN(n) && n > 0) {
                                  const neg = -Math.abs(n);
                                  e.target.value = String(neg);
                                  form.setValue(nameBase as never, neg as never, { shouldDirty: true });
                                }
                                origOnBlur(e);
                              }}
                            />
                          </div>
                        </div>
                      );
                    }
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
                  if (inputType === "agent_picker") {
                    const apLabel = String((meta as any)?.agentPickerLabel ?? "").trim() || "Browse";
                    return (
                      <div key={nameBase} className="col-span-2 space-y-1">
                        <Label>
                          {displayLabel} {Boolean(meta.required) ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                        </Label>
                        <div className="flex items-center gap-1.5">
                          <Input
                            className="flex-1"
                            readOnly
                            placeholder="Select an agent…"
                            {...form.register(nameBase as never, options)}
                          />
                          <button
                            type="button"
                            className="group/ep relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-all duration-300 ease-out hover:w-auto hover:gap-1.5 hover:px-3 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                            onClick={() => { setAgentPickerTarget(nameBase); setAgentPickerOpen(true); }}
                            title={apLabel}
                          >
                            <Search className="h-3.5 w-3.5 shrink-0" />
                            <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 transition-all duration-300 ease-out group-hover/ep:max-w-48 group-hover/ep:opacity-100">
                              {apLabel}
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  }
                  if (meta.entityPicker?.flow) {
                    const linkedPolId = String(allFormValues[`${nameBase}___linkedPolicyId`] ?? "");
                    const linkedPolNum = String(allFormValues[`${nameBase}___linkedPolicyNumber`] ?? "");
                    const linkedInsuredJson = String(allFormValues[`${nameBase}___linkedInsuredSnapshot`] ?? "");
                    const linkedPkgsJson = String(allFormValues[`${nameBase}___linkedPackagesSnapshot`] ?? "");
                    const linkedFlowKey = String(allFormValues[`${nameBase}___linkedFlowKey`] ?? "");
                    const linkedAgentJson = String(allFormValues[`${nameBase}___linkedAgent`] ?? "");
                    return (
                      <React.Fragment key={nameBase}>
                        <div className="col-span-2 space-y-1">
                          <Label>
                            {displayLabel} {Boolean(meta.required) ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                          </Label>
                          <div className="flex items-center gap-1.5">
                            <Input
                              className="flex-1"
                              type={isNumber ? "number" : isDate ? "text" : "text"}
                              placeholder={isDate ? "DD-MM-YYYY" : undefined}
                              inputMode={isDate ? "numeric" : undefined}
                              {...form.register(nameBase as never, options)}
                            />
                            <button
                              type="button"
                              className="group/ep relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition-all duration-300 ease-out hover:w-auto hover:gap-1.5 hover:px-3 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                              onClick={() => { setActiveEntityPicker(meta.entityPicker!); setActiveEntityPickerField(nameBase); }}
                              title={meta.entityPicker.buttonLabel || "Browse"}
                            >
                              <Search className="h-3.5 w-3.5 shrink-0" />
                              <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium opacity-0 transition-all duration-300 ease-out group-hover/ep:max-w-48 group-hover/ep:opacity-100">
                                {meta.entityPicker.buttonLabel || "Browse"}
                              </span>
                            </button>
                          </div>
                        </div>
                        {linkedPolNum && (
                          <LinkedPolicyCard
                            policyId={linkedPolId}
                            policyNumber={linkedPolNum}
                            insuredSnapshotJson={linkedInsuredJson}
                            packagesSnapshotJson={linkedPkgsJson}
                            flowKey={linkedFlowKey}
                            agentJson={linkedAgentJson}
                            title={meta.entityPicker.buttonLabel || displayLabel}
                            onClear={() => {
                              // Clear injected linked-policy package values
                              try {
                                const snap = JSON.parse(linkedPkgsJson || "{}") as Record<string, unknown>;
                                for (const [pkgKey, data] of Object.entries(snap)) {
                                  if (!data || typeof data !== "object") continue;
                                  const structured = data as { values?: Record<string, unknown> };
                                  const vals = structured.values ?? (data as Record<string, unknown>);
                                  if (!vals || typeof vals !== "object") continue;
                                  for (const [fieldKey] of Object.entries(vals)) {
                                    const fk = fieldKey.startsWith(`${pkgKey}__`) ? fieldKey : `${pkgKey}__${fieldKey}`;
                                    form.setValue(fk as never, "" as never, { shouldDirty: false });
                                  }
                                }
                              } catch { /* ignore */ }
                              form.setValue(`${nameBase}___linkedPolicyId` as never, "" as never, { shouldDirty: true });
                              form.setValue(`${nameBase}___linkedPolicyNumber` as never, "" as never, { shouldDirty: true });
                              form.setValue(`${nameBase}___linkedInsuredSnapshot` as never, "" as never, { shouldDirty: true });
                              form.setValue(`${nameBase}___linkedPackagesSnapshot` as never, "" as never, { shouldDirty: true });
                              form.setValue(`${nameBase}___linkedFlowKey` as never, "" as never, { shouldDirty: true });
                              form.setValue(`${nameBase}___linkedAgent` as never, "" as never, { shouldDirty: true });
                              form.setValue(nameBase as never, "" as never, { shouldDirty: true });
                            }}
                          />
                        )}
                      </React.Fragment>
                    );
                  }
                  return (
                    <Field
                      key={nameBase}
                      label={displayLabel}
                      required={Boolean(meta.required)}
                      type={isNumber ? "number" : isDate ? "text" : "text"}
                      placeholder={isDate ? "DD-MM-YYYY" : (isCurrency || isPercent) ? "0.00" : undefined}
                      inputMode={isDate ? "numeric" : undefined}
                      {...form.register(nameBase as never, options)}
                    />
                  );
                })}
              </div>
            </div>
          );});

          const hiddenGroupCount = debugGroupRows.filter((g) => !g.visible).length;
          const debugPanel = isAdmin ? (
            <details key="__debug" className="mt-4 rounded-md border border-dashed border-amber-400/50 bg-amber-50/50 p-2 dark:border-amber-600/30 dark:bg-amber-950/20">
              <summary className="cursor-pointer text-xs font-medium text-amber-700 dark:text-amber-400">
                Debug: Field Visibility ({pkg}) &mdash; {debugRows.filter((r) => r.visible).length}/{debugRows.length} visible, selectedCategory=&quot;{selectedCategory}&quot;, categories loaded={categories.length}
                {hiddenGroupCount > 0 ? <span className="ml-2 text-red-500 dark:text-red-400">&bull; {hiddenGroupCount} group(s) hidden by groupShowWhen</span> : null}
              </summary>
              <div className="mt-2 max-h-64 overflow-auto text-[10px] font-mono leading-relaxed">
                {debugGroupRows.length > 0 && debugGroupRows.some((g) => g.detail !== "no groupShowWhen") ? (
                  <>
                    <div className="mb-2 text-xs font-semibold text-amber-600 dark:text-amber-300">Group Visibility</div>
                    <table className="mb-3 w-full border-collapse">
                      <thead>
                        <tr className="border-b border-amber-300 dark:border-amber-700 text-left">
                          <th className="px-1 py-0.5">Group</th>
                          <th className="px-1 py-0.5">Fields</th>
                          <th className="px-1 py-0.5">Visible</th>
                          <th className="px-1 py-0.5">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debugGroupRows.map((g) => (
                          <tr key={g.group} className={g.visible ? "" : "text-red-600 dark:text-red-400"}>
                            <td className="px-1 py-0.5">{g.group}</td>
                            <td className="px-1 py-0.5">{g.fieldCount}</td>
                            <td className="px-1 py-0.5">{g.visible ? "YES" : "NO"}</td>
                            <td className="px-1 py-0.5 break-all">{g.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}
                <div className="mb-1 text-xs font-semibold text-amber-600 dark:text-amber-300">Field Visibility</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-amber-300 dark:border-amber-700 text-left">
                      <th className="px-1 py-0.5">Field</th>
                      <th className="px-1 py-0.5">Group</th>
                      <th className="px-1 py-0.5">Cat</th>
                      <th className="px-1 py-0.5">ShowWhen</th>
                      <th className="px-1 py-0.5">Visible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debugRows.map((r) => (
                      <tr key={r.value} className={r.visible ? "" : "text-red-600 dark:text-red-400"}>
                        <td className="px-1 py-0.5 whitespace-nowrap">{r.label} <span className="opacity-50">({r.value})</span></td>
                        <td className="px-1 py-0.5">{r.group}</td>
                        <td className="px-1 py-0.5">{r.catPass ? "PASS" : "FAIL"} <span className="opacity-60">{r.catDetail}</span></td>
                        <td className="px-1 py-0.5">{r.swPass ? "PASS" : "FAIL"} <span className="opacity-60">{r.swDetail}</span></td>
                        <td className="px-1 py-0.5">{r.visible ? "YES" : "NO"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null;

          return [...groupedElements, debugPanel];
        })()}
      </div>
      {activeEntityPicker && (
        <EntityPickerDrawer
          open={!!activeEntityPicker}
          onClose={() => { setActiveEntityPicker(null); setActiveEntityPickerField(""); }}
          flowKey={activeEntityPicker.flow}
          title={activeEntityPicker.buttonLabel || "Select Record"}
          onSelect={(sel) => handleEntityPickerSelect(activeEntityPicker, sel, activeEntityPickerField)}
        />
      )}
      {agentPickerOpen && (
        <AgentPickerDrawer
          open={agentPickerOpen}
          onClose={() => setAgentPickerOpen(false)}
          onSelect={handleAgentPickerSelect}
        />
      )}
    </section>
  );
}

// Field extracted to @/components/ui/form-field

