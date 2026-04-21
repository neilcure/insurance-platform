"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { usePolicyStatuses } from "@/hooks/use-policy-statuses";
import {
  FileText, Printer, ChevronLeft, Stamp, Download, Loader2,
  Mail, MessageCircle, CheckCircle2, Send, XCircle, X, Paperclip, Upload, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentStatusMap, DocumentStatusEntry } from "@/lib/types/accounting";
import { resolvePdfTemplateShowOn, type PdfTemplateRow, type PdfTemplateMeta } from "@/lib/types/pdf-template";
import type {
  DocumentTemplateMeta,
  DocumentTemplateRow,
  TemplateSection,
  TemplateFieldMapping,
} from "@/lib/types/document-template";
import { resolveDocumentTemplateShowOn } from "@/lib/types/document-template";
import type { PolicyDetail } from "@/lib/types/policy";
import {
  resolveRawValue,
  formatResolvedValue,
  type SnapshotData,
  type ResolveContext,
  type FieldRef,
  type DocTrackingEntry,
} from "@/lib/field-resolver";

function toTrackingKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const FALLBACK_POLICY_STATUS_ORDER = [
  "quotation_prepared",
  "quotation_sent",
  "quotation_confirmed",
  "invoice_prepared",
  "invoice_sent",
  "pending_payment",
  "payment_received",
  "commission_pending",
  "statement_created",
  "statement_sent",
  "statement_confirmed",
  "credit_advice_prepared",
  "credit_advice_sent",
  "credit_advice_confirmed",
  "commission_settled",
  "confirmed",
  "bound",
  "active",
  "completed",
] as const;

type ExtraDocContext = {
  statementData?: StatementDataForPreview | null;
  hasSchedule?: boolean;
  accountingLines?: AccountingLineForPreview[];
  clientData?: Record<string, unknown> | null;
  organisationData?: Record<string, unknown> | null;
  paymentData?: {
    latestClientPaidAmount?: number;
    latestClientPaidDate?: string | null;
    latestClientPaymentRef?: string | null;
  } | null;
};

type StatementDataForPreview = {
  statementNumber: string;
  statementDate: string | null;
  statementStatus: string;
  entityName: string | null;
  entityType: string;
  activeTotal: number;
  paidIndividuallyTotal: number;
  agentPaidTotal?: number;
  clientPaidTotal?: number;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  items: {
    description: string | null;
    amountCents: number;
    status: string;
    policyId: number;
    premiums?: Record<string, number>;
    paymentBadge?: string;
  }[];
  premiumTotals?: Record<string, number>;
  summaryTotals?: Record<string, number>;
};

type AccountingLineForPreview = {
  lineKey: string;
  lineLabel: string;
  /** Raw field values keyed by dynamic admin-configured field keys */
  values: Record<string, unknown>;
  margin: number | null;
  insurerName: string | null;
  collaboratorName: string | null;
};

function buildResolveContext(
  snapshot: SnapshotData,
  detail: PolicyDetail,
  extra?: ExtraDocContext,
  tracking?: Record<string, DocTrackingEntry> | null,
  currentDocTrackingKey?: string,
): ResolveContext {
  const ext = (detail.extraAttributes ?? {}) as Record<string, unknown>;
  return {
    policyNumber: detail.policyNumber,
    policyId: detail.policyId as number,
    createdAt: detail.createdAt,
    snapshot,
    policyExtra: ext,
    agent: detail.agent as Record<string, unknown> | null | undefined,
    client: extra?.clientData,
    organisation: extra?.organisationData,
    accountingLines: extra?.accountingLines,
    statementData: extra?.statementData,
    paymentData: extra?.paymentData,
    documentTracking: tracking,
    currentDocTrackingKey,
  };
}

function docFieldRef(section: TemplateSection, fieldKey: string): FieldRef {
  return {
    source: section.source,
    fieldKey,
    packageName: section.packageName,
    staticValue: (section as unknown as { staticValue?: string }).staticValue,
  };
}

function resolveFieldValue(
  snapshot: SnapshotData,
  detail: PolicyDetail,
  section: TemplateSection,
  fieldKey: string,
  extra?: ExtraDocContext,
  tracking?: Record<string, DocTrackingEntry> | null,
  currentDocTrackingKey?: string,
): unknown {
  return resolveRawValue(
    docFieldRef(section, fieldKey),
    buildResolveContext(snapshot, detail, extra, tracking, currentDocTrackingKey),
  );
}

/**
 * Document-template wrapper around the shared formatter. Boolean values are
 * a special case: many admin-configured fields have `format: "text"` even
 * though the underlying value is a boolean, which would otherwise render as
 * the literal "true". `false` is already filtered upstream by
 * `isEmptyFieldValue`, so we only need to map `true` to a friendly label.
 */
function formatValue(
  raw: unknown,
  format?: TemplateFieldMapping["format"],
  currencyCode?: string,
): string {
  if ((raw === true || raw === "true") && (!format || format === "text" || format === "boolean")) {
    return "Yes";
  }
  return formatResolvedValue(raw, format, currencyCode);
}

function isPerItemField(key: string): boolean {
  return key === "itemDescriptions" || key === "itemAmounts" || key === "itemStatuses" || key === "itemPaymentBadges" || key.startsWith("item_");
}

/**
 * Returns true when a resolved field value should be hidden from the rendered
 * document (no label/data row produced).
 *
 * Rules:
 *  - null / undefined / empty string → always hidden.
 *  - boolean `false` (or string "false") → hidden. Mirrors the policy
 *    snapshot view behavior so a "no" answer doesn't pollute the document
 *    with rows like "TAILGATE: false". Boolean `true` still renders.
 *  - currency/number fields with a value of 0 → hidden, except in the
 *    "totals" section where a zero balance is meaningful (e.g. statement
 *    outstanding = $0.00).
 *
 * This keeps the invoice clean by suppressing optional premium lines like
 * "Client Premium (PD)" or "Client Credit Premium" when no value is set,
 * and yes/no questions whose answer is "no".
 */
function isEmptyFieldValue(
  value: unknown,
  format: TemplateFieldMapping["format"] | undefined,
  sectionId: string,
): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "boolean" && value === false) return true;
  if (typeof value === "string") {
    const s = value.trim();
    if (s === "") return true;
    if (s.toLowerCase() === "false") return true;
  }
  if (sectionId === "totals") return false;
  if (format === "currency" || format === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n === 0) return true;
  }
  return false;
}

/**
 * Configuration for a child field that lives under a boolean parent field.
 * When the parent value is `true`/`false`, the matching branch's children
 * (configured in admin via Field Editor → Boolean Children) are surfaced as
 * additional rows below the parent in the rendered document.
 *
 * Snapshot keys follow the pattern `${parentKey}__${branch}__c${idx}` (see
 * `components/policies/PackageBlock.tsx` where they are written).
 */
type BooleanChildDef = {
  childKey: string;
  label: string;
  inputType: string;
  options?: Record<string, string>;
};
type BooleanChildrenMap = Record<string, { true?: BooleanChildDef[]; false?: BooleanChildDef[] }>;
type PackageBooleanChildrenCache = Record<string, BooleanChildrenMap>;

/**
 * Map of stored option value → human-readable label for select / multi-select
 * fields, keyed by package name then by field key. Lets a snapshot value like
 * `"hkonly"` render as `"Hong Kong Only"` instead of the raw key.
 */
type FieldOptionLabelsMap = Record<string, Record<string, string>>;
type PackageFieldOptionLabelsCache = Record<string, FieldOptionLabelsMap>;

/**
 * Returns the original value mapped through the field's admin-configured
 * select options when an entry exists. Handles arrays (multi-select) and
 * comma-separated strings as well, otherwise returns the original value.
 */
function applyOptionLabel(
  raw: unknown,
  packageName: string | undefined,
  fieldKey: string,
  optionLabelsCache: PackageFieldOptionLabelsCache,
): unknown {
  if (!packageName) return raw;
  const opts = optionLabelsCache[packageName]?.[fieldKey];
  if (!opts || Object.keys(opts).length === 0) return raw;
  const mapOne = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    const key = String(v).trim();
    if (!key) return v;
    return opts[key] ?? v;
  };
  if (Array.isArray(raw)) return raw.map(mapOne);
  if (typeof raw === "string" && raw.includes(",")) {
    return raw.split(",").map((s) => String(mapOne(s.trim()))).join(", ");
  }
  return mapOne(raw);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inputTypeToFormat(it: string): TemplateFieldMapping["format"] {
  if (it === "currency" || it === "negative_currency") return "currency";
  if (it === "number") return "number";
  if (it === "boolean") return "boolean";
  if (it === "date") return "date";
  return "text";
}

function humanizeChildKey(childKey: string, parentKey: string): string {
  // Strip "${parent}__true__c0" / "${parent}__opt_xxx__c0" / "${parent}__false__c0"
  const stripped = childKey
    .replace(new RegExp(`^${escapeRegExp(parentKey)}__(?:true|false|opt_[^_]+)__c\\d+$`), "")
    .trim();
  if (stripped) return stripped;
  // Fallback: just show the index
  const idxMatch = childKey.match(/c(\d+)$/);
  return idxMatch ? `Detail ${Number(idxMatch[1]) + 1}` : childKey;
}

/**
 * Resolves the child rows that should appear immediately below a boolean
 * parent field.
 *
 * Strategy (fully data-driven, no hardcoded field names):
 *  1. Determine the active branch from the parent value (`true`/`false`).
 *  2. Auto-discover child keys directly from the snapshot using the well-
 *     known pattern `${parentKey}__${branch}__c{idx}` (the same pattern
 *     written by `PackageBlock` when the form is filled in). This means a
 *     child shows up whenever data exists for it, even if the admin field
 *     meta hasn't been (re)loaded yet.
 *  3. Use admin-configured `meta.booleanChildren.${branch}` when available
 *     for nice labels, input types, and select-option label mapping.
 *     Falls back to a humanized label otherwise.
 */
function resolveBooleanChildRows(
  packageName: string | undefined,
  parentKey: string,
  parentValue: unknown,
  snapshot: SnapshotData,
  pkgChildren: PackageBooleanChildrenCache,
  sectionId: string,
): Array<{ key: string; label: string; resolved: unknown; format: TemplateFieldMapping["format"] }> {
  if (!packageName) return [];

  const isTrue = parentValue === true || parentValue === "true";
  const isFalse = parentValue === false || parentValue === "false";
  if (!isTrue && !isFalse) return [];
  const branch: "true" | "false" = isTrue ? "true" : "false";

  const pkgs = (snapshot.packagesSnapshot ?? {}) as Record<string, unknown>;
  const pkg = pkgs[packageName] as Record<string, unknown> | undefined;
  if (!pkg) return [];
  const values = (
    "values" in (pkg ?? {})
      ? (pkg as { values?: Record<string, unknown> }).values
      : pkg
  ) ?? {};

  // Index admin-configured child defs by their bare childKey
  // (e.g. "alarm__true__c0") for fast lookup.
  const adminDefs = pkgChildren[packageName]?.[parentKey]?.[branch] ?? [];
  const defByBareKey: Record<string, BooleanChildDef> = {};
  for (const def of adminDefs) defByBareKey[def.childKey] = def;

  // Auto-discover all child keys for this branch in the snapshot.
  // The form writes keys as `${packageName}__${parentKey}__${branch}__c\d+`,
  // but older/migrated snapshots may also store the bare `${parentKey}__${branch}__c\d+`.
  // Match both so we render whatever shape the data is in.
  const prefixedRe = new RegExp(
    `^${escapeRegExp(packageName)}__${escapeRegExp(parentKey)}__${branch}__c\\d+$`,
  );
  const bareRe = new RegExp(`^${escapeRegExp(parentKey)}__${branch}__c\\d+$`);

  const childEntries = Object.entries(values as Record<string, unknown>)
    .filter(([k]) => prefixedRe.test(k) || bareRe.test(k))
    .sort(([a], [b]) => {
      const ai = Number(a.match(/c(\d+)$/)?.[1] ?? 0);
      const bi = Number(b.match(/c(\d+)$/)?.[1] ?? 0);
      return ai - bi;
    });

  const rows: Array<{ key: string; label: string; resolved: unknown; format: TemplateFieldMapping["format"] }> = [];
  for (const [snapshotKey, rawValue] of childEntries) {
    // Compute the "bare" admin childKey (without the package prefix) to look up the def.
    const bareKey = snapshotKey.startsWith(`${packageName}__`)
      ? snapshotKey.slice(packageName.length + 2)
      : snapshotKey;
    const def = defByBareKey[bareKey];
    const inputType = def?.inputType ?? "text";
    const fmt = inputTypeToFormat(inputType);

    let displayRaw: unknown = rawValue;
    if (
      displayRaw !== undefined &&
      displayRaw !== null &&
      def?.options &&
      Object.keys(def.options).length > 0
    ) {
      const mapped = def.options[String(displayRaw)];
      if (mapped) displayRaw = mapped;
    }

    if (isEmptyFieldValue(displayRaw, fmt, sectionId)) continue;

    const label = def?.label?.trim() || humanizeChildKey(bareKey, parentKey);
    rows.push({ key: snapshotKey, label, resolved: displayRaw, format: fmt });
  }
  return rows;
}

/** Display-only hints — field order and labels come from the template. */
const STATEMENT_TOTAL_SIDE: Record<string, "credit" | "debit"> = {
  activeTotal: "debit",
  paidIndividuallyTotal: "credit",
  commissionTotal: "credit",
  agentPaidTotal: "credit",
  outstandingTotal: "debit",
  creditToAgent: "credit",
};
const STATEMENT_TOTAL_COLOR: Record<string, { bg: string; text: string }> = {
  paidIndividuallyTotal: { bg: "bg-green-50", text: "text-green-800" },
  commissionTotal: { bg: "bg-amber-50", text: "text-amber-800" },
  agentPaidTotal: { bg: "bg-green-50", text: "text-green-800" },
  outstandingTotal: { bg: "bg-red-50", text: "text-red-800" },
  creditToAgent: { bg: "bg-amber-50", text: "text-amber-800" },
};
const STATEMENT_RESULT_KEYS = new Set(["outstandingTotal", "creditToAgent"]);

function getStatementTotalSide(fieldKey: string): "credit" | "debit" | null {
  return STATEMENT_TOTAL_SIDE[fieldKey] ?? null;
}

function getItemFieldValue(
  item: StatementDataForPreview["items"][0],
  fieldKey: string,
): unknown {
  switch (fieldKey) {
    case "itemDescriptions": return item.description ?? "Premium";
    case "itemAmounts": return item.amountCents / 100;
    case "itemStatuses": return item.status;
    case "itemPaymentBadges": return (item as { paymentBadge?: string }).paymentBadge ?? "";
    default:
      if (fieldKey.startsWith("item_")) {
        const premKey = fieldKey.slice(5);
        if (premKey === "paymentBadge") return (item as { paymentBadge?: string }).paymentBadge ?? "";
        const v = item.premiums?.[premKey];
        return v != null ? v : null;
      }
      return null;
  }
}

function hasRenderableItemValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value === "number") return value !== 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n !== 0;
  return true;
}

function buildStatementItemPairs(fields: TemplateFieldMapping[]) {
  const ordered: Array<{
    groupLabel: string;
    agentField?: TemplateFieldMapping;
    clientField?: TemplateFieldMapping;
  }> = [];
  const pairMap = new Map<string, {
    groupLabel: string;
    agentField?: TemplateFieldMapping;
    clientField?: TemplateFieldMapping;
  }>();

  for (const field of fields) {
    if (!field.key.startsWith("item_")) continue;
    if (field.key === "itemDescriptions" || field.key === "itemAmounts" || field.key === "itemStatuses") continue;

    const isAgent = /^agent\b/i.test(field.label);
    const isClient = /^client\b/i.test(field.label);
    if (!isAgent && !isClient) continue;

    const groupLabel = field.label.replace(/^agent\s+/i, "").replace(/^client\s+/i, "").trim();
    const existing = pairMap.get(groupLabel) ?? { groupLabel };
    if (!pairMap.has(groupLabel)) {
      pairMap.set(groupLabel, existing);
      ordered.push(existing);
    }
    if (isAgent) existing.agentField = field;
    if (isClient) existing.clientField = field;
  }

  return ordered;
}

function groupStatementItems(items: StatementDataForPreview["items"]) {
  const groups: Array<{ policyId: number; items: StatementDataForPreview["items"] }> = [];
  const byPolicy = new Map<number, StatementDataForPreview["items"]>();

  for (const item of items) {
    const existing = byPolicy.get(item.policyId);
    if (existing) {
      existing.push(item);
      continue;
    }
    const grouped = [item];
    byPolicy.set(item.policyId, grouped);
    groups.push({ policyId: item.policyId, items: grouped });
  }

  return groups;
}

function getStatementGroupTitle(
  group: { policyId: number; items: StatementDataForPreview["items"] },
  detailPolicyNumber: string,
) {
  const firstDesc = group.items[0]?.description ?? "";
  const bracketMatch = firstDesc.match(/\[([^\]]+)\]/);
  const candidate = (bracketMatch?.[1] ?? firstDesc).trim();
  const stripped = candidate.replace(/\([a-z]\)\s*$/i, "").trim();
  if (stripped) return stripped;
  return detailPolicyNumber;
}

function isCurrentStatementGroup(
  group: { policyId: number; items: StatementDataForPreview["items"] },
  detailPolicyId: number,
) {
  return group.policyId === detailPolicyId;
}

function needsConfirmation(meta: DocumentTemplateMeta): boolean {
  if (meta.requiresConfirmation !== undefined) return meta.requiresConfirmation;
  return meta.type === "quotation";
}

export function DocumentPreview({
  template,
  detail,
  snapshot,
  trackingEntry,
  tracking,
  docTrackingKey,
  audience,
  renderMode,
  onConfirmDoc,
  onOpenEmailDialog,
}: {
  template: DocumentTemplateRow;
  detail: PolicyDetail;
  snapshot: SnapshotData;
  trackingEntry?: DocumentStatusEntry;
  tracking?: Record<string, DocTrackingEntry> | null;
  docTrackingKey?: string;
  audience?: "client" | "agent";
  renderMode?: "policy" | "agent_statement";
  onConfirmDoc?: (trackingKey: string) => void;
  onOpenEmailDialog?: (subject: string, htmlContent: string, plainText: string) => void;
}) {
  const meta = template.meta!;
  const printRef = React.useRef<HTMLDivElement>(null);

  const needsExtraContext = meta.type === "statement" || meta.type === "receipt" || meta.sections.some(
    (s) => s.source === "statement" || s.source === "accounting" || s.source === "client" || s.source === "organisation",
  );

  const [extraCtx, setExtraCtx] = React.useState<ExtraDocContext>({});
  const [loadingExtra, setLoadingExtra] = React.useState(false);
  /**
   * Cache of boolean-children configuration per package (loaded lazily from
   * `${pkg}_fields` form_options). Used to expand admin-configured follow-up
   * fields below a boolean parent (e.g. ALARM=true → "Alarm — Brand: Sony").
   * Keyed by the package name used in the template section's `packageName`.
   */
  const [pkgChildren, setPkgChildren] = React.useState<PackageBooleanChildrenCache>({});
  /**
   * Cache of select-option label maps per package field. Lets us render
   * `Hong Kong Only` instead of the raw stored value `hkonly`.
   */
  const [pkgOptionLabels, setPkgOptionLabels] = React.useState<PackageFieldOptionLabelsCache>({});

  React.useEffect(() => {
    // Sources that read their field metadata from `${pkg}_fields` form_options.
    // Mirrors the `dynamicSourceMap` in DocumentTemplatesManager.tsx — keep in sync.
    const SOURCE_TO_PKG: Record<string, string> = {
      insured: "insured",
      contactinfo: "contactinfo",
      accounting: "premiumRecord",
    };
    const pkgNames = Array.from(new Set(
      meta.sections.flatMap((s) => {
        if (s.source === "package" && typeof s.packageName === "string" && s.packageName.length > 0) {
          return [s.packageName];
        }
        const mapped = SOURCE_TO_PKG[s.source];
        return mapped ? [mapped] : [];
      }),
    ));
    if (pkgNames.length === 0) return;
    let cancelled = false;
    const ts = Date.now();
    Promise.all(
      pkgNames.map((pkg) =>
        fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}&_t=${ts}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])
          .then((rows: Array<{ value?: unknown; meta?: unknown }>) => {
            const childMap: BooleanChildrenMap = {};
            const optionMap: FieldOptionLabelsMap = {};
            for (const row of Array.isArray(rows) ? rows : []) {
              const parentKey = String(row?.value ?? "").trim();
              if (!parentKey) continue;
              const m = (row?.meta ?? null) as Record<string, unknown> | null;

              // Collect select / multi-select option label maps for value→label mapping.
              if (m && Array.isArray((m as { options?: unknown }).options)) {
                const opts = (m as { options: Array<{ value?: unknown; label?: unknown }> }).options;
                const fieldOpts: Record<string, string> = {};
                for (const o of opts) {
                  const ov = String(o?.value ?? o?.label ?? "").trim();
                  const ol = String(o?.label ?? o?.value ?? "").trim();
                  if (ov) fieldOpts[ov] = ol || ov;
                }
                if (Object.keys(fieldOpts).length > 0) optionMap[parentKey] = fieldOpts;
              }

              // Collect boolean children configuration.
              const bc = (m as { booleanChildren?: { true?: unknown[]; false?: unknown[] } } | null)?.booleanChildren;
              if (bc) {
                const buildBranch = (arr: unknown[] | undefined, branch: "true" | "false"): BooleanChildDef[] | undefined => {
                  if (!Array.isArray(arr) || arr.length === 0) return undefined;
                  return arr.map((c, idx) => {
                    const child = (c ?? {}) as { label?: unknown; inputType?: unknown; options?: unknown };
                    const childOptionMap: Record<string, string> = {};
                    if (Array.isArray(child.options)) {
                      for (const o of child.options as Array<{ value?: unknown; label?: unknown }>) {
                        const ov = String(o?.value ?? o?.label ?? "");
                        const ol = String(o?.label ?? o?.value ?? "");
                        if (ov) childOptionMap[ov] = ol;
                      }
                    }
                    return {
                      childKey: `${parentKey}__${branch}__c${idx}`,
                      label: String(child?.label ?? "").trim() || `Detail ${idx + 1}`,
                      inputType: String(child?.inputType ?? "text"),
                      options: childOptionMap,
                    };
                  });
                };
                childMap[parentKey] = {
                  true: buildBranch(bc.true, "true"),
                  false: buildBranch(bc.false, "false"),
                };
              }
            }
            return [pkg, childMap, optionMap] as const;
          }),
      ),
    ).then((entries) => {
      if (cancelled) return;
      const nextChildren: PackageBooleanChildrenCache = {};
      const nextOptions: PackageFieldOptionLabelsCache = {};
      for (const [pkg, childMap, optionMap] of entries) {
        nextChildren[pkg] = childMap;
        nextOptions[pkg] = optionMap;
      }
      setPkgChildren(nextChildren);
      setPkgOptionLabels(nextOptions);
    });
    return () => { cancelled = true; };
  }, [meta.sections]);

  React.useEffect(() => {
    if (!needsExtraContext) return;
    let cancelled = false;
    setLoadingExtra(true);

    (async () => {
      const ctx: ExtraDocContext = {};
      try {
        const aud = audience ?? "client";
        const ts = Date.now();

        type ApiLine = { lineKey: string; lineLabel: string; values: Record<string, unknown>; margin?: number | null; insurerName?: string | null; collaboratorName?: string | null };
        const roleAliasMap: Record<string, string> = { client: "clientPremium", agent: "agentPremium", net: "netPremium", commission: "agentCommission" };
        const labelAliasMap: Record<string, string> = { gross: "grossPremium", credit: "creditPremium", levy: "levy", stamp: "stampDuty", discount: "discount", currency: "currency", commission_rate: "commissionRate" };

        const [stmtRes, premRes, invRes, cliRes] = await Promise.all([
          fetch(`/api/accounting/statements/by-policy/${detail.policyId}?_t=${ts}&audience=${aud}`, { cache: "no-store" }).catch(() => null),
          fetch(`/api/policies/${detail.policyId}/premiums?_t=${ts}`, { cache: "no-store" }).catch(() => null),
          fetch(`/api/accounting/invoices/by-policy/${detail.policyId}?_t=${ts}`, { cache: "no-store" }).catch(() => null),
          detail.clientId ? fetch(`/api/clients/${detail.clientId}?_t=${ts}`, { cache: "no-store" }).catch(() => null) : Promise.resolve(null),
        ]);

        if (stmtRes?.ok) {
          const { statement, hasSchedule } = await stmtRes.json() as {
            statement: (StatementDataForPreview & { clientPaidPolicyIds?: number[] }) | null;
            hasSchedule?: boolean;
          };
          if (statement) {
            const paidSet = new Set(statement.clientPaidPolicyIds ?? []);
            if (paidSet.size > 0) {
              for (const it of statement.items) {
                if (paidSet.has(it.policyId) && !it.paymentBadge) {
                  it.paymentBadge = "Premium settled \u00b7 Client paid directly";
                }
              }
            }
            ctx.statementData = statement;
          }
          ctx.hasSchedule = !!hasSchedule;
        }

        if (premRes?.ok) {
          const premData = await premRes.json();
          const fields = Array.isArray(premData.fields) ? premData.fields as { key: string; label: string; premiumRole?: string; premiumColumn?: string }[] : [];
          const lines = Array.isArray(premData.lines) ? premData.lines : [];

          ctx.accountingLines = lines.map((ln: ApiLine) => {
            const vals = { ...(ln.values ?? {}) };
            for (const fd of fields) {
              const v = vals[fd.key];
              if (v === undefined || v === null) continue;
              if (fd.premiumRole && roleAliasMap[fd.premiumRole] && !(roleAliasMap[fd.premiumRole] in vals)) {
                vals[roleAliasMap[fd.premiumRole]] = v;
              }
              const lbl = fd.label.toLowerCase();
              for (const [pattern, alias] of Object.entries(labelAliasMap)) {
                if (lbl.includes(pattern) && !(alias in vals)) {
                  vals[alias] = v;
                }
              }
            }
            return {
              lineKey: ln.lineKey ?? "",
              lineLabel: ln.lineLabel ?? ln.lineKey ?? "",
              values: vals,
              margin: ln.margin ?? null,
              insurerName: ln.insurerName ?? null,
              collaboratorName: ln.collaboratorName ?? null,
            };
          });
        }

        if (invRes?.ok) {
          const invoices = await invRes.json() as Array<{
            direction?: string;
            payments?: Array<{
              amountCents?: number;
              amount_cents?: number;
              status?: string | null;
              payer?: string | null;
              paymentDate?: string | null;
              payment_date?: string | null;
              referenceNumber?: string | null;
              reference_number?: string | null;
              createdAt?: string | null;
              created_at?: string | null;
            }>;
          }>;
          const paymentRows = invoices
            .filter((inv) => inv.direction === "receivable")
            .flatMap((inv) => inv.payments ?? [])
            .filter((p) =>
              ["verified", "confirmed", "recorded"].includes(String(p.status ?? "").toLowerCase())
              && String(p.payer ?? "client").toLowerCase() === "client",
            )
            .sort((a, b) =>
              String(b.paymentDate ?? b.payment_date ?? b.createdAt ?? b.created_at ?? "")
                .localeCompare(String(a.paymentDate ?? a.payment_date ?? a.createdAt ?? a.created_at ?? "")),
            );
          const latest = paymentRows[0];
          if (latest) {
            const cents = Number(latest.amountCents ?? latest.amount_cents ?? 0);
            ctx.paymentData = {
              latestClientPaidAmount: Number.isFinite(cents) ? cents / 100 : undefined,
              latestClientPaidDate: String(latest.paymentDate ?? latest.payment_date ?? "") || null,
              latestClientPaymentRef: String(latest.referenceNumber ?? latest.reference_number ?? "") || null,
            };
          }
        }

        if (cliRes?.ok) {
          const cliData = await cliRes.json();
          ctx.clientData = cliData.client ?? cliData;
        }
      } catch (err) {
        console.error("Failed to fetch extra doc context:", err);
      }

      if (!cancelled) {
        setExtraCtx(ctx);
        setLoadingExtra(false);
      }
    })();

    return () => { cancelled = true; };
  }, [needsExtraContext, detail.policyId, detail.clientId, audience]);

  const hasAudienceSections = !!template.meta?.enableAgentCopy || meta.sections.some(
    (s) => s.audience === "client" || s.audience === "agent",
  );
  const viewAudience = audience ?? "client";

  const filteredSections = hasAudienceSections
    ? meta.sections.filter((s) => !s.audience || s.audience === "all" || s.audience === viewAudience)
    : meta.sections;

  const printStyles = `
    body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #1a1a1a; max-width: 800px; margin: 0 auto; font-size: 13px; }
    .border-b { border-bottom: 1px solid #f0f0f0; }
    .border-b-2 { border-bottom: 2px solid #333; }
    .border-t { border-top: 1px solid #ddd; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { padding: 6px 8px; font-weight: 600; color: #737373; border-bottom: 1px solid #e5e5e5; }
    td { padding: 6px 8px; font-weight: 600; color: #1a1a1a; border-bottom: 1px solid #f5f5f5; }
    tr:nth-child(even) td { background: #fafafa; }
    @media print { body { padding: 20px; } }
  `;

  function handlePrint() {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) {
      toast.error("Please allow popups to print");
      return;
    }
    win.document.write(`<!DOCTYPE html>
<html><head><title>${meta.header.title}</title>
<style>${printStyles}</style></head><body>${content}</body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 300);
  }

  const dateStr = (() => {
    const d = new Date(detail.createdAt);
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  })();

  /**
   * Takes a list of resolved+visible fields and inserts admin-configured
   * boolean children (true-branch or false-branch) immediately after their
   * parent. Each child is labelled as `${parentLabel} — ${childLabel}` so
   * the relationship is obvious in flat label/value layouts (HTML, email,
   * plain text). Children themselves use `isEmptyFieldValue` so empty
   * sub-answers are still suppressed.
   */
  type ResolvedField = {
    key: string;
    label: string;
    format?: TemplateFieldMapping["format"];
    currencyCode?: string;
    resolved: unknown;
    isChild?: boolean;
  };
  function expandFieldsWithChildren(
    fields: ResolvedField[],
    section: TemplateSection,
  ): ResolvedField[] {
    // Resolve which form_options group provides this section's field metadata.
    // Same mapping as the loader effect — kept inline for clarity.
    const SOURCE_TO_PKG: Record<string, string> = {
      insured: "insured",
      contactinfo: "contactinfo",
      accounting: "premiumRecord",
    };
    const pkgForLabels =
      section.source === "package" ? section.packageName : SOURCE_TO_PKG[section.source];

    // Apply select-option label mapping for every supported source, then
    // expand boolean children (only meaningful for the `package` source where
    // children are configured).
    const mapped: ResolvedField[] = fields.map((f) =>
      f.isChild
        ? f
        : { ...f, resolved: applyOptionLabel(f.resolved, pkgForLabels, f.key, pkgOptionLabels) },
    );

    if (section.source !== "package" || !section.packageName) return mapped;

    const out: ResolvedField[] = [];
    for (const f of mapped) {
      out.push(f);
      if (f.isChild) continue;
      const children = resolveBooleanChildRows(
        section.packageName,
        f.key,
        f.resolved,
        snapshot,
        pkgChildren,
        section.id,
      );
      for (const c of children) {
        out.push({
          key: c.key,
          label: `${f.label} — ${c.label}`,
          format: c.format,
          currencyCode: f.currencyCode,
          resolved: c.resolved,
          isChild: true,
        });
      }
    }
    return out;
  }

  function generatePlainText(): string {
    const lines: string[] = [];
    lines.push(meta.header.title);
    if (meta.header.subtitle) lines.push(meta.header.subtitle);
    if (trackingEntry?.documentNumber) lines.push(`Doc No: ${trackingEntry.documentNumber}`);
    lines.push("─".repeat(30));
    if (meta.header.showPolicyNumber !== false) lines.push(`Ref: ${detail.policyNumber}`);
    if (meta.header.showDate !== false) lines.push(`Date: ${dateStr}`);
    lines.push("");

    for (const section of filteredSections) {
      const isAgentFld = (f: { key: string; label: string }) =>
        /agent/i.test(f.label) || /agent/i.test(f.key);
      const rawVisibleFields = section.fields.filter((f) => {
        if (!hasAudienceSections) return true;
        if (section.id === "totals") return true;
        if (viewAudience === "client" && isAgentFld(f)) return false;
        return true;
      });
      const visibleFlds = rawVisibleFields;

      const useTable =
        (section.layout === "table" || section.id === "line_items") &&
        extraCtx.statementData?.items?.length;

      if (useTable) {
        const items = extraCtx.statementData!.items.filter(
          (it) => it.status === "active" || it.status === "paid_individually",
        );
        const tableCols = visibleFlds.filter((f) => isPerItemField(f.key));
        const scalarFlds = expandFieldsWithChildren(
          visibleFlds
            .filter((f) => !isPerItemField(f.key))
            .map((f) => ({
              ...f,
              resolved: resolveFieldValue(snapshot, detail, section, f.key, extraCtx, tracking, docTrackingKey),
            }))
            .filter((f) => !isEmptyFieldValue(f.resolved, f.format, section.id)),
          section,
        );

        if (tableCols.length === 0 && scalarFlds.length === 0) continue;

        lines.push(`▸ ${section.title}`);

        if (scalarFlds.length > 0) {
          if (section.id === "totals") {
            const maxLbl = Math.max(...scalarFlds.map((f) => f.label.length));
            const maxCredit = Math.max(
              "credit".length,
              ...scalarFlds
                .filter((f) => getStatementTotalSide(f.key) === "credit")
                .map((f) => formatValue(f.resolved, f.format, f.currencyCode).length),
            );
            const maxDebit = Math.max(
              "debit".length,
              ...scalarFlds
                .filter((f) => getStatementTotalSide(f.key) === "debit")
                .map((f) => formatValue(f.resolved, f.format, f.currencyCode).length),
            );
            lines.push(`  ${"".padEnd(maxLbl)}  ${"credit".padStart(maxCredit)}  ${"debit".padStart(maxDebit)}`);
            for (const f of scalarFlds) {
              const side = getStatementTotalSide(f.key);
              const value = formatValue(f.resolved, f.format, f.currencyCode);
              const credit = side === "credit" ? value : "";
              const debit = side === "debit" ? value : "";
              lines.push(`  ${f.label.padEnd(maxLbl)}  ${credit.padStart(maxCredit)}  ${debit.padStart(maxDebit)}`);
            }
          } else {
            const maxLbl = Math.max(...scalarFlds.map((f) => f.label.length));
            for (const f of scalarFlds) {
              lines.push(`  ${f.label.padEnd(maxLbl)}  ${formatValue(f.resolved, f.format, f.currencyCode)}`);
            }
          }
        }

        if (section.id === "line_items" && items.length > 0) {
          const descField = tableCols.find((f) => f.key === "itemDescriptions");
          const amountField = tableCols.find((f) => f.key === "itemAmounts");
          const itemPairs = buildStatementItemPairs(tableCols);
          const itemGroups = groupStatementItems(items);

          for (const group of itemGroups) {
            if (group.items.length > 1) {
              lines.push(`  [${getStatementGroupTitle(group, detail.policyNumber)}]`);
            }

            for (const item of group.items) {
              const title = formatValue(
                getItemFieldValue(item, descField?.key ?? "itemDescriptions"),
                descField?.format,
                descField?.currencyCode,
              );
              lines.push(`  ${title}`);

              if (itemPairs.length === 0) {
                const amountText = amountField
                  ? formatValue(
                      getItemFieldValue(item, amountField.key),
                      amountField.format,
                      amountField.currencyCode,
                    )
                  : "";
                if (amountText) lines.push(`    Amount: ${amountText}`);
                lines.push("");
                continue;
              }

              for (const pair of itemPairs) {
                const agentRaw = pair.agentField ? getItemFieldValue(item, pair.agentField.key) : null;
                const clientRaw = pair.clientField ? getItemFieldValue(item, pair.clientField.key) : null;
                if (!hasRenderableItemValue(agentRaw) && !hasRenderableItemValue(clientRaw)) continue;

                const label = pair.groupLabel || "Premium";
                const agentText = pair.agentField
                  ? formatValue(agentRaw, pair.agentField.format, pair.agentField.currencyCode)
                  : "—";
                const clientText = pair.clientField
                  ? formatValue(clientRaw, pair.clientField.format, pair.clientField.currencyCode)
                  : "—";
                lines.push(`    ${label}: Agent ${agentText} | Client ${clientText}`);
              }

              lines.push("");
            }
          }
        } else if (tableCols.length > 0 && items.length > 0) {
          const colWidths = tableCols.map((col) => {
            const headerLen = col.label.length;
            const maxVal = Math.max(
              ...items.map((it) => formatValue(getItemFieldValue(it, col.key), col.format, col.currencyCode).length),
            );
            return Math.max(headerLen, maxVal);
          });

          const headerLine = tableCols.map((col, i) =>
            col.key === "itemDescriptions" ? col.label.padEnd(colWidths[i]) : col.label.padStart(colWidths[i]),
          ).join("  ");
          lines.push(`  ${headerLine}`);
          lines.push(`  ${"─".repeat(headerLine.length)}`);

          for (const item of items) {
            const row = tableCols.map((col, i) => {
              const val = formatValue(getItemFieldValue(item, col.key), col.format, col.currencyCode);
              return col.key === "itemDescriptions" ? val.padEnd(colWidths[i]) : val.padStart(colWidths[i]);
            }).join("  ");
            lines.push(`  ${row}`);
          }
        }

        lines.push("");
        continue;
      }

      const fields = expandFieldsWithChildren(
        visibleFlds
          .map((f) => ({
            ...f,
            resolved: resolveFieldValue(snapshot, detail, section, f.key, extraCtx, tracking, docTrackingKey),
          }))
          .filter((f) => !isEmptyFieldValue(f.resolved, f.format, section.id)),
        section,
      );

      if (fields.length === 0) continue;

      lines.push(`▸ ${section.title}`);
      const maxLabelLen = Math.max(...fields.map((f) => f.label.length));
      for (const f of fields) {
        const val = formatValue(f.resolved, f.format, f.currencyCode);
        lines.push(`  ${f.label.padEnd(maxLabelLen)}  ${val}`);
      }
      lines.push("");
    }

    if (meta.footer?.text) {
      lines.push("─".repeat(30));
      lines.push(meta.footer.text);
    }

    return lines.join("\n");
  }

  function handleCopyText() {
    const text = generatePlainText();
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Failed to copy"),
    );
  }

  /**
   * Build an email-safe HTML body that renders consistently in Gmail/Outlook
   * /Apple Mail. Email clients strip <style> tags and ignore most modern CSS
   * (flexbox, grid, Tailwind classes), so we render label/value rows using
   * `<table>` with inline styles. Without this the labels and values run
   * together (e.g. "Display NameAlliance Motors Services Ltd").
   */
  function generateEmailHtml(): string {
    const escape = (s: unknown): string =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const parts: string[] = [];
    parts.push(
      '<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:14px;line-height:1.5;max-width:700px;">',
    );

    // Header
    parts.push(
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:18px;">',
      "<tr>",
      '<td style="vertical-align:top;">',
      `<div style="font-size:${({ sm: "14px", md: "18px", lg: "20px", xl: "26px" }[meta.header.titleSize ?? "lg"])};font-weight:bold;color:#1a1a1a;margin:0 0 2px 0;">${escape(meta.header.title)}</div>`,
    );
    if (meta.header.subtitle) {
      const subPx = { xs: "11px", sm: "13px", md: "16px" }[meta.header.subtitleSize ?? "sm"];
      const subColor = meta.header.subtitleColor ?? "#737373";
      parts.push(`<div style="font-size:${subPx};color:${subColor};">${escape(meta.header.subtitle)}</div>`);
    }
    parts.push("</td>");
    if (trackingEntry?.documentNumber) {
      parts.push(
        '<td style="vertical-align:top;text-align:right;">',
        '<div style="font-size:10px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.05em;">Doc No.</div>',
        `<div style="font-size:14px;font-weight:bold;color:#1a1a1a;">${escape(trackingEntry.documentNumber)}</div>`,
        "</td>",
      );
    }
    parts.push("</tr>");
    parts.push("</table>");

    const refParts: string[] = [];
    if (meta.header.showPolicyNumber !== false) {
      refParts.push(`Ref: <strong>${escape(detail.policyNumber)}</strong>`);
    }
    if (meta.header.showDate !== false) {
      refParts.push(`Date: <strong>${escape(dateStr)}</strong>`);
    }
    if (refParts.length > 0) {
      parts.push(
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:-12px 0 18px 0;font-size:12px;color:#737373;">',
        "<tr>",
        `<td style="text-align:left;">${refParts[0] ?? ""}</td>`,
        `<td style="text-align:right;">${refParts[1] ?? ""}</td>`,
        "</tr>",
        "</table>",
      );
    }

    // Sections — same visibility/empty-value rules as the on-screen preview.
    if (!(meta.requiresStatement && !extraCtx.statementData)) {
      for (const section of filteredSections) {
        const isAgentFld = (f: { key: string; label: string }) =>
          /agent/i.test(f.label) || /agent/i.test(f.key);
        const isClientFld = (f: { key: string; label: string }) =>
          /client/i.test(f.label) || /client/i.test(f.key);
        const visibleFlds = section.fields.filter((f) => {
          if (!hasAudienceSections) return true;
          if (section.id === "line_items" || section.id === "totals") return true;
          if (viewAudience === "client" && isAgentFld(f)) return false;
          if (viewAudience === "agent" && isClientFld(f)) return false;
          return true;
        });

        const fields = expandFieldsWithChildren(
          visibleFlds
            .filter((f) => !isPerItemField(f.key))
            .map((f) => ({
              ...f,
              resolved: resolveFieldValue(snapshot, detail, section, f.key, extraCtx, tracking, docTrackingKey),
            }))
            .filter((f) => !isEmptyFieldValue(f.resolved, f.format, section.id)),
          section,
        );

        if (fields.length === 0) continue;

        parts.push(
          '<div style="margin:18px 0 6px 0;">',
          `<div style="font-size:12px;font-weight:bold;color:#525252;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #d4d4d4;padding-bottom:4px;">${escape(section.title)}</div>`,
          "</div>",
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:12px;">',
        );
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          const isLast = i === fields.length - 1;
          const valueText = formatValue(f.resolved, f.format, f.currencyCode);
          const borderStyle = isLast ? "" : "border-bottom:1px solid #f5f5f5;";
          parts.push(
            "<tr>",
            `<td style="padding:6px 8px 6px 0;color:#737373;font-size:13px;vertical-align:top;width:40%;${borderStyle}">${escape(f.label)}</td>`,
            `<td style="padding:6px 0;color:#1a1a1a;font-weight:600;font-size:13px;text-align:right;vertical-align:top;white-space:pre-line;${borderStyle}">${escape(valueText)}</td>`,
            "</tr>",
          );
        }
        parts.push("</table>");
      }
    }

    if (meta.footer?.text) {
      parts.push(
        `<div style="margin-top:24px;padding-top:10px;border-top:1px solid #d4d4d4;color:#a3a3a3;font-size:11px;">${escape(meta.footer.text)}</div>`,
      );
    }

    parts.push("</div>");
    return parts.join("");
  }

  const trackingKey = (hasAudienceSections && viewAudience === "agent") || template.meta?.isAgentTemplate || (template.meta?.enableAgentCopy && viewAudience === "agent")
    ? toTrackingKey(template.label) + "_agent"
    : toTrackingKey(template.label);

  function handleWhatsApp() {
    const insured = (detail.extraAttributes as Record<string, unknown> | undefined)?.insuredSnapshot as Record<string, unknown> | undefined;
    const phone = String(insured?.contactPhone ?? insured?.phone ?? insured?.contactinfo__mobile ?? insured?.mobile ?? "").replace(/[^0-9+]/g, "");
    const text = generatePlainText();
    const url = phone
      ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  }

  function handleEmail() {
    const htmlContent = generateEmailHtml();
    const plainText = generatePlainText();
    const subject = `${meta.header.title} - ${detail.policyNumber}`;
    onOpenEmailDialog?.(subject, htmlContent, plainText);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{template.label}</div>
        {hasAudienceSections && (
          <span className={cn(
            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
            viewAudience === "agent"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
          )}>
            {viewAudience === "agent" ? "Agent Copy" : "Client Copy"}
          </span>
        )}
      </div>

      <div
        ref={printRef}
        className="rounded-md border border-neutral-200 bg-white p-3 sm:p-6 text-neutral-900 dark:border-neutral-700 max-w-[800px] overflow-hidden"
        style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: "#1a1a1a" }}
      >
        {/* Header */}
        <div className="border-b-2 border-neutral-800 pb-2 sm:pb-3 mb-3 sm:mb-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h1
                className="font-bold leading-tight m-0 wrap-break-word"
                style={{ fontSize: { sm: "13px", md: "16px", lg: "20px", xl: "26px" }[meta.header.titleSize ?? "lg"] }}
              >
                {meta.header.title}
              </h1>
              {meta.header.subtitle && (
                <div
                  className="mt-0.5"
                  style={{
                    fontSize: { xs: "11px", sm: "13px", md: "16px" }[meta.header.subtitleSize ?? "sm"],
                    color: meta.header.subtitleColor ?? "#737373",
                  }}
                >
                  {meta.header.subtitle}
                </div>
              )}
            </div>
            {trackingEntry?.documentNumber && (
              <div className="text-right ml-2 shrink-0 max-w-[45%]">
                <div className="text-[10px] sm:text-xs text-neutral-400 uppercase tracking-wider">Doc No.</div>
                <div className="text-xs sm:text-base font-bold text-neutral-800 break-all">{trackingEntry.documentNumber}</div>
              </div>
            )}
          </div>
          <div className="flex justify-between mt-1 sm:mt-2 text-[11px] sm:text-[13px] text-neutral-500">
            {meta.header.showPolicyNumber !== false && (
              <span>Ref: <strong>{detail.policyNumber}</strong></span>
            )}
            {meta.header.showDate !== false && (
              <span>Date: <strong>{dateStr}</strong></span>
            )}
          </div>
        </div>

        {/* Loading extra data */}
        {loadingExtra && needsExtraContext && (
          <div className="flex items-center gap-2 text-xs text-neutral-400 py-3">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading data...
          </div>
        )}
        {!loadingExtra && meta.requiresStatement && !extraCtx.statementData && (
          <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/30 rounded px-2 py-1.5 mb-2">
            {extraCtx.hasSchedule
              ? `This policy has not been added to a statement yet. Create a statement from the ${viewAudience}'s Payment Schedule to preview this document.`
              : `No statement found for this ${viewAudience}. The ${viewAudience} is not assigned to a Payment Schedule.`}
          </div>
        )}

        {/* Sections — skip entirely when requiresStatement is set and no statement data exists */}
        {!(meta.requiresStatement && !loadingExtra && !extraCtx.statementData) && filteredSections.map((section) => {
          const isAgentField = (f: { key: string; label: string }) =>
            /agent/i.test(f.label) || /agent/i.test(f.key);
          const isClientField = (f: { key: string; label: string }) =>
            /client/i.test(f.label) || /client/i.test(f.key);
          const rawVisibleFields = section.fields.filter((f) => {
            if (!hasAudienceSections) return true;
            if (section.id === "line_items") return true;
            if (section.id === "totals") return true;
            if (viewAudience === "client" && isAgentField(f)) return false;
            if (viewAudience === "agent" && isClientField(f)) return false;
            return true;
          });
          const visibleFields = rawVisibleFields;

          const useTable =
            (section.layout === "table" || section.id === "line_items") &&
            extraCtx.statementData?.items?.length;

          if (useTable) {
            const items = extraCtx.statementData!.items.filter(
              (it) => it.status === "active" || it.status === "paid_individually",
            );
            const tableCols = visibleFields.filter((f) => isPerItemField(f.key));
            const scalarFields = expandFieldsWithChildren(
              visibleFields
                .filter((f) => !isPerItemField(f.key))
                .map((f) => ({
                  ...f,
                  resolved: resolveFieldValue(snapshot, detail, section, f.key, extraCtx, tracking, docTrackingKey),
                }))
                .filter((f) => !isEmptyFieldValue(f.resolved, f.format, section.id)),
              section,
            );

            if (tableCols.length === 0 && scalarFields.length === 0) return null;

            return (
              <div key={section.id} className="mb-3 sm:mb-5">
                <div className="text-[11px] sm:text-sm font-bold text-neutral-700 uppercase tracking-wide border-b border-neutral-300 pb-1 mb-1.5 sm:mb-2">
                  {section.title}
                </div>

                {scalarFields.length > 0 && (
                  <div className="mb-2">
                    {section.id === "totals" ? (
                      <div className="space-y-1">
                        <div className="grid grid-cols-[1fr_100px_100px] gap-2 border-b border-neutral-200 pb-1">
                          <span />
                          <span className="text-[11px] sm:text-[12px] font-medium text-neutral-500 text-right">credit</span>
                          <span className="text-[11px] sm:text-[12px] font-medium text-neutral-500 text-right">debit</span>
                        </div>
                        {scalarFields.map((f, idx) => {
                          const side = getStatementTotalSide(f.key);
                          const value = formatValue(f.resolved, f.format, f.currencyCode);
                          const isResult = STATEMENT_RESULT_KEYS.has(f.key);
                          const prevField = idx > 0 ? scalarFields[idx - 1] : null;
                          const prevIsResult = prevField && STATEMENT_RESULT_KEYS.has(prevField.key);
                          const isFirstResult = isResult && !prevIsResult;
                          const color = STATEMENT_TOTAL_COLOR[f.key];
                          return (
                            <div
                              key={f.key}
                              className={cn(
                                "grid grid-cols-[1fr_100px_100px] gap-2 py-1 sm:py-1.5 rounded",
                                isFirstResult && "border-t-2 border-neutral-400 mt-1 pt-2",
                                !isFirstResult && idx < scalarFields.length - 1 && "border-b border-neutral-100",
                                color?.bg ?? "",
                                color ? "px-1.5" : "",
                              )}
                            >
                              <span className={cn("text-[11px] sm:text-[13px]", isResult ? "font-bold" : "font-medium", color?.text ?? (isResult ? "text-neutral-900" : "text-neutral-500"))}>
                                {f.label}
                              </span>
                              <span className={cn("text-xs sm:text-[13px] text-right", isResult ? "font-bold" : "font-semibold", color?.text ?? "text-neutral-900")}>
                                {side === "credit" ? value : ""}
                              </span>
                              <span className={cn("text-xs sm:text-[13px] text-right", isResult ? "font-bold" : "font-semibold", color?.text ?? "text-neutral-900")}>
                                {side === "debit" ? value : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : scalarFields.map((f, idx) => (
                      <div
                        key={f.key}
                        className={`flex justify-between gap-3 py-1 sm:py-1.5 ${idx < scalarFields.length - 1 ? "border-b border-neutral-100" : ""}`}
                      >
                        <span className="text-[11px] sm:text-[13px] text-neutral-500 font-medium w-[40%] shrink-0">
                          {f.label}
                        </span>
                        <span className="text-xs sm:text-[13px] font-semibold text-neutral-900 wrap-break-word text-right" style={{ whiteSpace: "pre-line" }}>
                          {formatValue(f.resolved, f.format, f.currencyCode)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {section.id === "line_items" && items.length > 0 && (() => {
                  const descField = tableCols.find((f) => f.key === "itemDescriptions");
                  const amountField = tableCols.find((f) => f.key === "itemAmounts");
                  const itemPairs = buildStatementItemPairs(tableCols);
                  const itemGroups = groupStatementItems(items);
                  return (
                    <div className="space-y-2">
                      {itemGroups.map((group, groupIdx) => (
                        <div
                          key={`policy-group-${group.policyId}-${groupIdx}`}
                          className={cn(
                            "rounded-lg border p-2 sm:p-3",
                            renderMode !== "agent_statement" && isCurrentStatementGroup(group, detail.policyId)
                              ? "border-amber-300 bg-amber-50/80"
                              : group.items.length > 1
                                ? "border-neutral-300 bg-neutral-100/80"
                                : "border-neutral-200 bg-neutral-50/60",
                          )}
                        >
                          {(group.items.length > 1 || (renderMode !== "agent_statement" && isCurrentStatementGroup(group, detail.policyId))) && (
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div className="text-[11px] sm:text-[13px] font-semibold text-neutral-900">
                                {getStatementGroupTitle(group, detail.policyNumber)}
                              </div>
                              {renderMode !== "agent_statement" && isCurrentStatementGroup(group, detail.policyId) && (
                                <div className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] sm:text-[11px] font-medium text-amber-700">
                                  Current Policy
                                </div>
                              )}
                            </div>
                          )}

                          <div className="space-y-2">
                            {group.items.map((item, idx) => {
                              const title = formatValue(
                                getItemFieldValue(item, descField?.key ?? "itemDescriptions"),
                                descField?.format,
                                descField?.currencyCode,
                              );
                              const visiblePairs = itemPairs.filter((pair) => {
                                const agentRaw = pair.agentField ? getItemFieldValue(item, pair.agentField.key) : null;
                                const clientRaw = pair.clientField ? getItemFieldValue(item, pair.clientField.key) : null;
                                if (viewAudience === "client") return hasRenderableItemValue(clientRaw);
                                return hasRenderableItemValue(agentRaw) || hasRenderableItemValue(clientRaw);
                              });
                              if (visiblePairs.length === 0) {
                                const amountText = amountField
                                  ? formatValue(
                                      getItemFieldValue(item, amountField.key),
                                      amountField.format,
                                      amountField.currencyCode,
                                    )
                                  : "";
                                return (
                                  <div key={`${title}-${idx}`} className="rounded-md border border-neutral-200 bg-white px-2 py-2 sm:p-3">
                                    <div className="mb-1 flex items-center justify-between gap-2">
                                      <span className="text-[11px] sm:text-[13px] font-semibold text-neutral-900">
                                        {title || "Premium"}
                                      </span>
                                      {item.paymentBadge && (
                                        <span className="rounded border border-green-300 bg-green-50 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-green-700 whitespace-nowrap">
                                          {item.paymentBadge}
                                        </span>
                                      )}
                                    </div>
                                    {amountText && (
                                      <div className="flex items-center justify-between text-[11px] sm:text-[13px]">
                                        <span className="text-neutral-500">Amount</span>
                                        <span className="font-semibold text-neutral-900">{amountText}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              }

                              return (
                                <div key={`${title}-${idx}`} className="rounded-md border border-neutral-200 bg-white px-2 py-2 sm:p-3">
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-[11px] sm:text-[13px] font-semibold text-neutral-900">
                                      {title}
                                    </span>
                                    {item.paymentBadge && (
                                      <span className="rounded border border-green-300 bg-green-50 px-1.5 py-0.5 text-[9px] sm:text-[10px] font-medium text-green-700 whitespace-nowrap">
                                        {item.paymentBadge}
                                      </span>
                                    )}
                                  </div>
                                  <div className="space-y-1.5">
                                    {visiblePairs.map((pair) => {
                                      const agentRaw = pair.agentField ? getItemFieldValue(item, pair.agentField.key) : null;
                                      const clientRaw = pair.clientField ? getItemFieldValue(item, pair.clientField.key) : null;
                                      const showAgentColumn = viewAudience !== "client";
                                      const showClientAsInfo = viewAudience === "agent";
                                      return (
                                        <div key={pair.groupLabel} className="rounded border border-neutral-200 bg-neutral-50 px-2 py-2">
                                          <div className="mb-1 text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                                            {pair.groupLabel || "Premium"}
                                          </div>
                                          <div className={`grid gap-2 ${showAgentColumn ? "grid-cols-2" : "grid-cols-1"}`}>
                                            <div className={cn(
                                              "rounded border px-2 py-1.5",
                                              showClientAsInfo
                                                ? "border-sky-100 bg-sky-50/60"
                                                : "border-neutral-100 bg-white",
                                            )}>
                                              <div className={cn(
                                                "text-[10px] sm:text-[11px]",
                                                showClientAsInfo ? "text-sky-600" : "text-neutral-500",
                                              )}>Client Premium</div>
                                              <div className={cn(
                                                "text-xs sm:text-[13px] font-semibold",
                                                showClientAsInfo ? "text-sky-700" : "text-neutral-900",
                                              )}>
                                                {pair.clientField
                                                  ? formatValue(clientRaw, pair.clientField.format, pair.clientField.currencyCode)
                                                  : "—"}
                                              </div>
                                            </div>
                                            {showAgentColumn && (
                                              <div className="rounded border border-neutral-100 bg-white px-2 py-1.5">
                                                <div className="text-[10px] sm:text-[11px] text-neutral-500">Agent Settlement</div>
                                                <div className="text-xs sm:text-[13px] font-semibold text-neutral-900">
                                                  {pair.agentField
                                                    ? formatValue(agentRaw, pair.agentField.format, pair.agentField.currencyCode)
                                                    : "—"}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {section.id !== "line_items" && tableCols.length > 0 && items.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] sm:text-[13px] border-collapse">
                      <thead>
                        <tr className="border-b border-neutral-200">
                          {tableCols.map((col) => (
                            <th
                              key={col.key}
                              className={cn(
                                "py-1.5 px-2 font-semibold text-neutral-500 whitespace-nowrap",
                                col.key === "itemDescriptions" ? "text-left" : "text-right",
                              )}
                            >
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, rowIdx) => (
                          <tr
                            key={rowIdx}
                            className={cn(
                              "border-b border-neutral-100",
                              rowIdx % 2 === 1 && "bg-neutral-50",
                            )}
                          >
                            {tableCols.map((col) => {
                              const raw = getItemFieldValue(item, col.key);
                              return (
                                <td
                                  key={col.key}
                                  className={cn(
                                    "py-1.5 px-2 font-semibold text-neutral-900",
                                    col.key === "itemDescriptions" ? "text-left" : "text-right whitespace-nowrap",
                                  )}
                                >
                                  {formatValue(raw, col.format, col.currencyCode)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          }

          const fields = expandFieldsWithChildren(
            visibleFields
              .map((f) => ({
                ...f,
                resolved: resolveFieldValue(snapshot, detail, section, f.key, extraCtx, tracking, docTrackingKey),
              }))
              .filter((f) => !isEmptyFieldValue(f.resolved, f.format, section.id)),
            section,
          );

          if (fields.length === 0) return null;

          return (
            <div key={section.id} className="mb-3 sm:mb-5">
              <div className="text-[11px] sm:text-sm font-bold text-neutral-700 uppercase tracking-wide border-b border-neutral-300 pb-1 mb-1.5 sm:mb-2">
                {section.title}
              </div>
              <div>
                {section.id === "totals" ? (
                  <div className="space-y-1">
                    <div className="grid grid-cols-[1fr_100px_100px] gap-2 border-b border-neutral-200 pb-1">
                      <span />
                      <span className="text-[11px] sm:text-[12px] font-medium text-neutral-500 text-right">credit</span>
                      <span className="text-[11px] sm:text-[12px] font-medium text-neutral-500 text-right">debit</span>
                    </div>
                    {fields.map((f, idx) => {
                      const side = getStatementTotalSide(f.key);
                      const value = formatValue(f.resolved, f.format, f.currencyCode);
                      const isResult = STATEMENT_RESULT_KEYS.has(f.key);
                      const prevField = idx > 0 ? fields[idx - 1] : null;
                      const prevIsResult = prevField && STATEMENT_RESULT_KEYS.has(prevField.key);
                      const isFirstResult = isResult && !prevIsResult;
                      const color = STATEMENT_TOTAL_COLOR[f.key];
                      return (
                        <div
                          key={f.key}
                          className={cn(
                            "grid grid-cols-[1fr_100px_100px] gap-2 py-1 sm:py-1.5 rounded",
                            isFirstResult && "border-t-2 border-neutral-400 mt-1 pt-2",
                            !isFirstResult && idx < fields.length - 1 && "border-b border-neutral-100",
                            color?.bg ?? "",
                            color ? "px-1.5" : "",
                          )}
                        >
                          <span className={cn("text-[11px] sm:text-[13px]", isResult ? "font-bold" : "font-medium", color?.text ?? (isResult ? "text-neutral-900" : "text-neutral-500"))}>
                            {f.label}
                          </span>
                          <span className={cn("text-xs sm:text-[13px] text-right", isResult ? "font-bold" : "font-semibold", color?.text ?? "text-neutral-900")}>
                            {side === "credit" ? value : ""}
                          </span>
                          <span className={cn("text-xs sm:text-[13px] text-right", isResult ? "font-bold" : "font-semibold", color?.text ?? "text-neutral-900")}>
                            {side === "debit" ? value : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : fields.map((f, idx) => (
                  <div
                    key={f.key}
                    className={`flex justify-between gap-3 py-1 sm:py-1.5 ${idx < fields.length - 1 ? "border-b border-neutral-100" : ""}`}
                  >
                    <span className="text-[11px] sm:text-[13px] text-neutral-500 font-medium w-[40%] shrink-0">
                      {f.label}
                    </span>
                    <span className="text-xs sm:text-[13px] font-semibold text-neutral-900 wrap-break-word text-right" style={{ whiteSpace: "pre-line" }}>
                      {formatValue(f.resolved, f.format, f.currencyCode)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Footer — hide when requiresStatement and no data */}
        {!(meta.requiresStatement && !loadingExtra && !extraCtx.statementData) && meta.footer?.text && (
          <div className="mt-6 sm:mt-8 pt-2 sm:pt-3 border-t border-neutral-300 text-[10px] sm:text-xs text-neutral-400">
            {meta.footer.text}
          </div>
        )}
        {!(meta.requiresStatement && !loadingExtra && !extraCtx.statementData) && meta.footer?.showSignature && (
          <div className="mt-10 sm:mt-16 flex justify-between">
            <div className="w-36 sm:w-[200px] border-t border-neutral-800 pt-1 text-[10px] sm:text-xs">Authorized Signature</div>
            <div className="w-36 sm:w-[200px] border-t border-neutral-800 pt-1 text-[10px] sm:text-xs">Client Signature</div>
          </div>
        )}
      </div>

      {/* Action buttons — 3-stage: icon / text / icon+text, 2 per row */}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={handleCopyText}>
          <FileText className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">Copy Text</span>
        </Button>
        <Button size="sm" variant="outline" onClick={handleEmail}>
          <Mail className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">Email</span>
        </Button>
        <Button size="sm" variant="outline" onClick={handleWhatsApp} className="text-green-600 hover:text-green-700 border-green-300 hover:border-green-400">
          <MessageCircle className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">WhatsApp</span>
        </Button>
        <Button size="sm" variant="outline" onClick={handlePrint}>
          <Printer className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">Print / PDF</span>
        </Button>
      </div>

      {/* Tracking status */}
      {trackingEntry && (
        <div className="flex items-center justify-between rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            {(() => {
              const badge = trackingEntry.status ? STATUS_BADGE[trackingEntry.status] : null;
              if (!badge) return null;
              return (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", badge.bg, badge.text)}>
                  {trackingEntry.status === "confirmed" && <CheckCircle2 className="h-2.5 w-2.5" />}
                  {trackingEntry.status === "sent" && <Send className="h-2.5 w-2.5" />}
                  {badge.label}
                </span>
              );
            })()}
            {trackingEntry.sentAt && (
              <span className="text-[10px] text-neutral-400">
                {new Date(trackingEntry.sentAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {trackingEntry.status === "sent" && onConfirmDoc && needsConfirmation(meta) && (
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onConfirmDoc(trackingKey)}>
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Confirm Received
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Status badge for document tracking ---

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  prepared:  { bg: "bg-sky-100 dark:bg-sky-900/50",      text: "text-sky-700 dark:text-sky-300",       label: "Prepared" },
  sent:      { bg: "bg-orange-100 dark:bg-orange-900/50", text: "text-orange-700 dark:text-orange-300", label: "Sent" },
  confirmed: { bg: "bg-green-100 dark:bg-green-900/50",  text: "text-green-700 dark:text-green-300",   label: "Confirmed" },
  rejected:  { bg: "bg-red-100 dark:bg-red-900/50",      text: "text-red-700 dark:text-red-300",       label: "Rejected" },
  generated: { bg: "bg-blue-100 dark:bg-blue-900/50",    text: "text-blue-700 dark:text-blue-300",     label: "Generated" },
};

// --- PDF template row with embedded tracking + action slide-out ---

function PdfMergeButton({
  tpl,
  policyId,
  trackingKey,
  entry,
  updating,
  onEmailClick,
  onWhatsAppClick,
  onTrackingAction,
  onConfirmWithProof,
}: {
  tpl: PdfTemplateRow;
  policyId: number;
  trackingKey: string;
  entry?: DocumentStatusEntry;
  updating: boolean;
  onEmailClick: (tpl: PdfTemplateRow) => void;
  onWhatsAppClick: (tpl: PdfTemplateRow) => void;
  onTrackingAction: (key: string, action: "send" | "confirm" | "reject" | "reset" | "prepare", extra?: string, documentPrefix?: string, documentSuffix?: string, documentSetGroup?: string, templateType?: string) => void;
  onConfirmWithProof: (key: string, method: "admin" | "upload", note?: string, file?: File, templateType?: string) => Promise<void>;
}) {
  const [generating, setGenerating] = React.useState(false);
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmMethod, setConfirmMethod] = React.useState<"admin" | "upload">("admin");
  const [confirmNote, setConfirmNote] = React.useState("");
  const [confirmFile, setConfirmFile] = React.useState<File | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const meta = tpl.meta as unknown as PdfTemplateMeta | null;
  const status = entry?.status;
  const badge = status ? STATUS_BADGE[status] : null;

  React.useEffect(() => {
    if (!actionsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [actionsOpen]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const generateBody: Record<string, unknown> = { policyId };
      if (meta?.isAgentTemplate) generateBody.audience = "agent";
      const res = await fetch(`/api/pdf-templates/${tpl.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generateBody),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
    }
    setGenerating(false);
  }

  const isDone = status === "confirmed";
  const pdfRequiresConfirm = meta?.requiresConfirmation !== undefined
    ? meta.requiresConfirmation
    : true;

  const actions: Array<{
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: "default" | "destructive";
    show: boolean;
  }> = [
    {
      label: "Mark Sent",
      icon: <Send className="h-3.5 w-3.5" />,
      onClick: () => {
        const sentTo = prompt("Sent to (email, optional):");
        const isAgentCopy = trackingKey.endsWith("_agent");
        onTrackingAction(trackingKey, "send", sentTo || undefined, meta?.documentPrefix || undefined, isAgentCopy ? "(A)" : undefined, meta?.documentSetGroup || undefined, meta?.type);
        setActionsOpen(false);
      },
      show: !status || status === "rejected",
    },
    {
      label: "Confirm",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      onClick: () => { setConfirmOpen(true); setActionsOpen(false); },
      show: pdfRequiresConfirm && (!status || status === "sent"),
    },
    {
      label: "Reject",
      icon: <XCircle className="h-3.5 w-3.5" />,
      onClick: () => {
        const note = prompt("Rejection reason (optional):");
        onTrackingAction(trackingKey, "reject", note || undefined);
        setActionsOpen(false);
      },
      variant: "destructive" as const,
      show: pdfRequiresConfirm && status === "sent",
    },
    {
      label: "Reset",
      icon: <X className="h-3.5 w-3.5" />,
      onClick: () => { onTrackingAction(trackingKey, "reset"); setActionsOpen(false); },
      variant: "destructive" as const,
      show: isDone || status === "rejected",
    },
  ];

  const visibleActions = actions.filter((a) => a.show);

  return (
    <div
      ref={containerRef}
      className={cn(
        "rounded-md border p-3 transition-colors",
        isDone
          ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20"
          : status === "rejected"
            ? "border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/20"
            : "border-neutral-200 dark:border-neutral-800",
      )}
    >
      {/* Row 1: template info + send icons + download */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || (!meta?.fields?.length && !meta?.pages?.length)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80 disabled:opacity-50"
        >
          <Stamp className="h-5 w-5 shrink-0 text-emerald-500 dark:text-emerald-400" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{tpl.label}</span>
              {badge && (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-medium", badge.bg, badge.text)}>
                  {status === "confirmed" && <CheckCircle2 className="h-2.5 w-2.5" />}
                  {status === "sent" && <Send className="h-2.5 w-2.5" />}
                  {status === "rejected" && <XCircle className="h-2.5 w-2.5" />}
                  {badge.label}
                </span>
              )}
            </div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
              PDF Mail Merge
              {meta?.fields ? ` \u00b7 ${meta.fields.length} field${meta.fields.length !== 1 ? "s" : ""}` : ""}
              {meta?.description ? ` \u00b7 ${meta.description}` : ""}
            </div>
          </div>
          <div className="shrink-0">
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
            ) : (
              <Download className="h-4 w-4 text-neutral-400" />
            )}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1 border-l border-neutral-200 pl-2 dark:border-neutral-700">
          <button
            type="button"
            title="Send via Email"
            onClick={() => onEmailClick(tpl)}
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <Mail className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Send via WhatsApp"
            onClick={() => onWhatsAppClick(tpl)}
            className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-green-600 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-green-400"
          >
            <MessageCircle className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Row 2: Status button right-aligned, slide-out opens right-to-left */}
      <div className="mt-2 flex items-center justify-end gap-1">
        <div
          className={cn(
            "flex items-center overflow-hidden transition-all duration-500 ease-in-out",
            actionsOpen ? "max-w-[400px] opacity-100 mr-1" : "max-w-0 opacity-0 mr-0",
          )}
        >
          <div className="flex items-center gap-0 rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-800">
            {visibleActions.map((action, i) => (
              <button
                key={i}
                type="button"
                onClick={action.onClick}
                disabled={updating}
                className={cn(
                  "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                  "focus:outline-none disabled:pointer-events-none disabled:opacity-50",
                  action.variant === "destructive"
                    ? "text-red-600 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/50 dark:hover:text-red-300"
                    : "text-neutral-600 hover:bg-white hover:text-neutral-900 hover:shadow-sm dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100",
                )}
              >
                <span className="[&_svg]:h-3 [&_svg]:w-3">{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        <span
          onClick={() => !updating && setActionsOpen((v) => !v)}
          className={cn(
            "inline-flex items-center rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-600 shadow-sm select-none cursor-pointer",
            "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
            updating && "opacity-50 cursor-not-allowed",
          )}
        >
          Status
        </span>
      </div>

      {/* Tracking detail */}
      {entry?.documentNumber && (
        <div className="mt-1 pl-8 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
          Doc No: {entry.documentNumber}
        </div>
      )}
      {entry?.sentTo && (
        <div className="mt-0.5 pl-8 text-[10px] text-neutral-400">
          Sent to: {entry.sentTo}
          {entry.sentAt && ` \u00b7 ${new Date(entry.sentAt).toLocaleDateString()}`}
        </div>
      )}
      {entry?.confirmedAt && (
        <div className="mt-0.5 pl-8 text-[10px] text-green-600 dark:text-green-400">
          Confirmed: {new Date(entry.confirmedAt).toLocaleDateString()}
          {entry.confirmedBy && ` by ${entry.confirmedBy}`}
          {entry.confirmMethod === "admin" && " (Admin)"}
          {entry.confirmMethod === "upload" && " (Proof uploaded)"}
        </div>
      )}
      {entry?.confirmNote && (
        <div className="mt-0.5 pl-8 text-[10px] text-neutral-500 dark:text-neutral-400 italic">
          Note: {entry.confirmNote}
        </div>
      )}
      {entry?.confirmProofName && (
        <a
          href={`/api/policies/${policyId}/document-tracking/proof?docType=${encodeURIComponent(trackingKey)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 pl-8 flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
        >
          <Paperclip className="h-2.5 w-2.5" />
          {entry.confirmProofName}
        </a>
      )}
      {status === "rejected" && entry?.rejectionNote && (
        <div className="mt-0.5 pl-8 text-[10px] text-red-500">
          Rejected: {entry.rejectionNote}
        </div>
      )}

      {/* Confirm Document Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              How would you like to confirm this document?
            </p>

            {/* Method selection */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={confirmMethod === "admin" ? "default" : "outline"}
                onClick={() => setConfirmMethod("admin")}
                className="flex-1"
              >
                <ShieldCheck className="mr-1 h-4 w-4" />
                Admin Confirm
              </Button>
              <Button
                size="sm"
                variant={confirmMethod === "upload" ? "default" : "outline"}
                onClick={() => setConfirmMethod("upload")}
                className="flex-1"
              >
                <Upload className="mr-1 h-4 w-4" />
                Upload Proof
              </Button>
            </div>

            {confirmMethod === "admin" && (
              <div>
                <Label>Admin Note (optional)</Label>
                <textarea
                  value={confirmNote}
                  onChange={(e) => setConfirmNote(e.target.value)}
                  rows={3}
                  placeholder="e.g. Client confirmed via phone call on 23/03/2026, spoke with Mr. Chan..."
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
              </div>
            )}

            {confirmMethod === "upload" && (
              <div>
                <Label>Upload signed/acknowledged document <span className="text-red-500">*</span></Label>
                <Input
                  type="file"
                  onChange={(e) => setConfirmFile(e.target.files?.[0] || null)}
                  className="mt-1"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                />
                <div className="mt-1">
                  <Label>Note (optional)</Label>
                  <Input
                    value={confirmNote}
                    onChange={(e) => setConfirmNote(e.target.value)}
                    placeholder="Optional note about this proof..."
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              disabled={
                confirmSubmitting ||
                (confirmMethod === "upload" && !confirmFile)
              }
              onClick={async () => {
                setConfirmSubmitting(true);
                try {
                  await onConfirmWithProof(
                    trackingKey,
                    confirmMethod,
                    confirmNote.trim() || undefined,
                    confirmFile || undefined,
                    meta?.type,
                  );
                  setConfirmOpen(false);
                  setConfirmNote("");
                  setConfirmFile(null);
                } finally {
                  setConfirmSubmitting(false);
                }
              }}
            >
              {confirmSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SendEmailDialog({
  open,
  onOpenChange,
  policyId,
  policyNumber,
  pdfTemplates,
  preSelectedId,
  defaultEmail,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: number;
  policyNumber: string;
  pdfTemplates: PdfTemplateRow[];
  preSelectedId?: number;
  defaultEmail?: string;
  onSent?: (sentTemplateLabels: string[], email: string) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setEmail(defaultEmail ?? "");
      setSubject(`Policy ${policyNumber} - Documents`);
      if (preSelectedId) {
        setSelectedIds(new Set([preSelectedId]));
      } else {
        setSelectedIds(new Set(pdfTemplates.map((t) => t.id)));
      }
    }
  }, [open, policyNumber, preSelectedId, pdfTemplates, defaultEmail]);

  function toggleId(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (!email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (selectedIds.size === 0) {
      toast.error("Please select at least one document");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/pdf-templates/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId,
          templateIds: Array.from(selectedIds),
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send");
      }
      const data = await res.json();
      toast.success(`Email sent with ${data.sent} document${data.sent !== 1 ? "s" : ""} to ${email}`);
      const sentLabels = pdfTemplates.filter((t) => selectedIds.has(t.id)).map((t) => t.label);
      onSent?.(sentLabels, email.trim());
      onOpenChange(false);
      setEmail("");
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    }
    setSending(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email Documents</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="send-email-to">Recipient Email</Label>
            <Input
              id="send-email-to"
              type="email"
              placeholder="client@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="send-email-subject">Subject</Label>
            <Input
              id="send-email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="send-email-msg">Message (optional)</Label>
            <textarea
              id="send-email-msg"
              rows={3}
              placeholder="Add a personal note..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700"
            />
          </div>
          {pdfTemplates.length > 1 && (
            <div>
              <Label>Attach Documents</Label>
              <div className="mt-1 space-y-1.5">
                {pdfTemplates.map((tpl) => (
                  <label key={tpl.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedIds.has(tpl.id)}
                      onChange={() => toggleId(tpl.id)}
                    />
                    <span>{tpl.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSend} disabled={sending || !email.trim()}>
            {sending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="mr-1.5 h-3.5 w-3.5" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type EndorsementEntry = {
  policyId: number;
  policyNumber: string;
  detail: PolicyDetail;
  statusClient: string;
  statusAgent: string;
};

export function DocumentsTab({
  detail,
  flowKey,
  currentStatus,
  currentStatusClient,
  currentStatusAgent,
  initialTemplateValue,
  initialAudience,
  onlyTemplateValue,
  renderMode = "policy",
  trackingScope = "policy",
  trackingInvoiceId,
  onStatusAutoAdvanced,
  endorsements,
}: {
  detail: PolicyDetail;
  flowKey?: string;
  currentStatus?: string;
  currentStatusClient?: string;
  currentStatusAgent?: string;
  initialTemplateValue?: string;
  initialAudience?: "client" | "agent";
  onlyTemplateValue?: string;
  renderMode?: "policy" | "agent_statement";
  trackingScope?: "policy" | "invoice";
  trackingInvoiceId?: number;
  onStatusAutoAdvanced?: () => void;
  endorsements?: EndorsementEntry[];
}) {
  const { sortedValues: statusOrder, loading: statusesLoading } = usePolicyStatuses();
  const [templates, setTemplates] = React.useState<DocumentTemplateRow[]>([]);
  const [pdfTemplates, setPdfTemplates] = React.useState<PdfTemplateRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [selected, setSelected] = React.useState<DocumentTemplateRow | null>(null);
  const [selectedAudience, setSelectedAudience] = React.useState<"client" | "agent">("client");
  const [selectedEndorsement, setSelectedEndorsement] = React.useState<EndorsementEntry | null>(null);
  const [initialSelectionApplied, setInitialSelectionApplied] = React.useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = React.useState(false);
  const [emailPreSelectedId, setEmailPreSelectedId] = React.useState<number | undefined>();

  // Endorsement templates (loaded from the same document_templates pool, filtered by flows: ["endorsement"])
  const [endorsementTemplates, setEndorsementTemplates] = React.useState<DocumentTemplateRow[]>([]);
  const [endorsementTracking, setEndorsementTracking] = React.useState<Record<number, DocumentStatusMap>>({});

  // Document tracking state (shared across all template rows)
  const [tracking, setTracking] = React.useState<DocumentStatusMap>({});
  const [trackingUpdating, setTrackingUpdating] = React.useState(false);

  const snapshot = (detail.extraAttributes ?? {}) as SnapshotData;
  const statusClient = currentStatusClient ?? currentStatus ?? "quotation_prepared";
  const statusAgent = currentStatusAgent ?? statusClient;
  const trackingEndpoint = (trackingScope === "invoice" && Number.isFinite(trackingInvoiceId) && Number(trackingInvoiceId) > 0)
    ? `/api/accounting/invoices/${Number(trackingInvoiceId)}/document-tracking`
    : `/api/policies/${detail.policyId}/document-tracking`;

  // Load tracking data
  React.useEffect(() => {
    fetch(trackingEndpoint, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: DocumentStatusMap) => setTracking(data))
      .catch(() => {});
  }, [trackingEndpoint]);

  // Load tracking for endorsement policies
  React.useEffect(() => {
    if (!endorsements || endorsements.length === 0) return;
    let cancelled = false;
    Promise.all(
      endorsements.map((e) =>
        fetch(`/api/policies/${e.policyId}/document-tracking`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => ({})),
      ),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<number, DocumentStatusMap> = {};
      results.forEach((data, i) => { map[endorsements[i].policyId] = data as DocumentStatusMap; });
      setEndorsementTracking(map);
    });
    return () => { cancelled = true; };
  }, [endorsements]);

  const handleTrackingAction = React.useCallback(async (
    docType: string,
    action: "send" | "confirm" | "reject" | "reset" | "prepare",
    extra?: string,
    documentPrefix?: string,
    documentSuffix?: string,
    documentSetGroup?: string,
    templateType?: string,
  ) => {
    setTrackingUpdating(true);
    try {
      const body: Record<string, unknown> = { docType, action };
      if (templateType) body.templateType = templateType;
      if (action === "send" && extra) body.sentTo = extra;
      if (action === "reject" && extra) body.rejectionNote = extra;
      if ((action === "send" || action === "prepare") && documentPrefix) body.documentPrefix = documentPrefix;
      if ((action === "send" || action === "prepare") && documentSuffix) body.documentSuffix = documentSuffix;
      if ((action === "send" || action === "prepare") && documentSetGroup) {
        body.documentSetGroup = documentSetGroup;
        const siblingKeys: string[] = [];
        for (const t of templates) {
          if (t.meta?.documentSetGroup === documentSetGroup) {
            siblingKeys.push(toTrackingKey(t.label));
            siblingKeys.push(toTrackingKey(t.label) + "_agent");
          }
        }
        for (const t of pdfTemplates) {
          const m = t.meta as unknown as { documentSetGroup?: string } | null;
          if (m?.documentSetGroup === documentSetGroup) {
            siblingKeys.push(toTrackingKey(t.label));
          }
        }
        body.groupSiblingKeys = siblingKeys;
      }

      const res = await fetch(trackingEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const data = await res.json();
      setTracking(data.documentTracking ?? {});
      const labels: Record<string, string> = { send: "marked as sent", confirm: "confirmed", reject: "rejected", reset: "reset", prepare: "prepared" };
      if (action !== "prepare") {
        toast.success(`${docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} ${labels[action]}`);
      }
      if (data.statusAdvanced) {
        toast.info(`Status auto-advanced to: ${data.statusAdvanced.replace(/_/g, " ")}`);
        onStatusAutoAdvanced?.();
      }
      if (data.statusRolledBack) {
        toast.warning(`Status rolled back to: ${data.statusRolledBack.replace(/_/g, " ")}`);
        onStatusAutoAdvanced?.();
      }
    } catch (err: unknown) {
      if (action !== "prepare") {
        toast.error(err instanceof Error ? err.message : "Failed to update");
      }
    } finally {
      setTrackingUpdating(false);
    }
  }, [detail.policyId, onStatusAutoAdvanced, pdfTemplates, templates]);

  const handleConfirmWithProof = React.useCallback(async (
    docType: string,
    method: "admin" | "upload",
    note?: string,
    file?: File,
    templateType?: string,
  ) => {
    setTrackingUpdating(true);
    try {
      let res: Response;
      if (method === "upload" && file) {
        const formData = new FormData();
        formData.append("docType", docType);
        formData.append("action", "confirm");
        formData.append("confirmMethod", "upload");
        if (note) formData.append("confirmNote", note);
        if (templateType) formData.append("templateType", templateType);
        formData.append("proofFile", file);
        res = await fetch(trackingEndpoint, {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch(trackingEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType,
            action: "confirm",
            confirmMethod: "admin",
            confirmNote: note,
            templateType,
          }),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const data = await res.json();
      setTracking(data.documentTracking ?? {});
      toast.success(`${docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} confirmed`);
      if (data.statusAdvanced) {
        toast.info(`Status auto-advanced to: ${data.statusAdvanced.replace(/_/g, " ")}`);
        onStatusAutoAdvanced?.();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setTrackingUpdating(false);
    }
  }, [onStatusAutoAdvanced, trackingEndpoint]);

  function handleEmailClick(tpl: PdfTemplateRow) {
    setEmailPreSelectedId(tpl.id);
    setEmailDialogOpen(true);
  }

  function handleWhatsAppClick(tpl: PdfTemplateRow) {
    const phone = (detail.extraAttributes?.insuredSnapshot as Record<string, unknown> | undefined)?.contactPhone
      ?? (detail.extraAttributes?.insuredSnapshot as Record<string, unknown> | undefined)?.phone
      ?? "";
    const phoneStr = String(phone).replace(/[^0-9+]/g, "");
    const text = encodeURIComponent(`Hi, please find the document "${tpl.label}" for Policy ${detail.policyNumber}.`);
    const url = phoneStr
      ? `https://wa.me/${phoneStr.replace(/^\+/, "")}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
  }

  const [htmlConfirmKey, setHtmlConfirmKey] = React.useState<string | null>(null);
  const [htmlConfirmMethod, setHtmlConfirmMethod] = React.useState<"admin" | "upload">("admin");
  const [htmlConfirmNote, setHtmlConfirmNote] = React.useState("");
  const [htmlConfirmFile, setHtmlConfirmFile] = React.useState<File | null>(null);
  const [htmlConfirmSubmitting, setHtmlConfirmSubmitting] = React.useState(false);

  // HTML document email dialog state
  const [htmlEmailOpen, setHtmlEmailOpen] = React.useState(false);
  const [htmlEmailTo, setHtmlEmailTo] = React.useState("");
  const [htmlEmailSubject, setHtmlEmailSubject] = React.useState("");
  const [htmlEmailHtml, setHtmlEmailHtml] = React.useState("");
  const [htmlEmailPlain, setHtmlEmailPlain] = React.useState("");
  const [htmlEmailSending, setHtmlEmailSending] = React.useState(false);

  const handleOpenHtmlEmail = React.useCallback((subject: string, htmlContent: string, plainText: string) => {
    setHtmlEmailSubject(subject);
    setHtmlEmailHtml(htmlContent);
    setHtmlEmailPlain(plainText);

    const insured = (detail.extraAttributes as Record<string, unknown> | undefined)?.insuredSnapshot as Record<string, unknown> | undefined;
    if (selectedAudience === "agent" && detail.agent?.email) {
      setHtmlEmailTo(detail.agent.email);
    } else {
      const clientEmail = String(insured?.email ?? insured?.contactinfo__email ?? "");
      setHtmlEmailTo(clientEmail);
    }

    setHtmlEmailOpen(true);
  }, [detail.extraAttributes, detail.agent, selectedAudience]);

  const handleSendHtmlEmail = React.useCallback(async () => {
    if (!htmlEmailTo.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }
    setHtmlEmailSending(true);
    try {
      const res = await fetch(`/api/policies/${detail.policyId}/send-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: htmlEmailTo.trim(),
          subject: htmlEmailSubject,
          htmlContent: htmlEmailHtml,
          plainText: htmlEmailPlain,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send");
      }
      toast.success(`Email sent to ${htmlEmailTo}`);
      setHtmlEmailOpen(false);

      // Mark as sent in tracking
      if (selected) {
        const hasAudienceSections = selected.meta?.sections?.some(
          (s) => s.audience === "client" || s.audience === "agent",
        );
        const isAgent = hasAudienceSections ? selectedAudience === "agent" : !!(selected.meta?.isAgentTemplate || (selected.meta?.enableAgentCopy && selectedAudience === "agent"));
        const trackKey = isAgent
          ? toTrackingKey(selected.label) + "_agent"
          : toTrackingKey(selected.label);
        if (!tracking[trackKey] || tracking[trackKey]?.status !== "confirmed") {
          await handleTrackingAction(trackKey, "send", htmlEmailTo.trim(), selected.meta?.documentPrefix || undefined, isAgent ? "(A)" : undefined, selected.meta?.documentSetGroup || undefined, selected.meta?.type);
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setHtmlEmailSending(false);
    }
  }, [htmlEmailTo, htmlEmailSubject, htmlEmailHtml, htmlEmailPlain, detail.policyId, selected, selectedAudience, tracking, handleTrackingAction]);

  const [policyInsurerIds, setPolicyInsurerIds] = React.useState<number[] | null>(null);
  const [policyLineKeys, setPolicyLineKeys] = React.useState<Set<string> | null>(null);
  const [policyInvoiceTypes, setPolicyInvoiceTypes] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    setInitialSelectionApplied(false);
  }, [initialTemplateValue, initialAudience, detail.policyId]);

  React.useEffect(() => {
    if (!initialTemplateValue) return;
    if (loading) return;
    if (selected) return;
    if (initialSelectionApplied) return;
    const matched = templates.find((t) => t.value === initialTemplateValue)
      ?? templates.find((t) => toTrackingKey(t.label) === toTrackingKey(initialTemplateValue));
    if (!matched) {
      setInitialSelectionApplied(true);
      return;
    }
    setSelected(matched);
    setSelectedAudience(initialAudience === "agent" ? "agent" : "client");
    setInitialSelectionApplied(true);
  }, [initialTemplateValue, initialAudience, loading, selected, templates, initialSelectionApplied]);


  React.useEffect(() => {
    if (statusesLoading) return;
    let cancelled = false;
    setLoading(true);

    const ts = Date.now();
    const hasEndorsements = endorsements && endorsements.length > 0;

    const effectiveStatusOrder = Array.from(new Set([
      ...statusOrder,
      ...FALLBACK_POLICY_STATUS_ORDER,
    ]));
    const getStatusForAudience = (audience: "client" | "agent") =>
      audience === "agent" ? statusAgent : statusClient;
    const matchesStatus = (sws: string[] | undefined, audience: "client" | "agent") => {
      if (!sws || sws.length === 0) return true;
      const status = getStatusForAudience(audience);
      const currentIdx = effectiveStatusOrder.indexOf(status);
      const earliestIdx = Math.min(
        ...sws.map((s) => effectiveStatusOrder.indexOf(s)).filter((i) => i >= 0),
      );
      if (currentIdx < 0 || earliestIdx === Infinity) return sws.includes(status);
      return currentIdx >= earliestIdx;
    };
    const matchesStatusForAudience = (
      meta: Pick<DocumentTemplateMeta, "showWhenStatus" | "showWhenStatusClient" | "showWhenStatusAgent">,
      audience: "client" | "agent",
    ) => {
      const audienceRule = audience === "agent" ? meta.showWhenStatusAgent : meta.showWhenStatusClient;
      const rule = audienceRule && audienceRule.length > 0 ? audienceRule : meta.showWhenStatus;
      return matchesStatus(rule, audience);
    };
    const matchesTemplateStatus = (meta: DocumentTemplateMeta) => {
      const hasAudienceSections = !!meta.enableAgentCopy || !!meta.sections?.some((s) => s.audience === "client" || s.audience === "agent");
      if (meta.isAgentTemplate && !hasAudienceSections) return matchesStatusForAudience(meta, "agent");
      if (!hasAudienceSections) return matchesStatusForAudience(meta, "client");
      return matchesStatusForAudience(meta, "client") || matchesStatusForAudience(meta, "agent");
    };

    // Fire ALL requests in parallel — don't wait for insurer/line data before loading templates
    const pInsurers = fetch(`/api/policies/${detail.policyId}/linked-insurers`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { insurerPolicyIds: [] }))
      .then((d: { insurerPolicyIds?: number[] }) => d.insurerPolicyIds ?? [])
      .catch(() => [] as number[]);

    const pLines = fetch(`/api/policies/${detail.policyId}/premiums?_t=${ts}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((d: { lines?: { lineKey?: string }[] }) =>
        new Set((d.lines ?? []).map((l) => l.lineKey ?? "").filter(Boolean)),
      )
      .catch(() => new Set<string>());

    const pInvoices = fetch(`/api/accounting/invoices/by-policy/${detail.policyId}?_t=${ts}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ invoiceType?: string }> | unknown) => {
        if (!Array.isArray(rows)) return new Set<string>();
        return new Set(rows.map((row) => String(row?.invoiceType ?? "").toLowerCase()).filter(Boolean));
      })
      .catch(() => new Set<string>());

    const pHtml = fetch(`/api/form-options?groupKey=document_templates&_t=${ts}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [] as DocumentTemplateRow[]);

    const pPdf = fetch(`/api/form-options?groupKey=pdf_merge_templates&_t=${ts}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [] as PdfTemplateRow[]);

    Promise.all([pInsurers, pLines, pInvoices, pHtml, pPdf]).then(
      ([insurerIds, lineKeys, invoiceTypes, htmlRows, pdfRows]) => {
        if (cancelled) return;

        setPolicyInsurerIds(insurerIds);
        setPolicyLineKeys(lineKeys);
        setPolicyInvoiceTypes(invoiceTypes);

        const matchingIds = [...new Set([detail.policyId, ...insurerIds])];
        const matchesInsurer = (tplInsurerIds: number[] | undefined) => {
          if (!tplInsurerIds || tplInsurerIds.length === 0) return true;
          return matchingIds.some((pid) => tplInsurerIds.includes(pid));
        };
        const matchesLineKey = (key: string | undefined) => {
          if (!key) return true;
          return lineKeys.size === 0 || lineKeys.has(key);
        };

        const applicable = (htmlRows as DocumentTemplateRow[]).filter((r) => {
          if (!r.meta) return false;
          if (onlyTemplateValue) return r.value === onlyTemplateValue;
          const placements = resolveDocumentTemplateShowOn(r.meta);
          if (!placements.includes("policy")) return false;
          const hasInsurerRestriction = r.meta.insurerPolicyIds && r.meta.insurerPolicyIds.length > 0;
          if (!hasInsurerRestriction) {
            const flows = r.meta.flows;
            if (flows && flows.length > 0) {
              if (!flowKey || !flows.includes(flowKey)) return false;
            }
          } else {
            if (!matchesInsurer(r.meta.insurerPolicyIds)) return false;
          }
          if (!matchesTemplateStatus(r.meta)) return false;
          if (!matchesLineKey(r.meta.accountingLineKey)) return false;
          return true;
        });
        setTemplates(applicable);

        if (hasEndorsements) {
          const endorseTemplates = (htmlRows as DocumentTemplateRow[]).filter((r) => {
            if (!r.meta) return false;
            const placements = resolveDocumentTemplateShowOn(r.meta);
            if (!placements.includes("policy")) return false;
            const flows = r.meta.flows;
            return flows && flows.length > 0 && flows.includes("endorsement");
          });
          setEndorsementTemplates(endorseTemplates);
        }

        const applicablePdf = (pdfRows as PdfTemplateRow[]).filter((r) => {
          const meta = r.meta as unknown as PdfTemplateMeta | null;
          if (!meta) return false;
          const placements = resolvePdfTemplateShowOn(meta);
          if (!placements.includes("policy")) return false;
          if (!meta.fields?.length && !meta.pages?.length) return false;
          const hasInsurerRestriction = meta.insurerPolicyIds && meta.insurerPolicyIds.length > 0;
          if (!hasInsurerRestriction) {
            const flows = meta.flows;
            if (flows && flows.length > 0) {
              if (!flowKey || !flows.includes(flowKey)) return false;
            }
          } else {
            if (!matchesInsurer(meta.insurerPolicyIds)) return false;
          }
          if (!matchesStatus(meta.showWhenStatus, "client")) return false;
          if (!matchesLineKey(meta.accountingLineKey)) return false;
          return true;
        });
        setPdfTemplates(applicablePdf);

        setLoading(false);
        setHasLoadedOnce(true);
      },
    );

    return () => { cancelled = true; };
  }, [flowKey, statusClient, statusAgent, detail.policyId, statusOrder, statusesLoading, onlyTemplateValue, endorsements]);

  // Auto-prepare: assign document numbers when templates become visible
  const [autoPrepared, setAutoPrepared] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (loading || templates.length === 0) return;

    const hasAgent = !!detail.agent;
    const templateHasAudienceSections = (tpl: DocumentTemplateRow) =>
      !!tpl.meta?.enableAgentCopy || !!tpl.meta?.sections?.some((s) => s.audience === "client" || s.audience === "agent");
    const effectiveStatusOrder = Array.from(new Set([
      ...statusOrder,
      ...FALLBACK_POLICY_STATUS_ORDER,
    ]));
    const getStatusForAudience = (audience: "client" | "agent") =>
      audience === "agent" ? statusAgent : statusClient;
    const matchesStatus = (sws: string[] | undefined, audience: "client" | "agent") => {
      if (!sws || sws.length === 0) return true;
      const status = getStatusForAudience(audience);
      const currentIdx = effectiveStatusOrder.indexOf(status);
      const earliestIdx = Math.min(
        ...sws.map((s) => effectiveStatusOrder.indexOf(s)).filter((i) => i >= 0),
      );
      if (currentIdx < 0 || earliestIdx === Infinity) return sws.includes(status);
      return currentIdx >= earliestIdx;
    };
    const matchesStatusForAudience = (tpl: DocumentTemplateRow, audience: "client" | "agent") => {
      const audienceRule = audience === "agent"
        ? tpl.meta?.showWhenStatusAgent
        : tpl.meta?.showWhenStatusClient;
      const rule = audienceRule && audienceRule.length > 0 ? audienceRule : tpl.meta?.showWhenStatus;
      return matchesStatus(rule, audience);
    };

    const toProcess: { key: string; prefix: string; suffix?: string; group?: string; tplType?: string }[] = [];

    for (const tpl of templates) {
      const prefix = tpl.meta?.documentPrefix;
      if (!prefix) continue;
      const group = tpl.meta?.documentSetGroup;
      const tplType = tpl.meta?.type;
      if (tplType === "credit_note" || tplType === "debit_note") continue;
      const canRenderAgentCopy = hasAgent && (templateHasAudienceSections(tpl) || !!tpl.meta?.isAgentTemplate || !!tpl.meta?.enableAgentCopy);

      const baseKey = toTrackingKey(tpl.label);
      if (
        !tpl.meta?.isAgentTemplate
        && matchesStatusForAudience(tpl, "client")
        && !tracking[baseKey]?.documentNumber
        && !autoPrepared.has(baseKey)
      ) {
        toProcess.push({ key: baseKey, prefix, group, tplType });
      }
      if (canRenderAgentCopy && matchesStatusForAudience(tpl, "agent")) {
        const agentKey = baseKey + "_agent";
        if (!tracking[agentKey]?.documentNumber && !autoPrepared.has(agentKey)) {
          toProcess.push({ key: agentKey, prefix, suffix: "(A)", group, tplType });
        }
      }
    }

    for (const tpl of pdfTemplates) {
      const meta = tpl.meta as unknown as { documentPrefix?: string; isAgentTemplate?: boolean; documentSetGroup?: string; type?: string } | null;
      const prefix = meta?.documentPrefix;
      if (!prefix) continue;
      const key = toTrackingKey(tpl.label);
      if (!tracking[key]?.documentNumber && !autoPrepared.has(key)) {
        toProcess.push({ key, prefix, suffix: meta?.isAgentTemplate ? "(A)" : undefined, group: meta?.documentSetGroup, tplType: meta?.type });
      }
    }

    if (toProcess.length === 0) return;

    setAutoPrepared((prev) => {
      const next = new Set(prev);
      toProcess.forEach((p) => next.add(p.key));
      return next;
    });

    (async () => {
      for (const { key, prefix, suffix, group, tplType } of toProcess) {
        await handleTrackingAction(key, "prepare", undefined, prefix, suffix, group, tplType);
      }
    })();
  }, [loading, templates, pdfTemplates, tracking, detail.agent, autoPrepared, handleTrackingAction, statusClient, statusAgent, statusOrder]);

  // Auto-prepare: endorsement document numbers
  const [endorseAutoPrepared, setEndorseAutoPrepared] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (!endorsements || endorsements.length === 0 || endorsementTemplates.length === 0) return;
    const hasAgent = !!detail.agent;
    const tplSupportsAgent = (tpl: DocumentTemplateRow) =>
      !!tpl.meta?.enableAgentCopy || !!tpl.meta?.isAgentTemplate || !!tpl.meta?.sections?.some((s) => s.audience === "client" || s.audience === "agent");

    // Build sibling keys and group info
    const groupSiblings = new Map<string, string[]>();
    for (const tpl of endorsementTemplates) {
      const g = tpl.meta?.documentSetGroup;
      if (!g) continue;
      if (!groupSiblings.has(g)) groupSiblings.set(g, []);
      const arr = groupSiblings.get(g)!;
      arr.push(toTrackingKey(tpl.label));
      arr.push(toTrackingKey(tpl.label) + "_agent");
    }

    const extractCode = (docNum: string) => {
      const match = docNum.match(/-(\d{4})-(\d{4,6})/);
      return match ? match[2] : null;
    };

    type PrepItem = { endorsePolicyId: number; key: string; prefix: string; suffix?: string; group?: string; tplType?: string; resetFirst?: boolean };
    const toProcess: PrepItem[] = [];

    for (const e of endorsements) {
      const eTrk = endorsementTracking[e.policyId] ?? {};

      // Find the "reference" code for each group (from any existing client-copy number)
      const groupRefCode = new Map<string, string>();
      for (const tpl of endorsementTemplates) {
        const g = tpl.meta?.documentSetGroup;
        if (!g) continue;
        const baseKey = toTrackingKey(tpl.label);
        const clientNum = eTrk[baseKey]?.documentNumber;
        if (clientNum) {
          const code = extractCode(clientNum);
          if (code && !groupRefCode.has(g)) groupRefCode.set(g, code);
        }
      }

      for (const tpl of endorsementTemplates) {
        const prefix = tpl.meta?.documentPrefix;
        if (!prefix) continue;
        const tplType = tpl.meta?.type;
        if (tplType === "credit_note" || tplType === "debit_note") continue;
        const group = tpl.meta?.documentSetGroup;
        const baseKey = toTrackingKey(tpl.label);
        const prepKey = `${e.policyId}::${baseKey}`;

        if (!tpl.meta?.isAgentTemplate && !eTrk[baseKey]?.documentNumber && !endorseAutoPrepared.has(prepKey)) {
          toProcess.push({ endorsePolicyId: e.policyId, key: baseKey, prefix, group, tplType });
        }
        if (hasAgent && tplSupportsAgent(tpl)) {
          const agentKey = baseKey + "_agent";
          const agentPrepKey = `${e.policyId}::${agentKey}`;
          const agentNum = eTrk[agentKey]?.documentNumber;

          if (!agentNum && !endorseAutoPrepared.has(agentPrepKey)) {
            toProcess.push({ endorsePolicyId: e.policyId, key: agentKey, prefix, suffix: "(A)", group, tplType });
          } else if (agentNum && group && groupRefCode.has(group) && !endorseAutoPrepared.has(agentPrepKey)) {
            // Check if agent copy code matches client copy code
            const agentCode = extractCode(agentNum);
            const refCode = groupRefCode.get(group);
            if (agentCode && refCode && agentCode !== refCode) {
              toProcess.push({ endorsePolicyId: e.policyId, key: agentKey, prefix, suffix: "(A)", group, tplType, resetFirst: true });
            }
          }
        }
      }
    }

    if (toProcess.length === 0) return;

    setEndorseAutoPrepared((prev) => {
      const next = new Set(prev);
      toProcess.forEach((p) => next.add(`${p.endorsePolicyId}::${p.key}`));
      return next;
    });

    (async () => {
      for (const { endorsePolicyId, key, prefix, suffix, group, tplType, resetFirst } of toProcess) {
        try {
          // Reset mismatched numbers first
          if (resetFirst) {
            await fetch(`/api/policies/${endorsePolicyId}/document-tracking`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ docType: key, action: "reset" }),
            });
          }

          const body: Record<string, unknown> = { docType: key, action: "prepare" };
          if (prefix) body.documentPrefix = prefix;
          if (suffix) body.documentSuffix = suffix;
          if (group) {
            body.documentSetGroup = group;
            body.groupSiblingKeys = groupSiblings.get(group) ?? [];
          }
          if (tplType) body.templateType = tplType;
          const res = await fetch(`/api/policies/${endorsePolicyId}/document-tracking`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            const data = await res.json();
            setEndorsementTracking((prev) => ({
              ...prev,
              [endorsePolicyId]: data.documentTracking ?? {},
            }));
          }
        } catch { /* ignore */ }
      }
    })();
  }, [endorsements, endorsementTemplates, endorsementTracking, detail.agent, endorseAutoPrepared]);

  if (loading && !hasLoadedOnce) {
    return (
      <div className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Loading templates...
      </div>
    );
  }

  if (selected) {
    const selHasAudienceSections = selected.meta?.enableAgentCopy || selected.meta?.sections?.some(
      (s) => s.audience === "client" || s.audience === "agent",
    );
    const selKey = (selHasAudienceSections && selectedAudience === "agent") || selected.meta?.isAgentTemplate
      ? toTrackingKey(selected.label) + "_agent"
      : toTrackingKey(selected.label);
    const previewDetail = selectedEndorsement ? selectedEndorsement.detail : detail;
    const previewSnapshot = (previewDetail.extraAttributes ?? {}) as SnapshotData;
    const previewTracking = selectedEndorsement
      ? (endorsementTracking[selectedEndorsement.policyId] ?? {})
      : tracking;
    return (
      <div className="space-y-3">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-xs"
          onClick={() => { setSelected(null); setSelectedEndorsement(null); }}
        >
          <ChevronLeft className="h-3 w-3" />
          Back to templates
        </Button>
        {selectedEndorsement && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            <FileText className="h-3 w-3" />
            Endorsement {selectedEndorsement.policyNumber}
          </div>
        )}
        <DocumentPreview
          template={selected}
          detail={previewDetail}
          snapshot={previewSnapshot}
          trackingEntry={previewTracking[selKey]}
          tracking={previewTracking as Record<string, DocTrackingEntry> | null}
          docTrackingKey={selKey}
          audience={selectedAudience}
          renderMode={renderMode}
          onConfirmDoc={(key) => {
            setHtmlConfirmKey(key);
            setHtmlConfirmMethod("admin");
            setHtmlConfirmNote("");
            setHtmlConfirmFile(null);
          }}
          onOpenEmailDialog={handleOpenHtmlEmail}
        />

        {/* Confirm dialog for HTML documents */}
        <Dialog open={!!htmlConfirmKey} onOpenChange={(open) => { if (!open) setHtmlConfirmKey(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm Document Received</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                How would you like to confirm this document?
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant={htmlConfirmMethod === "admin" ? "default" : "outline"} onClick={() => setHtmlConfirmMethod("admin")} className="flex-1">
                  <ShieldCheck className="mr-1 h-4 w-4" />
                  Admin Confirm
                </Button>
                <Button size="sm" variant={htmlConfirmMethod === "upload" ? "default" : "outline"} onClick={() => setHtmlConfirmMethod("upload")} className="flex-1">
                  <Upload className="mr-1 h-4 w-4" />
                  Upload Proof
                </Button>
              </div>
              {htmlConfirmMethod === "admin" && (
                <div>
                  <Label>Admin Note (optional)</Label>
                  <textarea
                    value={htmlConfirmNote}
                    onChange={(e) => setHtmlConfirmNote(e.target.value)}
                    rows={3}
                    placeholder="e.g. Client confirmed via phone call..."
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  />
                </div>
              )}
              {htmlConfirmMethod === "upload" && (
                <div>
                  <Label>Upload signed document <span className="text-red-500">*</span></Label>
                  <Input type="file" onChange={(e) => setHtmlConfirmFile(e.target.files?.[0] || null)} className="mt-1" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
                  <div className="mt-1">
                    <Label>Note (optional)</Label>
                    <Input value={htmlConfirmNote} onChange={(e) => setHtmlConfirmNote(e.target.value)} placeholder="Optional note..." className="mt-1" />
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHtmlConfirmKey(null)}>Cancel</Button>
              <Button
                disabled={
                  htmlConfirmSubmitting ||
                  (htmlConfirmMethod === "upload" && !htmlConfirmFile)
                }
                onClick={async () => {
                  if (!htmlConfirmKey) return;
                  setHtmlConfirmSubmitting(true);
                  try {
                    const confirmTpl = templates.find((t) => toTrackingKey(t.label) === htmlConfirmKey || toTrackingKey(t.label) + "_agent" === htmlConfirmKey);
                    await handleConfirmWithProof(
                      htmlConfirmKey,
                      htmlConfirmMethod,
                      htmlConfirmNote.trim() || undefined,
                      htmlConfirmFile || undefined,
                      confirmTpl?.meta?.type,
                    );
                    setHtmlConfirmKey(null);
                  } finally {
                    setHtmlConfirmSubmitting(false);
                  }
                }}
              >
                {htmlConfirmSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Send Email dialog for HTML documents (uses Brevo) */}
        <Dialog open={htmlEmailOpen} onOpenChange={setHtmlEmailOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <span className="flex items-center gap-2">
                  Email Document
                  {selected?.meta?.sections?.some((s) => s.audience === "client" || s.audience === "agent") && (
                    <span className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      selectedAudience === "agent"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
                    )}>
                      {selectedAudience === "agent" ? "Agent Copy" : "Client Copy"}
                    </span>
                  )}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="html-email-to">
                  {selectedAudience === "agent" ? "Agent Email" : "Recipient Email"}
                </Label>
                <Input
                  id="html-email-to"
                  type="email"
                  placeholder={selectedAudience === "agent" ? "agent@example.com" : "client@example.com"}
                  value={htmlEmailTo}
                  onChange={(e) => setHtmlEmailTo(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="html-email-subject">Subject</Label>
                <Input
                  id="html-email-subject"
                  value={htmlEmailSubject}
                  onChange={(e) => setHtmlEmailSubject(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setHtmlEmailOpen(false)} disabled={htmlEmailSending}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSendHtmlEmail} disabled={htmlEmailSending || !htmlEmailTo.trim()}>
                {htmlEmailSending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-1.5 h-3.5 w-3.5" />
                    Send via Brevo
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const effectiveStatusOrder = Array.from(new Set([
    ...statusOrder,
    ...FALLBACK_POLICY_STATUS_ORDER,
  ]));
  const matchesStatusRule = (rule: string[] | undefined, aud: "client" | "agent") => {
    if (!rule || rule.length === 0) return true;
    const status = aud === "agent" ? statusAgent : statusClient;
    const currentIdx = effectiveStatusOrder.indexOf(status);
    const earliestIdx = Math.min(
      ...rule.map((s) => effectiveStatusOrder.indexOf(s)).filter((i) => i >= 0),
    );
    if (currentIdx < 0 || earliestIdx === Infinity) return rule.includes(status);
    return currentIdx >= earliestIdx;
  };
  const templateMatchesAudienceStatus = (tpl: DocumentTemplateRow, aud: "client" | "agent") => {
    const audienceRule = aud === "agent"
      ? tpl.meta?.showWhenStatusAgent
      : tpl.meta?.showWhenStatusClient;
    const rule = audienceRule && audienceRule.length > 0 ? audienceRule : tpl.meta?.showWhenStatus;
    return matchesStatusRule(rule, aud);
  };
  const hasRealTrackingActionForAudience = (tpl: DocumentTemplateRow, aud: "client" | "agent") => {
    const key = aud === "agent" ? `${toTrackingKey(tpl.label)}_agent` : toTrackingKey(tpl.label);
    const status = tracking[key]?.status;
    return status === "sent" || status === "confirmed";
  };
  const isActionGatedTemplateVisibleForAudience = (tpl: DocumentTemplateRow, aud: "client" | "agent") => {
    const docType = tpl.meta?.type;
    if (docType === "credit_note") {
      return hasRealTrackingActionForAudience(tpl, aud) || policyInvoiceTypes.has("credit_note");
    }
    if (docType === "debit_note") {
      return hasRealTrackingActionForAudience(tpl, aud) || policyInvoiceTypes.has("debit_note");
    }
    return true;
  };
  const showPdfMergeTemplates = renderMode === "policy" && !onlyTemplateValue;
  const hasAny = templates.some((tpl) =>
    (templateMatchesAudienceStatus(tpl, "client") && isActionGatedTemplateVisibleForAudience(tpl, "client"))
    || (detail.agent
      ? (templateMatchesAudienceStatus(tpl, "agent") && isActionGatedTemplateVisibleForAudience(tpl, "agent"))
      : false),
  ) || (showPdfMergeTemplates && pdfTemplates.length > 0)
    || (endorsements && endorsements.length > 0 && endorsementTemplates.length > 0);

  if (!hasAny) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <FileText className="mx-auto mb-2 h-8 w-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
          No document templates
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          Go to Admin &rarr; Policy Settings &rarr; Document Templates or PDF Mail Merge
          to create templates.
        </p>
      </div>
    );
  }

  const policyHasAgent = !!detail.agent;
  const visibleForClient = (tpl: DocumentTemplateRow) =>
    templateMatchesAudienceStatus(tpl, "client")
    && isActionGatedTemplateVisibleForAudience(tpl, "client");
  const visibleForAgent = (tpl: DocumentTemplateRow) =>
    templateMatchesAudienceStatus(tpl, "agent")
    && isActionGatedTemplateVisibleForAudience(tpl, "agent");
  const visibleTemplates = templates.filter((tpl) =>
    visibleForClient(tpl) || (policyHasAgent && visibleForAgent(tpl)),
  );
  const templateSupportsAgent = (tpl: DocumentTemplateRow) =>
    !!tpl.meta?.enableAgentCopy || !!tpl.meta?.isAgentTemplate || !!tpl.meta?.sections?.some((s) => s.audience === "client" || s.audience === "agent");
  const isDedicatedAgentTemplate = (tpl: DocumentTemplateRow) =>
    !!tpl.meta?.isAgentTemplate && !tpl.meta?.enableAgentCopy;
  const isStatementTemplate = (tpl: DocumentTemplateRow) => tpl.meta?.type === "statement";
  const clientTemplates = visibleTemplates.filter((tpl) =>
    visibleForClient(tpl) && (
      isStatementTemplate(tpl)
        ? !isDedicatedAgentTemplate(tpl)
        : (!isDedicatedAgentTemplate(tpl))
    )
  );
  const agentTemplates = visibleTemplates.filter((tpl) =>
    visibleForAgent(tpl) && (
      isStatementTemplate(tpl)
        ? isDedicatedAgentTemplate(tpl)
        : templateSupportsAgent(tpl)
    )
  );

  const endorseClientTemplates = endorsementTemplates.filter((tpl) =>
    !isDedicatedAgentTemplate(tpl),
  );
  const endorseAgentTemplates = endorsementTemplates.filter((tpl) =>
    templateSupportsAgent(tpl),
  );

  const hasEndorsementAgentDocs = endorsements && endorsements.length > 0 && endorseAgentTemplates.length > 0;
  const showGrouped = policyHasAgent && (agentTemplates.length > 0 || !!hasEndorsementAgentDocs);

  function renderTemplateButton(tpl: DocumentTemplateRow, aud: "client" | "agent", endorsement?: EndorsementEntry) {
    const isAgent = aud === "agent";
    const tKey = isAgent ? toTrackingKey(tpl.label) + "_agent" : toTrackingKey(tpl.label);
    const trkMap = endorsement ? (endorsementTracking[endorsement.policyId] ?? {}) : tracking;
    const tEntry = trkMap[tKey];
    const tBadge = tEntry?.status ? STATUS_BADGE[tEntry.status] : null;

    return (
      <button
        key={`${tpl.id}_${aud}${endorsement ? `_e${endorsement.policyId}` : ""}`}
        type="button"
        onClick={() => { setSelected(tpl); setSelectedAudience(aud); setSelectedEndorsement(endorsement ?? null); }}
        className={cn(
          "flex w-full items-center gap-3 rounded-md p-2.5 text-left transition-colors",
          tEntry?.status === "confirmed"
            ? "bg-green-50/70 dark:bg-green-950/20"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
        )}
      >
        <FileText className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{tpl.label}</span>
            {tBadge && (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-medium", tBadge.bg, tBadge.text)}>
                {tEntry?.status === "confirmed" && <CheckCircle2 className="h-2.5 w-2.5" />}
                {tEntry?.status === "sent" && <Send className="h-2.5 w-2.5" />}
                {tBadge.label}
              </span>
            )}
          </div>
          {tEntry?.documentNumber ? (
            <div className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
              {tEntry.documentNumber}
            </div>
          ) : (
            <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {tpl.meta?.type
                ? tpl.meta.type.charAt(0).toUpperCase() + tpl.meta.type.slice(1)
                : "Document"}
            </div>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {visibleTemplates.length > 0 && showGrouped ? (
        <>
          {/* Client Documents Group */}
          <div className="rounded-lg border-2 border-blue-200 dark:border-blue-800 overflow-hidden">
            <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 dark:bg-blue-950/30">
              <FileText className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Client Documents</span>
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {clientTemplates.map((tpl) => renderTemplateButton(tpl, "client"))}
            </div>
            {endorsements && endorsements.length > 0 && endorseClientTemplates.length > 0 && endorsements.map((e) => (
              <div key={`endorse-client-${e.policyId}`}>
                <div className="flex items-center gap-1.5 bg-amber-50/60 px-3 py-1.5 border-t border-blue-200 dark:border-blue-800 dark:bg-amber-950/20">
                  <FileText className="h-3 w-3 text-amber-500" />
                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Endorsement {e.policyNumber}</span>
                </div>
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {endorseClientTemplates.map((tpl) => renderTemplateButton(tpl, "client", e))}
                </div>
              </div>
            ))}
          </div>

          {/* Agent Documents Group */}
          <div className="rounded-lg border-2 border-amber-200 dark:border-amber-800 overflow-hidden">
            <div className="flex items-center gap-2 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
              <FileText className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Agent Documents</span>
              {detail.agent?.name && (
                <span className="text-[10px] text-amber-500 dark:text-amber-400">({detail.agent.name})</span>
              )}
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {agentTemplates.map((tpl) => renderTemplateButton(tpl, "agent"))}
            </div>
            {endorsements && endorsements.length > 0 && endorseAgentTemplates.length > 0 && endorsements.map((e) => (
              <div key={`endorse-agent-${e.policyId}`}>
                <div className="flex items-center gap-1.5 bg-amber-50/60 px-3 py-1.5 border-t border-amber-200 dark:border-amber-800 dark:bg-amber-950/20">
                  <FileText className="h-3 w-3 text-amber-500" />
                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Endorsement {e.policyNumber}</span>
                </div>
                <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {endorseAgentTemplates.map((tpl) => renderTemplateButton(tpl, "agent", e))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : visibleTemplates.length > 0 || (endorsements && endorsements.length > 0 && endorseClientTemplates.length > 0) ? (
        <>
          <div className="text-sm font-medium">Document Templates</div>
          {clientTemplates.map((tpl) => renderTemplateButton(tpl, "client"))}
          {endorsements && endorsements.length > 0 && endorseClientTemplates.length > 0 && endorsements.map((e) => (
            <React.Fragment key={`endorse-ungrouped-${e.policyId}`}>
              <div className="flex items-center gap-1.5 pt-2 pb-1">
                <FileText className="h-3 w-3 text-amber-500" />
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Endorsement {e.policyNumber}</span>
              </div>
              {endorseClientTemplates.map((tpl) => renderTemplateButton(tpl, "client", e))}
            </React.Fragment>
          ))}
        </>
      ) : null}

      {showPdfMergeTemplates && pdfTemplates.length > 0 && (
        <>
          {visibleTemplates.length > 0 && <div className="border-t border-neutral-200 dark:border-neutral-800 pt-1" />}
          {pdfTemplates.map((tpl) => {
            const key = toTrackingKey(tpl.label);
            return (
              <PdfMergeButton
                key={tpl.id}
                tpl={tpl}
                policyId={detail.policyId}
                trackingKey={key}
                entry={tracking[key]}
                updating={trackingUpdating}
                onEmailClick={handleEmailClick}
                onWhatsAppClick={handleWhatsAppClick}
                onTrackingAction={handleTrackingAction}
                onConfirmWithProof={handleConfirmWithProof}
              />
            );
          })}
          {pdfTemplates.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => { setEmailPreSelectedId(undefined); setEmailDialogOpen(true); }}
            >
              <Mail className="h-3.5 w-3.5" />
              Email All Documents ({pdfTemplates.length})
            </Button>
          )}
        </>
      )}

      <SendEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        policyId={detail.policyId}
        policyNumber={detail.policyNumber}
        pdfTemplates={pdfTemplates}
        preSelectedId={emailPreSelectedId}
        defaultEmail={(() => {
          if (emailPreSelectedId) {
            const tpl = pdfTemplates.find((t) => t.id === emailPreSelectedId);
            const m = tpl?.meta as unknown as { isAgentTemplate?: boolean } | null;
            if (m?.isAgentTemplate && detail.agent?.email) return detail.agent.email;
          }
          const ins = (detail.extraAttributes as Record<string, unknown> | undefined)?.insuredSnapshot as Record<string, unknown> | undefined;
          return String(ins?.email ?? ins?.contactinfo__email ?? "");
        })()}
        onSent={async (labels, sentEmail) => {
          for (const label of labels) {
            const key = toTrackingKey(label);
            if (!tracking[key] || tracking[key]?.status !== "confirmed") {
              const matchingTpl = pdfTemplates.find((t) => t.label === label);
              const tplMeta = matchingTpl?.meta as unknown as { documentPrefix?: string; isAgentTemplate?: boolean; documentSetGroup?: string; type?: string } | null;
              await handleTrackingAction(key, "send", sentEmail, tplMeta?.documentPrefix || undefined, tplMeta?.isAgentTemplate ? "(A)" : undefined, tplMeta?.documentSetGroup || undefined, tplMeta?.type);
            }
          }
        }}
      />
    </div>
  );
}
