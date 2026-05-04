"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { PolicyDetail } from "@/lib/types/policy";
import { toast } from "sonner";

const DocumentsTab = dynamic(
  () => import("@/components/policies/tabs/DocumentsTab").then((m) => m.DocumentsTab),
  { loading: () => <div className="py-3 text-xs text-neutral-500 dark:text-neutral-400">Loading template preview...</div> },
);

export type AgentDocumentPreviewState = {
  statementInvoiceId: number;
  policyId: number;
  templateValue?: string;
  autoSelect?: boolean;
  flowKey?: string;
  statusAgent?: string;
  statusClient?: string;
};

export function AgentDocumentsTab({
  preview,
  onPolicyContextRefresh,
}: {
  preview: AgentDocumentPreviewState;
  onPolicyContextRefresh?: (payload: {
    policyId: number;
    flowKey: string;
    statusClient: string;
    statusAgent: string;
  }) => void;
}) {
  const [detail, setDetail] = React.useState<PolicyDetail | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refreshDetail = React.useCallback(async () => {
    const policyId = Number(preview.policyId);
    if (!Number.isFinite(policyId) || policyId <= 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/policies/${policyId}?_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load policy");
      const nextDetail = (await res.json()) as PolicyDetail;
      setDetail(nextDetail);
      const extra = (nextDetail.extraAttributes ?? {}) as Record<string, unknown>;
      const flowKey = String((nextDetail as unknown as { flowKey?: string }).flowKey ?? extra.flowKey ?? "").toLowerCase();
      const statusClient = String(extra.statusClient ?? extra.status ?? "quotation_prepared").toLowerCase();
      const statusAgent = String(extra.statusAgent ?? statusClient ?? "quotation_prepared").toLowerCase();
      onPolicyContextRefresh?.({ policyId, flowKey, statusClient, statusAgent });
    } catch {
      toast.error("Unable to open statement template.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [onPolicyContextRefresh, preview.policyId]);

  React.useEffect(() => {
    void refreshDetail();
  }, [refreshDetail]);

  if (loading && !detail) {
    return <div className="py-3 text-xs text-neutral-500 dark:text-neutral-400">Loading statement template...</div>;
  }
  if (!loading && !detail) {
    return <div className="py-3 text-xs text-neutral-500 dark:text-neutral-400">Unable to load statement template.</div>;
  }
  const resolvedDetail = detail as PolicyDetail;

  return (
    <div className="max-h-[70vh] overflow-auto">
      {loading && detail && (
        <div className="mb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          Refreshing document...
        </div>
      )}
      <DocumentsTab
        detail={resolvedDetail}
        flowKey={String(
          preview.flowKey
          ?? ((resolvedDetail as unknown as { flowKey?: string }).flowKey)
          ?? (((resolvedDetail.extraAttributes ?? {}) as Record<string, unknown>).flowKey)
          ?? "",
        )}
        currentStatusClient={String(
          preview.statusClient
          ?? (((resolvedDetail.extraAttributes ?? {}) as Record<string, unknown>).statusClient)
          ?? (((resolvedDetail.extraAttributes ?? {}) as Record<string, unknown>).status)
          ?? "quotation_prepared",
        )}
        currentStatusAgent={String(
          preview.statusAgent
          ?? (((resolvedDetail.extraAttributes ?? {}) as Record<string, unknown>).statusAgent)
          ?? (((resolvedDetail.extraAttributes ?? {}) as Record<string, unknown>).statusClient)
          ?? (((resolvedDetail.extraAttributes ?? {}) as Record<string, unknown>).status)
          ?? "quotation_prepared",
        )}
        initialTemplateValue={preview.autoSelect ? preview.templateValue : undefined}
        initialAudience="agent"
        currentUserType="agent"
        onlyTemplateValue={preview.templateValue}
        renderMode="agent_statement"
        trackingScope="invoice"
        trackingInvoiceId={preview.statementInvoiceId}
        onStatusAutoAdvanced={() => { void refreshDetail(); }}
      />
    </div>
  );
}
