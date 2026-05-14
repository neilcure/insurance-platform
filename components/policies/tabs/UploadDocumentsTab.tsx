"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { DocumentUploadCard } from "@/components/ui/document-upload-card";
import { DocumentActionBar } from "@/components/document-delivery/DocumentActionBar";
import { type DeliveryDocGroup } from "@/lib/document-delivery";
import { usePolicyStatuses } from "@/hooks/use-policy-statuses";
import type {
  PolicyDocumentRow,
  PolicyPaymentRecord,
  PremiumBreakdown,
  UploadDocumentTypeRow,
  DocumentRequirement,
} from "@/lib/types/upload-document";
import {
  buildUploadStatusOrdinalMap,
  buildVisibleDocumentRequirements,
  isOfficeProvidedReq,
} from "@/lib/policies/upload-requirement-build";

export type { TaskListPreviewItem } from "@/lib/policies/upload-requirement-build";

export type UploadSummary = {
  /** All visible requirement slots (documents + payments in this slice) */
  total: number;
  verified: number;
  /** Slots the client/agent is expected to supply (excludes uploadSource admin) — used for progress X/Y */
  userTaskTotal: number;
  userVerified: number;
  pending: number;
  outstanding: number;
  awaitingOffice: number;
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
  defaultPhone,
  defaultRecipientName,
  viewerUserType,
  documentSubset = "all",
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
  /** When showing document requirements in split Workflow sections (`task-list` vs `final-documents`). Ignored unless `filter` is `"documents"` or `"all"`. */
  documentSubset?: "all" | "task-list" | "final-documents";
  parentPolicyId?: number;
  parentSchedules?: ScheduleInfo[];
  /** Used to pre-fill the email subject. */
  policyNumber?: string;
  /** Pre-filled recipient when the user opens the Email Files dialog. */
  defaultEmail?: string;
  /** Pre-filled mobile when the user opens the WhatsApp Files dialog. */
  defaultPhone?: string;
  /** Pre-filled recipient name shown in the WhatsApp message body. */
  defaultRecipientName?: string;
  /** Logged-in `user.user_type`; filters by `meta.visibleToUserTypes` when set. */
  viewerUserType?: string | null;
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

  const statusOrdinalMap = React.useMemo(
    () => buildUploadStatusOrdinalMap(statusOptionsFromHook),
    [statusOptionsFromHook],
  );

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

      const visible = buildVisibleDocumentRequirements({
        types,
        uploads,
        policyPayments,
        premiumData,
        insurerPolicyIds: policyInsurerIds,
        policyLineKeys,
        policyNumericId: policyId,
        flowKey,
        currentStatus,
        insuredType,
        hasNcb: hasNcb ?? false,
        viewerUserType,
        filter,
        documentSubset,
        statusOrdinalMap,
      });
      setRequirements(visible);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [
    policyId,
    flowKey,
    currentStatus,
    refreshKey,
    policyInsurerIds,
    policyLineKeys,
    insuredType,
    hasNcb,
    filter,
    documentSubset,
    statusOptionsFromHook,
    statusOrdinalMap,
    viewerUserType,
  ]);

  const summaryRef = React.useRef(onSummaryChange);
  React.useEffect(() => {
    summaryRef.current = onSummaryChange;
  }, [onSummaryChange]);

  React.useEffect(() => {
    if (loading) return;
    const userFacing = requirements.filter((r) => !isOfficeProvidedReq(r));
    const s: UploadSummary = {
      total: requirements.length,
      verified: requirements.filter((r) => r.displayStatus === "verified").length,
      userTaskTotal: userFacing.length,
      userVerified: userFacing.filter((r) => r.displayStatus === "verified").length,
      pending: requirements.filter((r) => r.displayStatus === "uploaded").length,
      outstanding: requirements.filter((r) => r.displayStatus === "outstanding").length,
      awaitingOffice: requirements.filter((r) => r.displayStatus === "awaiting_office").length,
      rejected: requirements.filter((r) => r.displayStatus === "rejected").length,
    };
    summaryRef.current?.(s);
  }, [requirements, loading]);

  function refresh() {
    setRefreshKey((k) => k + 1);
    onPaymentRecorded?.();
  }

  // Group ALL non-rejected uploads across the visible requirements
  // for the share picker. We deliberately skip rejected files (per
  // product spec) — verified + pending verification are the
  // meaningful "the file exists, it's worth sending" states.
  // Filter only kicks in when this tab is showing the "documents"
  // (or "all") slice; when filter==="payments" the parent already
  // hides everything else, so the picker is naturally scoped.
  const shareableGroups: DeliveryDocGroup[] = React.useMemo(() => {
    const groups: DeliveryDocGroup[] = [];
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

  const totalShareableFiles = shareableGroups.reduce(
    (sum, g) => sum + g.uploads.length,
    0,
  );

  // The Email Files / WhatsApp Files affordances only make sense for
  // the "documents" slice — rendering them next to payment cards
  // would be confusing. The "all" filter (no parent filtering) also
  // benefits, e.g. when this tab is mounted standalone.
  const showShareButtons =
    filter !== "payments" && totalShareableFiles > 0;

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
          {documentSubset === "final-documents"
            ? "No final documents for this policy"
            : documentSubset === "task-list"
              ? "Nothing to collect yet"
              : "No upload requirements"}
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

  function renderRequirementCards(slice: DocumentRequirement[]) {
    return slice.map((req) => (
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
    ));
  }

  return (
    <div className="space-y-3">
      {showShareButtons && (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {totalShareableFiles} file{totalShareableFiles === 1 ? "" : "s"} available
          </div>
          <DocumentActionBar
            policyId={policyId}
            policyNumber={policyNumber}
            groups={shareableGroups}
            recipient={{
              email: defaultEmail,
              phone: defaultPhone,
              name: defaultRecipientName,
            }}
          />
        </div>
      )}

      {documentSubset !== "all" ? (
        <div className="space-y-3">{renderRequirementCards(requirements)}</div>
      ) : (() => {
        const clientAgentReqs: DocumentRequirement[] = [];
        const officeReqs: DocumentRequirement[] = [];
        for (const r of requirements) {
          if (isOfficeProvidedReq(r)) officeReqs.push(r);
          else clientAgentReqs.push(r);
        }
        return (
          <>
            {clientAgentReqs.length > 0 && (
              <div className="space-y-2">
                {officeReqs.length > 0 && (
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    Required from client or agent
                  </div>
                )}
                <div className="space-y-3">{renderRequirementCards(clientAgentReqs)}</div>
              </div>
            )}
            {officeReqs.length > 0 && (
              <div
                className={`space-y-2 ${clientAgentReqs.length > 0 ? "pt-3 border-t border-neutral-200 dark:border-neutral-800" : ""}`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Final documents
                </div>
                <div className="space-y-3">{renderRequirementCards(officeReqs)}</div>
              </div>
            )}
          </>
        );
      })()}

    </div>
  );
}
