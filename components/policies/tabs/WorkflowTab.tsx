"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, FileText } from "lucide-react";
import type { PolicyDetail } from "@/lib/types/policy";
import { usePolicyStatuses } from "@/hooks/use-policy-statuses";

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
  onRefresh,
}: {
  detail: PolicyDetail;
  flowKey?: string;
  currentStatus?: string;
  statusHistory?: Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>;
  isAdmin?: boolean;
  onRefresh?: () => void;
}) {
  const { getLabel, getColor, getOption } = usePolicyStatuses(flowKey);
  const [expandedSection, setExpandedSection] = React.useState<string | null>(null);

  const curStatus = currentStatus || "active";
  const currentDef = getOption(curStatus);
  const history = statusHistory ?? [];

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
  const [uploadSummary, setUploadSummary] = React.useState<{
    total: number; verified: number; pending: number; outstanding: number; rejected: number;
  } | null>(null);
  const [paymentSummary, setPaymentSummary] = React.useState<{
    totalOwed: number; totalPaid: number; totalPending: number; remaining: number;
    currency: string; invoiceCount: number; hasSubmitted: boolean;
    invoiceNumbers: string[];
  } | null>(null);
  const [paymentRefreshKey, setPaymentRefreshKey] = React.useState(0);

  const isParentPolicy = !flowKey || flowKey === "policyset" || flowKey === "";
  const [linkedEndorsements, setLinkedEndorsements] = React.useState<LinkedEndorsement[]>([]);
  const [endorsementSummaries, setEndorsementSummaries] = React.useState<Record<number, { total: number; verified: number; outstanding: number }>>({});

  React.useEffect(() => {
    if (!isParentPolicy) return;
    let cancelled = false;
    fetch(`/api/policies?linkedPolicyId=${detail.policyId}&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<Record<string, unknown>>) => {
        if (cancelled) return;
        const mapped: LinkedEndorsement[] = rows
          .filter((r) => (r.isActive ?? r.is_active) !== false)
          .map((r) => ({
            policyId: (r.policyId ?? r.id) as number,
            policyNumber: (r.policyNumber ?? r.policy_number ?? "") as string,
            status: ((r.extraAttributes as Record<string, unknown> | undefined)?.status ??
              (r.carExtra as Record<string, unknown> | undefined)?.status ?? "active") as string,
          }));
        setLinkedEndorsements(mapped);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isParentPolicy, detail.policyId]);

  const toggleSection = (id: string) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  const combinedUploadSummary = React.useMemo(() => {
    const base = uploadSummary ?? { total: 0, verified: 0, pending: 0, outstanding: 0, rejected: 0 };
    let total = base.total, verified = base.verified, pending = base.pending, outstanding = base.outstanding, rejected = base.rejected;
    for (const s of Object.values(endorsementSummaries)) {
      total += s.total;
      verified += s.verified;
      outstanding += s.outstanding;
    }
    return { total, verified, pending, outstanding, rejected };
  }, [uploadSummary, endorsementSummaries]);

  const sections = [
    { id: "documents", label: "Documents", show: true },
    { id: "uploads", label: "Task List", show: true },
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
          <span className="flex items-center gap-2">
            <Badge variant={currentDef?.color ? "custom" : "secondary"} className={currentDef?.color ?? ""}>
              {currentDef?.label ?? curStatus}
            </Badge>
            {isAdmin && (
              <ChevronRight className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${showOverride ? "rotate-90" : ""}`} />
            )}
          </span>
        </button>
        {showOverride && isAdmin && (
          <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
            <React.Suspense fallback={<div className="py-2 text-center text-xs text-neutral-400">Loading...</div>}>
              <StatusTab
                policyId={detail.policyId}
                currentStatus={curStatus}
                statusHistory={history}
                onStatusChange={(newStatus) => {
                  setShowOverride(false);
                  onRefresh?.();
                }}
                flowKey={flowKey}
              />
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
                {sec.id === "uploads" && combinedUploadSummary.total > 0 && (() => {
                  const s = combinedUploadSummary;
                  const allDone = s.verified === s.total;
                  return (
                    <>
                      <Badge
                        variant="custom"
                        className={`text-[10px] ${allDone
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        }`}
                      >
                        {s.verified}/{s.total}
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
                {sec.id === "payments" && paymentSummary && paymentSummary.invoiceCount > 0 && (() => {
                  const fullyPaid = paymentSummary.remaining <= 0;
                  const fmtCur = (cents: number) =>
                    new Intl.NumberFormat("en-HK", { style: "currency", currency: paymentSummary.currency, minimumFractionDigits: 0 }).format(cents / 100);
                  return (
                    <>
                      <Badge
                        variant="custom"
                        className={`text-[10px] ${fullyPaid
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                        }`}
                      >
                        {fmtCur(paymentSummary.totalPaid)} / {fmtCur(paymentSummary.totalOwed)}
                      </Badge>
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
          {sec.id === "uploads" && (
            <div className={expandedSection === sec.id ? "border-t border-neutral-200 p-3 dark:border-neutral-800 space-y-4" : "hidden"}>
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
                    flowKey={flowKey}
                    isAdmin={isAdmin ?? false}
                    currentStatus={curStatus}
                    insuredType={insuredType}
                    hasNcb={hasNcb}
                    onSummaryChange={setUploadSummary}
                    onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                    filter="documents"
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
                      currentStatus={curStatus}
                      parentPolicyId={detail.policyId}
                      onSummaryChange={(s) => {
                        setEndorsementSummaries((prev) => ({ ...prev, [e.policyId]: s }));
                      }}
                      onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                      filter="documents"
                    />
                  </div>
                ))}
              </React.Suspense>
            </div>
          )}
          {sec.id === "payments" && (
            <div className={expandedSection === sec.id ? "border-t border-neutral-200 p-3 dark:border-neutral-800 space-y-4" : "hidden"}>
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
                    flowKey={flowKey}
                    isAdmin={isAdmin ?? false}
                    currentStatus={curStatus}
                    insuredType={insuredType}
                    hasNcb={hasNcb}
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
                      currentStatus={curStatus}
                      parentPolicyId={detail.policyId}
                      onPaymentRecorded={() => setPaymentRefreshKey((k) => k + 1)}
                      filter="payments"
                    />
                  </div>
                ))}
                <PaymentSection
                  policyId={detail.policyId}
                  isAdmin={isAdmin ?? false}
                  onSummaryChange={setPaymentSummary}
                  externalRefreshKey={paymentRefreshKey}
                  endorsementPolicyIds={isParentPolicy ? linkedEndorsements.map((e) => e.policyId) : undefined}
                  hideInvoiceCards
                />
              </React.Suspense>
            </div>
          )}
          {sec.id !== "uploads" && sec.id !== "payments" && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
              <React.Suspense fallback={<div className="py-4 text-center text-xs text-neutral-400">Loading...</div>}>
                {sec.id === "documents" && (
                  <DocumentsTab
                    detail={detail}
                    flowKey={flowKey}
                    currentStatus={curStatus}
                    onStatusAutoAdvanced={onRefresh}
                  />
                )}
                {sec.id === "actions" && (
                  <ActionsTab
                    policyId={detail.policyId}
                    policyNumber={detail.policyNumber}
                    detail={detail}
                    currentAgent={detail.agent}
                    flowKey={flowKey}
                    currentStatus={curStatus}
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
