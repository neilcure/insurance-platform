"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, FileText } from "lucide-react";
import type { PolicyDetail } from "@/lib/types/policy";
import { usePolicyStatuses } from "@/hooks/use-policy-statuses";
import { resolveDefaultRecipientFromExtra } from "@/lib/document-delivery";
import type { UploadSummary } from "@/components/policies/tabs/UploadDocumentsTab";

function emptyUploadSummary(): UploadSummary {
  return {
    total: 0,
    verified: 0,
    userTaskTotal: 0,
    userVerified: 0,
    pending: 0,
    outstanding: 0,
    awaitingOffice: 0,
    rejected: 0,
  };
}

type LinkedEndorsement = {
  policyId: number;
  policyNumber: string;
  status: string;
};

const StatusTab = React.lazy(() =>
  import("@/components/policies/tabs/StatusTab").then((m) => ({ default: m.StatusTab })),
);
const ActionsTab = React.lazy(() =>
  import("@/components/policies/tabs/ActionsTab").then((m) => ({ default: m.ActionsTab })),
);
const DocumentsTab = React.lazy(() =>
  import("@/components/policies/tabs/DocumentsTab").then((m) => ({ default: m.DocumentsTab })),
);
const UploadDocumentsTab = React.lazy(() =>
  import("@/components/policies/tabs/UploadDocumentsTab").then((m) => ({ default: m.UploadDocumentsTab })),
);
const PaymentSection = React.lazy(() =>
  import("@/components/policies/tabs/PaymentSection").then((m) => ({ default: m.PaymentSection })),
);

export function WorkflowTab({
  detail,
  flowKey,
  currentStatus,
  statusHistory,
  isAdmin,
  currentUserType,
  onRefresh,
  initialSection,
  initialDocTemplateValue,
  initialDocAudience,
}: {
  detail: PolicyDetail;
  flowKey?: string;
  currentStatus?: string;
  statusHistory?: Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>;
  isAdmin?: boolean;
  currentUserType?: string;
  onRefresh?: () => void;
  initialSection?: string;
  initialDocTemplateValue?: string;
  initialDocAudience?: "client" | "agent";
}) {
  const { getLabel } = usePolicyStatuses(flowKey);
  const [expandedSection, setExpandedSection] = React.useState<string | null>(initialSection ?? null);
  React.useEffect(() => {
    if (initialSection) setExpandedSection(initialSection);
  }, [initialSection]);

  const statusExtra = (detail.extraAttributes ?? {}) as Record<string, unknown>;
  const curStatusClient = String(statusExtra.statusClient ?? currentStatus ?? "quotation_prepared");
  const curStatusAgent = String(statusExtra.statusAgent ?? statusExtra.statusClient ?? currentStatus ?? "quotation_prepared");
  const historyClient = Array.isArray(statusExtra.statusHistoryClient)
    ? (statusExtra.statusHistoryClient as Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>)
    : (statusHistory ?? []);
  const historyAgent = Array.isArray(statusExtra.statusHistoryAgent)
    ? (statusExtra.statusHistoryAgent as Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>)
    : [];

  // Default recipient (email + phone + display name) for the Email
  // Files / WhatsApp Files dialogs. All three resolutions live in
  // `lib/document-delivery/recipient.ts` so every surface that
  // pre-fills a recipient field gets the same fallback chain.
  const defaultRecipient = React.useMemo(
    () => resolveDefaultRecipientFromExtra(detail.extraAttributes),
    [detail.extraAttributes],
  );
  const defaultEmailRecipient = defaultRecipient.email;
  const defaultPhoneRecipient = defaultRecipient.phone;
  const defaultRecipientName = defaultRecipient.name;

  const { insuredType, hasNcb } = React.useMemo(() => {
    const extra = (detail.extraAttributes ?? {}) as Record<string, unknown>;
    const insured = (extra.insuredSnapshot ?? {}) as Record<string, unknown>;
    const pkgs = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;

    const rawType = String(
      insured.insuredType ?? insured.insured__category ?? insured.category ?? "",
    ).trim().toLowerCase();
    const iType = rawType === "personal" || rawType === "company" ? rawType : undefined;

    const ncbPattern = /^(ncb|ncd|ncbpercent|ncdpercent|no.?claim.?(bonus|discount))/i;
    let foundNcb = false;
    const scanForNcb = (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) {
        if (ncbPattern.test(k) && v != null && v !== "" && v !== 0 && v !== "0") {
          foundNcb = true;
          return;
        }
      }
    };
    for (const [, pkgVal] of Object.entries(pkgs)) {
      if (pkgVal && typeof pkgVal === "object") {
        const pkg = pkgVal as Record<string, unknown>;
        if (pkg.values && typeof pkg.values === "object") {
          scanForNcb(pkg.values as Record<string, unknown>);
        } else {
          scanForNcb(pkg);
        }
        if (foundNcb) break;
      }
    }

    return { insuredType: iType, hasNcb: foundNcb };
  }, [detail.extraAttributes]);

  const [showOverride, setShowOverride] = React.useState(false);
  const [taskListUploadSummary, setTaskListUploadSummary] = React.useState<UploadSummary | null>(null);
  const [finalDocsUploadSummary, setFinalDocsUploadSummary] = React.useState<UploadSummary | null>(null);
  const [paymentSummary, setPaymentSummary] = React.useState<{
    totalOwed: number; totalPaid: number; totalPending: number; remaining: number;
    currency: string; invoiceCount: number; hasSubmitted: boolean;
    invoiceNumbers: string[];
    agentOwed?: number; agentPaid?: number; commissionCents?: number;
  } | null>(null);
  const [paymentRefreshKey, setPaymentRefreshKey] = React.useState(0);

  const isParentPolicy = !flowKey || flowKey === "policyset" || flowKey === "";
  const isClientFlow = (flowKey ?? "").toLowerCase() === "clientset";
  /** Main wizard policies omit `detail.flowKey` on some payloads — upload types restricted to Policies must still match `policyset`. */
  const uploadDocsFlowKey = React.useMemo(() => {
    const fromProp = flowKey?.trim();
    if (fromProp) return fromProp;
    const fromSnap = String((detail.extraAttributes as Record<string, unknown> | undefined)?.flowKey ?? "").trim();
    if (fromSnap) return fromSnap;
    const fromDetail = typeof (detail as { flowKey?: string }).flowKey === "string"
      ? String((detail as { flowKey?: string }).flowKey).trim()
      : "";
    if (fromDetail) return fromDetail;
    return "policyset";
  }, [flowKey, detail]);
  const [linkedEndorsements, setLinkedEndorsements] = React.useState<LinkedEndorsement[]>([]);
  const [endorsementDetails, setEndorsementDetails] = React.useState<Record<number, PolicyDetail>>({});
  const [endorsementTaskSummaries, setEndorsementTaskSummaries] = React.useState<Record<number, UploadSummary>>({});
  const [endorsementFinalSummaries, setEndorsementFinalSummaries] = React.useState<Record<number, UploadSummary>>({});

  // Shared schedule data — fetched once, passed to all endorsement UploadDocumentsTab instances
  const [parentSchedules, setParentSchedules] = React.useState<{ id: number; entityType: string; entityName: string | null; frequency: string | null; billingDay: number | null; isActive?: boolean }[]>([]);
  React.useEffect(() => {
    if (!isParentPolicy) return;
    fetch(`/api/accounting/schedules/by-policy/${detail.policyId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { schedules: [] }))
      .then((data) => setParentSchedules(data.schedules ?? []))
      .catch(() => setParentSchedules([]));
  }, [isParentPolicy, detail.policyId]);

  React.useEffect(() => {
    if (!isParentPolicy) return;
    let cancelled = false;
    fetch(`/api/policies?linkedPolicyId=${detail.policyId}&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw: unknown) => {
        if (cancelled) return;
        const rows: Array<Record<string, unknown>> = Array.isArray(raw)
          ? (raw as Array<Record<string, unknown>>)
          : Array.isArray((raw as { rows?: unknown })?.rows)
            ? ((raw as { rows: Array<Record<string, unknown>> }).rows)
            : [];
        const mapped: LinkedEndorsement[] = rows
          .filter((r) => (r.isActive ?? r.is_active) !== false)
          .map((r) => ({
            policyId: (r.policyId ?? r.id) as number,
            policyNumber: (r.policyNumber ?? r.policy_number ?? "") as string,
            status: ((r.extraAttributes as Record<string, unknown> | undefined)?.statusClient ??
              (r.extraAttributes as Record<string, unknown> | undefined)?.status ??
              (r.carExtra as Record<string, unknown> | undefined)?.statusClient ??
              (r.carExtra as Record<string, unknown> | undefined)?.status ??
              "quotation_prepared") as string,
          }));
        setLinkedEndorsements(mapped);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isParentPolicy, detail.policyId]);

  React.useEffect(() => {
    if (linkedEndorsements.length === 0) return;
    let cancelled = false;
    Promise.all(
      linkedEndorsements.map((e) =>
        fetch(`/api/policies/${e.policyId}?_t=${Date.now()}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<number, PolicyDetail> = {};
      results.forEach((d, i) => {
        if (d) map[linkedEndorsements[i].policyId] = d as PolicyDetail;
      });
      setEndorsementDetails(map);
    });
    return () => { cancelled = true; };
  }, [linkedEndorsements]);

  const toggleSection = (id: string) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  // ─────────────────────────────────────────────────────────────
  // Documents-section summary.
  //
  // Fetched directly from the tracking endpoint (independent of
  // whether the heavy DocumentsTab below has mounted yet) so the
  // section header can show "1 signed · 2 sent" badges even with
  // the section still collapsed. Two side-effects use this:
  //   1. Header badges (rendered alongside the existing uploads /
  //      payments badges).
  //   2. Auto-expand: if there's at least one signed doc and the
  //      user hasn't manually picked a section yet, default-open
  //      Documents so the signed PDF download is one click away.
  //
  // We deliberately treat ALL keys (client + agent variants) as
  // a single bucket because the user's mental model is "did
  // anyone sign this policy yet?" — splitting client/agent here
  // would just clutter the header.
  // ─────────────────────────────────────────────────────────────
  type WorkflowTrackingEntry = {
    status?: string;
    signingSessionToken?: string;
    signedPdfStoredName?: string;
    confirmMethod?: string;
  };
  const [docsTrackingMap, setDocsTrackingMap] = React.useState<Record<string, WorkflowTrackingEntry>>({});
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/policies/${detail.policyId}/document-tracking`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, WorkflowTrackingEntry>) => {
        if (!cancelled) setDocsTrackingMap(data ?? {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [detail.policyId]);

  const docsSummary = React.useMemo(() => {
    let signed = 0;
    let awaitingSignature = 0;
    let sent = 0;
    let confirmed = 0;
    let rejected = 0;
    for (const [key, entry] of Object.entries(docsTrackingMap ?? {})) {
      // Internal underscore-prefixed keys (e.g. "_audit") aren't
      // real document rows — skip them.
      if (key.startsWith("_")) continue;
      if (!entry || typeof entry !== "object") continue;
      if (entry.signedPdfStoredName) signed++;
      else if (entry.signingSessionToken) awaitingSignature++;
      if (entry.status === "sent") sent++;
      if (entry.status === "confirmed") confirmed++;
      if (entry.status === "rejected") rejected++;
    }
    return { signed, awaitingSignature, sent, confirmed, rejected };
  }, [docsTrackingMap]);

  // Auto-expand Documents the FIRST time we see a signed/awaiting
  // entry, but only if the user hasn't already picked a section
  // and no `initialSection` was passed in. Tracked by a ref so a
  // user collapsing the section after auto-expand doesn't get it
  // re-popped open every render.
  const docsAutoExpandedRef = React.useRef(false);
  React.useEffect(() => {
    if (docsAutoExpandedRef.current) return;
    if (initialSection) return;
    if (expandedSection !== null) return;
    if (docsSummary.signed > 0 || docsSummary.awaitingSignature > 0) {
      setExpandedSection("documents");
      docsAutoExpandedRef.current = true;
    }
  }, [docsSummary.signed, docsSummary.awaitingSignature, expandedSection, initialSection]);

  const combinedTaskListSummary = React.useMemo(() => {
    const base = taskListUploadSummary ?? emptyUploadSummary();
    let total = base.total;
    let verified = base.verified;
    let userTaskTotal = base.userTaskTotal;
    let userVerified = base.userVerified;
    let pending = base.pending;
    let outstanding = base.outstanding;
    let awaitingOffice = base.awaitingOffice;
    let rejected = base.rejected;
    for (const s of Object.values(endorsementTaskSummaries)) {
      total += s.total;
      verified += s.verified;
      userTaskTotal += s.userTaskTotal ?? s.total;
      userVerified += s.userVerified ?? s.verified;
      pending += s.pending;
      outstanding += s.outstanding;
      awaitingOffice += s.awaitingOffice ?? 0;
      rejected += s.rejected;
    }
    return { total, verified, userTaskTotal, userVerified, pending, outstanding, awaitingOffice, rejected };
  }, [taskListUploadSummary, endorsementTaskSummaries]);

  const combinedFinalDocsSummary = React.useMemo(() => {
    const base = finalDocsUploadSummary ?? emptyUploadSummary();
    let total = base.total;
    let verified = base.verified;
    let pending = base.pending;
    let outstanding = base.outstanding;
    let awaitingOffice = base.awaitingOffice;
    let rejected = base.rejected;
    for (const s of Object.values(endorsementFinalSummaries)) {
      total += s.total;
      verified += s.verified;
      pending += s.pending;
      outstanding += s.outstanding;
      awaitingOffice += s.awaitingOffice ?? 0;
      rejected += s.rejected;
    }
    return { total, verified, pending, outstanding, awaitingOffice, rejected };
  }, [finalDocsUploadSummary, endorsementFinalSummaries]);

  const sections = [
    { id: "documents", label: "Documents", show: true },
    { id: "uploads", label: "Task List", show: true },
    { id: "final-documents", label: "Final Documents", show: true },
    { id: "payments", label: "Payments", show: true },
    { id: "actions", label: "Additional Actions", show: !!isAdmin },
  ].filter((s) => s.show);

  return (
    <div className="space-y-3">
      {/* Current status */}
      <div className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <button
          type="button"
          onClick={() => { if (isAdmin) setShowOverride((v) => !v); }}
          className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
        >
          <span>Current Status</span>
          <span className="flex flex-wrap items-center justify-end gap-2 min-w-0">
            <Badge
              variant="custom"
              className="max-w-[160px] truncate bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
              title={`Client: ${getLabel(curStatusClient)}`}
            >
              Client: {getLabel(curStatusClient)}
            </Badge>
            {isAdmin && detail.agent && (
              <Badge
                variant="custom"
                className="max-w-[160px] truncate bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                title={`Agent: ${getLabel(curStatusAgent)}`}
              >
                Agent: {getLabel(curStatusAgent)}
              </Badge>
            )}
            {isAdmin && (
              <ChevronRight className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${showOverride ? "rotate-90" : ""}`} />
            )}
          </span>
        </button>
        {showOverride && isAdmin && (
          <div className="border-t border-neutral-200 p-3 dark:border-neutral-800 space-y-3">
            <React.Suspense fallback={<div className="py-2 text-center text-xs text-neutral-400">Loading...</div>}>
              <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Client Status</div>
                <StatusTab
                  policyId={detail.policyId}
                  currentStatus={curStatusClient}
                  statusHistory={historyClient}
                  onStatusChange={() => {
                    setShowOverride(false);
                    onRefresh?.();
                  }}
                  flowKey={flowKey}
                  audience="client"
                />
              </div>
              {detail.agent && (
                <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Agent Status</div>
                  <StatusTab
                    policyId={detail.policyId}
                    currentStatus={curStatusAgent}
                    statusHistory={historyAgent}
                    onStatusChange={() => {
                      setShowOverride(false);
                      onRefresh?.();
                    }}
                    flowKey={flowKey}
                    audience="agent"
                  />
                </div>
              )}
            </React.Suspense>
          </div>
        )}
      </div>

      {/* Collapsible sections */}
      {sections.map((sec) => (
        <div key={sec.id} className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection(sec.id)}
            className="w-full px-3 py-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-1.5">
              <span className="text-sm font-medium shrink-0 flex items-center gap-1.5">
                {sec.label}
              </span>
              <span className="flex flex-wrap items-center justify-end gap-1">
                {sec.id === "documents" && (docsSummary.signed > 0 || docsSummary.awaitingSignature > 0 || docsSummary.sent > 0) && (
                  <>
                    {docsSummary.signed > 0 && (
                      <Badge
                        variant="custom"
                        className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        title="Documents that have been signed online by the recipient"
                      >
                        {docsSummary.signed} signed
                      </Badge>
                    )}
                    {docsSummary.awaitingSignature > 0 && (
                      <Badge
                        variant="custom"
                        className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                        title="Sign link sent — waiting for recipient to act"
                      >
                        {docsSummary.awaitingSignature} awaiting
                      </Badge>
                    )}
                    {docsSummary.sent > 0 && (
                      <Badge
                        variant="custom"
                        className="text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                        title="Documents sent that have not yet been signed or confirmed"
                      >
                        {docsSummary.sent} sent
                      </Badge>
                    )}
                    {docsSummary.rejected > 0 && (
                      <Badge
                        variant="custom"
                        className="text-[10px] bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        title="Documents rejected by the recipient"
                      >
                        {docsSummary.rejected} declined
                      </Badge>
                    )}
                  </>
                )}
                {sec.id === "uploads" && combinedTaskListSummary.total > 0 && (() => {
                  const s = combinedTaskListSummary;
                  const ut = Math.max(0, s.userTaskTotal);
                  const uv = Math.max(0, s.userVerified);
                  const fracNum = ut > 0 ? uv : s.verified;
                  const fracDen = ut > 0 ? ut : s.total;
                  const uploadsQuiescent =
                    s.outstanding === 0 &&
                    s.pending === 0 &&
                    s.rejected === 0;
                  return (
                    <>
                      <Badge
                        variant="custom"
                        title={ut > 0 ? "Verified client/agent uploads vs configured slots" : "Upload progress"}
                        className={`text-[10px] ${uploadsQuiescent && fracDen > 0 && fracNum >= fracDen
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        }`}
                      >
                        {fracNum}/{fracDen}
                      </Badge>
                      {s.outstanding > 0 && (
                        <Badge variant="custom" className="text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                          {s.outstanding} outstanding
                        </Badge>
                      )}
                      {s.pending > 0 && (
                        <Badge variant="custom" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          {s.pending} pending
                        </Badge>
                      )}
                      {s.rejected > 0 && (
                        <Badge variant="custom" className="text-[10px] bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                          {s.rejected} rejected
                        </Badge>
                      )}
                    </>
                  );
                })()}
                {sec.id === "final-documents" && combinedFinalDocsSummary.total > 0 && (() => {
                  const s = combinedFinalDocsSummary;
                  const fracDen = Math.max(0, s.total);
                  const fracNum = Math.max(0, s.verified);
                  const uploadsQuiescent =
                    fracDen > 0 &&
                    fracNum >= fracDen &&
                    (s.awaitingOffice ?? 0) === 0 &&
                    s.pending === 0 &&
                    s.rejected === 0;
                  return (
                    <>
                      <Badge
                        variant="custom"
                        title="Published final documents uploaded vs configured"
                        className={`text-[10px] ${uploadsQuiescent
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        }`}
                      >
                        {fracNum}/{fracDen}
                      </Badge>
                      {(s.awaitingOffice ?? 0) > 0 && (
                        <Badge
                          variant="custom"
                          className="text-[10px] bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200"
                          title="Admin must upload — not a missing client/agent task"
                        >
                          {s.awaitingOffice} awaiting office
                        </Badge>
                      )}
                      {s.pending > 0 && (
                        <Badge variant="custom" className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          {s.pending} pending
                        </Badge>
                      )}
                      {s.rejected > 0 && (
                        <Badge variant="custom" className="text-[10px] bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                          {s.rejected} rejected
                        </Badge>
                      )}
                    </>
                  );
                })()}
                {sec.id === "payments" && paymentSummary && paymentSummary.invoiceCount > 0 && (() => {
                  const clientFullyPaid = paymentSummary.remaining <= 0 && paymentSummary.totalOwed > 0;
                  const agentFullyPaid = paymentSummary.agentOwed != null && paymentSummary.agentPaid != null && paymentSummary.agentPaid >= paymentSummary.agentOwed;
                  const fmtCur = (cents: number) =>
                    new Intl.NumberFormat("en-HK", { style: "currency", currency: paymentSummary.currency, minimumFractionDigits: 0 }).format(cents / 100);
                  return (
                    <>
                      {paymentSummary.totalOwed > 0 && (
                        <Badge
                          variant="custom"
                          className={`text-[10px] ${clientFullyPaid
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                          }`}
                        >
                          {fmtCur(paymentSummary.totalPaid)} / {fmtCur(paymentSummary.totalOwed)}
                        </Badge>
                      )}
                      {isAdmin && paymentSummary.agentOwed != null && paymentSummary.agentOwed > 0 && (
                        <Badge
                          variant="custom"
                          className={`text-[10px] ${agentFullyPaid
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                            : "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200"
                          }`}
                        >
                          {fmtCur(paymentSummary.agentPaid ?? 0)} / {fmtCur(paymentSummary.agentOwed)}
                        </Badge>
                      )}
                      {isAdmin && paymentSummary.commissionCents != null && paymentSummary.commissionCents > 0 && (
                        <Badge
                          variant="custom"
                          className="text-[10px] bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                          title="Commission — on statement"
                        >
                          {fmtCur(paymentSummary.commissionCents)} comm.
                        </Badge>
                      )}
                      {paymentSummary.hasSubmitted && (
                        <Badge variant="custom" className="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          pending review
                        </Badge>
                      )}
                    </>
                  );
                })()}
                <ChevronRight className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${expandedSection === sec.id ? "rotate-90" : ""}`} />
              </span>
            </div>
            {sec.id === "payments" && paymentSummary && paymentSummary.invoiceNumbers.length > 0 && (
              <div className="mt-0.5 text-[10px] text-neutral-400 dark:text-neutral-500 font-mono">
                {paymentSummary.invoiceNumbers.join(" · ")}
              </div>
            )}
          </button>
          {sec.id === "uploads" && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800 space-y-4">
              <React.Suspense fallback={<div className="py-4 text-center text-xs text-neutral-400">Loading...</div>}>
                <div>
                  {isParentPolicy && linkedEndorsements.length > 0 && (
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                      <FileText className="h-3 w-3" />
                      Policy {detail.policyNumber}
                    </div>
                  )}
                  <UploadDocumentsTab
                    policyId={detail.policyId}
                    flowKey={uploadDocsFlowKey}
                    isAdmin={isAdmin ?? false}
                    currentStatus={curStatusClient}
                    insuredType={insuredType}
                    hasNcb={hasNcb}
                    viewerUserType={currentUserType}
                    documentSubset="task-list"
                    onSummaryChange={setTaskListUploadSummary}
                    onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                    filter="documents"
                    policyNumber={detail.policyNumber}
                    defaultEmail={defaultEmailRecipient}
                    defaultPhone={defaultPhoneRecipient}
                    defaultRecipientName={defaultRecipientName}
                  />
                </div>
                {isParentPolicy && linkedEndorsements.map((e) => (
                  <div key={e.policyId}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <FileText className="h-3 w-3" />
                      Endorsement {e.policyNumber}
                    </div>
                    <UploadDocumentsTab
                      policyId={e.policyId}
                      flowKey="endorsement"
                      isAdmin={isAdmin ?? false}
                      currentStatus={e.status}
                      viewerUserType={currentUserType}
                      parentPolicyId={detail.policyId}
                      parentSchedules={parentSchedules}
                      documentSubset="task-list"
                      onSummaryChange={(s) => {
                        setEndorsementTaskSummaries((prev) => ({ ...prev, [e.policyId]: s }));
                      }}
                      onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                      filter="documents"
                      policyNumber={e.policyNumber}
                      defaultEmail={defaultEmailRecipient}
                      defaultPhone={defaultPhoneRecipient}
                      defaultRecipientName={defaultRecipientName}
                    />
                  </div>
                ))}
              </React.Suspense>
            </div>
          )}
          {sec.id === "final-documents" && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800 space-y-4">
              <React.Suspense fallback={<div className="py-4 text-center text-xs text-neutral-400">Loading...</div>}>
                <div>
                  {isParentPolicy && linkedEndorsements.length > 0 && (
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                      <FileText className="h-3 w-3" />
                      Policy {detail.policyNumber}
                    </div>
                  )}
                  <UploadDocumentsTab
                    policyId={detail.policyId}
                    flowKey={uploadDocsFlowKey}
                    isAdmin={isAdmin ?? false}
                    currentStatus={curStatusClient}
                    insuredType={insuredType}
                    hasNcb={hasNcb}
                    viewerUserType={currentUserType}
                    documentSubset="final-documents"
                    onSummaryChange={setFinalDocsUploadSummary}
                    onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                    filter="documents"
                    policyNumber={detail.policyNumber}
                    defaultEmail={defaultEmailRecipient}
                    defaultPhone={defaultPhoneRecipient}
                    defaultRecipientName={defaultRecipientName}
                  />
                </div>
                {isParentPolicy && linkedEndorsements.map((e) => (
                  <div key={e.policyId}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <FileText className="h-3 w-3" />
                      Endorsement {e.policyNumber}
                    </div>
                    <UploadDocumentsTab
                      policyId={e.policyId}
                      flowKey="endorsement"
                      isAdmin={isAdmin ?? false}
                      currentStatus={e.status}
                      viewerUserType={currentUserType}
                      parentPolicyId={detail.policyId}
                      parentSchedules={parentSchedules}
                      documentSubset="final-documents"
                      onSummaryChange={(s) => {
                        setEndorsementFinalSummaries((prev) => ({ ...prev, [e.policyId]: s }));
                      }}
                      onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                      filter="documents"
                      policyNumber={e.policyNumber}
                      defaultEmail={defaultEmailRecipient}
                      defaultPhone={defaultPhoneRecipient}
                      defaultRecipientName={defaultRecipientName}
                    />
                  </div>
                ))}
              </React.Suspense>
            </div>
          )}
          {sec.id === "payments" && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800 space-y-4">
              <React.Suspense fallback={<div className="py-4 text-center text-xs text-neutral-400">Loading...</div>}>
                <div>
                  {isParentPolicy && linkedEndorsements.length > 0 && (
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                      <FileText className="h-3 w-3" />
                      Policy {detail.policyNumber}
                    </div>
                  )}
                  <UploadDocumentsTab
                    policyId={detail.policyId}
                    flowKey={uploadDocsFlowKey}
                    isAdmin={isAdmin ?? false}
                    currentStatus={curStatusClient}
                    insuredType={insuredType}
                    hasNcb={hasNcb}
                    viewerUserType={currentUserType}
                    parentSchedules={parentSchedules}
                    onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                    filter="payments"
                  />
                </div>
                {isParentPolicy && linkedEndorsements.map((e) => (
                  <div key={e.policyId}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <FileText className="h-3 w-3" />
                      Endorsement {e.policyNumber}
                    </div>
                    <UploadDocumentsTab
                      policyId={e.policyId}
                      flowKey="endorsement"
                      isAdmin={isAdmin ?? false}
                      currentStatus={e.status}
                      viewerUserType={currentUserType}
                      parentPolicyId={detail.policyId}
                      parentSchedules={parentSchedules}
                      onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                      filter="payments"
                    />
                  </div>
                ))}
                <PaymentSection
                  {...(isClientFlow
                    ? { clientRecordId: detail.policyId }
                    : { policyId: detail.policyId })}
                  isAdmin={isAdmin ?? false}
                  onSummaryChange={setPaymentSummary}
                  externalRefreshKey={paymentRefreshKey}
                  endorsementPolicyIds={isParentPolicy ? linkedEndorsements.map((e) => e.policyId) : undefined}
                  hideInvoiceCards
                  initialSchedules={parentSchedules}
                />
              </React.Suspense>
            </div>
          )}
          {sec.id !== "uploads"
            && sec.id !== "final-documents"
            && sec.id !== "payments"
            && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
              <React.Suspense fallback={<div className="py-4 text-center text-xs text-neutral-400">Loading...</div>}>
                {sec.id === "documents" && (
                  <DocumentsTab
                    detail={detail}
                    flowKey={flowKey}
                    currentUserType={currentUserType}
                    isPrivilegedViewer={isAdmin === true}
                    currentStatus={curStatusClient}
                    currentStatusClient={curStatusClient}
                    currentStatusAgent={curStatusAgent}
                    initialTemplateValue={initialDocTemplateValue}
                    initialAudience={initialDocAudience}
                    onStatusAutoAdvanced={onRefresh}
                    endorsements={isParentPolicy ? linkedEndorsements.filter((e) => !!endorsementDetails[e.policyId]).map((e) => {
                      const eDetail = endorsementDetails[e.policyId];
                      const eExtra = (eDetail.extraAttributes ?? {}) as Record<string, unknown>;
                      return {
                        policyId: e.policyId,
                        policyNumber: e.policyNumber,
                        detail: eDetail,
                        statusClient: String(eExtra.statusClient ?? e.status ?? "quotation_prepared"),
                        statusAgent: String(eExtra.statusAgent ?? eExtra.statusClient ?? e.status ?? "quotation_prepared"),
                      };
                    }) : undefined}
                  />
                )}
                {sec.id === "actions" && (
                  <ActionsTab
                    policyId={detail.policyId}
                    policyNumber={detail.policyNumber}
                    detail={detail}
                    currentAgent={detail.agent}
                    flowKey={flowKey}
                    currentStatus={curStatusClient}
                    onActionComplete={onRefresh}
                  />
                )}
              </React.Suspense>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
