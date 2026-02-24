"use client";

import * as React from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

function formatDDMMYYYY(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

// Helper: fetch first non-empty result from a list of group keys
async function fetchOptionsFrom(keys: string[]): Promise<unknown[]> {
  for (const key of keys) {
    try {
      const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(key)}`, { cache: "no-store" });
      const data = (await res.json()) as unknown;
      if (Array.isArray(data) && data.length > 0) return data as unknown[];
      if (Array.isArray(data)) continue;
    } catch {
      // try next
    }
  }
  return [];
}
type VehicleFormValues = Record<string, unknown>;

export function VehicleStep({
  onComplete,
  initialValues,
}: {
  onComplete?: (data: VehicleFormValues) => void;
  initialValues?: Record<string, unknown> | null;
}) {
  const form = useForm<VehicleFormValues>({
    defaultValues: { vehicleCategory: "commercial" },
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });

  const category = useWatch({ control: form.control, name: "vehicleCategory" }) as string | undefined;
  const [categories, setCategories] = React.useState<{ label: string; value: string }[]>([]);

  React.useEffect(() => {
    async function load() {
      try {
        const raw = (await fetchOptionsFrom(["vehicle_category", "vehicleinfo_category"])) as { label: string; value: string }[];
        const data = Array.isArray(raw) ? raw : [];
        setCategories(data ?? []);
        // If current category not in fetched list, keep it; otherwise set to first for consistency
        const hasCurrent = data.some((d) => d.value === form.getValues("vehicleCategory"));
        if (!hasCurrent && data.length > 0) {
          form.setValue("vehicleCategory", data[0].value);
        }
      } catch {
        // ignore
      }
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  

  function onSubmit(data: VehicleFormValues) {
    console.log("STEP 2 RESULT", data);
    toast.success("Step 2 valid. Check console output.");
    onComplete?.(data);
  }

  function getFirstErrorMessage(errors: FieldErrors<VehicleFormValues>): string | undefined {
    const queue: unknown[] = [errors];
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object") continue;
      for (const value of Object.values(current as Record<string, unknown>)) {
        if (value && typeof value === "object") {
          const msg = (value as Record<string, unknown>)["message"];
          if (typeof msg === "string") {
            return msg;
          }
          queue.push(value);
        }
      }
    }
    return undefined;
  }

  const categoryType = React.useMemo<"commercial" | "private" | "solo">(() => {
    const v = String(category ?? "").toLowerCase();
    if (v.includes("commercial")) return "commercial";
    if (v.includes("solo")) return "solo";
    // Default anything else to "private"-style fields
    return "private";
  }, [category]);

  // Hydrate form with initial values when coming back to this step
  React.useEffect(() => {
    if (!initialValues) return;
    try {
      form.reset({ ...(initialValues as VehicleFormValues) });
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);
  // Apply default values for boolean dynamic fields
  React.useEffect(() => {
    let cancelled = false;
    async function applyDefaults() {
      try {
        const raw = (await fetchOptionsFrom(["vehicle_fields", "vehicleinfo_fields"])) as Array<{
          value: string;
          meta?: { inputType?: string; defaultBoolean?: boolean };
        }>;
        const data = Array.isArray(raw) ? raw : [];
        if (cancelled || !Array.isArray(data)) return;
        for (const f of data) {
          const meta = f?.meta ?? {};
          if ((meta?.inputType ?? "string") === "boolean" && typeof meta?.defaultBoolean === "boolean") {
            const curr = form.getValues(f.value);
            if (typeof curr === "undefined" || curr === null || curr === "") {
              form.setValue(f.value, meta.defaultBoolean, { shouldDirty: false });
            }
          }
        }
      } catch {
        // ignore
      }
    }
    void applyDefaults();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Apply default values for boolean dynamic fields
  React.useEffect(() => {
    let cancelled = false;
    async function applyDefaults() {
      try {
        const raw = (await fetchOptionsFrom(["vehicle_fields", "vehicleinfo_fields"])) as Array<{
          value: string;
          meta?: { inputType?: string; defaultBoolean?: boolean };
        }>;
        const data = Array.isArray(raw) ? raw : [];
        if (cancelled || !Array.isArray(data)) return;
        for (const f of data) {
          const meta = f?.meta ?? {};
          if ((meta?.inputType ?? "string") === "boolean" && typeof meta?.defaultBoolean === "boolean") {
            const curr = form.getValues(f.value);
            if (typeof curr === "undefined" || curr === null || curr === "") {
              form.setValue(f.value, meta.defaultBoolean, { shouldDirty: false });
            }
          }
        }
      } catch {
        // ignore
      }
    }
    void applyDefaults();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 2 — Vehicle Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Vehicle Category */}
        <section className="space-y-2">
          <Label>Vehicle Category</Label>
          <RadioGroup
            value={category}
            onValueChange={(v) =>
              form.setValue("vehicleCategory", v)
            }
            className="flex gap-6"
          >
            {(categories.length > 0 ? categories : [
              { label: "Commercial", value: "commercial" },
              { label: "Private", value: "private" },
              { label: "Solo", value: "solo" },
            ]).map((opt) => (
              <div key={opt.value} className="flex items-center space-x-2">
                <RadioGroupItem value={opt.value} id={`veh-${opt.value}`} />
                <Label htmlFor={`veh-${opt.value}`}>{opt.label}</Label>
              </div>
            ))}
          </RadioGroup>
          {/* All categories loaded from form options are treated as supported */}
        </section>

        <Separator />

        {/* Common Vehicle Info */}
        <section className="space-y-4">
          <h3 className="text-sm font-medium">Common Vehicle Info</h3>
          <div className="grid grid-cols-2 gap-4">
            {/** Render dynamic fields from vehicle_fields */}
            <DynamicCommonFields
              category={category as string}
              register={form.register}
              setValue={form.setValue}
              control={form.control}
              unregister={form.unregister}
              initialValues={initialValues ?? {}}
            />
          </div>
        </section>

        {/* Category details removed; all fields should come from dynamic configuration */}
        <Separator />

        <div className="flex justify-end">
          <Button
            disabled={false}
            onClick={async () => {
              try {
                const ok = await form.trigger();
                if (!ok) {
                  const msg = getFirstErrorMessage(form.formState.errors) ?? "Please fill in the required fields.";
                  toast.error(msg);
                  return;
                }
                const values = form.getValues();
                // Persist raw values (dynamic fields + chosen category)
                onSubmit({ ...values, vehicleCategory: categoryType });
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "Validation failed";
                toast.error(String(message));
              }
            }}
          >
            Continue (Step 3)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  required,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; required?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>
        {label} {required ? <span className="text-red-600">*</span> : null}
      </Label>
      <Input {...props} />
    </div>
  );
}

function DynamicCommonFields({
  category,
  register,
  setValue,
  control,
  unregister,
  initialValues,
}: {
  category: string;
  register: ReturnType<typeof useForm<VehicleFormValues>>["register"];
  setValue: ReturnType<typeof useForm<VehicleFormValues>>["setValue"];
  control: ReturnType<typeof useForm<VehicleFormValues>>["control"];
  unregister: ReturnType<typeof useForm<VehicleFormValues>>["unregister"];
  initialValues?: Record<string, unknown>;
}) {
  type ChildMeta = {
    label?: string;
    value?: string;
    inputType?: "string" | "number" | "date" | "select" | "multi_select";
    required?: boolean;
    options?: { label: string; value: string }[];
  };
  type FieldMeta = {
    inputType?: "string" | "number" | "date" | "select" | "multi_select" | "boolean" | "repeatable";
    required?: boolean;
    categories?: string[];
    options?: { label: string; value: string; children?: ChildMeta[] }[];
    booleanChildren?: { true?: ChildMeta[]; false?: ChildMeta[] };
    repeatable?: {
      itemLabel?: string;
      min?: number;
      max?: number;
      fields?: ChildMeta[];
    };
  };
  const [fields, setFields] = React.useState<{ label: string; value: string; meta?: FieldMeta }[]>([]);
  const values = useWatch({ control }) as VehicleFormValues; // watch all values to resolve child-field rendering
  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const raw = (await fetchOptionsFrom(["vehicle_fields", "vehicleinfo_fields"])) as {
          label: string;
          value: string;
          valueType: string;
          meta?: FieldMeta;
          sortOrder: number;
        }[];
        const data = Array.isArray(raw) ? raw : [];
        // debug: raw fetch results
        try {
          console.log("[veh-fields] raw", (data ?? []).map((f) => ({
            label: f.label,
            value: f.value,
            inputType: f?.meta?.inputType,
            hasRepeatable: Boolean(f?.meta?.repeatable),
            categories: Array.isArray(f?.meta?.categories) ? f?.meta?.categories : [],
          })));
          console.log("[veh-fields] current category", category);
        } catch {}
        const filtered = (data ?? []).filter((f) => {
          const cats = (f.meta?.categories ?? []) as string[];
          return cats.length === 0 || cats.includes(category);
        });
        try {
          console.log("[veh-fields] filtered", filtered.map((f) => ({
            label: f.label,
            value: f.value,
            inputType: f?.meta?.inputType,
            hasRepeatable: Boolean(f?.meta?.repeatable),
          })));
        } catch {}
        if (!cancelled) setFields(filtered);
      } catch {
        if (!cancelled) setFields([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [category]);

  // After fields load, hydrate from initial values for any matching keys
  React.useEffect(() => {
    if (!initialValues || fields.length === 0) return;
    for (const f of fields) {
      const v = (initialValues as Record<string, unknown>)[f.value];
      if (typeof v !== "undefined") {
        setValue(f.value, v, { shouldDirty: false });
      }
    }
  }, [fields, initialValues, setValue]);

  // Ensure we don't keep stale child values when parent selection changes
  React.useEffect(() => {
    if (fields.length === 0) return;
    const currentValues = values as Record<string, unknown>;
    // Build a set of keys that are valid given the current selections
    const validKeys = new Set<string>();
    for (const f of fields) {
      const inputType = String(f.meta?.inputType ?? "string").trim().toLowerCase();
      if (inputType === "boolean") {
        const yesRaw = (f.meta as any)?.booleanChildren?.true ?? [];
        const yesChildren = (Array.isArray(yesRaw) ? yesRaw : [yesRaw]) as ChildMeta[];
        const v = currentValues[f.value];
        if (v === true || v === "true") {
          for (let i = 0; i < yesChildren.length; i++) {
            validKeys.add(`${f.value}__true__c${i}`);
          }
        }
      } else if (inputType === "select") {
        const options = Array.isArray(f.meta?.options) ? f.meta?.options ?? [] : [];
        const selected = currentValues[f.value];
        if (typeof selected === "string") {
          const opt = options.find((o) => o.value === selected);
          const children = opt?.children ?? [];
          for (let i = 0; i < children.length; i++) {
            validKeys.add(`${f.value}__${selected}__c${i}`);
          }
        }
      } else if (inputType === "multi_select") {
        const options = Array.isArray(f.meta?.options) ? f.meta?.options ?? [] : [];
        const selectedArr = Array.isArray(currentValues[f.value]) ? (currentValues[f.value] as string[]) : [];
        for (const sel of selectedArr) {
          const opt = options.find((o) => o.value === sel);
          const children = opt?.children ?? [];
          for (let i = 0; i < children.length; i++) {
            validKeys.add(`${f.value}__${sel}__c${i}`);
          }
        }
      }
    }
    // Clear any child keys that are not currently valid
    for (const key of Object.keys(currentValues)) {
      // Child keys are of the form parentKey__...
      if (!key.includes("__")) continue;
      const isStillValid = validKeys.has(key);
      if (!isStillValid) {
        try {
          unregister(key);
        } catch {
          // ignore
        }
      }
    }
  }, [values, fields, unregister]);

  if (fields.length === 0) {
    // Fallback to previous hardcoded set to avoid breaking wizard rhythm
    return (
      <>
        <Field label="Plate No" {...register("plateNo")} />
        <Field label="Make" {...register("make")} />
        <Field label="Model" {...register("model")} />
        <Field
          label="Year"
          type="number"
          {...register("year", {
            setValueAs: (v) => (v === "" ? undefined : Number(v)),
          })}
        />
        <Field label="Body Type" {...register("bodyType")} />
        <Field label="Engine No" {...register("engineNo")} />
        <Field label="Chassis No" {...register("chassisNo")} />
        <Field
          label="Sum Insured"
          type="number"
          {...register("sumInsured", {
            setValueAs: (v) => (v === "" ? undefined : Number(v)),
          })}
        />
      </>
    );
  }

  return (
    <>
      {fields.map((f) => {
        const inputType = String(f.meta?.inputType ?? "string").trim().toLowerCase();
        const isRepeatableType = inputType === "repeatable" || Boolean(f.meta?.repeatable);
        const isNumber = inputType === "number";
        const isDate = inputType === "date";
        if (inputType === "select") {
          const options = Array.isArray(f.meta?.options) ? f.meta?.options ?? [] : [];
          const selected = (values as Record<string, unknown>)?.[f.value] as string | undefined;
          const selectedOpt = options.find((o) => o.value === selected);
          return (
            <div key={f.value} className="space-y-2">
              <div className="space-y-1">
                <Label>
                  {f.label} {f.meta?.required ? <span className="text-red-600">*</span> : null}
                </Label>
                <select
                  className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                  {...register(f.value, { required: Boolean(f.meta?.required) })}
                >
                  <option value="">-- Select --</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {/* Child fields for selected option */}
              {!Array.isArray(selectedOpt?.children) ? null : (
                <div className="space-y-2">
                  {(selectedOpt?.children ?? []).map((child, cIdx) => (
                    <ChildFieldRenderer
                      key={`${f.value}__${selectedOpt?.value}__${cIdx}`}
                      parentKey={f.value}
                      optionValue={`${selectedOpt?.value}__c${cIdx}`}
                      meta={child}
                      register={register}
                      setValue={setValue}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        }
        if (inputType === "multi_select") {
          const options = Array.isArray(f.meta?.options) ? f.meta?.options ?? [] : [];
          const selected = Array.isArray((initialValues as Record<string, unknown>)?.[f.value])
            ? ((initialValues as Record<string, unknown>)[f.value] as string[])
            : [];
          return (
            <div key={f.value} className="space-y-2">
              <div className="space-y-1">
                <Label>
                  {f.label} {f.meta?.required ? <span className="text-red-600">*</span> : null}
                </Label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                  {options.map((o) => (
                    <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        value={o.value}
                        defaultChecked={selected.includes(o.value)}
                        {...register(f.value, {
                          validate: (v) =>
                            !Boolean(f.meta?.required) ||
                            (Array.isArray(v) && v.length > 0) ||
                            `${f.label} is required`,
                        })}
                      />
                      {o.label}
                    </label>
                  ))}
                  {options.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                </div>
              </div>
              {/* Render child fields for each selected option that defines one */}
              <div className="space-y-2">
                {options
                  .filter((o) => Array.isArray((values as Record<string, unknown>)?.[f.value]) && ((values as Record<string, unknown>)[f.value] as string[]).includes(o.value))
                  .map((o) =>
                    (o.children ?? []).map((child, cIdx) => (
                      <ChildFieldRenderer
                        key={`${f.value}__${o.value}__${cIdx}`}
                        parentKey={f.value}
                        optionValue={`${o.value}__c${cIdx}`}
                        meta={child}
                        register={register}
                        setValue={setValue}
                      />
                    ))
                  )}
              </div>
            </div>
          );
        }
        if (inputType === "boolean") {
          const yesRaw = (f.meta as any)?.booleanChildren?.true ?? [];
          const yesChildren = (Array.isArray(yesRaw) ? yesRaw : [yesRaw]) as ChildMeta[];
          return (
            <div key={f.value} className="space-y-2">
              <div className="space-y-1">
                <Label>
                  {f.label} {f.meta?.required ? <span className="text-red-600">*</span> : null}
                </Label>
                <div className="flex items-center gap-6">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="true"
                      {...register(f.value, {
                        required: Boolean(f.meta?.required),
                        setValueAs: (v) => (v === "true" ? true : v === "false" ? false : v),
                      })}
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="false"
                      {...register(f.value, {
                        required: Boolean(f.meta?.required),
                        setValueAs: (v) => (v === "true" ? true : v === "false" ? false : v),
                      })}
                    />
                    No
                  </label>
                </div>
              </div>
              {/* Render child for selected branch */}
              {(() => {
                const v = (values as Record<string, unknown>)?.[f.value];
                const defaultYes = (f.meta as Record<string, unknown> | undefined)?.defaultBoolean === true;
                const isYes = v === true || v === "true" || (typeof v === "undefined" && defaultYes);
                return yesChildren.length > 0 ? (
                <div className="space-y-2" style={{ display: isYes ? "block" : "none" }}>
                  {yesChildren.map((child, cIdx) => {
                    const t = String((child as any)?.inputType ?? "string").trim().toLowerCase();
                    const isRep = t === "repeatable" || t.includes("repeat") || !!(child as any)?.repeatable;
                    if (isRep) {
                      // Render repeatable using the same child renderer per field name pattern
                      return (
                        <ChildFieldRenderer
                          key={`${f.value}__true__${cIdx}`}
                          parentKey={f.value}
                          optionValue={`true__c${cIdx}`}
                          meta={child as any}
                          register={register}
                          setValue={setValue}
                        />
                      );
                    }
                    return (
                      <ChildFieldRenderer
                        key={`${f.value}__true__${cIdx}`}
                        parentKey={f.value}
                        optionValue={`true__c${cIdx}`}
                        meta={child as any}
                        register={register}
                        setValue={setValue}
                      />
                    );
                  })}
                </div>) : null;
              })()}
            </div>
          );
        }
        if (isRepeatableType) {
          try {
            console.log("[veh-fields] rendering repeatable", { value: f.value, label: f.label, meta: f.meta });
          } catch {}
          const rep = f.meta?.repeatable ?? {};
          const itemLabel = String(rep.itemLabel ?? "Item");
          const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
          const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
          const childFields = Array.isArray(rep.fields) ? rep.fields.filter(Boolean) : [];
          const rawList = Array.isArray((values as Record<string, unknown>)?.[f.value])
            ? (((values as Record<string, unknown>)[f.value] as unknown[]) ?? [])
            : [];
          const items = rawList as Record<string, unknown>[];
          const canAdd = max <= 0 || items.length < max;
          const canRemove = (idx: number) => items.length > Math.max(1, min) - 0 && idx >= 0;
          const addItem = () => {
            const next = [...items, {}];
            setValue(f.value, next, { shouldDirty: true });
          };
          const removeItem = (idx: number) => {
            if (!canRemove(idx)) return;
            const next = items.filter((_, i) => i !== idx);
            setValue(f.value, next, { shouldDirty: true });
          };
          return (
            <div key={f.value} className="col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {f.label} {f.meta?.required ? <span className="text-red-600">*</span> : null}
                </Label>
                <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!canAdd}>
                  Add {itemLabel}
                </Button>
              </div>
              <div className="space-y-2">
                {(items.length === 0 ? Array.from({ length: Math.max(0, min) }) : items).map((_, idx) => {
                  const baseRowKey = `${f.value}__row__${idx}`;
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
                          const base = `${f.value}.${idx}.${cf?.value ?? `c${cIdx}`}`;
                          const type = String(cf.inputType ?? "string").trim().toLowerCase();
                          if (type === "select") {
                            const opts = Array.isArray(cf.options) ? cf.options : [];
                            return (
                              <div key={`${base}__sel`} className="space-y-1">
                                <Label>{cf.label ?? "Select"}</Label>
                                <select
                                  className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                  {...register(base, { required: Boolean(cf.required) })}
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
                          if (type === "multi_select") {
                            const opts = Array.isArray(cf.options) ? cf.options : [];
                            return (
                              <div key={`${base}__ms`} className="space-y-1">
                                <Label>{cf.label ?? "Select"}</Label>
                                <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                  {opts.map((o) => (
                                    <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        value={o.value}
                                        {...register(base, {
                                          validate: (v) =>
                                            !Boolean(cf.required) ||
                                            (Array.isArray(v) && v.length > 0) ||
                                            `${cf.label ?? "This"} is required`,
                                        })}
                                      />
                                      {o.label}
                                    </label>
                                  ))}
                                  {opts.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                                </div>
                              </div>
                            );
                          }
                          const isNum = type === "number";
                          const isDateChild = type === "date";
                          const childOptions: {
                            setValueAs?: (v: unknown) => number | undefined;
                            validate?: (v: unknown) => boolean | string;
                            onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
                            required?: string | boolean;
                          } = {};
                          if (isNum) {
                            childOptions.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as string | number));
                          }
                          if (isDateChild) {
                            childOptions.validate = (v: unknown) => {
                              if (v === undefined || v === null || v === "") return true;
                              return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                            };
                            childOptions.onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                              const formatted = formatDDMMYYYY(e?.target?.value ?? "");
                              setValue(base, formatted, { shouldDirty: true });
                            };
                          }
                          if (Boolean(cf.required)) childOptions.required = `${cf.label ?? "This field"} is required`;
                          const registerProps = register(base, childOptions);
                          return (
                            <div key={`${base}__fld`} className="space-y-1">
                              <Label>{cf.label ?? "Value"}</Label>
                              <Input
                                type={isNum ? "number" : isDateChild ? "text" : "text"}
                                placeholder={isDateChild ? "DD-MM-YYYY" : undefined}
                                inputMode={isDateChild ? "numeric" : undefined}
                                {...registerProps}
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
        // Fallback: if meta.repeatable exists but inputType didn't match for any reason,
        // still render the repeatable UI to avoid silently showing a plain input.
        if (f.meta?.repeatable && !isRepeatableType) {
          const rep = f.meta?.repeatable ?? {};
          const itemLabel = String(rep.itemLabel ?? "Item");
          const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
          const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
          const childFields = Array.isArray(rep.fields) ? rep.fields.filter(Boolean) : [];
          const rawList = Array.isArray((values as Record<string, unknown>)?.[f.value])
            ? (((values as Record<string, unknown>)[f.value] as unknown[]) ?? [])
            : [];
          const items = rawList as Record<string, unknown>[];
          const canAdd = max <= 0 || items.length < max;
          const canRemove = (idx: number) => items.length > Math.max(1, min) - 0 && idx >= 0;
          const addItem = () => {
            const next = [...items, {}];
            setValue(f.value, next, { shouldDirty: true });
          };
          const removeItem = (idx: number) => {
            if (!canRemove(idx)) return;
            const next = items.filter((_, i) => i !== idx);
            setValue(f.value, next, { shouldDirty: true });
          };
          return (
            <div key={`${f.value}__rep_fallback`} className="col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  {f.label} {f.meta?.required ? <span className="text-red-600">*</span> : null}
                </Label>
                <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!canAdd}>
                  Add {itemLabel}
                </Button>
              </div>
              <div className="space-y-2">
                {(items.length === 0 ? Array.from({ length: Math.max(0, min) }) : items).map((_, idx) => {
                  if (!Array.isArray((values as Record<string, unknown>)?.[f.value]) && min > 0) {
                    setValue(
                      f.value,
                      Array.from({ length: min }).map(() => ({})),
                      { shouldDirty: false }
                    );
                  }
                  const baseRowKey = `${f.value}__row__${idx}`;
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
                          const base = `${f.value}.${idx}.${cf?.value ?? `c${cIdx}`}`;
                          const type = String(cf.inputType ?? "string").trim().toLowerCase();
                          if (type === "select") {
                            const opts = Array.isArray(cf.options) ? cf.options : [];
                            return (
                              <div key={`${base}__sel`} className="space-y-1">
                                <Label>{cf.label ?? "Select"}</Label>
                                <select
                                  className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                                  {...register(base, { required: Boolean(cf.required) })}
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
                          if (type === "multi_select") {
                            const opts = Array.isArray(cf.options) ? cf.options : [];
                            return (
                              <div key={`${base}__ms`} className="space-y-1">
                                <Label>{cf.label ?? "Select"}</Label>
                                <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                                  {opts.map((o) => (
                                    <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                      <input
                                        type="checkbox"
                                        value={o.value}
                                        {...register(base, {
                                          validate: (v) =>
                                            !Boolean(cf.required) ||
                                            (Array.isArray(v) && v.length > 0) ||
                                            `${cf.label ?? "This"} is required`,
                                        })}
                                      />
                                      {o.label}
                                    </label>
                                  ))}
                                  {opts.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                                </div>
                              </div>
                            );
                          }
                          const isNum = type === "number";
                          const isDateChild = type === "date";
                          const childOptions: {
                            setValueAs?: (v: unknown) => number | undefined;
                            validate?: (v: unknown) => boolean | string;
                            onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
                            required?: string | boolean;
                          } = {};
                          if (isNum) {
                            childOptions.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as string | number));
                          }
                          if (isDateChild) {
                            childOptions.validate = (v: unknown) => {
                              if (v === undefined || v === null || v === "") return true;
                              return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                            };
                            childOptions.onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                              const formatted = formatDDMMYYYY(e?.target?.value ?? "");
                              setValue(base, formatted, { shouldDirty: true });
                            };
                          }
                          if (Boolean(cf.required)) childOptions.required = `${cf.label ?? "This field"} is required`;
                          const registerProps = register(base, childOptions);
                          return (
                            <div key={`${base}__fld`} className="space-y-1">
                              <Label>{cf.label ?? "Value"}</Label>
                              <Input
                                type={isNum ? "number" : isDateChild ? "text" : "text"}
                                placeholder={isDateChild ? "DD-MM-YYYY" : undefined}
                                inputMode={isDateChild ? "numeric" : undefined}
                                {...registerProps}
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
        const options: {
          setValueAs?: (v: unknown) => number | undefined;
          validate?: (v: unknown) => boolean | string;
          onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
          required?: string | boolean;
        } = {};
        if (isNumber) options.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as string | number));
        if (isDate) {
          options.validate = (v: unknown) => {
            if (v === undefined || v === null || v === "") return true;
            return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
          };
          options.onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const formatted = formatDDMMYYYY(e?.target?.value ?? "");
            setValue(f.value, formatted, { shouldDirty: true });
          };
        }
        if (Boolean(f.meta?.required)) options.required = `${f.label} is required`;
        const registerProps = register(f.value, options);
        return (
          <Field
            key={f.value}
            label={f.label}
            required={Boolean(f.meta?.required)}
            type={isNumber ? "number" : isDate ? "text" : "text"}
            placeholder={isDate ? "DD-MM-YYYY" : undefined}
            inputMode={isDate ? "numeric" : undefined}
            {...registerProps}
          />
        );
      })}
    </>
  );
}

function ChildFieldRenderer({
  parentKey,
  optionValue,
  meta,
  register,
  setValue,
}: {
  parentKey: string;
  optionValue: string;
  meta?: {
    label?: string;
    inputType?: "string" | "number" | "date" | "select" | "multi_select" | "repeatable";
    required?: boolean;
    options?: { label: string; value: string }[];
    repeatable?: {
      itemLabel?: string;
      min?: number;
      max?: number;
      fields?: { label?: string; value?: string; inputType?: "string" | "number" | "date" | "select" | "multi_select"; options?: { label: string; value: string }[] }[];
  };
  };
  register: ReturnType<typeof useForm<VehicleFormValues>>["register"];
  setValue: ReturnType<typeof useForm<VehicleFormValues>>["setValue"];
}) {
  const m = meta ?? {};
  const name = `${parentKey}__${optionValue}`;
  const label = (m as { label?: string }).label ?? "Details";
  const inputType = (m as { inputType?: string }).inputType ?? "string";
  const isNumber = inputType === "number";
  const isDate = inputType === "date";
  const isRepeatableMeta = inputType === "repeatable" || Boolean((m as { repeatable?: unknown }).repeatable);
  const [rows, setRows] = React.useState<number>(0);
  if (isRepeatableMeta) {
    const rep: {
      itemLabel?: string;
      min?: number;
      max?: number;
      fields?: { label?: string; value?: string; inputType?: string; options?: { label: string; value: string }[] }[];
    } = (m as { repeatable?: unknown }).repeatable ?? {};
    const itemLabel = String(rep.itemLabel ?? "Item");
    const childFields = Array.isArray(rep.fields) ? rep.fields : [];
    const addRow = () => setRows((n) => n + 1);
    const removeRow = (idx: number) => {
      // Best-effort clear of removed row values
      for (let cIdx = 0; cIdx < childFields.length; cIdx++) {
        const childName = `${name}.${idx}.${childFields[cIdx]?.value ?? `c${cIdx}`}`;
        try {
          setValue(childName as never, undefined as never, { shouldDirty: true });
        } catch {}
      }
      setRows((n) => Math.max(0, n - 1));
    };
    return (
      <div className="col-span-2 space-y-2">
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          <Button type="button" size="sm" variant="secondary" onClick={addRow}>
            Add {itemLabel}
          </Button>
        </div>
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, idx) => {
            const baseRowKey = `${name}__row__${idx}`;
            return (
              <div key={baseRowKey} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-medium">
                    {itemLabel} #{idx + 1}
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => removeRow(idx)}>
                    Remove
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {childFields.map((cf: { label?: string; value?: string; inputType?: string; options?: { label: string; value: string }[] }, cIdx: number) => {
                    const childName = `${name}.${idx}.${cf?.value ?? `c${cIdx}`}`;
                    const t = String(cf?.inputType ?? "string").trim().toLowerCase();
                    if (t === "select") {
                      const opts = Array.isArray(cf.options) ? cf.options : [];
                      return (
                        <div key={`${childName}__sel`} className="space-y-1">
                          <Label>{cf.label ?? "Select"}</Label>
                          <select
                            className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                            {...register(childName as never)}
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
                    if (t === "multi_select") {
                      const opts = Array.isArray(cf.options) ? cf.options : [];
                      return (
                        <div key={`${childName}__ms`} className="space-y-1">
                          <Label>{cf.label ?? "Select"}</Label>
                          <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                            {opts.map((o) => (
                              <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                                <input type="checkbox" value={o.value} {...register(childName as never)} />
                                {o.label}
                              </label>
                            ))}
                            {opts.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
                          </div>
                        </div>
                      );
                    }
                    const reg: {
                      setValueAs?: (v: unknown) => number | undefined;
                      validate?: (v: unknown) => boolean | string;
                      onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
                      required?: string | boolean;
                    } = {};
                    if (t === "number") reg.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                    if (t === "date") {
                      reg.validate = (v: unknown) => {
                        if (v === undefined || v === null || v === "") return true;
                        return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                      };
                      reg.onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                        const formatted = formatDDMMYYYY(e?.target?.value ?? "");
                        setValue(childName as never, formatted as never, { shouldDirty: true });
                      };
                    }
                    return (
                      <Field
                        key={`${childName}__fld`}
                        label={cf?.label ?? "Value"}
                        required={false}
                        type={t === "number" ? "number" : t === "date" ? "text" : "text"}
                        placeholder={t === "date" ? "DD-MM-YYYY" : undefined}
                        inputMode={t === "date" ? "numeric" : undefined}
                        {...register(childName, reg)}
                      />
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
    const mOptions = (m as { options?: { label: string; value: string }[] }).options;
    const options: { label: string; value: string }[] = Array.isArray(mOptions) ? mOptions : [];
    return (
      <div className="space-y-1">
        <Label>
          {label}
        </Label>
        <select
          className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none ring-0 transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          {...register(name as never)}
        >
          <option value="">-- Select --</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (inputType === "multi_select") {
    const mOptions = (m as { options?: { label: string; value: string }[] }).options;
    const options: { label: string; value: string }[] = Array.isArray(mOptions) ? mOptions : [];
    return (
      <div className="space-y-1">
        <Label>
          {label}
        </Label>
        <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
          {options.map((o) => (
            <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={o.value}
                {...register(name as never)}
              />
              {o.label}
            </label>
          ))}
          {options.length === 0 ? <p className="text-xs text-neutral-500">No options configured.</p> : null}
        </div>
      </div>
    );
  }
  const options: {
    setValueAs?: (v: unknown) => number | undefined;
    validate?: (v: unknown) => boolean | string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    required?: string | boolean;
  } = {};
  if (isNumber) options.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as string | number));
  if (isDate) {
    options.validate = (v: unknown) => {
      if (v === undefined || v === null || v === "") return true;
      return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
    };
    options.onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = String(e?.target?.value ?? "").replace(/\D/g, "").slice(0, 8);
      const formatted =
        digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
      setValue(name, formatted, { shouldDirty: true });
    };
  }
  const registerProps = register(name, options);
  return (
    <Field
      label={label}
      required={false}
      type={isNumber ? "number" : isDate ? "text" : "text"}
      placeholder={isDate ? "DD-MM-YYYY" : undefined}
      inputMode={isDate ? "numeric" : undefined}
      {...registerProps}
    />
  );
}


