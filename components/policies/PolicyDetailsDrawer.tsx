"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useSession } from "next-auth/react";
import { Activity, Zap, FileText, Upload, DollarSign } from "lucide-react";
import { RecordDetailsDrawer } from "@/components/ui/record-details-drawer";
import type { PolicyDetail } from "@/lib/types/policy";
import type { DrawerTab } from "@/components/ui/drawer-tabs";
import type { WorkflowActionRow } from "@/lib/types/workflow-action";
import type { DocumentTemplateRow } from "@/lib/types/document-template";
import type { UploadDocumentTypeRow } from "@/lib/types/upload-document";

const PolicySnapshotView = dynamic(
  () => import("@/components/policies/PolicySnapshotView").then((m) => m.PolicySnapshotView),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);
const StatusTab = dynamic(
  () => import("@/components/policies/tabs/StatusTab").then((m) => m.StatusTab),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);
const ActionsTab = dynamic(
  () => import("@/components/policies/tabs/ActionsTab").then((m) => m.ActionsTab),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);
const DocumentsTab = dynamic(
  () => import("@/components/policies/tabs/DocumentsTab").then((m) => m.DocumentsTab),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);
const UploadDocumentsTab = dynamic(
  () => import("@/components/policies/tabs/UploadDocumentsTab").then((m) => m.UploadDocumentsTab),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);
const AccountingTab = dynamic(
  () => import("@/components/policies/tabs/AccountingTab").then((m) => m.AccountingTab),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);

export type PolicyDetailsDrawerProps = {
  policyId: number | null;
  open: boolean;
  drawerOpen: boolean;
  onClose: () => void;
  title?: string;
  entityLabel?: string;
  hideClientInfo?: boolean;
};

export function PolicyDetailsDrawer({
  policyId,
  open,
  drawerOpen,
  onClose,
  title,
  entityLabel,
  hideClientInfo,
}: PolicyDetailsDrawerProps) {
  const session = useSession();
  const sessionUserType = (session.data?.user as any)?.userType as string | undefined;
  const isAdmin = sessionUserType === "admin" || sessionUserType === "internal_staff";
  const isClientUser = sessionUserType === "direct_client";

  const [mounted, setMounted] = React.useState(false);
  const [detail, setDetail] = React.useState<PolicyDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [hasActions, setHasActions] = React.useState(false);
  const [hasDocs, setHasDocs] = React.useState(false);
  const [hasUploads, setHasUploads] = React.useState(false);

  React.useEffect(() => { setMounted(true); }, []);

  const fetchDetail = React.useCallback(async (id: number, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch(`/api/policies/${id}?_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as PolicyDetail;
      setDetail(data);
    } catch { /* ignore */ }
    finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (policyId && open) {
      setDetail(null);
      void fetchDetail(policyId);
    }
  }, [policyId, open, fetchDetail]);

  const refreshCurrent = React.useCallback(async () => {
    if (!policyId || refreshing) return;
    setRefreshing(true);
    try { await fetchDetail(policyId, { silent: true }); }
    finally { setRefreshing(false); }
  }, [policyId, refreshing, fetchDetail]);

  const detailFlowKey = React.useMemo(
    () => (detail as any)?.flowKey ?? ((detail?.extraAttributes as Record<string, unknown> | undefined)?.flowKey as string) ?? undefined,
    [detail],
  );

  const premiumTabConfig = React.useMemo(() => {
    const fk = (detailFlowKey ?? "").toLowerCase();
    if (fk === "appaccounting") return null;
    if (fk === "policyset" || fk === "" || !detailFlowKey) return { label: "Premium", context: "policy" as const };
    if (fk.includes("endorsement")) return { label: "Endorsement Premium", context: "self" as const };
    if (fk.includes("collaborator") || fk === "collaboratorset") return { label: "Premium Payable", context: "collaborator" as const };
    if (fk.includes("insurance") || fk === "insuranceset") return { label: "Insurer Premium", context: "insurer" as const };
    if (fk.includes("client")) return { label: "Client Premium", context: "client" as const };
    if (fk.includes("agent")) return { label: "Agent Premium", context: "agent" as const };
    return null;
  }, [detailFlowKey]);

  const snapshotHiddenPkgs = React.useMemo(() => {
    const hidden = new Set<string>();
    if (premiumTabConfig) {
      hidden.add("accounting");
      hidden.add("premiumRecord");
    }
    if (hideClientInfo) {
      hidden.add("insured");
      hidden.add("contactinfo");
    }
    return hidden.size > 0 ? hidden : undefined;
  }, [premiumTabConfig, hideClientInfo]);

  React.useEffect(() => {
    if (!detail) {
      setHasActions(false);
      setHasDocs(false);
      setHasUploads(false);
      return;
    }
    let cancelled = false;
    const fk = detailFlowKey;

    function matches(flows: string[] | undefined): boolean {
      if (!flows || flows.length === 0) return true;
      if (!fk) return false;
      return flows.includes(fk);
    }

    Promise.all([
      fetch(`/api/form-options?groupKey=workflow_actions&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`/api/form-options?groupKey=document_templates&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`/api/form-options?groupKey=upload_document_types&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`/api/form-options?groupKey=pdf_merge_templates&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]).then(([actions, docs, uploadTypes, pdfTpls]: [WorkflowActionRow[], DocumentTemplateRow[], UploadDocumentTypeRow[], unknown[]]) => {
      if (cancelled) return;
      setHasActions(actions.some((a) => a.meta && matches(a.meta.flows)));
      const hasHtmlDocs = docs.some((d) => d.meta && matches(d.meta.flows));
      const hasPdfDocs = pdfTpls.some((p) => {
        const meta = (p as Record<string, unknown>)?.meta as { fields?: unknown[]; flows?: string[] } | null;
        return meta?.fields?.length && matches(meta.flows);
      });
      setHasDocs(hasHtmlDocs || hasPdfDocs);
      setHasUploads(uploadTypes.some((u) => matches(u.meta?.flows)));
    });

    return () => { cancelled = true; };
  }, [detail, detailFlowKey]);

  const label = entityLabel ?? "Policy";

  if (!mounted) return null;

  const drawer = (
    <RecordDetailsDrawer
      open={open}
      drawerOpen={drawerOpen}
      onClose={onClose}
      title={title ?? `${label} Details`}
      loading={loading}
      extraAttributes={detail?.extraAttributes as Record<string, unknown> | undefined}
      onRefresh={refreshCurrent}
      refreshing={refreshing}
      side="right"
      zClass="z-60"
      passthrough
      functionTabs={detail ? ([
        {
          id: "status",
          label: "Status",
          icon: <Activity className="h-3 w-3" />,
          content: (
            <StatusTab
              policyId={detail.policyId}
              currentStatus={
                ((detail.extraAttributes as Record<string, unknown> | undefined)?.status as string) ?? undefined
              }
              statusHistory={
                ((detail.extraAttributes as Record<string, unknown> | undefined)?.statusHistory as Array<{
                  status: string; changedAt: string; changedBy?: string; note?: string;
                }>) ?? undefined
              }
              onStatusChange={isClientUser ? undefined : refreshCurrent}
            />
          ),
        },
        ...(!isClientUser && hasActions ? [{
          id: "actions",
          label: "Actions",
          icon: <Zap className="h-3 w-3" />,
          content: (
            <ActionsTab
              policyId={detail.policyId}
              policyNumber={detail.policyNumber}
              detail={detail}
              currentAgent={detail.agent}
              flowKey={detailFlowKey}
              onActionComplete={refreshCurrent}
            />
          ),
        }] : []),
        ...(!isClientUser && hasDocs ? [{
          id: "documents",
          label: "Documents",
          icon: <FileText className="h-3 w-3" />,
          content: (
            <DocumentsTab
              detail={detail}
              flowKey={detailFlowKey}
            />
          ),
        }] : []),
        ...(!isClientUser && hasUploads ? [{
          id: "uploads",
          label: "Uploads",
          icon: <Upload className="h-3 w-3" />,
          content: (
            <UploadDocumentsTab
              policyId={detail.policyId}
              flowKey={detailFlowKey}
              isAdmin={isAdmin}
            />
          ),
        }] : []),
        ...(premiumTabConfig ? [{
          id: "accounting",
          label: premiumTabConfig.label,
          icon: <DollarSign className="h-3 w-3" />,
          content: (
            <AccountingTab
              policyId={detail.policyId}
              policyNumber={detail.policyNumber}
              canEdit={(isAdmin || sessionUserType === "accounting") && premiumTabConfig.context === "policy"}
              policyExtra={detail.extraAttributes as Record<string, unknown> | null | undefined}
              onUpdate={refreshCurrent}
              context={premiumTabConfig.context}
            />
          ),
        }] : []),
      ] satisfies Omit<DrawerTab, "permanent">[]) : undefined}
    >
      {detail ? (
        <PolicySnapshotView
          detail={detail}
          entityLabel={label}
          hiddenPackages={snapshotHiddenPkgs}
        />
      ) : (
        <div className="text-neutral-500 dark:text-neutral-400">No details.</div>
      )}
    </RecordDetailsDrawer>
  );

  return createPortal(drawer, document.body);
}
