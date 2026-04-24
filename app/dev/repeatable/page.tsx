"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type InputType = "string" | "number" | "date" | "select" | "multi_select" | "boolean" | "repeatable";
type ChildMeta = {
  label?: string;
  value?: string;
  inputType?: InputType;
  required?: boolean;
  options?: { label: string; value: string }[];
};
type FieldMeta = {
  inputType?: InputType;
  labelCase?: "original" | "upper" | "lower" | "title";
  dateFormat?: "DD-MM-YYYY" | "YYYY-MM-DD";
  repeatable?: {
    itemLabel?: string;
    min?: number;
    max?: number;
    fields?: ChildMeta[];
  };
};

function applyCase(text: string, mode?: "original" | "upper" | "lower" | "title"): string {
  const t = String(text ?? "");
  switch (mode) {
    case "upper":
      return t.toUpperCase();
    case "lower":
      return t.toLowerCase();
    case "title":
      return t.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    default:
      return t;
  }
}

export default function RepeatableTestPage() {
  const form = useForm<any>({ defaultValues: {} });
  const values = useWatch({ control: form.control }) as Record<string, unknown>;

  // Demo field configuration
  const field = React.useMemo(
    () => ({
      label: "Accessories",
      value: "accessories",
      meta: {
        inputType: "repeatable",
        repeatable: {
          itemLabel: "Accessory",
          min: 1,
          max: 4,
          fields: [
            { label: "Name", value: "name", inputType: "string", required: true },
            { label: "Cost", value: "cost", inputType: "number" },
            {
              label: "Type",
              value: "type",
              inputType: "select",
              options: [
                { label: "Electrical", value: "electrical" },
                { label: "Body", value: "body" },
              ],
            },
            { label: "Installed", value: "installed", inputType: "boolean" },
          ],
        },
      } as FieldMeta,
    }),
    []
  );

  const rep = (field.meta as FieldMeta | undefined)?.repeatable ?? {};
  const itemLabel = String(rep.itemLabel ?? "Item");
  const min = Number.isFinite(Number(rep.min)) ? Number(rep.min) : 0;
  const max = Number.isFinite(Number(rep.max)) ? Number(rep.max) : 0;
  const childFields = Array.isArray(rep.fields) ? rep.fields.filter(Boolean) : [];
  const list: unknown[] = Array.isArray(values?.[field.value]) ? (((values as any)[field.value] as unknown[]) ?? []) : [];
  const items = list as Record<string, unknown>[];
  const canAdd = max <= 0 || items.length < max;
  const canRemove = (idx: number) => items.length > Math.max(1, min) - 0 && idx >= 0;

  const addItem = () => {
    const next = [...items, {}];
    form.setValue(field.value as any, next as any, { shouldDirty: true });
  };
  const removeItem = (idx: number) => {
    if (!canRemove(idx)) return;
    const next = items.filter((_, i) => i !== idx);
    form.setValue(field.value as any, next as any, { shouldDirty: true });
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-3 sm:p-6">
      <h1 className="text-xl font-semibold">Repeatable Field — Dev Test</h1>
      <section className="space-y-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <Label>
            {applyCase(field.label, (field.meta as FieldMeta | undefined)?.labelCase)}{" "}
            {field.meta && (field.meta as any).required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
          </Label>
          <Button type="button" size="sm" variant="secondary" onClick={addItem} disabled={!canAdd}>
            Add {itemLabel}
          </Button>
        </div>
        <div className="space-y-2">
          {(items.length === 0 ? Array.from({ length: Math.max(0, min) }) : items).map((_, idx) => {
            if (!Array.isArray(values?.[field.value]) && min > 0) {
              form.setValue(field.value as any, Array.from({ length: min }).map(() => ({})) as any, { shouldDirty: false });
            }
            return (
              <div key={`${field.value}__row__${idx}`} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
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
                    const base = `${field.value}.${idx}.${cf?.value ?? `c${cIdx}`}`;
                    const type = cf.inputType ?? "string";
                    if (type === "select") {
                      const opts = Array.isArray(cf.options) ? cf.options : [];
                      return (
                        <div key={`${base}__sel`} className="space-y-1">
                          <Label>{cf.label ?? "Select"}</Label>
                          <select
                            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                            {...form.register(base as any, { required: Boolean(cf.required) })}
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
                                  {...form.register(base as any, {
                                    validate: (v) => !Boolean(cf.required) || (Array.isArray(v) && v.length > 0) || `${cf.label ?? "This"} is required`,
                                  })}
                                />
                                {o.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    if (type === "boolean") {
                      return (
                        <div key={`${base}__bool`} className="space-y-1">
                          <Label>{cf.label ?? "Select"}</Label>
                          <div className="flex items-center gap-6">
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input type="radio" value="true" {...form.register(base as any, { setValueAs: (v) => v === "true" })} />
                              Yes
                            </label>
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input type="radio" value="false" {...form.register(base as any, { setValueAs: (v) => v === "true" })} />
                              No
                            </label>
                          </div>
                        </div>
                      );
                    }
                    const isNum = type === "number";
                    const registerProps = form.register(base as any, isNum ? { setValueAs: (v) => (v === "" ? undefined : Number(v)) } : {});
                    return (
                      <div key={`${base}__fld`} className="space-y-1">
                        <Label>{cf.label ?? "Value"}</Label>
                        <Input type={isNum ? "number" : "text"} {...registerProps} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="rounded-md border border-neutral-200 p-4 text-xs dark:border-neutral-800">
        <div className="mb-2 font-medium">Form values</div>
        <pre className="whitespace-pre-wrap wrap-break-word">{JSON.stringify(values ?? {}, null, 2)}</pre>
      </section>
    </main>
  );
}

