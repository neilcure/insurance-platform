"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { deepEqual, formSnapshot } from "@/lib/form-utils";
import { Building2, ChevronDown, ChevronRight, Loader2, Pencil, Save, User, Users, X } from "lucide-react";
import { FieldEditDialog, type EditField } from "@/components/ui/field-edit-dialog";

type FieldDef = {
  key: string;
  label: string;
  inputType: string;
  sortOrder: number;
  groupOrder?: number;
  groupName?: string;
  options?: Array<{ value: string; label: string }>;
  premiumColumn?: string;
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


// --- Accounting flow record view ---
type PremiumContext = "policy" | "collaborator" | "insurer" | "client" | "agent" | "self";

type AccountingRecord = {
  recordId: number;
  recordNumber: string;
  flowKey: string;
  fields: { key: string; label: string; value: unknown }[];
  createdAt: string;
  linkedPolicyNumber?: string;
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
              <span className="text-sm font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
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

  const mainHint = snapshotEntities["main"] ?? { collabName: null, insurerName: null };
  const odHint = snapshotEntities["od"] ?? { collabName: null, insurerName: null };

  const mainFields: { def: FieldDef; value: unknown }[] = [];
  const pdFields: { def: FieldDef; value: unknown }[] = [];

  for (const f of allFields) {
    const v = valMap.get(f.key);
    if (v === undefined || v === null || v === "") continue;
    if (isPdField(f)) {
      pdFields.push({ def: f, value: v });
    } else {
      mainFields.push({ def: f, value: v });
    }
  }

  const hasPdSection = pdFields.length > 0 || odHint.collabName || odHint.insurerName;

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
            className="h-6 text-[11px]"
            onClick={() => onEdit(record)}
          >
            <Pencil className="mr-1 h-3 w-3" /> Edit
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


function CollapsibleRecord({
  record,
  premiumContext,
  children,
}: {
  record: { recordId: number; recordNumber: string; linkedPolicyNumber?: string };
  premiumContext?: PremiumContext;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  const showPolicyBadge = !!record.linkedPolicyNumber && premiumContext !== "policy" && premiumContext !== "self";

  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
        <span className="font-mono text-xs font-medium text-neutral-600 dark:text-neutral-300">{record.recordNumber}</span>
        {showPolicyBadge && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            Policy: {record.linkedPolicyNumber}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
          {children}
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

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/premiums?context=${encodeURIComponent(context)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      setFields(json.fields ?? []);
      setLines(json.lines ?? []);
      setAccountingRecords(json.accountingRecords ?? []);
      setCoverTypeOptions(json.coverTypeOptions ?? []);
      setSnapshotEntities(json.snapshotEntities ?? {});
      setAgentName(json.agentName ?? null);
    } catch {
      setFields([]);
      setLines([]);
      setAccountingRecords([]);
    } finally {
      setLoading(false);
    }
  }, [policyId, context]);

  React.useEffect(() => { void load(); }, [load]);

  const hasAccountingRecords = accountingRecords.length > 0;

  const expectedTemplates = React.useMemo(
    () => resolveTemplates(coverTypeOptions, policyExtra),
    [coverTypeOptions, policyExtra],
  );

  const isTpoWithOd = React.useMemo(() => {
    if (expectedTemplates.length < 2) return false;
    const keys = expectedTemplates.map((t) => t.key.toLowerCase());
    return keys.includes("tpo") && keys.some((k) => k.includes("own_vehicle") || k.includes("owndamage"));
  }, [expectedTemplates]);

  const displayLines = React.useMemo(() => {
    if (hasAccountingRecords) return [];
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
  }, [expectedTemplates, lines, fields, snapshotEntities, hasAccountingRecords]);

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

  // Accounting flow records take precedence over old premium lines
  if (hasAccountingRecords) {
    return (
      <div className="space-y-3">
        {accountingRecords.map((rec) => (
          <CollapsibleRecord key={rec.recordId} record={rec} premiumContext={context}>
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

        {accountingRecords.length > 1 && (() => {
          const currency = "HKD";
          const currencyFields = fields.filter((f) => f.inputType === "currency");
          const sumField = (key: string) => {
            let total = 0;
            let found = false;
            for (const rec of accountingRecords) {
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
            .filter((t) => t.total !== null);
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

      {displayLines.map((line, idx) => (
        <LineView
          key={line.lineKey}
          line={line}
          fields={fields}
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
      ))}

      {displayLines.length > 1 && (() => {
        const currency = (typeof displayLines[0]?.values?.currency === "string" && displayLines[0].values.currency) || "HKD";

        const currencyFields = fields.filter((f) => f.inputType === "currency");
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
