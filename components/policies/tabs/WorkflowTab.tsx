"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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

  const [showOverride, setShowOverride] = React.useState(false);

  const toggleSection = (id: string) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  const sections = [
    { id: "documents", label: "Documents", show: true },
    { id: "uploads", label: "Required Uploads", show: true },
    { id: "actions", label: "Workflow Actions", show: !!isAdmin },
  ].filter((s) => s.show);

  return (
    <div className="space-y-3">
      {/* Current status + inline manual override */}
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">Current Status</div>
          <div className="flex items-center gap-2">
            <Badge variant={currentDef?.color ? "custom" : "secondary"} className={currentDef?.color ?? ""}>
              {currentDef?.label ?? curStatus}
            </Badge>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowOverride((v) => !v)}
                className="text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors"
                title="Manual override"
              >
                ✎
              </button>
            )}
          </div>
        </div>
        {showOverride && isAdmin && (
          <div className="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-700">
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

      {/* Status timeline */}
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

      {/* Collapsible sections */}
      {sections.map((sec) => (
        <div key={sec.id} className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection(sec.id)}
            className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
          >
            {sec.label}
            <ChevronRight className={`h-4 w-4 text-neutral-400 transition-transform ${expandedSection === sec.id ? "rotate-90" : ""}`} />
          </button>
          {expandedSection === sec.id && (
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
                {sec.id === "uploads" && (
                  <UploadDocumentsTab
                    policyId={detail.policyId}
                    flowKey={flowKey}
                    isAdmin={isAdmin ?? false}
                    currentStatus={curStatus}
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
