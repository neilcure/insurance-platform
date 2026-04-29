"use client";

import * as React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { maskDDMMYYYY } from "@/lib/format/date";
import { Field } from "@/components/ui/form-field";
import { evaluateFormula } from "@/lib/formula";
import { Button } from "@/components/ui/button";
import { CreatableSelect } from "@/components/ui/creatable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import type { BooleanBranchChild, ShowWhenRule, SelectChild } from "@/lib/types/form";

/**
 * Boolean Yes/No radio group bound to RHF.
 *
 * IMPORTANT: This must drive the radio's `checked` attribute explicitly
 * (controlled-style) rather than relying on RHF's auto-`checked` matching.
 * RHF compares `radio.value === stateValue` with strict equality. Since
 * `setValueAs` coerces the radio's string value into a boolean (and saved
 * values come back from the DB as booleans too), `"true" === true` is
 * `false` and neither radio would visually check on re-load — making
 * users think their selection was never saved.
 */
function BooleanRadioPair({
  form,
  name,
  yesLabel,
  noLabel,
  required,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  yesLabel: string;
  noLabel: string;
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
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  booleanChildren?: { true?: BooleanBranchChild[]; false?: BooleanBranchChild[] };
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
        if (bcType === "currency" || bcType === "negative_currency") {
          const cc = String(bc?.currencyCode ?? "").trim();
          const dec = Number(bc?.decimals ?? 2);
          const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
          return (
            <div key={bcName} className="space-y-1">
              <Label>{bc?.label ?? "Value"}</Label>
              <div className="flex items-center gap-2">
                {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
                <Input type="number" step={step} placeholder={`0.${"0".repeat(dec)}`} {...form.register(bcName as never, { setValueAs: (v: unknown) => (v === "" ? undefined : Number(v as number)) })} />
              </div>
            </div>
          );
        }
        if (bcType === "formula") {
          const computed = evaluateFormula(String((bc as any)?.formula ?? ""), form.getValues() as Record<string, unknown>);
          return (
            <div key={bcName} className="space-y-1">
              <Label>{bc?.label ?? "Value"}</Label>
              <Input type="text" readOnly value={computed} className="bg-neutral-50 dark:bg-neutral-800 cursor-default" />
            </div>
          );
        }
        if (bcType === "select" || bcType === "multi_select") {
          const allOpts = Array.isArray(bc?.options) ? bc.options : [];
          const allVals = form.getValues() as Record<string, unknown>;
          const opts = allOpts.filter((o) => evaluateChildShowWhen((o as any)?.showWhen, allVals));
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
          regOpts.onChange = (e: unknown) => { const t = e as { target?: { value?: string } }; form.setValue(bcName as never, maskDDMMYYYY(t?.target?.value ?? "") as never, { shouldDirty: true }); };
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

async function childOptionApi(
  fieldId: number,
  parentOptionValue: string,
  childIndex: number,
  action: "add" | "remove",
  payload: { label?: string; value?: string },
): Promise<{ option?: { label: string; value: string }; field?: { meta?: unknown }; message?: string } | null> {
  try {
    const res = await fetch(`/api/admin/form-options/${fieldId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        ...payload,
        childPath: { parentOptionValue, childIndex },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      toast.error(err.error ?? `Failed to ${action} option`);
      return null;
    }
    const data = await res.json();
    if (action === "add") {
      if (data.message) toast.info(data.message);
      else toast.success(`Option "${payload.label}" added`);
    } else {
      toast.success("Option removed");
    }
    return data;
  } catch {
    toast.error(`Failed to ${action} option`);
    return null;
  }
}

function ChildOptionAdminAddRemove({
  fieldId,
  parentOptionValue,
  childIndex,
  options,
  onFieldUpdated,
}: {
  fieldId: number;
  parentOptionValue: string;
  childIndex: number;
  options: { label?: string; value?: string }[];
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
      const res = await childOptionApi(fieldId, parentOptionValue, childIndex, "add", { label });
      if (res?.field) {
        onFieldUpdated(res.field);
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
      const res = await childOptionApi(fieldId, parentOptionValue, childIndex, "remove", { value: optValue });
      if (res?.field) onFieldUpdated(res.field);
    } finally {
      setRemoving(null);
      setConfirmRemove(null);
    }
  };

  const requestAdd = () => {
    const label = value.trim();
    if (!label) return;
    const lower = label.toLowerCase();
    if (options.some((o) => (o.label ?? "").toLowerCase() === lower || (o.value ?? "").toLowerCase() === lower)) {
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
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); requestAdd(); } }}
          placeholder="Add new option..."
          className="h-7 flex-1 rounded border border-neutral-200 bg-white px-2 text-xs outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <Button type="button" size="xs" variant="secondary" disabled={busy || !value.trim()} onClick={requestAdd}>
          {busy ? "..." : "+"}
        </Button>
      </div>
      {options.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
            Manage options ({options.length})
          </summary>
          <div className="mt-1 flex flex-wrap gap-1">
            {options.map((o) => (
              <span key={o.value} className="inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800 dark:text-neutral-200">
                {o.label ?? o.value}
                <button
                  type="button"
                  onClick={() => setConfirmRemove({ value: o.value ?? "", label: o.label ?? o.value ?? "" })}
                  disabled={removing === o.value}
                  className="rounded text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  {removing === o.value ? "..." : "×"}
                </button>
              </span>
            ))}
          </div>
        </details>
      )}
      <Dialog open={!!confirmAdd} onOpenChange={(v) => { if (!v) setConfirmAdd(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add new option</DialogTitle></DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Are you sure you want to add <strong className="text-neutral-900 dark:text-neutral-100">&ldquo;{confirmAdd}&rdquo;</strong> as a new option? This will be available to all users.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmAdd(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void handleAddConfirmed()} disabled={busy}>{busy ? "Adding..." : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!confirmRemove} onOpenChange={(v) => { if (!v) setConfirmRemove(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove option</DialogTitle></DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Are you sure you want to remove <strong className="text-neutral-900 dark:text-neutral-100">&ldquo;{confirmRemove?.label}&rdquo;</strong>? This will remove it from the list for all users.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmRemove(null)} disabled={!!removing}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => void handleRemoveConfirmed()} disabled={!!removing}>{removing ? "Removing..." : "Remove"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChildSelectField({
  form,
  name,
  label,
  options: initialOptions,
  fieldId,
  parentOptionValue,
  childIndex,
  onFieldUpdated,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  name: string;
  label: string;
  options: { label?: string; value?: string }[];
  fieldId: number;
  parentOptionValue: string;
  childIndex: number;
  onFieldUpdated?: (updatedField: { meta?: unknown }) => void;
}) {
  const [opts, setOpts] = React.useState(initialOptions);
  const currentVal = useWatch({ control: form.control, name: name as string }) as string | undefined;

  // Sync local state when props change (e.g. after parent re-renders with updated field)
  React.useEffect(() => {
    setOpts(initialOptions);
  }, [initialOptions]);

  const handleCreate = React.useCallback(async (newLabel: string) => {
    const res = await childOptionApi(fieldId, parentOptionValue, childIndex, "add", { label: newLabel });
    if (!res?.option) return null;
    const created = { label: res.option.label, value: res.option.value };
    if (res.field && onFieldUpdated) onFieldUpdated(res.field);
    else setOpts((prev) => [...prev, created]);
    return created;
  }, [fieldId, parentOptionValue, childIndex, onFieldUpdated]);

  const handleRemove = React.useCallback(async (optValue: string) => {
    const res = await childOptionApi(fieldId, parentOptionValue, childIndex, "remove", { value: optValue });
    if (!res) return false;
    if (res.field && onFieldUpdated) onFieldUpdated(res.field);
    else setOpts((prev) => prev.filter((o) => o.value !== optValue));
    return true;
  }, [fieldId, parentOptionValue, childIndex, onFieldUpdated]);

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <CreatableSelect
        options={opts}
        value={currentVal ?? ""}
        onChange={(v) => form.setValue(name as never, v as never, { shouldDirty: true })}
        onCreateOption={handleCreate}
        onRemoveOption={handleRemove}
      />
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
  isAdmin?: boolean;
  fieldId?: number;
  onFieldUpdated?: (updatedField: { meta?: unknown }) => void;
};

export const InlineSelectWithChildren = React.memo(function InlineSelectWithChildren({
  form,
  nameBase,
  label,
  required,
  options,
  displayMode = "dropdown",
  isAdmin,
  fieldId,
  onFieldUpdated,
}: InlineSelectWithChildrenProps) {
  const current = useWatch({ control: form.control, name: nameBase as string }) as string | undefined;
  const allFormValues = useWatch({ control: form.control }) as Record<string, unknown>;
  const visibleOptions = options.filter((o) => evaluateChildShowWhen((o as any)?.showWhen, allFormValues));
  const nodes: React.ReactNode[] = [];

  const handleCreateOption = React.useCallback(async (newLabel: string) => {
    if (!fieldId) return null;
    try {
      const res = await fetch(`/api/admin/form-options/${fieldId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast.error(err.error ?? "Failed to add option");
        return null;
      }
      const data = (await res.json()) as { option?: { label?: string; value?: string }; field?: { meta?: unknown }; message?: string };
      const created = data.option ? { label: data.option.label ?? newLabel, value: data.option.value ?? "" } : null;
      if (data.field && onFieldUpdated) onFieldUpdated(data.field);
      if (data.message) toast.info(data.message);
      else if (created) toast.success(`Option "${newLabel}" added`);
      return created;
    } catch {
      toast.error("Failed to add option");
      return null;
    }
  }, [fieldId, onFieldUpdated]);

  const handleRemoveOption = React.useCallback(async (optValue: string) => {
    if (!fieldId) return false;
    try {
      const res = await fetch(`/api/admin/form-options/${fieldId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", value: optValue }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast.error(err.error ?? "Failed to remove option");
        return false;
      }
      const data = (await res.json()) as { field?: { meta?: unknown } };
      if (data.field && onFieldUpdated) onFieldUpdated(data.field);
      toast.success("Option removed");
      return true;
    } catch {
      toast.error("Failed to remove option");
      return false;
    }
  }, [fieldId, onFieldUpdated]);

  nodes.push(
    <div key={`${nameBase}__field`} className="space-y-2">
      <div className="space-y-1">
        <Label>
          {label} {required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
        </Label>
        {displayMode === "dropdown" && isAdmin && fieldId ? (
          <CreatableSelect
            options={visibleOptions.map((o) => ({ label: o.label, value: o.value }))}
            value={current ?? ""}
            onChange={(v) => form.setValue(nameBase as never, v as never, { shouldDirty: true })}
            onCreateOption={handleCreateOption}
            onRemoveOption={handleRemoveOption}
            required={required}
          />
        ) : displayMode === "dropdown" ? (
          <select
            className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            {...form.register(nameBase as never, { required: Boolean(required) })}
            defaultValue={current ?? ""}
          >
            <option value="">-- Select --</option>
            {visibleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-wrap gap-4">
            {visibleOptions.map((o) => (
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
          const formatted = maskDDMMYYYY(t?.target?.value ?? "");
          form.setValue(name as never, formatted as never, { shouldDirty: true });
        };
      }
      if (cType === "formula") {
        const computed = evaluateFormula(String((child as any)?.formula ?? ""), allFormValues);
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
              {hasBranchChildren ? <BooleanBranchFields form={form} name={name} booleanChildren={child.booleanChildren} /> : null}
            </div>
          );
        } else {
          nodes.push(
            <div key={name} className="space-y-1">
              <Label>{child?.label ?? "Details"}</Label>
              <BooleanRadioPair form={form} name={name} yesLabel={yesLabel} noLabel={noLabel} />
              {hasBranchChildren ? <BooleanBranchFields form={form} name={name} booleanChildren={child.booleanChildren} /> : null}
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
        if (isAdmin && fieldId && current) {
          nodes.push(
            <ChildSelectField
              key={name}
              form={form}
              name={name}
              label={child?.label ?? "Details"}
              options={opts}
              fieldId={fieldId}
              parentOptionValue={current}
              childIndex={cIdx}
              onFieldUpdated={onFieldUpdated}
            />
          );
        } else {
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
        }
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
              {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
            </div>
            {isAdmin && fieldId && current && onFieldUpdated && (
              <ChildOptionAdminAddRemove
                fieldId={fieldId}
                parentOptionValue={current}
                childIndex={cIdx}
                options={opts}
                onFieldUpdated={onFieldUpdated}
              />
            )}
          </div>
        );
        return;
      }
      if (cType === "currency" || cType === "negative_currency") {
        const cc = String(child?.currencyCode ?? "").trim();
        const dec = Number(child?.decimals ?? 2);
        const step = `0.${"0".repeat(Math.max(0, dec - 1))}1`;
        nodes.push(
          <div key={name} className="min-w-[220px] flex-1 space-y-1">
            <Label>{child?.label ?? "Details"}</Label>
            <div className="flex items-center gap-2">
              {cc ? <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">{cc}</span> : null}
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

// Field extracted to @/components/ui/form-field

