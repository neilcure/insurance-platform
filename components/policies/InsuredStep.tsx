"use client";

import * as React from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { maskDDMMYYYY } from "@/lib/format/date";
import { Field } from "@/components/ui/form-field";
import { tDynamic, useLocale, useT } from "@/lib/i18n";

/**
 * Boolean Yes/No radio pair bound to RHF.
 *
 * RHF's auto-`checked` matching for radios uses `radio.value === stateValue`
 * with strict equality. Because `setValueAs` coerces clicks into a boolean
 * (and saved values from the DB also arrive as booleans), `"true" === true`
 * is `false` and the radios would render unselected on re-load even when the
 * value was saved correctly. Driving `checked` explicitly via
 * `String(curr ?? "") === "true"` works for boolean and string state shapes
 * (and safely handles `null` / `undefined` / `""` as "no selection").
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
          className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black"
          value="true"
          checked={isYes}
          {...form.register(name as never, {
            required: Boolean(required),
            setValueAs: (v) => (v === "true" ? true : v === "false" ? false : v),
          })}
        />
        {yesLabel}
      </label>
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          type="radio"
          className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black"
          value="false"
          checked={isNo}
          {...form.register(name as never, {
            required: Boolean(required),
            setValueAs: (v) => (v === "true" ? true : v === "false" ? false : v),
          })}
        />
        {noLabel}
      </label>
    </div>
  );
}

type DynamicField = {
  label: string;
  value: string;
  valueType?: string;
  sortOrder?: number;
  meta?: {
    inputType?: string;
    required?: boolean;
    categories?: string[];
    options?: { label?: string; value?: string }[];
    booleanChildren?: { true?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[]; false?: { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[] };
    defaultBoolean?: boolean | null;
    selectDisplay?: "dropdown" | "radio";
    /** Optional admin-edited locale overrides — opaque blob, see `lib/i18n`. */
    translations?: unknown;
  } | null;
};

export function InsuredStep({
  form,
}: {
  form: UseFormReturn<Record<string, unknown>>;
}) {
  const locale = useLocale();
  const t = useT();
  const [insuredTypes, setInsuredTypes] = React.useState<{ label: string; value: string; meta?: Record<string, unknown> | null }[]>([]);
  const insuredType = String((form.watch("insuredType") as string) ?? "")
    .trim()
    .toLowerCase();

  const normalizeInsuredCategoryValue = (v: unknown): string => {
    const s = String(v ?? "").trim();
    const lower = s.toLowerCase();
    // insured_category is expected to be company/personal (case-insensitive)
    if (lower === "company" || lower === "personal") return lower;
    return s;
  };

  React.useEffect(() => {
    let cancelled = false;
    async function loadTypes() {
      try {
        const res = await fetch("/api/form-options?groupKey=insured_category", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string; meta?: Record<string, unknown> | null }[];
        if (cancelled) return;
        const normalized = (Array.isArray(data) ? data : [])
          .map((d) => ({
            label: String(d?.label ?? d?.value ?? ""),
            value: normalizeInsuredCategoryValue(d?.value),
            meta: (d?.meta ?? null) as Record<string, unknown> | null,
          }))
          .filter((d) => String(d.value ?? "").trim() !== "");
        setInsuredTypes(normalized);

        const currRaw = String(form.getValues("insuredType") ?? "").trim();
        const curr = normalizeInsuredCategoryValue(currRaw);
        const isDirty = Boolean((form.formState.dirtyFields as any)?.insuredType);
        const hasCurrent = normalized.some((d) => d.value === curr);

        // If the user already picked a value, don't snap it back after the async load.
        if (isDirty) return;

        // Canonicalize casing if needed.
        if (currRaw && curr && hasCurrent && currRaw !== curr) {
          form.setValue("insuredType", curr as never, { shouldDirty: false, shouldTouch: false });
          return;
        }

        // Only set a default if it's currently empty.
        if (!curr && normalized.length > 0) {
          form.setValue("insuredType", normalized[0].value as never, { shouldDirty: false, shouldTouch: false });
        }
      } catch {
        // ignore
      }
    }
    void loadTypes();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [dynamicFields, setDynamicFields] = React.useState<DynamicField[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    async function loadFields() {
      try {
        const res = await fetch("/api/form-options?groupKey=insured_fields", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as DynamicField[];
        if (!cancelled) setDynamicFields(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setDynamicFields([]);
      }
    }
    void loadFields();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!Array.isArray(dynamicFields) || dynamicFields.length === 0) return;
    for (const f of dynamicFields) {
      const meta = (f.meta ?? {}) as Record<string, unknown>;
      if ((meta?.inputType ?? "string") === "boolean" && typeof meta?.defaultBoolean === "boolean") {
        const rawKey = String(f.value ?? "").trim();
        const baseKey = rawKey.startsWith("insured__") ? rawKey.slice("insured__".length) : rawKey.startsWith("insured_") ? rawKey.slice("insured_".length) : rawKey;
        const nameBase = `insured__${baseKey}`;
        const curr = (form.getValues() as Record<string, unknown>)[nameBase];
        if (typeof curr === "undefined" || curr === null || curr === "") {
          form.setValue(nameBase as never, (meta.defaultBoolean as boolean) as never, { shouldDirty: false });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynamicFields]);

  React.useEffect(() => {
    const sub = form.watch((all, { name }) => {
      if (name !== "insuredType") return;
      const nextType = String((all as Record<string, unknown>)?.insuredType ?? "");
      const prevType = String(insuredType ?? "");
      // No prompt and no auto-clearing; accept change silently
      if (!prevType || prevType === nextType) return;
      // If suppression flag is set for programmatic changes, just consume it
      try {
        const suppress = (form.getValues() as Record<string, unknown>)?._suppressInsuredTypeConfirm;
        if (suppress === true) {
          form.setValue("_suppressInsuredTypeConfirm" as never, false as never, { shouldDirty: false });
        }
      } catch {}
    });
    return () => sub.unsubscribe && sub.unsubscribe();
  }, [form, insuredType, dynamicFields]);


  return (
    <>
      <div className="space-y-2">
        <Label>{t("insured.typeLabel", "Insured Type")}</Label>
        {insuredTypes.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t(
              "insured.noCategoriesHelp",
              "No insured categories configured. Please create one in Admin → Policy Settings → Insured Category.",
            )}
          </p>
        ) : (
          <div className="flex gap-6">
            {insuredTypes.map((opt) => (
              <label key={opt.value} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  className="appearance-none h-3.5 w-3.5 rounded-full border border-neutral-400 bg-transparent checked:bg-neutral-900 dark:checked:bg-white checked:border-white dark:checked:border-black focus-visible:outline-none focus-visible:ring-0"
                  value={opt.value}
                  checked={insuredType === opt.value}
                  onChange={() => form.setValue("insuredType", normalizeInsuredCategoryValue(opt.value) as never, { shouldDirty: true })}
                />
                {/* Translate first; this label has no labelCase so no need to compose. */}
                {tDynamic(opt, locale)}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Dynamic Insured Fields */}
      {dynamicFields.filter((f) => {
        const cats = (f.meta?.categories ?? []) as string[];
        const canonCats = cats.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean);
        return canonCats.length === 0 || canonCats.includes(insuredType as string);
      }).length > 0 ? (
        <section className="space-y-4">
          <h3 className="text-sm font-medium">{t("insured.infoSectionTitle", "Insured Info")}</h3>
          <div className="grid grid-cols-2 gap-4">
            {dynamicFields
              .filter((f) => {
                const cats = (f.meta?.categories ?? []) as string[];
                const canonCats = cats.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean);
                return canonCats.length === 0 || canonCats.includes(insuredType as string);
              })
              .map((f) => {
                const rawKey = String(f.value ?? "").trim();
                const baseKey = rawKey.startsWith("insured__")
                  ? rawKey.slice("insured__".length)
                  : rawKey.startsWith("insured_")
                    ? rawKey.slice("insured_".length)
                    : rawKey;
                const nameBase = `insured__${baseKey}`;
                const inputType = f.meta?.inputType ?? "string";
                const isNumber = inputType === "number";
                const isDate = inputType === "date";
                if (inputType === "select") {
                  const options = (Array.isArray(f.meta?.options) ? (f.meta?.options as unknown[]) : []) as {
                    label?: string;
                    value?: string;
                  }[];
                  return (
                    <div key={nameBase} className="space-y-1">
                      <Label>
                        {tDynamic(f, locale)} {f.meta?.required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                      </Label>
                      <div className="flex flex-wrap gap-4">
                        {options.map((o) => (
                          <label key={o.value} className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black"
                              value={o.value}
                              {...form.register(nameBase as never, { required: Boolean(f.meta?.required) })}
                            />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (inputType === "multi_select") {
                  const options = (Array.isArray(f.meta?.options) ? (f.meta?.options as unknown[]) : []) as {
                    label?: string;
                    value?: string;
                  }[];
                  return (
                    <div key={nameBase} className="space-y-1">
                      <Label>
                        {tDynamic(f, locale)} {f.meta?.required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                      </Label>
                      <div className="max-h-40 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
                        {options.map((o) => (
                          <label key={o.value} className="mr-4 inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              value={o.value}
                              {...form.register(nameBase as never, {
                                validate: (v) =>
                                  !Boolean(f.meta?.required) || (Array.isArray(v) && (v as unknown[]).length > 0) || `${f.label} is required`,
                              })}
                            />
                            {o.label}
                          </label>
                        ))}
                        {options.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("insured.noOptionsConfigured", "No options configured.")}</p> : null}
                      </div>
                    </div>
                  );
                }
                if (inputType === "boolean") {
                  const yesChildren = (Array.isArray(f.meta?.booleanChildren?.true) ? (f.meta?.booleanChildren?.true as unknown[]) : []) as { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                  const noChildren = (Array.isArray(f.meta?.booleanChildren?.false) ? (f.meta?.booleanChildren?.false as unknown[]) : []) as { label?: string; inputType?: string; options?: { label?: string; value?: string }[] }[];
                  const curr = (form.getValues() as Record<string, unknown>)[nameBase];
                  const isYes = curr === true || curr === "true";
                  return (
                    <div key={nameBase} className="col-span-2 space-y-2">
                      <div className="space-y-1">
                        <Label>
                          {tDynamic(f, locale)} {f.meta?.required ? <span className="text-red-600 dark:text-red-400">*</span> : null}
                        </Label>
                        <BooleanRadioPair form={form} name={nameBase} required={Boolean(f.meta?.required)} />
                      </div>
                      {isYes && yesChildren.length > 0 ? (
                        <div className="grid grid-cols-2 gap-4">
                          {yesChildren.map((child, cIdx: number) => {
                            const name = `${nameBase}__true__c${cIdx}`;
                            const cType = String(child?.inputType ?? "string").trim().toLowerCase();
                            const cIsNum = cType === "number";
                            const cIsDate = cType === "date";
                            if (cType === "select") {
                              const opts = (Array.isArray(child?.options) ? child?.options : []) as { label?: string; value?: string }[];
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
                              const opts = (Array.isArray(child?.options) ? child?.options : []) as { label?: string; value?: string }[];
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
                                    {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                  </div>
                                </div>
                              );
                            }
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
                          {noChildren.map((child, cIdx: number) => {
                            const name = `${nameBase}__false__c${cIdx}`;
                            const cType = String(child?.inputType ?? "string").trim().toLowerCase();
                            const cIsNum = cType === "number";
                            const cIsDate = cType === "date";
                            if (cType === "select") {
                              const opts = (Array.isArray(child?.options) ? child?.options : []) as { label?: string; value?: string }[];
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
                              const opts = (Array.isArray(child?.options) ? child?.options : []) as { label?: string; value?: string }[];
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
                                    {opts.length === 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">No options configured.</p> : null}
                                  </div>
                                </div>
                              );
                            }
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
                const options: {
                  setValueAs?: (v: unknown) => number | undefined;
                  validate?: (v: unknown) => boolean | string;
                  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
                  required?: string | boolean;
                } = {};
                if (isNumber) options.setValueAs = (v: unknown) => (v === "" ? undefined : Number(v as number));
                if (isDate) {
                  options.validate = (v: unknown) => {
                    if (v === undefined || v === null || v === "") return true;
                    return /^\d{2}-\d{2}-\d{4}$/.test(String(v)) || "Use DD-MM-YYYY";
                  };
                  options.onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                    const formatted = maskDDMMYYYY(e?.target?.value ?? "");
                    form.setValue(nameBase as never, formatted as never, { shouldDirty: true });
                  };
                }
                if (Boolean(f.meta?.required)) options.required = `${f.label} is required`;
                const registerProps = form.register(nameBase as never, options);
                return (
                  <Field
                    key={nameBase}
                    label={tDynamic(f, locale)}
                    required={Boolean(f.meta?.required)}
                    type={isNumber ? "number" : isDate ? "text" : "text"}
                    placeholder={isDate ? "DD-MM-YYYY" : undefined}
                    inputMode={isDate ? "numeric" : undefined}
                    {...registerProps}
                  />
                );
              })}
          </div>
        </section>
      ) : null}
    </>
  );
}

// Field extracted to @/components/ui/form-field

