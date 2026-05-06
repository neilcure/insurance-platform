"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { deepEqual, formSnapshot } from "@/lib/form-utils";
import { Building2, ChevronDown, ChevronRight, ExternalLink, Loader2, Pencil, Save, User, Users, X } from "lucide-react";
import { FieldEditDialog, type EditField } from "@/components/ui/field-edit-dialog";
import dynamic from "next/dynamic";

const PolicyDetailsDrawer = dynamic(
  () => import("@/components/policies/PolicyDetailsDrawer").then((m) => m.PolicyDetailsDrawer),
);
const PaymentSection = React.lazy(() =>
  import("@/components/policies/tabs/PaymentSection").then((m) => ({ default: m.PaymentSection })),
);

type FieldDef = {
  key: string;
  label: string;
  inputType: string;
  sortOrder: number;
  groupOrder?: number;
  groupName?: string;
  options?: Array<{ value: string; label: string }>;
  premiumColumn?: string;
  // Optional currency formatting hints from the admin field config.
  // Used so a formula field whose result is a monetary amount (e.g. Agent
  // Commission) renders as currency rather than a bare number.
  currencyCode?: string;
  decimals?: number;
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

const fmtCurrency = (val: unknown, currency: string, decimals = 2): string => {
  const n = Number(val);
  if (!Number.isFinite(n)) return "—";
  return `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
};

function formatDisplayValue(val: unknown, field: FieldDef, currency: string): string {
  if (val === null || val === undefined || val === "") return "—";
  if (field.inputType === "currency" || field.inputType === "negative_currency") return fmtCurrency(val, currency);
  // Formula fields whose admin config sets `currencyCode` render as
  // currency. The DB column (e.g. agentCommissionCents) already stores
  // the value in the line's currency, so we keep the line's currency
  // unless the field overrides it explicitly. Decimals fall back to the
  // standard 2 when not specified.
  if (field.inputType === "formula" && field.currencyCode) {
    const code = (field.currencyCode || currency || "HKD").toUpperCase();
    const decimals = typeof field.decimals === "number" ? field.decimals : 2;
    return fmtCurrency(val, code, decimals);
  }
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

/**
 * Returns "(a)", "(b)", etc. for TPO+OD multi-line policies so each line
 * gets a distinct policy-number suffix (HK motor-insurance convention).
 */
function policyNumberForLine(
  policyNumber: string,
  lineKey: string,
  lineIndex: number,
  totalLines: number,
  isTpoWithOd: boolean,
): string {
  if (!isTpoWithOd || totalLines < 2) return policyNumber;
  const suffix = String.fromCharCode(97 + lineIndex); // a, b, c …
  return `${policyNumber}(${suffix})`;
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

  const currency = typeof values.currency === "string" && values.currency ? values.currency : "HKD";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Edit — {lineLabel}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving} title="Cancel">
            <X className="h-3 w-3 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
          <Button size="sm" onClick={() => onSave(lineKey, lineLabel, values, insurerId, collabId)} disabled={saving} title="Save">
            {saving ? <Loader2 className="h-3 w-3 animate-spin sm:hidden lg:inline" /> : <Save className="h-3 w-3 sm:hidden lg:inline" />}
            <span className="hidden sm:inline">Save</span>
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

            if (f.inputType === "number" || f.inputType === "currency" || f.inputType === "negative_currency" || f.inputType === "percent") {
              const maxDecimals = f.inputType === "currency" || f.inputType === "negative_currency" ? 2 : f.inputType === "percent" ? 2 : undefined;
              return (
                <div key={f.key}>
                  <label className="text-xs text-neutral-600 dark:text-neutral-300">{f.label}</label>
                  <div className="mt-1 flex items-center gap-2">
                    {(f.inputType === "currency" || f.inputType === "negative_currency") && (
                      <span className="shrink-0 text-xs font-medium text-neutral-500 dark:text-neutral-400">{currency}</span>
                    )}
                    <Input
                      type="number"
                      step={f.inputType === "currency" || f.inputType === "negative_currency" || f.inputType === "percent" ? "0.01" : "any"}
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

        </div>
      </div>
    </div>
  );
}

// --- Read-only view of one line ---
function LineView({ line, fields, canEdit, onEdit, displayPolicyNumber }: { line: LineData; fields: FieldDef[]; canEdit: boolean; onEdit: () => void; displayPolicyNumber?: string }) {
  const currency = (typeof line.values.currency === "string" && line.values.currency) || "HKD";
  const hasData = Object.values(line.values).some((v) => v !== null && v !== undefined && v !== "");

  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{line.lineLabel}</span>
          {displayPolicyNumber && (
            <span className="text-[10px] font-mono text-neutral-500 dark:text-neutral-400">
              Policy No: {displayPolicyNumber}
            </span>
          )}
        </div>
        {canEdit && (
          <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px]" onClick={onEdit} title="Edit">
            <Pencil className="h-3 w-3 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Edit</span>
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
            {fields.filter((f) => {
              const v = line.values[f.key];
              if (v === null || v === undefined || v === "") return false;
              if (v === 0 && (f.inputType === "currency" || f.inputType === "negative_currency")) return false;
              return true;
            }).map((f, idx) => (
              <React.Fragment key={f.key}>
                {idx > 0 && <Separator className="my-0.5" />}
                <SummaryRow label={f.label} value={formatDisplayValue(line.values[f.key], f, currency)} className={f.inputType === "negative_currency" ? "text-red-600 dark:text-red-400" : undefined} />
              </React.Fragment>
            ))}
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


// --- Accounting flow record view ---
type PremiumContext = "policy" | "collaborator" | "insurer" | "client" | "agent" | "self";

type EntityHintMap = Record<string, { insurerId: number | null; insurerName: string | null; collabId: number | null; collabName: string | null }>;

type AccountingRecord = {
  recordId: number;
  recordNumber: string;
  flowKey: string;
  fields: { key: string; label: string; value: unknown }[];
  createdAt: string;
  linkedPolicyNumber?: string;
  isActive?: boolean;
  entities?: EntityHintMap;
};

type SectionEntities = {
  collabName: string | null;
  insurerName: string | null;
  agentName: string | null;
};

type SectionData = {
  label: string;
  policyNumber: string | null;
  entities: SectionEntities;
  fields: { def: FieldDef; value: unknown }[];
};

const isPdField = (f: FieldDef) => {
  const l = f.label.toLowerCase();
  const k = f.key.toLowerCase();
  return l.includes("(pd)") || l.includes("(od)") || k.endsWith("pd") || k.endsWith("od")
    || k.includes("owndamage") || k.includes("ownvehicle");
};

function AccountingSection({ section, currency }: { section: SectionData; currency: string }) {
  const hasEntities = !!section.entities.collabName || !!section.entities.insurerName || !!section.entities.agentName;

  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{section.label}</div>
        {section.policyNumber && (
          <div className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
            Policy No: {section.policyNumber}
          </div>
        )}
      </div>

      {hasEntities && (
        <div className="space-y-0.5 border-b border-neutral-100 px-3 py-1.5 dark:border-neutral-800">
          {section.entities.collabName && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Users className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
              <span className="text-neutral-500 dark:text-neutral-400">Collaborator:</span>
              <span className="font-medium text-neutral-700 dark:text-neutral-300">{section.entities.collabName}</span>
            </div>
          )}
          {section.entities.insurerName && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Building2 className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
              <span className="text-neutral-500 dark:text-neutral-400">Insurer:</span>
              <span className="font-medium text-neutral-700 dark:text-neutral-300">{section.entities.insurerName}</span>
            </div>
          )}
          {section.entities.agentName && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <User className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
              <span className="text-neutral-500 dark:text-neutral-400">Agent:</span>
              <span className="font-medium text-neutral-700 dark:text-neutral-300">{section.entities.agentName}</span>
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-1">
        {section.fields.length === 0 ? (
          <div className="py-3 text-center text-xs text-neutral-400 dark:text-neutral-500">—</div>
        ) : (
          section.fields.map((f) => (
            <div key={f.def.key} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-neutral-500 dark:text-neutral-400">{f.def.label}</span>
              <span className={`text-sm font-medium tabular-nums ${f.def.inputType === "negative_currency" ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-100"}`}>
                {formatDisplayValue(f.value, f.def, currency)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AccountingRecordView({
  record, allFields, snapshotEntities, agentName, policyNumber, expectedTemplates, premiumContext, canEdit = false, onEdit,
}: {
  record: AccountingRecord;
  allFields: FieldDef[];
  snapshotEntities: Record<string, { insurerId: number | null; insurerName: string | null; collabId: number | null; collabName: string | null }>;
  agentName: string | null;
  policyNumber?: string;
  expectedTemplates: { key: string; label: string }[];
  premiumContext?: PremiumContext;
  canEdit?: boolean;
  onEdit?: (record: AccountingRecord) => void;
}) {
  const valMap = new Map(record.fields.map((f) => [f.key, f.value]));
  const currency = (typeof valMap.get("currency") === "string" && valMap.get("currency")) || "HKD";

  const displayPolNum = record.linkedPolicyNumber ?? policyNumber;

  const entitySource = record.entities ?? snapshotEntities;
  const mainHint = entitySource["main"] ?? { collabName: null, insurerName: null };
  const odHint = entitySource["od"] ?? { collabName: null, insurerName: null };

  const mainFields: { def: FieldDef; value: unknown }[] = [];
  const pdFields: { def: FieldDef; value: unknown }[] = [];

  for (const f of allFields) {
    const v = valMap.get(f.key);
    if (v === undefined || v === null || v === "") continue;
    const isCurrency = f.inputType === "currency" || f.inputType === "negative_currency";
    if (isCurrency && Number(v) === 0) continue;
    if (isPdField(f)) {
      pdFields.push({ def: f, value: v });
    } else {
      mainFields.push({ def: f, value: v });
    }
  }

  const hasPdSection = pdFields.length > 0;

  const mainLabel = expectedTemplates[0]?.label ?? "Third Party";
  const pdLabel = expectedTemplates[1]?.label ?? "Own Vehicle Damage";

  const isTpoOd = expectedTemplates.length >= 2;
  const mainPolNum = displayPolNum
    ? (isTpoOd ? `${displayPolNum}(a)` : displayPolNum)
    : null;
  const pdPolNum = displayPolNum && isTpoOd ? `${displayPolNum}(b)` : null;

  const showEntities = premiumContext !== "collaborator" && premiumContext !== "insurer";

  const sections: SectionData[] = [
    {
      label: mainLabel,
      policyNumber: mainPolNum,
      entities: showEntities
        ? { collabName: mainHint.collabName, insurerName: mainHint.insurerName, agentName: null }
        : { collabName: null, insurerName: null, agentName: null },
      fields: mainFields,
    },
  ];

  if (hasPdSection) {
    sections.push({
      label: pdLabel,
      policyNumber: pdPolNum,
      entities: showEntities
        ? { collabName: odHint.collabName, insurerName: odHint.insurerName, agentName: null }
        : { collabName: null, insurerName: null, agentName: null },
      fields: pdFields,
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && onEdit && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 text-[11px]"
            onClick={() => onEdit(record)}
            title="Edit"
          >
            <Pencil className="h-3 w-3 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        </div>
      )}

      {agentName && (
        <div className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-2 text-[11px] dark:border-neutral-800">
          <User className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
          <span className="text-neutral-500 dark:text-neutral-400">Agent:</span>
          <span className="font-medium text-neutral-700 dark:text-neutral-300">{agentName}</span>
        </div>
      )}

      {sections.map((s) => (
        <AccountingSection key={s.label} section={s} currency={currency as string} />
      ))}
    </div>
  );
}


function deriveRecordType(flowKey: string): { label: string; borderClass: string; badgeClass: string; accentBorder: string } {
  const fk = flowKey.toLowerCase();
  if (fk === "endorsement") {
    return {
      label: "Endorsement",
      borderClass: "border-amber-400/60 dark:border-amber-500/40",
      badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
      accentBorder: "border-amber-300 dark:border-amber-600/40",
    };
  }
  if (fk === "policyset") {
    return {
      label: "Policy Premium",
      borderClass: "border-sky-400/60 dark:border-sky-500/40",
      badgeClass: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
      accentBorder: "border-sky-300 dark:border-sky-600/40",
    };
  }
  return {
    label: "Premium Record",
    borderClass: "border-neutral-300 dark:border-neutral-700",
    badgeClass: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
    accentBorder: "border-neutral-200 dark:border-neutral-800",
  };
}

function CollapsibleRecord({
  record,
  premiumContext,
  onPolicyClick,
  children,
}: {
  record: { recordId: number; recordNumber: string; flowKey: string; linkedPolicyNumber?: string; isActive?: boolean };
  premiumContext?: PremiumContext;
  onPolicyClick?: (policyId: number) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  const showPolicyBadge = !!record.linkedPolicyNumber && premiumContext !== "policy" && premiumContext !== "self";
  const canClick = !!onPolicyClick && premiumContext !== "policy" && premiumContext !== "self";
  const isActive = record.isActive !== false;
  const rt = deriveRecordType(record.flowKey);

  const linkColor = isActive
    ? "text-green-600 hover:text-green-500 dark:text-green-400 dark:hover:text-green-300"
    : "text-neutral-400 hover:text-neutral-300 dark:text-neutral-500 dark:hover:text-neutral-400";

  return (
    <div className={`rounded-md border-2 ${rt.borderClass}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-left hover:opacity-80"
        >
          {open
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
        </button>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${rt.badgeClass}`}>
          {rt.label}
        </span>
        {canClick ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPolicyClick(record.recordId); }}
            className={`group flex items-center gap-1 font-mono text-xs font-medium ${linkColor}`}
            title="Open policy details"
          >
            {record.recordNumber}
            <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          <span className="font-mono text-xs font-medium text-neutral-600 dark:text-neutral-300">{record.recordNumber}</span>
        )}
        {showPolicyBadge && !canClick && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            Policy: {record.linkedPolicyNumber}
          </span>
        )}
      </div>
      {open && (
        <div className={`border-t ${rt.accentBorder} px-3 py-2`}>
          {children}
        </div>
      )}
    </div>
  );
}

// --- Payment Status Card (renders PaymentSection inside a premium-style card) ---
function PaymentStatusCard({ policyId, canEdit, endorsementPolicyIds }: { policyId: number; canEdit: boolean; endorsementPolicyIds?: number[] }) {
  const [open, setOpen] = React.useState(false);
  const [summary, setSummary] = React.useState<{
    totalOwed: number; totalPaid: number; totalPending: number;
    remaining: number; currency: string; invoiceCount: number; hasSubmitted: boolean;
    agentOwed?: number; agentPaid?: number; commissionCents?: number;
  } | null>(null);

  if (summary && summary.invoiceCount === 0) return null;

  const fmtCur = (cents: number, cur = "HKD") =>
    new Intl.NumberFormat("en-HK", { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(cents / 100);

  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <span>Payment Status</span>
          {summary && summary.invoiceCount > 0 && (
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              summary.remaining <= 0
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
            }`}>
              {summary.remaining <= 0 ? "Fully Paid" : `${fmtCur(summary.remaining, summary.currency)} outstanding`}
            </span>
          )}
          {summary?.hasSubmitted && (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              pending review
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          {summary && summary.invoiceCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] font-normal text-neutral-500">
              <span className="text-emerald-600 dark:text-emerald-400">{fmtCur(summary.totalPaid, summary.currency)} / {fmtCur(summary.totalOwed, summary.currency)}</span>
              {canEdit && summary.agentOwed != null && summary.agentOwed > 0 && (
                <span className="text-blue-600 dark:text-blue-400">
                  {fmtCur(summary.agentPaid ?? 0, summary.currency)} / {fmtCur(summary.agentOwed, summary.currency)}
                </span>
              )}
              {canEdit && summary.commissionCents != null && summary.commissionCents > 0 && (
                <span className="text-yellow-600 dark:text-yellow-400">
                  {fmtCur(summary.commissionCents, summary.currency)}
                </span>
              )}
            </span>
          )}
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-neutral-200 dark:border-neutral-700 p-3">
          <PaymentSection
            policyId={policyId}
            isAdmin={canEdit}
            onSummaryChange={setSummary}
            endorsementPolicyIds={endorsementPolicyIds}
          />
        </div>
      )}
    </div>
  );
}

// --- Main AccountingTab ---
export function AccountingTab({
  policyId,
  policyNumber,
  canEdit,
  policyExtra,
  onUpdate,
  context = "policy",
}: {
  policyId: number;
  policyNumber?: string;
  canEdit: boolean;
  policyExtra?: Record<string, unknown> | null;
  onUpdate?: () => void;
  context?: PremiumContext;
}) {
  const [fields, setFields] = React.useState<FieldDef[]>([]);
  const [lines, setLines] = React.useState<LineData[]>([]);
  const [accountingRecords, setAccountingRecords] = React.useState<AccountingRecord[]>([]);
  const [coverTypeOptions, setCoverTypeOptions] = React.useState<CoverTypeOption[]>([]);
  const [availableInsurers, setAvailableInsurers] = React.useState<EntityOption[]>([]);
  const [availableCollabs, setAvailableCollabs] = React.useState<EntityOption[]>([]);
  type EntityHint = { insurerId: number | null; insurerName: string | null; collabId: number | null; collabName: string | null };
  const [snapshotEntities, setSnapshotEntities] = React.useState<Record<string, EntityHint>>({});
  const [agentName, setAgentName] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const editingInitialSnapshotRef = React.useRef<{
    values: Record<string, unknown>;
    insurerId: number | null;
    collaboratorId: number | null;
  } | null>(null);

  const [drawerPolicyId, setDrawerPolicyId] = React.useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const openPolicyDrawer = React.useCallback((id: number) => {
    setDrawerPolicyId(id);
    requestAnimationFrame(() => setDrawerOpen(true));
  }, []);

  const closePolicyDrawer = React.useCallback(() => {
    setDrawerOpen(false);
    setTimeout(() => setDrawerPolicyId(null), 400);
  }, []);

  const entityOptionsRef = React.useRef<{ loaded: boolean; loading: boolean }>({ loaded: false, loading: false });
  const ensureEntityOptions = React.useCallback(async (): Promise<boolean> => {
    if (entityOptionsRef.current.loaded) return true;
    if (entityOptionsRef.current.loading) return false;
    entityOptionsRef.current.loading = true;
    try {
      const res = await fetch("/api/premium-entity-options", { cache: "no-store" });
      if (!res.ok) return false;
      const json = await res.json();
      setAvailableInsurers(json.availableInsurers ?? []);
      setAvailableCollabs(json.availableCollabs ?? []);
      entityOptionsRef.current.loaded = true;
      return true;
    } catch { return false; }
    finally { entityOptionsRef.current.loading = false; }
  }, []);

  const [recEditOpen, setRecEditOpen] = React.useState(false);
  const [recEditRecord, setRecEditRecord] = React.useState<AccountingRecord | null>(null);
  const [recEditFields, setRecEditFields] = React.useState<EditField[]>([]);
  const [recEditValues, setRecEditValues] = React.useState<Record<string, unknown>>({});
  const [recEditSaving, setRecEditSaving] = React.useState(false);

  function openRecordEdit(record: AccountingRecord) {
    const editFields: EditField[] = fields.map((f) => ({
      key: f.key,
      label: f.label,
      inputType: f.inputType,
      sortOrder: f.sortOrder,
      groupOrder: f.groupOrder,
      groupName: f.groupName,
      options: f.options,
    }));
    const vals: Record<string, unknown> = {};
    for (const f of fields) {
      const rf = record.fields.find((rf) => rf.key === f.key);
      vals[f.key] = rf?.value ?? (f.inputType === "boolean" ? false : "");
    }
    setRecEditRecord(record);
    setRecEditFields(editFields);
    setRecEditValues(vals);
    setRecEditOpen(true);
  }

  async function saveRecordEdit() {
    if (!recEditRecord) return;
    setRecEditSaving(true);
    try {
      const pkgKey = "premiumRecord";
      const prefixed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(recEditValues)) {
        prefixed[`${pkgKey}__${k}`] = v;
      }
      const res = await fetch(`/api/policies/${recEditRecord.recordId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packagesSnapshot: { [pkgKey]: { values: prefixed } },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Premium record updated");
      setRecEditOpen(false);
      setRecEditRecord(null);
      await load();
      onUpdate?.();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Failed to save");
    } finally {
      setRecEditSaving(false);
    }
  }

  const abortRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/premiums?context=${encodeURIComponent(context)}`, { cache: "no-store", signal });
      if (signal?.aborted) return;
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      if (signal?.aborted) return;
      setFields(json.fields ?? []);
      setLines(json.lines ?? []);
      setAccountingRecords(json.accountingRecords ?? []);
      setCoverTypeOptions(json.coverTypeOptions ?? []);
      setSnapshotEntities(json.snapshotEntities ?? {});
      setAgentName(json.agentName ?? null);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setFields([]);
      setLines([]);
      setAccountingRecords([]);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [policyId, context]);

  React.useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const hasAccountingRecords = accountingRecords.length > 0;

  const endorsementPolicyIds = React.useMemo(() => {
    if (context !== "policy") return undefined;
    const ids = accountingRecords
      .filter((r) => r.flowKey.toLowerCase() === "endorsement" && r.recordId !== policyId)
      .map((r) => r.recordId);
    return ids.length > 0 ? ids : undefined;
  }, [accountingRecords, context, policyId]);

  const expectedTemplates = React.useMemo(
    () => resolveTemplates(coverTypeOptions, policyExtra),
    [coverTypeOptions, policyExtra],
  );

  const isTpoWithOd = React.useMemo(() => {
    if (expectedTemplates.length < 2) return false;
    return new Set(expectedTemplates.map((t) => t.key)).size >= 2;
  }, [expectedTemplates]);

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
        const entities = hintForLine(tmpl.key, tmpl.label, templateIdx);
        result.push({
          ...existing,
          lineLabel: tmpl.label,
          insurerId: existing.insurerId ?? entities.insurerId,
          insurerName: existing.insurerName ?? entities.insurerName,
          collaboratorId: existing.collaboratorId ?? entities.collabId,
          collaboratorName: existing.collaboratorName ?? entities.collabName,
        });
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

      if (line.lineKey === "main" && expectedTemplates.length >= 2) {
        const emptyIndices = result
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => !lines.some((l) => l.lineKey === r.lineKey))
          .map(({ i }) => i);

        if (emptyIndices.length === 0) continue;

        if (emptyIndices.length >= 2) {
          const tpVals: Record<string, unknown> = {};
          const odVals: Record<string, unknown> = {};
          for (const f of fields) {
            const kLow = f.key.toLowerCase();
            const lLow = f.label.toLowerCase();
            const isPd = lLow.includes("(pd)") || lLow.includes("(od)")
              || kLow.endsWith("pd") || kLow.endsWith("od")
              || kLow.includes("owndamage") || kLow.includes("ownvehicle");
            if (isPd) {
              odVals[f.key] = line.values[f.key];
              tpVals[f.key] = null;
            } else {
              tpVals[f.key] = line.values[f.key];
              odVals[f.key] = null;
            }
          }
          const currencyVal = line.values.currency;
          if (currencyVal !== undefined) {
            tpVals.currency = currencyVal;
            odVals.currency = currencyVal;
          }
          result[emptyIndices[0]] = { ...result[emptyIndices[0]], values: tpVals, updatedAt: line.updatedAt };
          result[emptyIndices[1]] = { ...result[emptyIndices[1]], values: odVals, updatedAt: line.updatedAt };
        } else {
          result[emptyIndices[0]] = { ...result[emptyIndices[0]], values: { ...line.values }, updatedAt: line.updatedAt };
        }
        continue;
      }

      const hasPremiumData = Object.entries(line.values).some(
        ([k, v]) => k !== "currency" && v !== null && v !== undefined && v !== "" && v !== 0,
      ) || line.insurerId !== null || line.collaboratorId !== null;
      if (hasPremiumData) result.push(line);
    }
    return result;
  }, [expectedTemplates, lines, fields, snapshotEntities]);

  const mergedRecords = React.useMemo(() => {
    if (!hasAccountingRecords) return [];
    const result: AccountingRecord[] = [];
    const accountingRecordIds = new Set(accountingRecords.map((r) => r.recordId));
    if (context === "policy" && displayLines.length > 0 && !accountingRecordIds.has(policyId)) {
      const lineFields: { key: string; label: string; value: unknown }[] = [];
      for (const line of displayLines) {
        for (const f of fields) {
          if (lineFields.some((lf) => lf.key === f.key)) continue;
          const v = line.values[f.key];
          if (v !== null && v !== undefined && v !== "") {
            lineFields.push({ key: f.key, label: f.label, value: v });
          }
        }
      }
      if (lineFields.length > 0) {
        result.push({
          recordId: policyId,
          recordNumber: policyNumber ?? `#${policyId}`,
          flowKey: "policyset",
          fields: lineFields,
          createdAt: "",
          isActive: true,
        });
      }
    }
    result.push(...accountingRecords);
    return result;
  }, [hasAccountingRecords, accountingRecords, context, displayLines, policyId, policyNumber, fields]);

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

  if (fields.length === 0 && accountingRecords.length === 0) {
    const msg = (context !== "policy" && context !== "self")
      ? "No premium records found for this entity."
      : "No accounting fields configured.";
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <div className="text-sm text-neutral-500 dark:text-neutral-400">{msg}</div>
        {(context === "policy" || context === "self") && (
          <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
            Create a <span className="font-medium">premiumRecord</span> package in Admin &rarr; Policy Settings &rarr; Packages, then add fields to it.
          </div>
        )}
      </div>
    );
  }

  if (mergedRecords.length > 0) {
    const activeRecords = mergedRecords.filter((r) => r.isActive !== false);
    const visibleRecords = activeRecords.length > 0 ? activeRecords : mergedRecords;

    return (
      <div className="space-y-3">
        {visibleRecords.map((rec, idx) => (
          <CollapsibleRecord key={`${rec.recordId}-${idx}`} record={rec} premiumContext={context} onPolicyClick={openPolicyDrawer}>
            <AccountingRecordView
              record={rec}
              allFields={fields}
              snapshotEntities={snapshotEntities}
              agentName={agentName}
              policyNumber={policyNumber}
              expectedTemplates={expectedTemplates}
              premiumContext={context}
              canEdit={canEdit}
              onEdit={openRecordEdit}
            />
          </CollapsibleRecord>
        ))}

        {visibleRecords.length > 1 && (() => {
          const currency = "HKD";
          const currencyFields = fields.filter((f) => f.inputType === "currency" || f.inputType === "negative_currency");
          const sumField = (key: string) => {
            let total = 0;
            let found = false;
            for (const rec of visibleRecords) {
              const fld = rec.fields.find((f) => f.key === key);
              if (fld) {
                const v = Number(fld.value);
                if (Number.isFinite(v)) { total += v; found = true; }
              }
            }
            return found ? total : null;
          };
          const totals = currencyFields
            .map((f) => ({ key: f.key, label: f.label, total: sumField(f.key) }))
            .filter((t) => t.total !== null && t.total !== 0);
          if (totals.length === 0) return null;
          return (
            <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-700">
              <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1">Total</div>
              {totals.map((t) => (
                <div key={t.key} className="flex items-center justify-between py-1">
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{t.label}</span>
                  <span className="text-sm font-bold tabular-nums text-neutral-900 dark:text-neutral-100">{fmtCurrency(t.total, currency)}</span>
                </div>
              ))}
            </div>
          );
        })()}

        <FieldEditDialog
          open={recEditOpen}
          onOpenChange={setRecEditOpen}
          title={`Edit Premium — ${recEditRecord?.recordNumber ?? ""}`}
          fields={recEditFields}
          values={recEditValues}
          onValuesChange={setRecEditValues}
          saving={recEditSaving}
          onSave={saveRecordEdit}
        />

        {(context === "policy" || context === "self") && (
          <React.Suspense fallback={<div className="py-2 text-center text-xs text-neutral-400">Loading payment info...</div>}>
            <PaymentStatusCard policyId={policyId} canEdit={canEdit} endorsementPolicyIds={endorsementPolicyIds} />
          </React.Suspense>
        )}

        <PolicyDetailsDrawer
          policyId={drawerPolicyId}
          open={drawerPolicyId !== null}
          drawerOpen={drawerOpen}
          onClose={closePolicyDrawer}
          title="Policy Details"
          hideClientInfo={context === "client"}
        />
      </div>
    );
  }

  if (context !== "policy" && context !== "self" && !hasAccountingRecords) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <div className="text-sm text-neutral-500 dark:text-neutral-400">No premium records found.</div>
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
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Accounting</div>
      </div>

      {displayLines.map((line, idx) => {
        let viewFields = fields;
        if (isTpoWithOd && displayLines.length >= 2) {
          const pdNormLabels = new Set(
            fields.filter((f) => isPdField(f))
              .map((f) => f.label.replace(/\s*\((?:PD|OD|pd|od)\)\s*/gi, "").trim().toLowerCase()),
          );
          viewFields = fields.filter((f) => {
            if (isPdField(f)) return true;
            return pdNormLabels.has(f.label.trim().toLowerCase());
          });
        }
        return (
        <LineView
          key={line.lineKey}
          line={line}
          fields={viewFields}
          canEdit={canEdit}
          displayPolicyNumber={
            policyNumber && isTpoWithOd
              ? policyNumberForLine(policyNumber, line.lineKey, idx, displayLines.length, isTpoWithOd)
              : undefined
          }
          onEdit={async () => {
            editingInitialSnapshotRef.current = {
              values: formSnapshot(line.values),
              insurerId: line.insurerId,
              collaboratorId: line.collaboratorId,
            };
            const ok = await ensureEntityOptions();
            if (ok) setEditingKey(line.lineKey);
            else toast.error("Failed to load entity options");
          }}
        />
        );
      })}

      {displayLines.length > 1 && (() => {
        const currency = (typeof displayLines[0]?.values?.currency === "string" && displayLines[0].values.currency) || "HKD";

        let currencyFields = fields.filter((f) => f.inputType === "currency" || f.inputType === "negative_currency");
        if (isTpoWithOd) {
          const pdNormLabels = new Set(
            currencyFields.filter((f) => isPdField(f))
              .map((f) => f.label.replace(/\s*\((?:PD|OD|pd|od)\)\s*/gi, "").trim().toLowerCase()),
          );
          currencyFields = currencyFields.filter((f) =>
            isPdField(f) || pdNormLabels.has(f.label.trim().toLowerCase()),
          );
        }
        const sumField = (key: string) => {
          let total = 0;
          let found = false;
          for (const l of displayLines) {
            const v = Number(l.values[key]);
            if (Number.isFinite(v)) { total += v; found = true; }
          }
          return found ? total : null;
        };

        const pairs = new Map<string, { label: string; keys: string[] }>();
        for (const f of currencyFields) {
          const normLabel = isPdField(f)
            ? f.label.replace(/\s*\((?:PD|OD|pd|od)\)\s*/gi, "").trim()
            : f.label;
          const existing = pairs.get(normLabel);
          if (existing) {
            existing.keys.push(f.key);
          } else {
            pairs.set(normLabel, { label: normLabel, keys: [f.key] });
          }
        }

        const totals: { key: string; label: string; total: number }[] = [];
        for (const [, { label, keys }] of pairs) {
          let total = 0;
          let found = false;
          for (const key of keys) {
            const v = sumField(key);
            if (v !== null) { total += v; found = true; }
          }
          if (found && total !== 0) totals.push({ key: keys[0], label, total });
        }

        if (totals.length === 0) return null;
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
            </div>
          </div>
        );
      })()}

      {(context === "policy" || context === "self") && (
        <React.Suspense fallback={<div className="py-2 text-center text-xs text-neutral-400">Loading payment info...</div>}>
          <PaymentStatusCard policyId={policyId} canEdit={canEdit} endorsementPolicyIds={endorsementPolicyIds} />
        </React.Suspense>
      )}
    </div>
  );
}
