"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RowActionMenu } from "@/components/ui/row-action-menu";
import { RecordDetailsDrawer } from "@/components/ui/record-details-drawer";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AgentDetail } from "@/lib/types/agent";
import { formatDDMMYYYYHHMM } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { resolveDocumentTemplateShowOn, type DocumentTemplateMeta } from "@/lib/types/document-template";
import { usePolicyStatuses } from "@/hooks/use-policy-statuses";
import dynamic from "next/dynamic";
import type { PolicyDetail } from "@/lib/types/policy";
import { CompactSelect } from "@/components/ui/compact-select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUpDown, Ban, CheckCircle2, ChevronRight, CreditCard, FileText, Settings2, Trash2 } from "lucide-react";
const DocumentsTab = dynamic(
  () => import("@/components/policies/tabs/DocumentsTab").then((m) => m.DocumentsTab),
  { loading: () => <div className="py-3 text-xs text-neutral-500 dark:text-neutral-400">Loading template preview...</div> },
);

type Row = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
};

type LogEntry = { at: string; type: string; message: string; meta?: Record<string, unknown> };
type AgentStatementRow = {
  id: number;
  policyId?: number | null;
  flowKey?: string | null;
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  invoiceDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  policyNumbers: string;
};
type AgentTemplateRow = {
  id: number;
  label: string;
  value: string;
  meta: DocumentTemplateMeta | null;
};
type AgentPolicyContext = {
  statusAgent: string;
  statusClient: string;
  flowKey: string;
  tracking: Record<string, unknown>;
};
function toTrackingKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "_");
}

function AgentLogPanel({ agentId }: { agentId: number }) {
  const [logs, setLogs] = React.useState<LogEntry[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/logs`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => { if (!cancelled) setLogs(Array.isArray(j) ? (j as LogEntry[]) : []); })
      .catch(() => { if (!cancelled) setLogs([]); });
    return () => { cancelled = true; };
  }, [agentId]);

  if (!logs) {
    return <div className="text-neutral-500 dark:text-neutral-400">Loading…</div>;
  }
  if (logs.length === 0) {
    return <div className="text-neutral-500 dark:text-neutral-400">No logs.</div>;
  }
  return (
    <div className="space-y-2">
      {logs.map((l, i) => (
        <div key={`log-${i}`} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="mb-1 flex items-center justify-between">
            <div className="font-medium">{formatDDMMYYYYHHMM(l.at)}</div>
            <div className="text-neutral-500 dark:text-neutral-400 capitalize">{l.type}</div>
          </div>
          <div>{l.message}</div>
          {l.meta ? (
            <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-[11px] leading-snug text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              {JSON.stringify(l.meta, null, 2)}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AgentStatementsPanel({
  agentId,
}: {
  agentId: number;
}) {
  const { sortedValues: statusOrder } = usePolicyStatuses();
  const [rows, setRows] = React.useState<AgentStatementRow[] | null>(null);
  const [statementTemplates, setStatementTemplates] = React.useState<AgentTemplateRow[]>([]);
  const [policyContextById, setPolicyContextById] = React.useState<Record<number, AgentPolicyContext>>({});
  const [preparingKeys, setPreparingKeys] = React.useState<Set<string>>(new Set());
  const [attemptedPrepareKeys, setAttemptedPrepareKeys] = React.useState<Set<string>>(new Set());
  const [openPreview, setOpenPreview] = React.useState<{
    policyId: number;
    templateValue?: string;
    autoSelect?: boolean;
    flowKey?: string;
    statusAgent?: string;
    statusClient?: string;
  } | null>(null);
  const [previewDetail, setPreviewDetail] = React.useState<PolicyDetail | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [autoEnteredTemplateView, setAutoEnteredTemplateView] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/statements`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => { if (!cancelled) setRows(Array.isArray(j) ? (j as AgentStatementRow[]) : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [agentId]);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/form-options?groupKey=document_templates&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: unknown) => {
        if (cancelled || !Array.isArray(j)) return;
        const rows = (j as AgentTemplateRow[]).filter((t) => {
          const meta = t.meta;
          if (!meta) return false;
          if (meta.type !== "statement") return false;
          if (!meta.isAgentTemplate) return false;
          const flowRules = Array.isArray(meta.flows) ? meta.flows.map((v) => String(v).toLowerCase()) : [];
          if (flowRules.length > 0 && !flowRules.includes("agent")) return false;
          const placements = resolveDocumentTemplateShowOn(meta);
          return placements.includes("agent");
        });
        setStatementTemplates(rows);
      })
      .catch(() => {
        if (!cancelled) setStatementTemplates([]);
      });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function loadPolicyContexts() {
      if (!rows || rows.length === 0) {
        setPolicyContextById({});
        return;
      }
      const policyIds = [...new Set(rows.map((r) => Number(r.policyId)).filter((id) => Number.isFinite(id) && id > 0))];
      const entries = await Promise.all(policyIds.map(async (policyId): Promise<[number, AgentPolicyContext | null]> => {
        try {
          const [detailRes, trackingRes] = await Promise.all([
            fetch(`/api/policies/${policyId}?_t=${Date.now()}`, { cache: "no-store" }),
            fetch(`/api/policies/${policyId}/document-tracking?_t=${Date.now()}`, { cache: "no-store" }),
          ]);
          if (!detailRes.ok) return [policyId, null];
          const detail = (await detailRes.json()) as { flowKey?: string; extraAttributes?: Record<string, unknown> };
          const extra = (detail.extraAttributes ?? {}) as Record<string, unknown>;
          const flowKey = String(detail.flowKey ?? extra.flowKey ?? "").toLowerCase();
          const statusClient = String(extra.statusClient ?? extra.status ?? "quotation_prepared").toLowerCase();
          const statusAgent = String(extra.statusAgent ?? statusClient ?? "quotation_prepared").toLowerCase();
          const tracking = trackingRes.ok
            ? ((await trackingRes.json()) as Record<string, unknown>)
            : {};
          return [policyId, { statusAgent, statusClient, flowKey, tracking }];
        } catch {
          return [policyId, null];
        }
      }));
      if (cancelled) return;
      const next: Record<number, AgentPolicyContext> = {};
      for (const [id, ctx] of entries) {
        if (ctx) next[id] = ctx;
      }
      setPolicyContextById(next);
    }
    void loadPolicyContexts();
    return () => { cancelled = true; };
  }, [rows]);

  const rowsSafe = rows ?? [];

  const effectiveStatusOrder = Array.from(new Set([
    ...statusOrder,
    "quotation_prepared",
    "quotation_confirmed",
    "invoice_prepared",
    "invoice_sent",
    "payment_received",
    "receipt_prepared",
    "proposal_form_received",
    "completed",
    "active",
    "commission_pending",
    "statement_created",
    "statement_sent",
    "statement_confirmed",
    "credit_advice_prepared",
    "credit_advice_sent",
    "credit_advice_confirmed",
    "commission_settled",
  ].map((s) => String(s).toLowerCase())));

  const matchesStatusRule = (rule: string[] | undefined, policyStatus: string) => {
    if (!rule || rule.length === 0) return true;
    const normalizedRule = rule.map((s) => String(s).toLowerCase());
    const currentIdx = effectiveStatusOrder.indexOf(policyStatus);
    const earliestIdx = Math.min(
      ...normalizedRule.map((s) => effectiveStatusOrder.indexOf(s)).filter((i) => i >= 0),
    );
    if (currentIdx < 0 || earliestIdx === Infinity) return normalizedRule.includes(policyStatus);
    return currentIdx >= earliestIdx;
  };

  const matchesTemplateForRow = (tpl: AgentTemplateRow, row: AgentStatementRow) => {
    const meta = tpl.meta;
    if (!meta) return false;
    const flowRules = Array.isArray(meta.flows) ? meta.flows.map((v) => String(v).toLowerCase()) : [];
    if (flowRules.length > 0) {
      if (!flowRules.includes("agent")) return false;
      const nonAgentFlowRules = flowRules.filter((f) => f !== "agent");
      if (row.policyId) {
        const ctx = policyContextById[Number(row.policyId)];
        if (!ctx) return false;
        if (nonAgentFlowRules.length > 0 && !nonAgentFlowRules.includes(ctx.flowKey)) return false;
      }
    }
    if (!row.policyId) return true;
    const ctx = policyContextById[Number(row.policyId)];
    if (!ctx) return false;
    const rule = (meta.showWhenStatusAgent && meta.showWhenStatusAgent.length > 0)
      ? meta.showWhenStatusAgent
      : meta.showWhenStatus;
    return matchesStatusRule(rule, ctx.statusAgent);
  };

  const resolveLinkedDocNumber = (tpl: AgentTemplateRow, row: AgentStatementRow) => {
    if (!row.policyId) return "";
    const ctx = policyContextById[Number(row.policyId)];
    if (!ctx) return "";
    const key = `${toTrackingKey(tpl.label)}_agent`;
    const entry = ctx.tracking[key] as Record<string, unknown> | undefined;
    return entry?.documentNumber ? String(entry.documentNumber) : "";
  };

  const displayRows = rowsSafe
    .map((row) => {
      const matchedTemplate = statementTemplates.find((tpl) => matchesTemplateForRow(tpl, row));
      if (!matchedTemplate) return null;
      const docNumber = resolveLinkedDocNumber(matchedTemplate, row);
      return { row, matchedTemplate, docNumber };
    })
    .filter((v): v is { row: AgentStatementRow; matchedTemplate: AgentTemplateRow; docNumber: string } => !!v);

  React.useEffect(() => {
    if (displayRows.length === 0) return;
    const toPrepare = displayRows
      .map(({ row, matchedTemplate, docNumber }) => {
        const policyId = Number(row.policyId);
        const trackingKey = `${toTrackingKey(matchedTemplate.label)}_agent`;
        const prepId = `${policyId}:${trackingKey}`;
        if (!Number.isFinite(policyId) || policyId <= 0) return null;
        if (docNumber) return null;
        if (!matchedTemplate.meta?.documentPrefix) return null;
        if (preparingKeys.has(prepId)) return null;
        if (attemptedPrepareKeys.has(prepId)) return null;
        return { policyId, trackingKey, prepId, tpl: matchedTemplate };
      })
      .filter((v): v is { policyId: number; trackingKey: string; prepId: string; tpl: AgentTemplateRow } => !!v);
    if (toPrepare.length === 0) return;

    setPreparingKeys((prev) => {
      const next = new Set(prev);
      toPrepare.forEach((p) => next.add(p.prepId));
      return next;
    });
    setAttemptedPrepareKeys((prev) => {
      const next = new Set(prev);
      toPrepare.forEach((p) => next.add(p.prepId));
      return next;
    });

    let cancelled = false;
    (async () => {
      for (const item of toPrepare) {
        try {
          const res = await fetch(`/api/policies/${item.policyId}/document-tracking`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              docType: item.trackingKey,
              action: "prepare",
              templateType: item.tpl.meta?.type,
              documentPrefix: item.tpl.meta?.documentPrefix,
              documentSuffix: "(A)",
              documentSetGroup: item.tpl.meta?.documentSetGroup,
            }),
          });
          if (!res.ok) continue;
          const data = await res.json() as { documentTracking?: Record<string, unknown> };
          if (cancelled || !data.documentTracking) continue;
          setPolicyContextById((prev) => {
            const current = prev[item.policyId];
            if (!current) return prev;
            return {
              ...prev,
              [item.policyId]: {
                ...current,
                tracking: data.documentTracking ?? current.tracking,
              },
            };
          });
        } catch {
          // ignore
        } finally {
          setPreparingKeys((prev) => {
            const next = new Set(prev);
            next.delete(item.prepId);
            return next;
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [displayRows, preparingKeys, attemptedPrepareKeys]);

  const fmtMoney = (cents: number, ccy: string) =>
    new Intl.NumberFormat("en-HK", { style: "currency", currency: ccy || "HKD", minimumFractionDigits: 2 }).format((Number(cents) || 0) / 100);

  const openTemplatePreview = async (
    policyId: number,
    templateValue?: string,
    autoSelect = true,
    context?: { flowKey?: string; statusAgent?: string; statusClient?: string },
  ) => {
    if (!Number.isFinite(policyId) || policyId <= 0) return;
    setOpenPreview({
      policyId,
      templateValue,
      autoSelect,
      flowKey: context?.flowKey,
      statusAgent: context?.statusAgent,
      statusClient: context?.statusClient,
    });
    setPreviewDetail(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/policies/${policyId}?_t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load policy");
      const detail = (await res.json()) as PolicyDetail;
      setPreviewDetail(detail);
    } catch {
      toast.error("Unable to open statement template.");
      setOpenPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  React.useEffect(() => {
    setAutoEnteredTemplateView(false);
    setOpenPreview(null);
    setPreviewDetail(null);
    setPreviewLoading(false);
  }, [agentId]);

  React.useEffect(() => {
    if (autoEnteredTemplateView) return;
    if (openPreview) return;
    const first = displayRows[0];
    if (!first) return;
    const policyId = Number(first.row.policyId);
    if (!Number.isFinite(policyId) || policyId <= 0) return;
    const ctx = policyContextById[policyId];
    void openTemplatePreview(policyId, first.matchedTemplate.value, false, ctx ? {
      flowKey: ctx.flowKey,
      statusAgent: ctx.statusAgent,
      statusClient: ctx.statusClient,
    } : undefined);
    setAutoEnteredTemplateView(true);
  }, [autoEnteredTemplateView, openPreview, displayRows, policyContextById]);

  const refreshOpenPreviewPolicy = async () => {
    if (!openPreview) return;
    const policyId = Number(openPreview.policyId);
    if (!Number.isFinite(policyId) || policyId <= 0) return;
    try {
      const [detailRes, trackingRes] = await Promise.all([
        fetch(`/api/policies/${policyId}?_t=${Date.now()}`, { cache: "no-store" }),
        fetch(`/api/policies/${policyId}/document-tracking?_t=${Date.now()}`, { cache: "no-store" }),
      ]);
      if (!detailRes.ok) return;
      const detail = (await detailRes.json()) as PolicyDetail;
      setPreviewDetail(detail);
      const extra = (detail.extraAttributes ?? {}) as Record<string, unknown>;
      const flowKey = String((detail as unknown as { flowKey?: string }).flowKey ?? extra.flowKey ?? "").toLowerCase();
      const statusClient = String(extra.statusClient ?? extra.status ?? "quotation_prepared").toLowerCase();
      const statusAgent = String(extra.statusAgent ?? statusClient ?? "quotation_prepared").toLowerCase();
      setOpenPreview((prev) => prev ? { ...prev, flowKey, statusAgent, statusClient } : prev);
      const tracking = trackingRes.ok ? ((await trackingRes.json()) as Record<string, unknown>) : {};
      setPolicyContextById((prev) => ({
        ...prev,
        [policyId]: { statusAgent, statusClient, flowKey, tracking },
      }));
    } catch {
      // non-fatal refresh
    }
  };

  if (!rows) {
    return <div className="text-xs text-neutral-500 dark:text-neutral-400">Loading statements...</div>;
  }
  if (rows.length === 0) {
    return <div className="text-xs text-neutral-500 dark:text-neutral-400">No agent statements yet.</div>;
  }

  const needsPolicyContext = rowsSafe.some((r) => Number.isFinite(Number(r.policyId)) && Number(r.policyId) > 0);
  const hasAnyPolicyContext = Object.keys(policyContextById).length > 0;
  if (needsPolicyContext && !hasAnyPolicyContext) {
    return <div className="text-xs text-neutral-500 dark:text-neutral-400">Loading linked document context...</div>;
  }

  if (displayRows.length === 0) {
    return <div className="text-xs text-neutral-500 dark:text-neutral-400">No linked agent documents found for current template settings.</div>;
  }

  if (openPreview) {
    return (
      <div className="space-y-2">
        {previewLoading && (
          <div className="py-3 text-xs text-neutral-500 dark:text-neutral-400">Loading statement template...</div>
        )}
        {!previewLoading && previewDetail && (
          <div className="max-h-[70vh] overflow-auto">
            <DocumentsTab
              detail={previewDetail}
              flowKey={String(
                openPreview.flowKey
                ?? (previewDetail as unknown as { flowKey?: string }).flowKey
                ?? ((previewDetail.extraAttributes ?? {}) as Record<string, unknown>).flowKey
                ?? "",
              )}
              currentStatusClient={String(
                openPreview.statusClient
                ?? ((previewDetail.extraAttributes ?? {}) as Record<string, unknown>).statusClient
                ?? ((previewDetail.extraAttributes ?? {}) as Record<string, unknown>).status
                ?? "quotation_prepared",
              )}
              currentStatusAgent={String(
                openPreview.statusAgent
                ?? ((previewDetail.extraAttributes ?? {}) as Record<string, unknown>).statusAgent
                ?? ((previewDetail.extraAttributes ?? {}) as Record<string, unknown>).statusClient
                ?? ((previewDetail.extraAttributes ?? {}) as Record<string, unknown>).status
                ?? "quotation_prepared",
              )}
              initialTemplateValue={openPreview.autoSelect ? openPreview.templateValue : undefined}
              initialAudience="agent"
              onlyTemplateValue={openPreview.templateValue}
              hidePdfTemplates
              onStatusAutoAdvanced={() => { void refreshOpenPreviewPolicy(); }}
            />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {displayRows.map(({ row: r, matchedTemplate, docNumber }) => {
        const policyId = Number(r.policyId);
        const trackingKey = `${toTrackingKey(matchedTemplate.label)}_agent`;
        const isPreparing = preparingKeys.has(`${policyId}:${trackingKey}`);
        return (
        <div
          key={r.id}
          role="button"
          tabIndex={Number.isFinite(policyId) && policyId > 0 ? 0 : -1}
          className="cursor-pointer rounded-md border border-neutral-200 p-2 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/40"
          onClick={() => {
            if (!Number.isFinite(policyId) || policyId <= 0) return;
            const ctx = policyContextById[policyId];
            void openTemplatePreview(policyId, matchedTemplate.value, true, ctx ? {
              flowKey: ctx.flowKey,
              statusAgent: ctx.statusAgent,
                  statusClient: ctx.statusClient,
            } : undefined);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            if (!Number.isFinite(policyId) || policyId <= 0) return;
            const ctx = policyContextById[policyId];
            void openTemplatePreview(policyId, matchedTemplate.value, true, ctx ? {
              flowKey: ctx.flowKey,
              statusAgent: ctx.statusAgent,
              statusClient: ctx.statusClient,
            } : undefined);
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-mono">{docNumber || r.invoiceNumber || (isPreparing ? "Preparing document number..." : "No document number yet")}</div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                {String(r.status || "").replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <div className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
            Template: {matchedTemplate.label}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {r.policyNumbers || "—"}
          </div>
          <div className="mt-1 text-xs">
            {fmtMoney(r.totalAmountCents, r.currency)} total
            {r.paidAmountCents > 0 ? ` · ${fmtMoney(r.paidAmountCents, r.currency)} paid` : ""}
          </div>
        </div>
      );
      })}
    </div>
  );
}

function AgentPaymentsPanel({ agentId }: { agentId: number }) {
  const [rows, setRows] = React.useState<AgentStatementRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/statements`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => { if (!cancelled) setRows(Array.isArray(j) ? (j as AgentStatementRow[]) : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [agentId]);

  if (!rows) return <div className="text-xs text-neutral-500 dark:text-neutral-400">Loading payments...</div>;
  if (rows.length === 0) return <div className="text-xs text-neutral-500 dark:text-neutral-400">No payment records yet.</div>;

  const currency = rows[0]?.currency || "HKD";
  const totalCents = rows.reduce((sum, r) => sum + (Number(r.totalAmountCents) || 0), 0);
  const paidCents = rows.reduce((sum, r) => sum + (Number(r.paidAmountCents) || 0), 0);
  const outstandingCents = totalCents - paidCents;
  const fmtMoney = (cents: number) =>
    new Intl.NumberFormat("en-HK", { style: "currency", currency, minimumFractionDigits: 2 }).format((Number(cents) || 0) / 100);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Total</div>
        <div className="mt-1 text-sm font-semibold">{fmtMoney(totalCents)}</div>
      </div>
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Paid</div>
        <div className="mt-1 text-sm font-semibold">{fmtMoney(paidCents)}</div>
      </div>
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Outstanding</div>
        <div className="mt-1 text-sm font-semibold">{fmtMoney(outstandingCents)}</div>
      </div>
    </div>
  );
}

function AgentWorkflowPanel({ detail }: { detail: AgentDetail }) {
  const [expandedSection, setExpandedSection] = React.useState<string | null>(null);
  const sections = [
    { id: "documents", label: "Documents" },
    { id: "task-list", label: "Task List" },
    { id: "payments", label: "Payments" },
    { id: "actions", label: "Additional Actions" },
  ];
  const toggleSection = (id: string) => {
    setExpandedSection((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <div className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium">
          <span>Current Status</span>
          <span className="flex items-center gap-2">
            <Badge
              variant="custom"
              className={detail.isActive
                ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"}
            >
              {detail.isActive ? "Active" : "Inactive"}
            </Badge>
          </span>
        </div>
      </div>

      {sections.map((sec) => (
        <div key={sec.id} className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection(sec.id)}
            className="w-full px-3 py-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{sec.label}</span>
              <ChevronRight className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${expandedSection === sec.id ? "rotate-90" : ""}`} />
            </div>
          </button>

          {sec.id === "documents" && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
              <AgentStatementsPanel agentId={detail.id} />
            </div>
          )}
          {sec.id === "task-list" && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              No pending agent tasks.
            </div>
          )}
          {sec.id === "payments" && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
              <AgentPaymentsPanel agentId={detail.id} />
            </div>
          )}
          {sec.id === "actions" && expandedSection === sec.id && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Additional Actions</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => toast.info("Use Documents section for statement actions.")}>
                  Manage Statements
                </Button>
                <Button size="sm" variant="outline" onClick={() => toast.info("Use Payments section for payment totals.")}>
                  Review Payments
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AgentsTableClient({ initialRows }: { initialRows: Row[] }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const session = useSession();
  const sessionUserType = (session.data?.user as { userType?: string } | undefined)?.userType;
  const canManageAgents = mounted && sessionUserType === "admin";
  const [rows, setRows] = React.useState<Row[]>(initialRows);
  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "active" | "inactive">("all");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [visibleCols, setVisibleCols] = React.useState<string[]>(["agentNo", "nameEmail", "status"]);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<AgentDetail | null>(null);
  const [actionBusyId, setActionBusyId] = React.useState<number | null>(null);
  const [toggleConfirm, setToggleConfirm] = React.useState<{ id: number; currentlyActive: boolean } | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<number | null>(null);
  const [searchText, setSearchText] = React.useState("");

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setOpenId(null), 250);
  }

  async function openDetails(id: number) {
    setOpenId(id);
    setDetail(null);
    try {
      const res = await fetch(`/api/agents/${id}`, { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as AgentDetail;
        setDetail(d);
      }
    } finally {
      setDrawerOpen(false);
      requestAnimationFrame(() => setDrawerOpen(true));
    }
  }

  async function confirmToggleActive() {
    if (!toggleConfirm) return;
    const { id, currentlyActive } = toggleConfirm;
    if (!canManageAgents) return;
    setActionBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !currentlyActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Update failed");
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, isActive: !currentlyActive } : r)));
      if (detail?.id === id) setDetail((prev) => (prev ? { ...prev, isActive: !currentlyActive } : prev));
      toast.success(currentlyActive ? "Agent disabled" : "Agent enabled");
      setToggleConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setActionBusyId(null);
    }
  }

  async function confirmDeleteAgent() {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    if (!canManageAgents) return;
    setActionBusyId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Delete failed");
      setRows((prev) => prev.filter((r) => r.id !== id));
      if (openId === id) closeDrawer();
      toast.success("Agent deleted");
      setDeleteConfirmId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActionBusyId(null);
    }
  }

  const filteredRows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (statusFilter === "active" && !r.isActive) return false;
      if (statusFilter === "inactive" && r.isActive) return false;
      if (!q) return true;
      const hay = `${r.userNumber ?? ""} ${r.name ?? ""} ${r.email}`.toLowerCase();
      return hay.includes(q);
    });
    const sorted = [...base].sort((a, b) => {
      const ad = Date.parse(a.createdAt || "");
      const bd = Date.parse(b.createdAt || "");
      if (Number.isNaN(ad) || Number.isNaN(bd)) return 0;
      return sortDir === "asc" ? ad - bd : bd - ad;
    });
    return sorted;
  }, [rows, query, statusFilter, sortDir]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="max-w-[420px]"
        />
        <Button size="sm" onClick={() => setQuery(searchText)}>
          Search
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          Agents # {filteredRows.length}
        </div>
        <div className="flex items-center gap-2">
          <CompactSelect
            options={[
              { value: "all", label: "All Agents" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as "all" | "active" | "inactive")}
            maxWidth="9rem"
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {sortDir === "asc" ? "Asc" : "Desc"}
          </Button>
          {mounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1">
                  <Settings2 className="h-3.5 w-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={visibleCols.includes("agentNo")}
                  onCheckedChange={(checked) =>
                    setVisibleCols((prev) => checked ? [...new Set([...prev, "agentNo"])] : prev.filter((c) => c !== "agentNo"))
                  }
                >
                  Agent No.
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleCols.includes("nameEmail")}
                  onCheckedChange={(checked) =>
                    setVisibleCols((prev) => checked ? [...new Set([...prev, "nameEmail"])] : prev.filter((c) => c !== "nameEmail"))
                  }
                >
                  Name / Email
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={visibleCols.includes("status")}
                  onCheckedChange={(checked) =>
                    setVisibleCols((prev) => checked ? [...new Set([...prev, "status"])] : prev.filter((c) => c !== "status"))
                  }
                >
                  Status
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" variant="outline" className="gap-1" disabled>
              <Settings2 className="h-3.5 w-3.5" />
              Columns
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {visibleCols.includes("agentNo") && <TableHead>Agent No.</TableHead>}
            {visibleCols.includes("nameEmail") && <TableHead>Name / Email</TableHead>}
            {visibleCols.includes("status") && <TableHead>Status</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRows.map((r) => (
            <TableRow
              key={r.id}
              onClick={() => openDetails(r.id)}
              className={cn(
                "cursor-pointer",
                r.isActive && "text-green-600 dark:text-green-400",
              )}
            >
              {visibleCols.includes("agentNo") && (
                <TableCell className="font-medium">
                  <span className={r.isActive ? "text-green-600 dark:text-green-400" : "text-neutral-500 dark:text-neutral-400"}>
                    {r.userNumber ?? "—"}
                  </span>
                </TableCell>
              )}
              {visibleCols.includes("nameEmail") && (
                <TableCell>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                    <span className="font-medium">{r.name ?? "—"}</span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">{r.email}</span>
                  </div>
                </TableCell>
              )}
              {visibleCols.includes("status") && (
                <TableCell>
                  <span className={r.isActive ? "text-green-600 dark:text-green-400" : "text-neutral-500 dark:text-neutral-400"}>
                    {r.isActive ? "Active" : "Inactive"}
                  </span>
                </TableCell>
              )}
              <TableCell className="text-right">
                <div
                  className="flex justify-end gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RowActionMenu
                    actions={[
                      ...(canManageAgents
                        ? [{
                          label: r.isActive ? "Disable" : "Enable",
                          icon: r.isActive ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />,
                          onClick: () => setToggleConfirm({ id: r.id, currentlyActive: r.isActive }),
                          loading: actionBusyId === r.id,
                        }]
                        : []),
                      ...(canManageAgents
                        ? [{
                          label: "Delete",
                          icon: <Trash2 className="h-4 w-4" />,
                          onClick: () => setDeleteConfirmId(r.id),
                          variant: "destructive" as const,
                          loading: actionBusyId === r.id,
                        }]
                        : []),
                    ]}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {filteredRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={visibleCols.length + 1} className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                No agents found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>

      <RecordDetailsDrawer
        open={openId !== null}
        drawerOpen={drawerOpen}
        onClose={closeDrawer}
        title="Agent Details"
        loading={!detail}
        logContent={openId !== null ? <AgentLogPanel agentId={openId} /> : undefined}
        functionTabs={detail ? ([
          {
            id: "workflow",
            label: "Workflow",
            icon: <FileText className="h-3 w-3" />,
            content: <AgentWorkflowPanel detail={detail} />,
          },
          {
            id: "agent-premium",
            label: "Agent Premium",
            icon: <CreditCard className="h-3 w-3" />,
            content: <AgentStatementsPanel agentId={detail.id} />,
          },
        ]) : undefined}
      >
        {detail ? (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Agent No.</div>
              <div className="font-mono">{detail.userNumber ?? "—"}</div>
            </div>
            <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="mb-1 text-sm font-medium">Details</div>
              <div className="grid grid-cols-1 gap-1">
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Name</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.name ?? "—"}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Email</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.email}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Role</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right capitalize">{detail.userType}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Status</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.isActive ? "Active" : "Inactive"}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Created</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{formatDDMMYYYYHHMM(detail.createdAt)}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Updated</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.updatedAt ? formatDDMMYYYYHHMM(detail.updatedAt) : "—"}</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-neutral-500 dark:text-neutral-400">No details.</div>
        )}
      </RecordDetailsDrawer>

      <Dialog open={toggleConfirm !== null} onOpenChange={(o) => { if (!o) setToggleConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{toggleConfirm?.currentlyActive ? "Disable Record" : "Enable Record"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {toggleConfirm?.currentlyActive
              ? "Are you sure you want to disable this record? It will remain in the list but marked as inactive."
              : "Are you sure you want to re-enable this record?"}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToggleConfirm(null)} disabled={!!actionBusyId}>
              Cancel
            </Button>
            <Button
              variant={toggleConfirm?.currentlyActive ? "destructive" : "default"}
              onClick={confirmToggleActive}
              disabled={!!actionBusyId}
            >
              {actionBusyId ? "Saving..." : toggleConfirm?.currentlyActive ? "Disable" : "Enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmId !== null} onOpenChange={(o) => { if (!o) setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Record</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Are you sure you want to delete this record? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)} disabled={!!actionBusyId}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteAgent} disabled={!!actionBusyId}>
              {actionBusyId ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

