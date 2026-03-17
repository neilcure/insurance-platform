"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

export type EditField = {
  key: string;
  label: string;
  inputType: string;
  sortOrder: number;
  groupOrder?: number;
  groupName?: string;
  options?: Array<{ value: string; label: string }>;
};

export type FieldEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fields: EditField[];
  values: Record<string, unknown>;
  onValuesChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  loading?: boolean;
  saving?: boolean;
  onSave: () => void;
};

export function FieldEditDialog({
  open,
  onOpenChange,
  title,
  fields,
  values,
  onValuesChange,
  loading,
  saving,
  onSave,
}: FieldEditDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading fields...
            </div>
          ) : fields.length === 0 ? (
            <div className="text-sm text-neutral-500 dark:text-neutral-400">
              No fields to edit.
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {fields.map((f) => {
                const value = values[f.key];

                if (f.inputType === "boolean") {
                  const checked = value === true || value === "true";
                  return (
                    <label
                      key={f.key}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-neutral-600 dark:text-neutral-300">
                        {f.label}
                      </span>
                      <Checkbox
                        checked={checked}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          onValuesChange((s) => ({
                            ...s,
                            [f.key]: Boolean(e.target.checked),
                          }));
                        }}
                      />
                    </label>
                  );
                }

                if (f.inputType === "number" || f.inputType === "currency" || f.inputType === "percent") {
                  return (
                    <div key={f.key}>
                      <label className="text-sm text-neutral-600 dark:text-neutral-300">
                        {f.label}
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step={f.inputType === "currency" || f.inputType === "percent" ? "0.01" : undefined}
                          value={String(value ?? "")}
                          onChange={(e) => {
                            const raw = e.target.value;
                            onValuesChange((s) => ({
                              ...s,
                              [f.key]: raw === "" ? "" : Number(raw),
                            }));
                          }}
                        />
                        {f.inputType === "percent" && (
                          <span className="shrink-0 text-sm font-medium text-neutral-500 dark:text-neutral-400">%</span>
                        )}
                      </div>
                    </div>
                  );
                }

                if (f.inputType === "multi_select" && f.options) {
                  const current = Array.isArray(value)
                    ? (value as string[])
                    : String(value ?? "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                  return (
                    <div key={f.key}>
                      <label className="text-sm text-neutral-600 dark:text-neutral-300">
                        {f.label}
                      </label>
                      <select
                        multiple
                        className="mt-1 w-full rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        value={current}
                        onChange={(e) => {
                          const selected = Array.from(
                            e.target.selectedOptions,
                          ).map((o) => o.value);
                          onValuesChange((s) => ({
                            ...s,
                            [f.key]: selected,
                          }));
                        }}
                      >
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                if (f.inputType === "select" && f.options) {
                  return (
                    <div key={f.key}>
                      <label className="text-sm text-neutral-600 dark:text-neutral-300">
                        {f.label}
                      </label>
                      <select
                        className="mt-1 w-full rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        value={String(value ?? "")}
                        onChange={(e) =>
                          onValuesChange((s) => ({
                            ...s,
                            [f.key]: e.target.value,
                          }))
                        }
                      >
                        <option value="" />
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                return (
                  <div key={f.key}>
                    <label className="text-sm text-neutral-600 dark:text-neutral-300">
                      {f.label}
                    </label>
                    <Input
                      value={String(value ?? "")}
                      onChange={(e) =>
                        onValuesChange((s) => ({
                          ...s,
                          [f.key]: e.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={saving || loading}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Load field definitions for a package from the API.
 * Returns field rows with key, label, inputType, sortOrder, and options.
 */
export async function loadEditFields(
  pkgName: string,
  currentValues: Record<string, unknown>,
): Promise<{ fields: EditField[]; values: Record<string, unknown> }> {
  const res = await fetch(
    `/api/form-options?groupKey=${encodeURIComponent(`${pkgName}_fields`)}&_t=${Date.now()}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Failed to load fields");
  const rows = await res.json();
  const fields: EditField[] = (Array.isArray(rows) ? rows : [])
    .map((r: any) => {
      const m = (r?.meta ?? {}) as Record<string, unknown>;
      const opts = Array.isArray(m?.options)
        ? (m.options as Array<{ value?: unknown; label?: unknown }>).map(
            (o) => ({
              value: String(o?.value ?? o?.label ?? ""),
              label: String(o?.label ?? o?.value ?? ""),
            }),
          )
        : [];
      return {
        key: String(r?.value ?? ""),
        label: String(r?.label ?? r?.value ?? ""),
        inputType: String(m?.inputType ?? "text"),
        sortOrder: Number(r?.sortOrder ?? 0),
        groupOrder: Number(m?.groupOrder ?? 0),
        groupName: typeof m?.group === "string" ? m.group : "",
        options: opts.length > 0 ? opts : undefined,
      };
    })
    .filter((f: { key: string }) => f.key);
  fields.sort((a, b) => {
    const ag = a.groupOrder ?? 0, bg = b.groupOrder ?? 0;
    if (ag !== bg) return ag - bg;
    const agn = a.groupName ?? "", bgn = b.groupName ?? "";
    if (agn !== bgn) return agn.localeCompare(bgn, undefined, { sensitivity: "base" });
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });

  const merged: Record<string, unknown> = {};
  for (const f of fields) {
    const v =
      currentValues[f.key] ??
      currentValues[`${pkgName}__${f.key}`] ??
      currentValues[`${pkgName}_${f.key}`];
    merged[f.key] = v ?? (f.inputType === "boolean" ? false : "");
  }
  return { fields, values: merged };
}
