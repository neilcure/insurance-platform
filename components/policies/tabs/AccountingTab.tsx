"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Loader2, Pencil, Save, X } from "lucide-react";

type FieldDef = {
  key: string;
  label: string;
  inputType: string;
  sortOrder: number;
  options?: Array<{ value: string; label: string }>;
};

type LineTemplate = { key: string; label: string };

type CoverTypeOption = {
  value: string;
  label: string;
  accountingLines?: LineTemplate[];
};

type LineData = {
  lineKey: string;
  lineLabel: string;
  values: Record<string, unknown>;
  margin: number | null;
  updatedAt: string | null;
};

const fmtCurrency = (val: unknown, currency: string): string => {
  const n = Number(val);
  if (!Number.isFinite(n)) return "—";
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function formatDisplayValue(val: unknown, field: FieldDef, currency: string): string {
  if (val === null || val === undefined || val === "") return "—";
  if (field.inputType === "currency") return fmtCurrency(val, currency);
  if (field.inputType === "percent") {
    const n = Number(val);
    return Number.isFinite(n) ? `${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%` : String(val);
  }
  if (field.inputType === "boolean") return val === true || val === "true" ? "Yes" : "No";
  if ((field.inputType === "select" || field.inputType === "multi_select") && field.options) {
    if (Array.isArray(val)) return (val as string[]).map((v) => field.options!.find((o) => o.value === v)?.label ?? v).join(", ") || "—";
    return field.options.find((o) => o.value === String(val))?.label ?? String(val);
  }
  if (field.inputType === "number") {
    const n = Number(val);
    return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(val);
  }
  return String(val);
}

function SummaryRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${className ?? "text-neutral-900 dark:text-neutral-100"}`}>{value}</span>
    </div>
  );
}

/**
 * Resolve which line templates to use based on the policy's cover type
 * and the admin-configured cover type options (from policy_category form options).
 */
function resolveTemplates(
  coverTypeOptions: CoverTypeOption[],
  policyExtra: Record<string, unknown> | null | undefined,
): LineTemplate[] {
  const fallback: LineTemplate[] = [{ key: "main", label: "Premium" }];
  if (!coverTypeOptions.length) return fallback;

  // Scan all package values from the snapshot to find coverType and related fields
  let coverTypeValue: string | undefined;
  let hasOwnVehicleDamage = false;

  const scanValues = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      const bare = k.includes("__") ? k.split("__").pop()! : k;
      if (bare === "coverType" && typeof v === "string" && v.trim()) {
        coverTypeValue = v.trim();
      }
      // Detect "with Own Vehicle Damage" boolean child (various possible key patterns)
      const lowerBare = bare.toLowerCase();
      if (
        (lowerBare.includes("ownvehicle") || lowerBare.includes("own_vehicle") || lowerBare === "withownvehicledamage") &&
        (v === true || v === "true" || v === "Yes" || v === "yes")
      ) {
        hasOwnVehicleDamage = true;
      }
    }
  };

  // Check top-level
  if (policyExtra) scanValues(policyExtra as Record<string, unknown>);

  // Scan packagesSnapshot.*.values
  const pkgs = (policyExtra?.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const entry of Object.values(pkgs)) {
    if (!entry || typeof entry !== "object") continue;
    const values = ("values" in (entry as Record<string, unknown>) ? (entry as Record<string, unknown>).values : entry) as Record<string, unknown> | undefined;
    if (values && typeof values === "object") scanValues(values);
  }

  if (!coverTypeValue) return fallback;

  // If TPO + own vehicle damage boolean is true, look for a "tpo_with_od" option first
  let effectiveValue = coverTypeValue;
  if (coverTypeValue.toLowerCase() === "tpo" && hasOwnVehicleDamage) {
    const odMatch = coverTypeOptions.find((opt) => opt.value === "tpo_with_od");
    if (odMatch) effectiveValue = "tpo_with_od";
  }

  // Match effective value to the options
  const normalized = effectiveValue.toLowerCase().replace(/[\s_-]+/g, "_");
  const match = coverTypeOptions.find((opt) => {
    const optNorm = opt.value.toLowerCase().replace(/[\s_-]+/g, "_");
    return opt.value === effectiveValue || optNorm === normalized;
  });

  if (match?.accountingLines && match.accountingLines.length > 0) {
    return match.accountingLines;
  }

  if (match) {
    return [{ key: match.value, label: match.label }];
  }

  return fallback;
}

// --- Line editor ---
function LineEditor({
  fields,
  lineKey,
  lineLabel,
  initialValues,
  onSave,
  onCancel,
  saving,
}: {
  fields: FieldDef[];
  lineKey: string;
  lineLabel: string;
  initialValues: Record<string, unknown>;
  onSave: (lineKey: string, lineLabel: string, values: Record<string, unknown>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [values, setValues] = React.useState<Record<string, unknown>>({ ...initialValues });

  const liveMargin = React.useMemo(() => {
    const client = Number(values.clientPremium) || 0;
    const net = Number(values.netPremium) || 0;
    const agent = Number(values.agentCommission) || 0;
    if (client === 0 && net === 0 && agent === 0) return null;
    return client - net - agent;
  }, [values]);

  const currency = typeof values.currency === "string" && values.currency ? values.currency : "HKD";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Edit — {lineLabel}</div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            <X className="mr-1 h-3 w-3" /> Cancel
          </Button>
          <Button size="sm" onClick={() => onSave(lineKey, lineLabel, values)} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            Save
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="space-y-3">
          {fields.map((f) => {
            const val = values[f.key];

            if (f.inputType === "boolean") {
              const checked = val === true || val === "true";
              return (
                <label key={f.key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-xs text-neutral-600 dark:text-neutral-300">{f.label}</span>
                  <Checkbox
                    checked={checked}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setValues((s) => ({ ...s, [f.key]: Boolean(e.target.checked) }));
                    }}
                  />
                </label>
              );
            }

            if (f.inputType === "number" || f.inputType === "currency" || f.inputType === "percent") {
              const maxDecimals = f.inputType === "currency" ? 2 : f.inputType === "percent" ? 2 : undefined;
              return (
                <div key={f.key}>
                  <label className="text-xs text-neutral-600 dark:text-neutral-300">{f.label}</label>
                  <div className="mt-1 flex items-center gap-2">
                    {f.inputType === "currency" && (
                      <span className="shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">{currency}</span>
                    )}
                    <Input
                      type="number"
                      step={f.inputType === "currency" || f.inputType === "percent" ? "0.01" : "any"}
                      value={String(val ?? "")}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") {
                          setValues((s) => ({ ...s, [f.key]: "" }));
                          return;
                        }
                        if (maxDecimals !== undefined) {
                          const dotIdx = raw.indexOf(".");
                          if (dotIdx !== -1 && raw.length - dotIdx - 1 > maxDecimals) return;
                        }
                        setValues((s) => ({ ...s, [f.key]: Number(raw) }));
                      }}
                      className="h-8 text-xs"
                      placeholder="0.00"
                    />
                    {f.inputType === "percent" && (
                      <span className="shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">%</span>
                    )}
                  </div>
                </div>
              );
            }

            if ((f.inputType === "select" || f.inputType === "multi_select") && f.options) {
              return (
                <div key={f.key}>
                  <label className="text-xs text-neutral-600 dark:text-neutral-300">{f.label}</label>
                  <select
                    className="mt-1 h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={String(val ?? "")}
                    onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                  >
                    <option value="">—</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              );
            }

            return (
              <div key={f.key}>
                <label className="text-xs text-neutral-600 dark:text-neutral-300">{f.label}</label>
                <Input
                  type={f.inputType === "date" ? "date" : "text"}
                  value={String(val ?? "")}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                  className="mt-1 h-8 text-xs"
                />
              </div>
            );
          })}

          {liveMargin !== null && (
            <>
              <Separator />
              <div className="flex items-center justify-between rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-900">
                <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Margin</span>
                <span className={`text-sm font-semibold tabular-nums ${liveMargin >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {currency} {liveMargin.toFixed(2)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Read-only view of one line ---
function LineView({ line, fields, canEdit, onEdit }: { line: LineData; fields: FieldDef[]; canEdit: boolean; onEdit: () => void }) {
  const currency = (typeof line.values.currency === "string" && line.values.currency) || "HKD";
  const hasData = Object.values(line.values).some((v) => v !== null && v !== undefined && v !== "");

  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{line.lineLabel}</span>
        {canEdit && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={onEdit}>
            <Pencil className="mr-1 h-3 w-3" /> Edit
          </Button>
        )}
      </div>
      <div className="px-3 py-1">
        {!hasData ? (
          <div className="py-3 text-center text-xs text-neutral-400 dark:text-neutral-500">
            Not filled in yet
            {canEdit && (
              <div className="mt-1">
                <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={onEdit}>Fill in</Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {fields.map((f, idx) => (
              <React.Fragment key={f.key}>
                {idx > 0 && <Separator className="my-0.5" />}
                <SummaryRow label={f.label} value={formatDisplayValue(line.values[f.key], f, currency)} />
              </React.Fragment>
            ))}
            {line.margin !== null && (
              <>
                <Separator className="my-0.5" />
                <SummaryRow
                  label="Margin"
                  value={fmtCurrency(line.margin, currency)}
                  className={line.margin >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
                />
              </>
            )}
          </>
        )}
      </div>
      {line.updatedAt && (
        <div className="border-t border-neutral-100 px-3 py-1 text-right text-[10px] text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
          Updated: {new Date(line.updatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

// --- Main AccountingTab ---
export function AccountingTab({
  policyId,
  canEdit,
  policyExtra,
  onUpdate,
}: {
  policyId: number;
  canEdit: boolean;
  policyExtra?: Record<string, unknown> | null;
  onUpdate?: () => void;
}) {
  const [fields, setFields] = React.useState<FieldDef[]>([]);
  const [lines, setLines] = React.useState<LineData[]>([]);
  const [coverTypeOptions, setCoverTypeOptions] = React.useState<CoverTypeOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/premiums`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      setFields(json.fields ?? []);
      setLines(json.lines ?? []);
      setCoverTypeOptions(json.coverTypeOptions ?? []);
    } catch {
      setFields([]);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  React.useEffect(() => { void load(); }, [load]);

  // Determine which lines SHOULD exist based on the policy's cover type
  const expectedTemplates = React.useMemo(
    () => resolveTemplates(coverTypeOptions, policyExtra),
    [coverTypeOptions, policyExtra],
  );

  // Merge expected templates with existing DB lines
  const displayLines = React.useMemo(() => {
    const result: LineData[] = [];
    for (const tmpl of expectedTemplates) {
      const existing = lines.find((l) => l.lineKey === tmpl.key);
      if (existing) {
        result.push({ ...existing, lineLabel: tmpl.label });
      } else {
        const emptyValues: Record<string, unknown> = {};
        for (const f of fields) emptyValues[f.key] = null;
        result.push({ lineKey: tmpl.key, lineLabel: tmpl.label, values: emptyValues, margin: null, updatedAt: null });
      }
    }
    // Include any existing lines not in the templates (legacy data)
    for (const line of lines) {
      if (!result.some((r) => r.lineKey === line.lineKey)) {
        result.push(line);
      }
    }
    return result;
  }, [expectedTemplates, lines, fields]);

  async function handleSave(lineKey: string, lineLabel: string, values: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/premiums`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineKey, lineLabel, values }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      toast.success("Saved");
      setEditingKey(null);
      await load();
      onUpdate?.();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <div className="text-sm text-neutral-500 dark:text-neutral-400">No accounting fields configured.</div>
        <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          Create an <span className="font-medium">accounting</span> package in Admin &rarr; Policy Settings &rarr; Packages, then add fields to it.
        </div>
      </div>
    );
  }

  // Editing a line
  if (editingKey !== null) {
    const line = displayLines.find((l) => l.lineKey === editingKey);
    if (!line) { setEditingKey(null); return null; }
    return (
      <LineEditor
        fields={fields}
        lineKey={line.lineKey}
        lineLabel={line.lineLabel}
        initialValues={line.values}
        onSave={handleSave}
        onCancel={() => setEditingKey(null)}
        saving={saving}
      />
    );
  }

  // Read-only
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Accounting</div>

      {displayLines.map((line) => (
        <LineView
          key={line.lineKey}
          line={line}
          fields={fields}
          canEdit={canEdit}
          onEdit={() => setEditingKey(line.lineKey)}
        />
      ))}

      {/* Totals across all lines */}
      {displayLines.length > 1 && (() => {
        const currency = (typeof displayLines[0]?.values?.currency === "string" && displayLines[0].values.currency) || "HKD";
        let totalMargin = 0;
        let hasMargin = false;
        for (const l of displayLines) {
          if (l.margin !== null) { totalMargin += l.margin; hasMargin = true; }
        }
        if (!hasMargin) return null;
        return (
          <div className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
            <SummaryRow
              label="Total Margin"
              value={fmtCurrency(totalMargin, currency)}
              className={totalMargin >= 0 ? "text-green-600 dark:text-green-400 font-bold" : "text-red-600 dark:text-red-400 font-bold"}
            />
          </div>
        );
      })()}
    </div>
  );
}
