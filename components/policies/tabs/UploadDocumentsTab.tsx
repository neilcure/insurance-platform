"use client";

import * as React from "react";
import { Mail, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentUploadCard } from "@/components/ui/document-upload-card";
import {
  EmailUploadedFilesDialog,
  type EmailableDocGroup,
} from "@/components/policies/EmailUploadedFilesDialog";
import { usePolicyStatuses } from "@/hooks/use-policy-statuses";
import type {
  DocumentStatus,
  PolicyDocumentRow,
  PolicyPaymentRecord,
  PremiumBreakdown,
  UploadDocumentTypeRow,
  DocumentRequirement,
} from "@/lib/types/upload-document";

const FALLBACK_POLICY_STATUS_ORDER = [
  "quotation_prepared",
  "quotation_sent",
  "quotation_confirmed",
  "invoice_prepared",
  "invoice_sent",
  "pending_payment",
  "payment_received",
  "confirmed",
  "bound",
  "active",
  "completed",
] as const;

function computeDisplayStatus(
  uploads: PolicyDocumentRow[],
  payments?: PolicyPaymentRecord[],
): DocumentStatus {
  if (uploads.some((u) => u.status === "verified")) return "verified";
  if (payments && payments.length > 0) {
    const hasVerified = payments.some(
      (p) =>
        (!p.direction || p.direction === "receivable") &&
        (p.status === "verified" || p.status === "confirmed" || p.status === "recorded"),
    );
    if (hasVerified) return "verified";
  }
  if (uploads.length === 0) return "outstanding";
  if (uploads.some((u) => u.status === "uploaded")) return "uploaded";
  if (uploads.every((u) => u.status === "rejected")) return "rejected";
  return "outstanding";
}

export type UploadSummary = {
  total: number;
  verified: number;
  pending: number;
  outstanding: number;
  rejected: number;
};

type ScheduleInfo = {
  id: number;
  entityType: string;
  entityName: string | null;
  frequency: string | null;
  billingDay: number | null;
};

export function UploadDocumentsTab({
  policyId,
  flowKey,
  isAdmin,
  currentStatus,
  insuredType,
  hasNcb,
  onSummaryChange,
  onPaymentRecorded,
  filter = "all",
  parentPolicyId,
  parentSchedules,
  policyNumber,
  defaultEmail,
}: {
  policyId: number;
  flowKey?: string;
  isAdmin: boolean;
  currentStatus?: string;
  insuredType?: string;
  hasNcb?: boolean;
  onSummaryChange?: (summary: UploadSummary) => void;
  onPaymentRecorded?: () => void;
  filter?: "all" | "documents" | "payments";
  parentPolicyId?: number;
  parentSchedules?: ScheduleInfo[];
  /** Used to pre-fill the email subject. */
  policyNumber?: string;
  /** Pre-filled recipient when the user opens the Email Files dialog. */
  defaultEmail?: string;
}) {
  const { allOptions: statusOptionsFromHook } = usePolicyStatuses();
  const [requirements, setRequirements] = React.useState<DocumentRequirement[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [policyInsurerIds, setPolicyInsurerIds] = React.useState<number[] | null>(null);
  const [policyLineKeys, setPolicyLineKeys] = React.useState<Set<string>>(new Set());
  const [totalConfigured, setTotalConfigured] = React.useState(0);
  const [schedules, setSchedules] = React.useState<ScheduleInfo[]>(parentSchedules ?? []);
  const scheduleLookupId = parentPolicyId ?? policyId;
  React.useEffect(() => {
    if (parentSchedules) { setSchedules(parentSchedules); return; }
    fetch(`/api/accounting/schedules/by-policy/${scheduleLookupId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { schedules: [] }))
      .then((data) => setSchedules(data.schedules ?? []))
      .catch(() => setSchedules([]));
  }, [scheduleLookupId, parentSchedules]);

  const clientSchedule = schedules.find((s) => s.entityType === "client") ?? null;
  const agentSchedule = schedules.find((s) => s.entityType === "agent") ?? null;

  const [hasStatementInvoices, setHasStatementInvoices] = React.useState(false);
  React.useEffect(() => {
    const schedule = agentSchedule || clientSchedule;
    if (!schedule) return;
    if (policyId == null || !Number.isFinite(Number(policyId)) || Number(policyId) <= 0) return;
    fetch(`/api/accounting/invoices/by-policy/${policyId}?_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((invoices: { scheduleId: number | null; direction: string; invoiceType: string }[]) => {
        const onStatement = invoices
          .filter((inv) => inv.direction === "receivable" && inv.invoiceType !== "statement")
          .some((inv) => inv.scheduleId != null);
        setHasStatementInvoices(onStatement);
      })
      .catch(() => {});
  }, [policyId, agentSchedule, clientSchedule]);

  React.useEffect(() => {
    if (policyId == null || !Number.isFinite(Number(policyId)) || Number(policyId) <= 0) return;

    fetch(`/api/policies/${policyId}/linked-insurers`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { insurerPolicyIds: [] }))
      .then((data: { insurerPolicyIds?: number[] }) => {
        setPolicyInsurerIds(data.insurerPolicyIds ?? []);
      })
      .catch(() => setPolicyInsurerIds([]));

    fetch(`/api/policies/${policyId}/premiums?_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((data: { lines?: { lineKey?: string }[] }) => {
        const keys = new Set((data.lines ?? []).map((l) => l.lineKey ?? "").filter(Boolean));
        setPolicyLineKeys(keys);
      })
      .catch(() => {});
  }, [policyId]);

  React.useEffect(() => {
    if (policyInsurerIds === null) return;
    if (policyId == null || !Number.isFinite(Number(policyId)) || Number(policyId) <= 0) return;
    let cancelled = false;
    setLoading(true);

    const matchingIds = [...new Set([policyId, ...policyInsurerIds])];
    const matchesInsurer = (tplInsurerIds: number[] | undefined) => {
      if (!tplInsurerIds || tplInsurerIds.length === 0) return true;
      return matchingIds.some((pid) => tplInsurerIds.includes(pid));
    };

    Promise.all([
      fetch(`/api/form-options?groupKey=upload_document_types&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`/api/policies/${policyId}/documents?_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { documents: [], payments: [] }))
        .catch(() => ({ documents: [], payments: [] })),
      fetch(`/api/policies/${policyId}/premium-summary?_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([types, docsData, premiumData]: [UploadDocumentTypeRow[], { documents: PolicyDocumentRow[]; payments: PolicyPaymentRecord[] } | PolicyDocumentRow[], PremiumBreakdown | null]) => {
      const uploads: PolicyDocumentRow[] = Array.isArray(docsData) ? docsData : docsData.documents;
      const policyPayments: PolicyPaymentRecord[] = Array.isArray(docsData) ? [] : (docsData.payments ?? []);
      if (cancelled) return;
      setTotalConfigured(types.length);

      const effectiveStatusOrder = Array.from(new Set([
        ...statusOptionsFromHook.map((s) => s.value),
        ...FALLBACK_POLICY_STATUS_ORDER,
      ]));

      const applicable = types.filter((t) => {
        // Flow + Insurer restrictions are AND-ed: a template flagged
        // for both flow X and insurer Y now only shows on policies
        // that match BOTH (previously the insurer restriction
        // silently bypassed the flow check).
        const flows = t.meta?.flows;
        if (flows && flows.length > 0) {
          if (!flowKey || !flows.includes(flowKey)) return false;
        }
        if (!matchesInsurer(t.meta?.insurerPolicyIds)) return false;

        const sws = t.meta?.showWhenStatus;
        if (sws && sws.length > 0) {
          const status = currentStatus || "quotation_prepared";
          const hasUploadsForType = uploads.some((u) => u.documentTypeKey === t.value);
          if (!hasUploadsForType) {
            const curIdx = effectiveStatusOrder.indexOf(status);
            const earliestIdx = Math.min(
              ...sws.map((s) => effectiveStatusOrder.indexOf(s)).filter((i) => i >= 0),
            );
            if (curIdx < 0 || earliestIdx === Infinity) {
              if (!sws.includes(status)) return false;
            } else if (curIdx < earliestIdx) {
              return false;
            }
          }
        }

        const its = t.meta?.insuredTypes;
        if (its && its.length > 0 && insuredType) {
          if (!its.includes(insuredType)) return false;
        }

        const alk = t.meta?.accountingLineKey;
        if (alk && policyLineKeys.size > 0 && !policyLineKeys.has(alk)) return false;
        if (t.meta?.requireNcb && !hasNcb) return false;
        return true;
      });

      const reqs: DocumentRequirement[] = applicable.map((t) => {
        const typeUploads = uploads.filter((u) => u.documentTypeKey === t.value);
        const isPaymentType = t.meta?.requirePaymentDetails === true;
        return {
          typeKey: t.value,
          label: t.label,
          meta: t.meta,
          displayStatus: computeDisplayStatus(typeUploads, isPaymentType ? policyPayments : undefined),
          uploads: typeUploads,
          ...(isPaymentType ? { payments: policyPayments, premiumBreakdown: premiumData ?? undefined } : {}),
        };
      });

      // Include orphaned uploads (uploaded for types no longer in config)
      const knownKeys = new Set(applicable.map((t) => t.value));
      const orphanedUploads = uploads.filter((u) => !knownKeys.has(u.documentTypeKey));
      const orphanedGroups = new Map<string, PolicyDocumentRow[]>();
      for (const u of orphanedUploads) {
        const arr = orphanedGroups.get(u.documentTypeKey) ?? [];
        arr.push(u);
        orphanedGroups.set(u.documentTypeKey, arr);
      }
      for (const [key, docs] of orphanedGroups) {
        reqs.push({
          typeKey: key,
          label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          meta: null,
          displayStatus: computeDisplayStatus(docs),
          uploads: docs,
        });
      }

      const filtered = filter === "all"
        ? reqs
        : filter === "payments"
          ? reqs.filter((r) => r.meta?.requirePaymentDetails)
          : reqs.filter((r) => !r.meta?.requirePaymentDetails);
      setRequirements(filtered);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [policyId, flowKey, currentStatus, refreshKey, policyInsurerIds, policyLineKeys, insuredType, hasNcb, filter, statusOptionsFromHook]);

  const summaryRef = React.useRef(onSummaryChange);
  summaryRef.current = onSummaryChange;

  React.useEffect(() => {
    if (loading) return;
    const s: UploadSummary = {
      total: requirements.length,
      verified: requirements.filter((r) => r.displayStatus === "verified").length,
      pending: requirements.filter((r) => r.displayStatus === "uploaded").length,
      outstanding: requirements.filter((r) => r.displayStatus === "outstanding").length,
      rejected: requirements.filter((r) => r.displayStatus === "rejected").length,
    };
    summaryRef.current?.(s);
  }, [requirements, loading]);

  function refresh() {
    setRefreshKey((k) => k + 1);
    onPaymentRecorded?.();
  }

  // Group ALL non-rejected uploads across the visible requirements
  // for the "Email Files" picker. We deliberately skip rejected
  // files (per product spec) — verified + pending verification are
  // the meaningful "the file exists, it's worth sending" states.
  // Filter only kicks in when this tab is showing the "documents"
  // (or "all") slice; when filter==="payments" the parent already
  // hides everything else, so the picker is naturally scoped.
  const emailableGroups: EmailableDocGroup[] = React.useMemo(() => {
    const groups: EmailableDocGroup[] = [];
    for (const req of requirements) {
      const usable = req.uploads.filter((u) => u.status !== "rejected");
      if (usable.length === 0) continue;
      groups.push({
        typeKey: req.typeKey,
        label: req.label,
        uploads: usable,
      });
    }
    return groups;
  }, [requirements]);

  const totalEmailableFiles = emailableGroups.reduce(
    (sum, g) => sum + g.uploads.length,
    0,
  );
  const [emailDialogOpen, setEmailDialogOpen] = React.useState(false);
  // The Email Files affordance only makes sense for the
  // "documents" slice — rendering it next to payment cards would
  // be confusing. The "all" filter (no parent filtering) also
  // benefits, e.g. when this tab is mounted standalone.
  const showEmailFilesButton =
    filter !== "payments" && totalEmailableFiles > 0;

  if (loading) {
    if (filter === "payments") return null;
    return (
      <div className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Loading documents...
      </div>
    );
  }

  if (requirements.length === 0) {
    if (filter === "payments") return null;
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <Upload className="mx-auto mb-2 h-8 w-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
          No upload requirements
        </div>
        {totalConfigured === 0 ? (
          <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            Go to Admin &rarr; Policy Settings &rarr; Upload Documents to configure
            document types that need to be collected.
          </p>
        ) : isAdmin && (
          <div className="mt-2 space-y-1 text-[11px] text-neutral-400 dark:text-neutral-500">
            <p>{totalConfigured} document type{totalConfigured !== 1 ? "s" : ""} configured but none match this policy.</p>
            <p>
              Policy context: flow=<span className="font-mono">{flowKey ?? "(none)"}</span>,
              status=<span className="font-mono">{currentStatus ?? "quotation_prepared"}</span>,
              insured=<span className="font-mono">{insuredType ?? "(unknown)"}</span>
              {hasNcb && ", NCB=yes"}
            </p>
            <p>Check Flows, Status, Insured Type, and Insurance Company filters in Admin &rarr; Upload Documents.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showEmailFilesButton && (
        <div className="flex items-center justify-between gap-2 pb-1">
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {totalEmailableFiles} file{totalEmailableFiles === 1 ? "" : "s"} available
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[11px] px-2"
            onClick={() => setEmailDialogOpen(true)}
            title="Send selected uploaded files in one email"
          >
            <Mail className="h-3.5 w-3.5" />
            Email Files
          </Button>
        </div>
      )}

      {requirements.map((req) => (
        <DocumentUploadCard
          key={req.typeKey}
          typeKey={req.typeKey}
          label={req.label}
          meta={req.meta}
          displayStatus={req.displayStatus}
          uploads={req.uploads}
          payments={req.payments}
          premiumBreakdown={req.premiumBreakdown}
          policyId={policyId}
          isAdmin={isAdmin}
          onRefresh={refresh}
          onStatementToggled={() => onPaymentRecorded?.()}
          clientSchedule={clientSchedule}
          agentSchedule={agentSchedule}
          hasStatementInvoices={hasStatementInvoices}
        />
      ))}

      {showEmailFilesButton && (
        <EmailUploadedFilesDialog
          open={emailDialogOpen}
          onOpenChange={setEmailDialogOpen}
          policyId={policyId}
          policyNumber={policyNumber}
          defaultEmail={defaultEmail}
          groups={emailableGroups}
        />
      )}
    </div>
  );
}
