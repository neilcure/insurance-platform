"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import type { PolicyDetail } from "@/lib/types/policy";

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

type StatusOption = { value: string; label: string; color: string };

const DEFAULT_STATUS_OPTIONS: StatusOption[] = [
  { value: "draft", label: "Draft", color: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200" },
  { value: "pending", label: "Pending Review", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  { value: "active", label: "Active", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "suspended", label: "Suspended", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "expired", label: "Expired", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  { value: "cancelled", label: "Cancelled", color: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" },
];

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
  const [statusOptions, setStatusOptions] = React.useState<StatusOption[]>([...DEFAULT_STATUS_OPTIONS]);
  const [expandedSection, setExpandedSection] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(`/api/form-options?groupKey=policy_statuses&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { label: string; value: string; meta?: { color?: string; flows?: string[] } }[]) => {
        if (!Array.isArray(rows) || rows.length === 0) return;
        const applicable = rows.filter((r) => {
          const flows = r.meta?.flows;
          if (!flows || flows.length === 0) return true;
          return flowKey ? flows.includes(flowKey) : false;
        });
        if (applicable.length > 0) {
          setStatusOptions(applicable.map((r) => ({
            value: r.value,
            label: r.label,
            color: r.meta?.color || "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
          })));
        }
      })
      .catch(() => {});
  }, [flowKey]);

  const allKnownStatuses = React.useMemo(() => {
    const map = new Map<string, StatusOption>();
    for (const s of DEFAULT_STATUS_OPTIONS) map.set(s.value, s);
    for (const s of statusOptions) map.set(s.value, s);
    return map;
  }, [statusOptions]);

  const curStatus = currentStatus || "active";
  const currentDef = allKnownStatuses.get(curStatus);
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

  const toggleSection = (id: string) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  const sections = [
    { id: "documents", label: "Documents", show: true },
    { id: "uploads", label: "Required Uploads", show: true },
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
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{sec.label}</span>
              <span className="flex items-center gap-1.5">
                {sec.id === "uploads" && uploadSummary && uploadSummary.total > 0 && (() => {
                  const allDone = uploadSummary.verified === uploadSummary.total;
                  return (
                    <>
                      <Badge
                        variant="custom"
                        className={allDone
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                        }
                      >
                        {uploadSummary.verified}/{uploadSummary.total}
                      </Badge>
                      {uploadSummary.outstanding > 0 && (
                        <Badge variant="custom" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                          {uploadSummary.outstanding} outstanding
                        </Badge>
                      )}
                      {uploadSummary.pending > 0 && (
                        <Badge variant="custom" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                          {uploadSummary.pending} pending
                        </Badge>
                      )}
                      {uploadSummary.rejected > 0 && (
                        <Badge variant="custom" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                          {uploadSummary.rejected} rejected
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
                        className={fullyPaid
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                        }
                      >
                        {fmtCur(paymentSummary.totalPaid)} / {fmtCur(paymentSummary.totalOwed)}
                      </Badge>
                      {paymentSummary.hasSubmitted && (
                        <Badge variant="custom" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
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
            <div className={expandedSection === sec.id ? "border-t border-neutral-200 p-3 dark:border-neutral-800" : "hidden"}>
              <React.Suspense fallback={<div className="py-4 text-center text-xs text-neutral-400">Loading...</div>}>
                <UploadDocumentsTab
                  policyId={detail.policyId}
                  flowKey={flowKey}
                  isAdmin={isAdmin ?? false}
                  currentStatus={curStatus}
                  insuredType={insuredType}
                  hasNcb={hasNcb}
                  onSummaryChange={setUploadSummary}
                />
              </React.Suspense>
            </div>
          )}
          {sec.id === "payments" && (
            <div className={expandedSection === sec.id ? "border-t border-neutral-200 p-3 dark:border-neutral-800" : "hidden"}>
              <React.Suspense fallback={<div className="py-4 text-center text-xs text-neutral-400">Loading...</div>}>
                <PaymentSection
                  policyId={detail.policyId}
                  isAdmin={isAdmin ?? false}
                  onSummaryChange={setPaymentSummary}
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

      {/* Status history */}
      {history.length > 0 && (
        <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">History</div>
          <div className="space-y-1.5">
            {history.map((entry, idx) => {
              const def = allKnownStatuses.get(entry.status);
              return (
                <div key={idx} className="flex items-start justify-between gap-2 text-xs">
                  <div>
                    <Badge variant="outline" className="text-[10px]">
                      {def?.label ?? entry.status}
                    </Badge>
                    {entry.note && (
                      <div className="mt-0.5 text-neutral-500 dark:text-neutral-400">{entry.note}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-neutral-400 dark:text-neutral-500">
                    <div>{new Date(entry.changedAt).toLocaleDateString()}</div>
                    {entry.changedBy && <div>{entry.changedBy}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
