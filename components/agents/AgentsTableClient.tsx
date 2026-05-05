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
import { CompactSelect } from "@/components/ui/compact-select";
import { AgentDocumentsTab, type AgentDocumentPreviewState } from "@/components/agents/AgentDocumentsTab";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowUpDown, Ban, CheckCircle2, ChevronRight, CreditCard, FileText, Link2, Pencil, RefreshCcw, Settings2, Trash2 } from "lucide-react";
import { EditUserDialog, type EditableUser } from "@/components/admin/edit-user-dialog";
import { PaymentSection } from "@/components/policies/tabs/PaymentSection";
import { usePagination } from "@/lib/pagination/use-pagination";
import { Pagination } from "@/components/ui/pagination";

type Row = {
  id: number;
  userNumber: string | null;
  email: string;
  mobile?: string | null;
  name: string | null;
  isActive: boolean;
  hasCompletedSetup?: boolean;
  accountType?: "personal" | "company" | null;
  companyName?: string | null;
  primaryId?: string | null;
  createdAt: string;
};

type LogEntry = { at: string; type: string; message: string; meta?: Record<string, unknown> };
type AgentStatementRow = {
  id: number;
  scheduleId?: number | null;
  policyId?: number | null;
  flowKey?: string | null;
  invoiceNumber: string;
  docNumber?: string | null;
  invoiceType: string;
  direction?: string | null;
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
};
function toTrackingKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "_");
}

function scoreStatementRow(row: AgentStatementRow): number {
  let score = 0;
  if (String(row.invoiceType || "").toLowerCase() === "statement") score += 4;
  if (String(row.docNumber || "").trim()) score += 3;
  const st = String(row.status || "").toLowerCase();
  if (st === "statement_created" || st === "statement_sent" || st === "statement_confirmed") score += 2;
  return score;
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

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/statements`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((j) => {
        if (cancelled) return;
        const parsed = Array.isArray(j) ? j : (j as { rows?: unknown[] }).rows ?? [];
        setRows(Array.isArray(parsed) ? (parsed as AgentStatementRow[]) : []);
      })
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
          const detailRes = await fetch(`/api/policies/${policyId}?_t=${Date.now()}`, { cache: "no-store" });
          if (!detailRes.ok) return [policyId, null];
          const detail = (await detailRes.json()) as { flowKey?: string; extraAttributes?: Record<string, unknown> };
          const extra = (detail.extraAttributes ?? {}) as Record<string, unknown>;
          const flowKey = String(detail.flowKey ?? extra.flowKey ?? "").toLowerCase();
          const statusClient = String(extra.statusClient ?? extra.status ?? "quotation_prepared").toLowerCase();
          const statusAgent = String(extra.statusAgent ?? statusClient ?? "quotation_prepared").toLowerCase();
          return [policyId, { statusAgent, statusClient, flowKey }];
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

  const rowsSafe = React.useMemo(
    () => [...(rows ?? [])].sort((a, b) => scoreStatementRow(b) - scoreStatementRow(a)),
    [rows],
  );

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
    const flowRules = Array.isArray(meta.flows)
      ? meta.flows.map((v) => String(v).toLowerCase()).filter((v) => v !== "agent")
      : [];
    if (flowRules.length > 0) {
      if (row.policyId) {
        const ctx = policyContextById[Number(row.policyId)];
        if (!ctx) return false;
        if (!flowRules.includes(ctx.flowKey)) return false;
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

  const displayRows = rowsSafe
    .map((row) => {
      const matchedTemplate = statementTemplates.find((tpl) => matchesTemplateForRow(tpl, row));
      if (!matchedTemplate) return null;
      return { row, matchedTemplate };
    })
    .filter((v): v is { row: AgentStatementRow; matchedTemplate: AgentTemplateRow } => !!v);

  const handlePolicyContextRefresh = React.useCallback((payload: {
    policyId: number;
    flowKey: string;
    statusClient: string;
    statusAgent: string;
  }) => {
    setPolicyContextById((prev) => ({
      ...prev,
      [payload.policyId]: {
        flowKey: payload.flowKey,
        statusClient: payload.statusClient,
        statusAgent: payload.statusAgent,
      },
    }));
  }, []);

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

  const first = displayRows[0];
  const firstPolicyId = Number(first?.row.policyId);
  const firstCtx = Number.isFinite(firstPolicyId) && firstPolicyId > 0 ? policyContextById[firstPolicyId] : undefined;
  const activePreview: AgentDocumentPreviewState | null = first && Number.isFinite(firstPolicyId) && firstPolicyId > 0
    ? {
      statementInvoiceId: first.row.id,
      policyId: firstPolicyId,
      templateValue: first.matchedTemplate.value,
      autoSelect: false,
      flowKey: firstCtx?.flowKey,
      statusAgent: firstCtx?.statusAgent,
      statusClient: firstCtx?.statusClient,
    }
    : null;

  if (activePreview) {
    return (
      <div className="space-y-2">
        <AgentDocumentsTab
          preview={activePreview}
          onPolicyContextRefresh={handlePolicyContextRefresh}
        />
      </div>
    );
  }
  return <div className="text-xs text-neutral-500 dark:text-neutral-400">No openable statement document found.</div>;
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
              <PaymentSection agentId={detail.id} isAdmin={true} />
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

export default function AgentsTableClient({
  initialRows,
  initialTotal,
  initialPageSize,
}: {
  initialRows: Row[];
  /** SSR-seeded total count (across every page). Falls back to
   *  `initialRows.length` for callers that haven't been migrated yet. */
  initialTotal?: number;
  initialPageSize?: number;
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const session = useSession();
  const sessionUserType = (session.data?.user as { userType?: string } | undefined)?.userType;
  const canManageAgents = mounted && sessionUserType === "admin";

  const {
    rows,
    total,
    page,
    pageSize,
    loading: rowsLoading,
    setPage,
    setPageSize,
    patchRow,
    removeRow,
  } = usePagination<Row>({
    url: "/api/agents",
    scope: "agents",
    initialRows,
    initialTotal: initialTotal ?? initialRows.length,
    initialPageSize,
  });

  function patchRowById(id: number, next: Partial<Row>) {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx >= 0) patchRow(idx, { ...rows[idx], ...next });
  }
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
  const [editAgent, setEditAgent] = React.useState<EditableUser | null>(null);
  const [inviteAgent, setInviteAgent] = React.useState<EditableUser | null>(null);
  const [inviteVerb, setInviteVerb] = React.useState<"send" | "reissue">("send");

  function rowToEditable(r: Row): EditableUser {
    return {
      id: r.id,
      email: r.email,
      mobile: r.mobile ?? null,
      name: r.name ?? null,
      userType: "agent",
      accountType: r.accountType ?? null,
      companyName: r.companyName ?? null,
      primaryId: r.primaryId ?? null,
    };
  }

  function openEditAgent(r: Row) {
    setEditAgent(rowToEditable(r));
  }

  function openInviteAgent(r: Row) {
    if (!canManageAgents) return;
    setInviteVerb(r.hasCompletedSetup === false ? "send" : "reissue");
    setInviteAgent(rowToEditable(r));
  }

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
      patchRowById(id, { isActive: !currentlyActive });
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
      removeRow((r) => r.id === id);
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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="max-w-full sm:max-w-[420px]"
        />
        <Button size="sm" onClick={() => setQuery(searchText)}>
          Search
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          Agents # {filteredRows.length}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            title={sortDir === "asc" ? "Sort ascending" : "Sort descending"}
          >
            <ArrowUpDown className="h-3.5 w-3.5 sm:hidden lg:inline" />
            <span className="hidden sm:inline">{sortDir === "asc" ? "Asc" : "Desc"}</span>
          </Button>
          {mounted ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1" title="Toggle columns">
                  <Settings2 className="h-3.5 w-3.5 sm:hidden lg:inline" />
                  <span className="hidden sm:inline">Columns</span>
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
            <Button size="sm" variant="outline" className="gap-1" disabled title="Toggle columns">
              <Settings2 className="h-3.5 w-3.5 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Columns</span>
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
                  {r.hasCompletedSetup === false ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      title="Account created but the agent has not completed the invite flow yet."
                    >
                      Setup Pending
                    </span>
                  ) : r.isActive ? (
                    <span className="text-green-600 dark:text-green-400">Active</span>
                  ) : (
                    <span className="text-neutral-500 dark:text-neutral-400">Inactive</span>
                  )}
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
                          label: "Edit",
                          icon: <Pencil className="h-4 w-4" />,
                          onClick: () => openEditAgent(r),
                          loading: actionBusyId === r.id,
                        }]
                        : []),
                      ...(canManageAgents && (r.hasCompletedSetup === false || !r.isActive)
                        ? [{
                          label: r.hasCompletedSetup === false ? "Send Invite" : "Re-Invite",
                          icon: r.hasCompletedSetup === false ? <Link2 className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />,
                          onClick: () => openInviteAgent(r),
                          loading: actionBusyId === r.id,
                        }]
                        : []),
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

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        loading={rowsLoading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        itemNoun={total === 1 ? "agent" : "agents"}
      />

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
                  <div className="text-neutral-500 dark:text-neutral-400">Mobile</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.mobile ?? "—"}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Account Type</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right capitalize">
                    {detail.profileMeta?.accountType ?? "personal"}
                  </div>
                </div>
                {detail.profileMeta?.accountType === "company" ? (
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <div className="text-neutral-500 dark:text-neutral-400">Company Name</div>
                    <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.profileMeta?.companyName ?? "—"}</div>
                  </div>
                ) : null}
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">
                    {detail.profileMeta?.accountType === "company" ? "BR / CI Number" : "ID Number"}
                  </div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.profileMeta?.primaryId ?? "—"}</div>
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

      <EditUserDialog
        open={editAgent !== null}
        onOpenChange={(o) => { if (!o) setEditAgent(null); }}
        user={editAgent}
        onSaved={(u) => {
          applyAgentUpdate(u);
          setEditAgent(null);
        }}
      />

      <EditUserDialog
        open={inviteAgent !== null}
        onOpenChange={(o) => { if (!o) setInviteAgent(null); }}
        user={inviteAgent}
        mode="invite"
        inviteVerb={inviteVerb}
        onSaved={(u) => applyAgentUpdate(u)}
        onInviteSent={() => setInviteAgent(null)}
      />
    </div>
  );

  function applyAgentUpdate(u: EditableUser) {
    patchRowById(u.id, {
      email: u.email,
      mobile: u.mobile ?? null,
      name: u.name ?? null,
      accountType: u.accountType ?? null,
      companyName: u.companyName ?? null,
      primaryId: u.primaryId ?? null,
    });
    if (detail?.id === u.id) {
      setDetail((prev) => (prev ? { ...prev, email: u.email, mobile: u.mobile ?? null, name: u.name ?? null } : prev));
    }
  }
}

