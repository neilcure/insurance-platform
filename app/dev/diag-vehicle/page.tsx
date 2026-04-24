"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AnyRecord = Record<string, unknown>;

export default function DevDiagVehicle() {
  const [groupKey, setGroupKey] = React.useState<string>("vehicleinfo_fields");
  const [fields, setFields] = React.useState<
    { id: number; label: string; value: string; meta?: AnyRecord; sortOrder?: number }[]
  >([]);
  const form = useForm<AnyRecord>({ defaultValues: {} });
  const values = useWatch({ control: form.control });

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(groupKey)}`, { cache: "no-store" });
        const data = (await res.json()) as any[];
        if (!cancelled) setFields(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setFields([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [groupKey]);

  const target = React.useMemo(() => fields.find((f) => f.value === "2leveltest"), [fields]);
  const meta = (target?.meta ?? {}) as AnyRecord;

  const yesRaw = (meta?.booleanChildren as AnyRecord | undefined)?.["true"] ?? [];
  const yesChildren = (Array.isArray(yesRaw) ? yesRaw : [yesRaw]) as AnyRecord[];

  const isYes = React.useMemo(() => {
    const v = values?.[target?.value ?? ""];
    const defYes = (meta?.defaultBoolean as boolean | undefined) === true;
    return v === true || v === "true" || (typeof v === "undefined" && defYes);
  }, [values, target, meta]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-3 sm:p-6">
      <h1 className="text-xl font-semibold">Dev — Vehicle diag</h1>

      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="mb-2 text-sm font-medium">Group</div>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" variant={groupKey === "vehicleinfo_fields" ? "default" : "outline"} onClick={() => setGroupKey("vehicleinfo_fields")}>
            vehicleinfo_fields
          </Button>
          <Button type="button" size="sm" variant={groupKey === "vehicle_fields" ? "default" : "outline"} onClick={() => setGroupKey("vehicle_fields")}>
            vehicle_fields
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800">
        <div className="mb-2 text-sm font-medium">Raw field (2leveltest)</div>
        <pre className="whitespace-pre-wrap break-words">{JSON.stringify(target ?? null, null, 2)}</pre>
      </div>

      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="mb-2 text-sm font-medium">Rendered</div>
        {!target ? (
          <div className="text-sm text-neutral-500">No field named 2leveltest in {groupKey}</div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>2 Level test (boolean)</Label>
              <div className="flex items-center gap-6">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    value="true"
                    {...form.register(target.value as any, {
                      setValueAs: (v) => (v === "true" ? true : v === "false" ? false : v),
                    })}
                  />
                  Yes
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    value="false"
                    {...form.register(target.value as any, {
                      setValueAs: (v) => (v === "true" ? true : v === "false" ? false : v),
                    })}
                  />
                  No
                </label>
              </div>
            </div>

            <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="mb-2 text-sm font-medium">Yes branch (isYes={String(isYes)})</div>
              {isYes ? (
                <YesBranchRenderer nameBase={target.value} yesChildren={yesChildren} form={form} />
              ) : (
                <div className="text-sm text-neutral-500">Hidden — select Yes to view</div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function YesBranchRenderer({
  nameBase,
  yesChildren,
  form,
}: {
  nameBase: string;
  yesChildren: AnyRecord[];
  form: ReturnType<typeof useForm<AnyRecord>>;
}) {
  const first = yesChildren?.[0] ?? {};
  const isRepeatable =
    String(first?.inputType ?? "").trim().toLowerCase() === "repeatable" || !!first?.repeatable;
  if (!isRepeatable) {
    return <div className="text-sm text-red-500">First child is not repeatable.</div>;
  }
  const rep = (first?.repeatable ?? {}) as {
    itemLabel?: string;
    min?: number;
    max?: number;
    fields?: { label?: string; value?: string; inputType?: string }[];
  };
  const items = (useWatch({ control: form.control, name: `${nameBase}__true__c0_list` as any }) as AnyRecord[]) ?? [];
  const add = () => {
    const next = [...(Array.isArray(items) ? items : []), {}];
    form.setValue(`${nameBase}__true__c0_list` as any, next as any, { shouldDirty: true });
  };
  const remove = (idx: number) => {
    const next = (Array.isArray(items) ? items : []).filter((_, i) => i !== idx);
    form.setValue(`${nameBase}__true__c0_list` as any, next as any, { shouldDirty: true });
  };
  const childFields = Array.isArray(rep?.fields) ? rep.fields : [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{String(first?.label ?? rep?.itemLabel ?? "Accessory")}</Label>
        <Button type="button" size="sm" onClick={add}>
          Add {String(rep?.itemLabel ?? "Item")}
        </Button>
      </div>
      <div className="space-y-2">
        {(Array.isArray(items) ? items : []).map((_, idx) => (
          <div key={idx} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium">
                {String(rep?.itemLabel ?? "Item")} #{idx + 1}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => remove(idx)}>
                Remove
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {childFields.map((cf, cIdx) => {
                const name = `${nameBase}__true__c0_${idx}.${cf?.value ?? `c${cIdx}`}`;
                const t = String(cf?.inputType ?? "string").trim().toLowerCase();
                return (
                  <div key={name} className="space-y-1">
                    <Label>{cf?.label ?? "Value"}</Label>
                    <Input type={t === "number" ? "number" : "text"} {...form.register(name as any)} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

