"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { deepEqual, formSnapshot } from "@/lib/form-utils";
import { Building2, Loader2, Pencil, Save, Users, X } from "lucide-react";

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

type EntityOption = { id: number; name: string };

type LineData = {
  lineKey: string;
  lineLabel: string;
  values: Record<string, unknown>;
  margin: number | null;
  updatedAt: string | null;
  insurerId: number | null;
  insurerName: string | null;
  collaboratorId: number | null;
  collaboratorName: string | null;
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

function resolveTemplates(
  coverTypeOptions: CoverTypeOption[],
  policyExtra: Record<string, unknown> | null | undefined,
): LineTemplate[] {
  const fallback: LineTemplate[] = [{ key: "main", label: "Premium" }];
  if (!coverTypeOptions.length) return fallback;

  let coverTypeValue: string | undefined;
  let hasOwnVehicleDamage = false;

  const scanValues = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      const bare = k.includes("__") ? k.split("__").pop()! : k;
      if (bare === "coverType" && typeof v === "string" && v.trim()) {
        coverTypeValue = v.trim();
      }
      const lower = k.toLowerCase();
      const lowerBare = bare.toLowerCase();
      if (
        (lowerBare.includes("ownvehicle") || lowerBare.includes("own_vehicle") || lowerBare === "withownvehicledamage") &&
        (v === true || v === "true" || v === "Yes" || v === "yes")
      ) {
        hasOwnVehicleDamage = true;
      }
      // Detect child field under coverType=tpo that is true (e.g. coverType__opt_tpo__c0 = true)
      if (lower.includes("covertype__opt_tpo__c") && (v === true || v === "true")) {
        hasOwnVehicleDamage = true;
      }
      // Detect PD-suffixed entity fields with values (insCompanyPD, insColloratorsPD)
      if (lowerBare.endsWith("pd") && typeof v === "string" && v.trim()) {
        hasOwnVehicleDamage = true;
      }
    }
  };

  if (policyExtra) scanValues(policyExtra as Record<string, unknown>);
  const pkgs = (policyExtra?.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const entry of Object.values(pkgs)) {
    if (!entry || typeof entry !== "object") continue;
    const values = ("values" in (entry as Record<string, unknown>) ? (entry as Record<string, unknown>).values : entry) as Record<string, unknown> | undefined;
    if (values && typeof values === "object") scanValues(values);
  }

  if (!coverTypeValue) return fallback;

  let effectiveValue = coverTypeValue;
  if (coverTypeValue.toLowerCase() === "tpo" && hasOwnVehicleDamage) {
    const odMatch = coverTypeOptions.find((opt) => opt.value === "tpo_with_od");
    if (odMatch) effectiveValue = "tpo_with_od";
  }

  const normalized = effectiveValue.toLowerCase().replace(/[\s_-]+/g, "_");
  const match = coverTypeOptions.find((opt) => {
    const optNorm = opt.value.toLowerCase().replace(/[\s_-]+/g, "_");
    return opt.value === effectiveValue || optNorm === normalized;
  });

  if (match?.accountingLines && match.accountingLines.length > 0) return match.accountingLines;
  if (match) return [{ key: match.value, label: match.label }];
  return fallback;
}

// --- Entity badge (read-only) ---
function EntityBadge({ icon: Icon, label, name }: { icon: React.ElementType; label: string; name: string | null }) {
  if (!name) return null;
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <Icon className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
      <span className="text-neutral-500 dark:text-neutral-400">{label}:</span>
      <span className="font-medium text-neutral-700 dark:text-neutral-300">{name}</span>
    </div>
  );
}

// --- Line editor ---
function LineEditor({
  fields,
  lineKey,
  lineLabel,
  initialValues,
  initialInsurerId,
  initialCollabId,
  availableInsurers,
  availableCollabs,
  onSave,
  onCancel,
  saving,
}: {
  fields: FieldDef[];
  lineKey: string;
  lineLabel: string;
  initialValues: Record<string, unknown>;
  initialInsurerId: number | null;
  initialCollabId: number | null;
  availableInsurers: EntityOption[];
  availableCollabs: EntityOption[];
  onSave: (lineKey: string, lineLabel: string, values: Record<string, unknown>, insurerId: number | null, collabId: number | null) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [values, setValues] = React.useState<Record<string, unknown>>({ ...initialValues });
  const [insurerId, setInsurerId] = React.useState<number | null>(initialInsurerId);
  const [collabId, setCollabId] = React.useState<number | null>(initialCollabId);

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
          <Button size="sm" onClick={() => onSave(lineKey, lineLabel, values, insurerId, collabId)} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            Save
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="space-y-3">
          {/* Entity pickers */}
          <div className="space-y-2 rounded-md bg-neutral-50 p-2.5 dark:bg-neutral-900/50">
            <div>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                <Users className="h-3 w-3" /> Collaborator
              </label>
              <select
                className="mt-1 h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                value={collabId ?? ""}
                onChange={(e) => setCollabId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— Select —</option>
                {availableCollabs.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                <Building2 className="h-3 w-3" /> Insurance Company
              </label>
              <select
                className="mt-1 h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                value={insurerId ?? ""}
                onChange={(e) => setInsurerId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— Select —</option>
                {availableInsurers.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          </div>

          <Separator />

          {/* Dynamic accounting fields */}
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

      {/* Entity associations */}
      {(line.insurerName || line.collaboratorName) && (
        <div className="space-y-0.5 border-b border-neutral-100 px-3 py-1.5 dark:border-neutral-800">
          <EntityBadge icon={Users} label="Collaborator" name={line.collaboratorName} />
          <EntityBadge icon={Building2} label="Insurer" name={line.insurerName} />
        </div>
      )}

      <div className="px-3 py-1">
        {!hasData && !line.insurerName ? (
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
  const [availableInsurers, setAvailableInsurers] = React.useState<EntityOption[]>([]);
  const [availableCollabs, setAvailableCollabs] = React.useState<EntityOption[]>([]);
  type EntityHint = { insurerId: number | null; insurerName: string | null; collabId: number | null; collabName: string | null };
  const [snapshotEntities, setSnapshotEntities] = React.useState<Record<string, EntityHint>>({});
  const [loading, setLoading] = React.useState(true);
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const editingInitialSnapshotRef = React.useRef<{
    values: Record<string, unknown>;
    insurerId: number | null;
    collaboratorId: number | null;
  } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/premiums`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      setFields(json.fields ?? []);
      setLines(json.lines ?? []);
      setCoverTypeOptions(json.coverTypeOptions ?? []);
      setAvailableInsurers(json.availableInsurers ?? []);
      setAvailableCollabs(json.availableCollabs ?? []);
      setSnapshotEntities(json.snapshotEntities ?? {});
    } catch {
      setFields([]);
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  React.useEffect(() => { void load(); }, [load]);

  const expectedTemplates = React.useMemo(
    () => resolveTemplates(coverTypeOptions, policyExtra),
    [coverTypeOptions, policyExtra],
  );

  const displayLines = React.useMemo(() => {
    const result: LineData[] = [];
    const hasOdHint = "od" in snapshotEntities;
    const hintForLine = (lineKey: string, lineLabel: string, idx: number): EntityHint => {
      const k = (lineKey + lineLabel).toLowerCase().replace(/[^a-z]/g, "");
      let isOd = k.includes("owndamage") || k.includes("ownvehicle");
      if (!isOd && idx > 0 && hasOdHint) isOd = true;
      const hint = snapshotEntities[isOd ? "od" : "main"] ?? snapshotEntities["main"];
      return hint ?? { insurerId: null, insurerName: null, collabId: null, collabName: null };
    };
    let templateIdx = 0;
    for (const tmpl of expectedTemplates) {
      const existing = lines.find((l) => l.lineKey === tmpl.key);
      if (existing) {
        result.push({ ...existing, lineLabel: tmpl.label });
      } else {
        const emptyValues: Record<string, unknown> = {};
        for (const f of fields) emptyValues[f.key] = null;
        const entities = hintForLine(tmpl.key, tmpl.label, templateIdx);
        result.push({
          lineKey: tmpl.key, lineLabel: tmpl.label, values: emptyValues,
          margin: null, updatedAt: null,
          insurerId: entities.insurerId,
          insurerName: entities.insurerName,
          collaboratorId: entities.collabId,
          collaboratorName: entities.collabName,
        });
      }
      templateIdx++;
    }
    for (const line of lines) {
      if (result.some((r) => r.lineKey === line.lineKey)) continue;
      const hasPremiumData = Object.entries(line.values).some(
        ([k, v]) => k !== "currency" && v !== null && v !== undefined && v !== "" && v !== 0,
      ) || line.insurerId !== null || line.collaboratorId !== null;
      if (hasPremiumData) result.push(line);
    }
    return result;
  }, [expectedTemplates, lines, fields, snapshotEntities]);

  async function handleSave(lineKey: string, lineLabel: string, values: Record<string, unknown>, insurerId: number | null, collabId: number | null) {
    const snap = editingInitialSnapshotRef.current;
    if (snap) {
      const current = {
        values: formSnapshot(values),
        insurerId,
        collaboratorId: collabId,
      };
      const initial = {
        values: snap.values,
        insurerId: snap.insurerId,
        collaboratorId: snap.collaboratorId,
      };
      if (deepEqual(current, initial)) {
        toast.info("No changes to save");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/premiums`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineKey, lineLabel, values, insurerId, collaboratorId: collabId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      toast.success("Saved");
      editingInitialSnapshotRef.current = null;
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

  if (editingKey !== null) {
    const line = displayLines.find((l) => l.lineKey === editingKey);
    if (!line) {
      editingInitialSnapshotRef.current = null;
      setEditingKey(null);
      return null;
    }
    return (
      <LineEditor
        fields={fields}
        lineKey={line.lineKey}
        lineLabel={line.lineLabel}
        initialValues={line.values}
        initialInsurerId={line.insurerId}
        initialCollabId={line.collaboratorId}
        availableInsurers={availableInsurers}
        availableCollabs={availableCollabs}
        onSave={handleSave}
        onCancel={() => {
          editingInitialSnapshotRef.current = null;
          setEditingKey(null);
        }}
        saving={saving}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Accounting</div>

      {displayLines.map((line) => (
        <LineView
          key={line.lineKey}
          line={line}
          fields={fields}
          canEdit={canEdit}
          onEdit={() => {
            editingInitialSnapshotRef.current = {
              values: formSnapshot(line.values),
              insurerId: line.insurerId,
              collaboratorId: line.collaboratorId,
            };
            setEditingKey(line.lineKey);
          }}
        />
      ))}

      {displayLines.length > 1 && (() => {
        const currency = (typeof displayLines[0]?.values?.currency === "string" && displayLines[0].values.currency) || "HKD";

        const currencyFields = fields.filter((f) => f.inputType === "currency");
        const percentFields = fields.filter((f) => f.inputType === "percent");
        const sumField = (key: string) => {
          let total = 0;
          let found = false;
          for (const l of displayLines) {
            const v = Number(l.values[key]);
            if (Number.isFinite(v)) { total += v; found = true; }
          }
          return found ? total : null;
        };

        const totals = currencyFields.map((f) => ({
          key: f.key,
          label: f.label,
          total: sumField(f.key),
        })).filter((t) => t.total !== null);

        let totalMargin = 0;
        let hasMargin = false;
        for (const l of displayLines) {
          if (l.margin !== null) { totalMargin += l.margin; hasMargin = true; }
        }

        if (totals.length === 0 && !hasMargin) return null;
        return (
          <div className="rounded-md border border-neutral-700 bg-neutral-900 dark:border-neutral-300 dark:bg-neutral-50">
            <div className="border-b border-neutral-600 px-3 py-2 dark:border-neutral-200">
              <span className="text-xs font-semibold text-neutral-100 dark:text-neutral-800">Total Premium</span>
            </div>
            <div className="px-3 py-1 [&>div>span:first-child]:text-neutral-400! dark:[&>div>span:first-child]:text-neutral-500!">
              {totals.map((t, idx) => (
                <React.Fragment key={t.key}>
                  {idx > 0 && <Separator className="my-0.5 bg-neutral-700 dark:bg-neutral-300" />}
                  <SummaryRow label={t.label} value={fmtCurrency(t.total, currency)} className="text-white! dark:text-black! font-semibold" />
                </React.Fragment>
              ))}
              {hasMargin && (
                <>
                  {totals.length > 0 && <Separator className="my-0.5 bg-neutral-700 dark:bg-neutral-300" />}
                  <SummaryRow
                    label="Total Margin"
                    value={fmtCurrency(totalMargin, currency)}
                    className={totalMargin >= 0 ? "text-green-400! dark:text-green-600! font-bold" : "text-red-400! dark:text-red-600! font-bold"}
                  />
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
