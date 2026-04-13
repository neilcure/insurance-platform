"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  SCHEDULE_FREQUENCY_LABELS,
  type PaymentStatus,
  type InvoiceStatus,
  type ScheduleFrequency,
} from "@/lib/types/accounting";
import {
  Check,
  X,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  CalendarClock,
} from "lucide-react";
import { InlinePaymentForm } from "@/components/ui/inline-payment-form";

type InvoicePayment = {
  id: number;
  invoiceId: number;
  amountCents: number;
  currency: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  payer: string | null;
  status: PaymentStatus;
  notes: string | null;
  submittedBy: number | null;
  verifiedBy: number | null;
  verifiedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

type InvoiceWithPayments = {
  id: number;
  invoiceNumber: string;
  invoiceType: string;
  direction: string;
  premiumType: string;
  entityType: string;
  entityName: string | null;
  entityPolicyId?: number | null;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  status: InvoiceStatus;
  invoiceDate: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  scheduleId: number | null;
  payments: InvoicePayment[];
};

export type PaymentSummary = {
  totalOwed: number;
  totalPaid: number;
  totalPending: number;
  remaining: number;
  currency: string;
  invoiceCount: number;
  hasSubmitted: boolean;
  invoiceNumbers: string[];
};

function formatCurrency(cents: number, currency = "HKD"): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function statusBadgeClass(status: PaymentStatus): string {
  switch (status) {
    case "verified":
    case "confirmed":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "submitted":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "recorded":
      return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
    case "rejected":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

function invoiceStatusClass(status: InvoiceStatus): string {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "partial":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
    case "pending":
    case "submitted":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "statement_created":
      return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200";
    case "overdue":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "cancelled":
    case "refunded":
      return "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

type AgentStmtItem = {
  id: number;
  policyId: number;
  policyPremiumId?: number | null;
  description: string | null;
  amountCents: number;
  displayAmountCents?: number;
  status: string;
};
type AgentStmtData = {
  statementNumber: string;
  statementStatus: string;
  activeTotal: number;
  paidIndividuallyTotal: number;
  commissionTotal: number;
  currency: string;
  items: AgentStmtItem[];
  policyClients: Record<number, { policyNumber: string; clientName: string }>;
  clientPaidPolicyIds: number[];
};

export function PaymentSection({
  policyId,
  agentId,
  isAdmin,
  onSummaryChange,
  externalRefreshKey,
  endorsementPolicyIds,
  hideInvoiceCards,
  initialSchedules,
}: {
  policyId?: number;
  agentId?: number;
  isAdmin: boolean;
  onSummaryChange?: (summary: PaymentSummary) => void;
  externalRefreshKey?: number;
  endorsementPolicyIds?: number[];
  hideInvoiceCards?: boolean;
  initialSchedules?: { id: number; entityType: string; frequency?: string | null; entityName?: string | null; billingDay?: number | null; isActive?: boolean }[];
}) {
  const isAgentMode = !!agentId && !policyId;
  const [invoices, setInvoices] = React.useState<InvoiceWithPayments[]>([]);
  const [payables, setPayables] = React.useState<InvoiceWithPayments[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedInvoice, setExpandedInvoice] = React.useState<number | null>(null);
  const [verifyingId, setVerifyingId] = React.useState<number | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [rejectionNote, setRejectionNote] = React.useState("");

  type ScheduleInfo = {
    id: number;
    frequency: ScheduleFrequency;
    entityType: string;
    entityName: string | null;
    billingDay: number | null;
    isActive: boolean;
  };
  const [schedules, setSchedules] = React.useState<ScheduleInfo[] | undefined>(
    initialSchedules as ScheduleInfo[] | undefined,
  );
  const clientSchedule = schedules?.find((s) => s.entityType === "client") ?? null;
  const agentSchedule = schedules?.find((s) => s.entityType === "agent") ?? null;
  const hasClientSchedule = !!clientSchedule;

  type StatementItemInfo = {
    id: number;
    policyId: number;
    policyPremiumId: number | null;
    amountCents: number;
    description: string | null;
    status: string;
  };
  type StatementData = {
    id: number;
    statementNumber: string;
    status: string;
    totalAmountCents: number;
    paidAmountCents: number;
    currency: string;
    entityType: string;
    entityName: string | null;
    items: StatementItemInfo[];
    activeTotal: number;
    paidIndividuallyTotal: number;
  };
  const [statementsBySchedule, setStatementsBySchedule] = React.useState<Record<number, StatementData | null>>({});
  const [itemActionBusy, setItemActionBusy] = React.useState<number | null>(null);

  const [agentStmtData, setAgentStmtData] = React.useState<AgentStmtData | null>(null);
  const [agentStmtLoaded, setAgentStmtLoaded] = React.useState(false);

  React.useEffect(() => {
    const agentSched = schedules?.find((s) => s.entityType === "agent");
    if (!agentSched) {
      if (schedules !== undefined) setAgentStmtLoaded(true);
      return;
    }
    let cancelled = false;
    fetch(`/api/accounting/statements/by-schedule/${agentSched.id}?audience=agent&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) { if (!cancelled) setAgentStmtLoaded(true); return; }
        const s = j.statement;
        if (!s) { setAgentStmtLoaded(true); return; }
        const activeTotal = Number(s.activeTotal) || 0;
        const paidIndividuallyTotal = Number(s.paidIndividuallyTotal) || 0;
        const commissionTotal = Number(s.commissionTotal) || 0;
        setAgentStmtData({
          statementNumber: String(s.statementNumber ?? "").trim(),
          statementStatus: String(s.statementStatus ?? s.status ?? "draft").trim(),
          activeTotal,
          paidIndividuallyTotal,
          commissionTotal,
          currency: String(s.currency ?? "HKD"),
          items: Array.isArray(s.items) ? s.items : [],
          policyClients: (s.policyClients ?? {}) as Record<number, { policyNumber: string; clientName: string }>,
          clientPaidPolicyIds: Array.isArray(s.clientPaidPolicyIds) ? s.clientPaidPolicyIds : [],
        });
        setAgentStmtLoaded(true);
        if (j.invoicesCreated) setRefreshKey((k) => k + 1);
      })
      .catch(() => { if (!cancelled) setAgentStmtLoaded(true); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, refreshKey]);

  const skipInitialScheduleFetch = React.useRef(!!initialSchedules);
  React.useEffect(() => {
    if (skipInitialScheduleFetch.current) { skipInitialScheduleFetch.current = false; return; }
    if (isAgentMode) {
      fetch(`/api/agents/${agentId}/statements`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { agentScheduleIds: [] }))
        .then((data) => {
          const schedIds: number[] = data.agentScheduleIds ?? [];
          if (schedIds.length === 0) { setSchedules([]); return; }
          Promise.all(
            schedIds.map((sid) =>
              fetch(`/api/accounting/schedules/${sid}`, { cache: "no-store" })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null),
            ),
          ).then((results) => {
            const arr = results.filter(Boolean).map((s) => s.schedule ?? s).filter((s) => s?.id);
            setSchedules(arr);
          });
        })
        .catch(() => setSchedules([]));
    } else if (policyId) {
      fetch(`/api/accounting/schedules/by-policy/${policyId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { schedules: [] }))
        .then((data) => {
          const arr = data.schedules ?? (data.schedule ? [data.schedule] : []);
          setSchedules(arr);
        })
        .catch(() => setSchedules([]));
    }
  }, [policyId, agentId, isAgentMode, refreshKey, externalRefreshKey]);

  React.useEffect(() => {
    if (!schedules || schedules.length === 0) return;
    for (const s of schedules) {
      fetch(`/api/accounting/statements?scheduleId=${s.id}&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { statement: null }))
        .then((data) => {
          setStatementsBySchedule((prev) => ({ ...prev, [s.id]: data.statement ?? null }));
        })
        .catch(() => {});
    }
  }, [schedules, refreshKey, externalRefreshKey]);

  const handleStatementItemAction = async (
    statementId: number,
    itemId: number,
    action: "paid_individually" | "reactivate" | "remove",
  ) => {
    setItemActionBusy(itemId);
    try {
      const res = await fetch(`/api/accounting/statements/${statementId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action }),
      });
      if (!res.ok) throw new Error("Failed to update item");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setItemActionBusy(null);
    }
  };

  const summaryRef = React.useRef(onSummaryChange);
  summaryRef.current = onSummaryChange;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchPromise = isAgentMode
      ? fetch(`/api/accounting/invoices/by-agent/${agentId}?_t=${Date.now()}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : []))
          .then((data: InvoiceWithPayments[]) => data)
          .catch(() => [] as InvoiceWithPayments[])
      : (() => {
          const allIds = [policyId!, ...(endorsementPolicyIds ?? [])];
          return Promise.all(
            allIds.map((id) =>
              fetch(`/api/accounting/invoices/by-policy/${id}?_t=${Date.now()}`, { cache: "no-store" })
                .then((r) => (r.ok ? r.json() : []))
                .then((data: InvoiceWithPayments[]) => data)
                .catch(() => [] as InvoiceWithPayments[]),
            ),
          ).then((results) => results.flat());
        })();

    fetchPromise
      .then((data) => {
        if (cancelled) return;
        const receivable = data.filter((inv) => inv.direction === "receivable" && inv.invoiceType !== "statement");
        const payableInvs = data.filter((inv) => inv.direction === "payable" && inv.invoiceType !== "statement");
        setInvoices(receivable);
        setPayables(payableInvs);

        const totalOwed = receivable.reduce((sum, inv) => sum + inv.totalAmountCents, 0);
        const verifiedPaid = receivable.reduce((sum, inv) => {
          const invPaid = inv.payments
            .filter((p) => p.status === "verified" || p.status === "confirmed" || p.status === "recorded")
            .reduce((s, p) => s + p.amountCents, 0);
          return sum + invPaid;
        }, 0);
        const pendingAmount = receivable.reduce((sum, inv) => {
          const pending = inv.payments
            .filter((p) => p.status === "submitted")
            .reduce((s, p) => s + p.amountCents, 0);
          return sum + pending;
        }, 0);
        const hasSubmitted = receivable.some((inv) =>
          inv.payments.some((p) => p.status === "submitted"),
        );

        const currency = receivable[0]?.currency ?? "HKD";
        const summary: PaymentSummary = {
          totalOwed,
          totalPaid: verifiedPaid,
          totalPending: pendingAmount,
          remaining: totalOwed - verifiedPaid,
          currency,
          invoiceCount: receivable.length,
          hasSubmitted,
          invoiceNumbers: receivable.map((inv) => inv.invoiceNumber),
        };
        summaryRef.current?.(summary);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId, agentId, isAgentMode, refreshKey, externalRefreshKey, endorsementPolicyIds?.join(",")]);

  const handleVerify = async (invoiceId: number, paymentId: number, action: "verify" | "reject") => {
    setVerifyingId(paymentId);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          action,
          rejectionNote: action === "reject" ? (rejectionNote.trim() || null) : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to process payment");
      }
      setRejectionNote("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setVerifyingId(null);
    }
  };

  // Invoices are added to statements ONLY by explicit admin action (toggle button).
  // No auto-linking — admin must manually add policies to statements.

  const [togglingSchedule, setTogglingSchedule] = React.useState<number | null>(null);
  const allScheduleIds = React.useMemo(() => new Set(schedules?.map((s) => s.id) ?? []), [schedules]);

  const handleToggleStatement = async (invoiceId: number, scheduleId: number | null) => {
    setTogglingSchedule(invoiceId);
    try {
      const body: Record<string, unknown> = { scheduleId };
      if (scheduleId) body.status = "statement_created";
      else body.status = "pending";
      const res = await fetch(`/api/accounting/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setTogglingSchedule(null);
    }
  };

  if (loading) {
    return <div className="py-4 text-center text-xs text-neutral-400">Loading payment info...</div>;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {error}
      </div>
    );
  }

  const scheduleCard = (s: ScheduleInfo, label: string, linkedInvs: InvoiceWithPayments[], matchAllSchedules = false) => {
    const stmt = statementsBySchedule[s.id] ?? null;

    const onStatementInvs = linkedInvs.filter((inv) =>
      matchAllSchedules ? inv.scheduleId && allScheduleIds.has(inv.scheduleId) : inv.scheduleId === s.id,
    );

    const useAgentStmtData = s.entityType === "agent" && agentStmtData;

    const activeItems = useAgentStmtData
      ? agentStmtData.items.filter((it: any) => it.status === "active")
      : stmt?.items.filter((it) => it.status === "active") ?? [];
    const paidIndItems = useAgentStmtData
      ? agentStmtData.items.filter((it: any) => it.status === "paid_individually")
      : stmt?.items.filter((it) => it.status === "paid_individually") ?? [];

    const payableOnStatement = onStatementInvs.filter((inv) => inv.direction === "payable");

    const receivableOnStatement = onStatementInvs.filter((inv) => inv.direction === "receivable");

    let totalDue: number;
    let paidIndividuallyTotal: number;
    let commissionTotal: number;
    let outstanding: number;

    if (useAgentStmtData) {
      totalDue = agentStmtData.activeTotal + agentStmtData.paidIndividuallyTotal;
      paidIndividuallyTotal = agentStmtData.paidIndividuallyTotal;
      commissionTotal = agentStmtData.commissionTotal;
      outstanding = totalDue - paidIndividuallyTotal - commissionTotal;
    } else {
      totalDue = stmt
        ? stmt.activeTotal + (stmt.paidIndividuallyTotal ?? 0)
        : receivableOnStatement.reduce((sum, inv) => sum + (inv.totalAmountCents - inv.paidAmountCents), 0);
      paidIndividuallyTotal = stmt?.paidIndividuallyTotal ?? 0;
      commissionTotal = payableOnStatement.reduce((sum, inv) => sum + (inv.totalAmountCents - inv.paidAmountCents), 0);
      outstanding = totalDue - paidIndividuallyTotal - commissionTotal;
    }

    const hasItems = useAgentStmtData
      ? agentStmtData.items.length > 0
      : stmt ? stmt.items.length > 0 : onStatementInvs.length > 0;

    return (
      <div className="rounded-md border border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <CalendarClock className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-indigo-800 dark:text-indigo-200">
              {label}
            </div>
            <div className="text-[11px] text-indigo-600 dark:text-indigo-400">
              {s.entityName ? `${s.entityName} — ` : ""}
              {SCHEDULE_FREQUENCY_LABELS[s.frequency] ?? s.frequency}
              {s.billingDay ? ` (day ${s.billingDay})` : ""}
            </div>
          </div>
          {(useAgentStmtData && agentStmtData.statementNumber) || stmt ? (
            <Badge variant="custom" className="text-[10px] bg-indigo-200 text-indigo-800 dark:bg-indigo-800 dark:text-indigo-200 font-mono">
              {useAgentStmtData ? agentStmtData.statementNumber : stmt?.statementNumber}
            </Badge>
          ) : (
            <Badge variant="custom" className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
              Period Pay
            </Badge>
          )}
        </div>

        {hasItems && (
          <div className="border-t border-indigo-200 dark:border-indigo-800 px-3 py-2 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-1">
              {(useAgentStmtData && agentStmtData.statementNumber) || stmt
                ? `Items on ${useAgentStmtData ? agentStmtData.statementNumber : stmt?.statementNumber}`
                : `Policies on this statement`}
              {" "}({(useAgentStmtData || stmt) ? activeItems.length : onStatementInvs.length})
            </div>

            {(useAgentStmtData || stmt) ? (
              <>
                {activeItems.map((item: any) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded bg-white/60 dark:bg-indigo-900/20 px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3 w-3 shrink-0 text-indigo-400" />
                      <span className="font-medium text-indigo-800 dark:text-indigo-200 truncate">
                        {item.description ?? "Premium"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                        {formatCurrency(item.displayAmountCents ?? item.amountCents)}
                      </span>
                      {isAdmin && stmt && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-5 w-5 p-0 text-neutral-400 hover:text-red-500"
                          disabled={itemActionBusy === item.id}
                          onClick={() => handleStatementItemAction(stmt.id, item.id, "remove")}
                          title="Remove from statement"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {paidIndItems.length > 0 && (
                  <>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mt-2 mb-0.5">
                      Paid Individually ({paidIndItems.length})
                    </div>
                    {paidIndItems.map((item: any) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded bg-neutral-100/60 dark:bg-neutral-800/30 px-2 py-1.5 text-xs opacity-60"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileText className="h-3 w-3 shrink-0 text-neutral-400" />
                          <span className="font-medium text-neutral-500 dark:text-neutral-400 truncate line-through">
                            {item.description ?? "Premium"}
                          </span>
                          <Badge variant="custom" className="text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            Paid Individually
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-semibold text-neutral-400 line-through">
                            {formatCurrency(item.displayAmountCents ?? item.amountCents)}
                          </span>
                          {isAdmin && stmt && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px] text-indigo-500 hover:text-indigo-700"
                              disabled={itemActionBusy === item.id}
                              onClick={() => handleStatementItemAction(stmt.id, item.id, "reactivate")}
                              title="Move back to statement"
                            >
                              Restore
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : (
              <>
                {receivableOnStatement.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-2 rounded bg-white/60 dark:bg-indigo-900/20 px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3 w-3 shrink-0 text-indigo-400" />
                      <span className="font-medium text-indigo-800 dark:text-indigo-200">{inv.invoiceNumber}</span>
                      {inv.notes && (
                        <span className="text-indigo-500 dark:text-indigo-400 truncate max-w-[120px]">· {inv.notes}</span>
                      )}
                    </div>
                    <span className="shrink-0 font-semibold text-indigo-700 dark:text-indigo-300">
                      {formatCurrency(inv.totalAmountCents - inv.paidAmountCents, inv.currency)}
                    </span>
                  </div>
                ))}
              </>
            )}

            {payableOnStatement.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-2 rounded bg-amber-50/60 dark:bg-amber-900/10 px-2 py-1.5 text-xs"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText className="h-3 w-3 shrink-0 text-amber-500" />
                  <span className="font-medium text-amber-800 dark:text-amber-200">{inv.invoiceNumber}</span>
                  {inv.notes && (
                    <span className="text-amber-600 dark:text-amber-400 truncate max-w-[120px]">· {inv.notes}</span>
                  )}
                </div>
                <span className="shrink-0 font-semibold text-amber-700 dark:text-amber-300">
                  −{formatCurrency(inv.totalAmountCents - inv.paidAmountCents, inv.currency)}
                </span>
              </div>
            ))}

            <div className="space-y-0.5 pt-1 border-t border-indigo-200/60 dark:border-indigo-700/60 mt-1 text-xs">
              <div className="flex items-center justify-between text-indigo-500 dark:text-indigo-400">
                <span>Total Due</span>
                <span>{formatCurrency(totalDue)}</span>
              </div>
              {paidIndividuallyTotal > 0 && (
                <div className="flex items-center justify-between text-neutral-400 dark:text-neutral-500">
                  <span>Paid Individually</span>
                  <span>−{formatCurrency(paidIndividuallyTotal)}</span>
                </div>
              )}
              {commissionTotal > 0 && (
                <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                  <span>Less commission</span>
                  <span>−{formatCurrency(commissionTotal)}</span>
                </div>
              )}
              <div className="flex items-center justify-between font-medium">
                {outstanding > 0 ? (
                  <>
                    <span className="text-indigo-600 dark:text-indigo-400">Outstanding</span>
                    <span className="font-bold text-indigo-800 dark:text-indigo-200">{formatCurrency(outstanding)}</span>
                  </>
                ) : outstanding < 0 ? (
                  <>
                    <span className="text-amber-600 dark:text-amber-400">Commission credit to agent</span>
                    <span className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(Math.abs(outstanding))}</span>
                  </>
                ) : (
                  <>
                    <span className="text-green-600 dark:text-green-400">Statement settled</span>
                    <span className="font-bold text-green-700 dark:text-green-300">{formatCurrency(0)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {!hasItems && (
          <div className="border-t border-indigo-200 dark:border-indigo-800 px-3 py-1.5">
            <div className="text-[11px] text-indigo-500 dark:text-indigo-400 italic">
              No policies added to this statement yet.
            </div>
          </div>
        )}
      </div>
    );
  };

  if (isAgentMode) {
    const allInvs = [...invoices, ...payables];
    const agentSched = agentSchedule ?? schedules?.find((s) => s.entityType === "agent") ?? null;

    if (allInvs.length === 0 && !agentSched && agentStmtLoaded) {
      return <div className="text-xs text-neutral-500 dark:text-neutral-400">No payment records yet.</div>;
    }

    if (!agentStmtLoaded) {
      return <div className="text-xs text-neutral-500 dark:text-neutral-400">Loading payments...</div>;
    }

    const onStatementReceivables = invoices.filter((inv) =>
      agentSched ? inv.scheduleId === agentSched.id : !!inv.scheduleId,
    );
    const commissionInvs = payables.filter((inv) =>
      agentSched ? inv.scheduleId === agentSched.id : !!inv.scheduleId,
    );

    const agentPaidTotal = onStatementReceivables.reduce((sum, inv) => {
      const agentPayments = inv.payments
        .filter((p) => (p.status === "recorded" || p.status === "verified" || p.status === "confirmed") && (!p.payer || p.payer === "agent"))
        .reduce((s, p) => s + p.amountCents, 0);
      return sum + agentPayments;
    }, 0);

    const receivableByPolicy = new Map<number, InvoiceWithPayments>();
    for (const inv of onStatementReceivables) {
      if (inv.entityPolicyId) receivableByPolicy.set(inv.entityPolicyId, inv);
    }

    const stmtCurrency = agentStmtData?.currency || onStatementReceivables[0]?.currency || "HKD";
    const stmtNumber = agentStmtData?.statementNumber || "";
    const stmtStatus = agentStmtData?.statementStatus || "draft";

    const totalDue = agentStmtData ? (agentStmtData.activeTotal + agentStmtData.paidIndividuallyTotal) : 0;
    const paidInd = agentStmtData?.paidIndividuallyTotal ?? 0;
    const commission = agentStmtData?.commissionTotal ?? 0;
    const outstanding = totalDue - paidInd - commission - agentPaidTotal;

    const paidSet = new Set((agentStmtData?.clientPaidPolicyIds ?? []).map(Number));
    const premiumItems = (agentStmtData?.items ?? []).filter((it) => it.policyPremiumId);
    const resolvedAmt = (it: AgentStmtItem) => Number(it.displayAmountCents ?? it.amountCents) || 0;

    const byClient = new Map<string, { clientName: string; policies: Map<number, { policyNumber: string; items: AgentStmtItem[] }> }>();
    for (const item of premiumItems) {
      const info = (agentStmtData?.policyClients ?? {})[item.policyId];
      const clientName = info?.clientName || "—";
      const policyNumber = info?.policyNumber || `Policy #${item.policyId}`;
      if (!byClient.has(clientName)) byClient.set(clientName, { clientName, policies: new Map() });
      const clientGroup = byClient.get(clientName)!;
      if (!clientGroup.policies.has(item.policyId)) clientGroup.policies.set(item.policyId, { policyNumber, items: [] });
      clientGroup.policies.get(item.policyId)!.items.push(item);
    }

    return (
      <div className="space-y-3">
        {/* Statement header */}
        <div className="rounded-md border border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-xs font-medium text-indigo-800 dark:text-indigo-200">
              {stmtNumber || "Agent Statement"}
            </div>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {stmtStatus.replace(/_/g, " ")}
            </span>
          </div>
          {agentStmtData && totalDue > 0 && (
            <div className="border-t border-indigo-200 dark:border-indigo-800 px-3 py-2 space-y-1">
              <div className="space-y-0.5 text-xs">
                <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400">
                  <span>Total Due</span>
                  <span className="font-semibold">{formatCurrency(totalDue, stmtCurrency)}</span>
                </div>
                {paidInd > 0 && (
                  <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
                    <span>Paid Individually</span>
                    <span>−{formatCurrency(paidInd, stmtCurrency)}</span>
                  </div>
                )}
                {commission > 0 && (
                  <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                    <span>Less commission</span>
                    <span>−{formatCurrency(commission, stmtCurrency)}</span>
                  </div>
                )}
                {agentPaidTotal > 0 && (
                  <div className="flex items-center justify-between text-green-600 dark:text-green-400">
                    <span>Agent Paid</span>
                    <span>−{formatCurrency(agentPaidTotal, stmtCurrency)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between font-medium pt-1 border-t border-indigo-200/60 dark:border-indigo-700/60">
                  {outstanding > 0 ? (
                    <>
                      <span className="text-indigo-600 dark:text-indigo-400">Outstanding</span>
                      <span className="font-bold text-indigo-800 dark:text-indigo-200">{formatCurrency(outstanding, stmtCurrency)}</span>
                    </>
                  ) : outstanding < 0 ? (
                    <>
                      <span className="text-amber-600 dark:text-amber-400">Credit to agent</span>
                      <span className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(Math.abs(outstanding), stmtCurrency)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-green-600 dark:text-green-400">Settled</span>
                      <span className="font-bold text-green-700 dark:text-green-300">{formatCurrency(0, stmtCurrency)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Line items grouped by client → policy */}
        {premiumItems.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Line Items ({premiumItems.length})
            </div>
            {[...byClient.values()].map((group) => (
              <div key={group.clientName} className="space-y-1">
                <div className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 px-1">
                  {group.clientName}
                </div>
                {[...group.policies.entries()].map(([polId, pol]) => {
                  const isPaid = paidSet.has(polId) || pol.items.every((it) => it.status === "paid_individually");
                  const polTotal = pol.items.reduce((s, it) => s + resolvedAmt(it), 0);
                  const invoice = receivableByPolicy.get(polId);
                  const invRemaining = invoice ? invoice.totalAmountCents - invoice.paidAmountCents : 0;
                  const isExpanded = expandedInvoice === polId;

                  return (
                    <div
                      key={polId}
                      className={`rounded text-xs border overflow-hidden ${
                        isPaid
                          ? "border-green-200/60 dark:border-green-800/30"
                          : "bg-white/60 dark:bg-indigo-900/10 border-neutral-100 dark:border-neutral-800"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => invoice && setExpandedInvoice(isExpanded ? null : polId)}
                        className={`w-full px-2 py-1.5 text-left ${invoice ? "cursor-pointer hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className={`h-3 w-3 shrink-0 ${isPaid ? "text-green-400 dark:text-green-500" : "text-indigo-400"}`} />
                            <span className={`font-mono text-[11px] font-medium truncate ${isPaid ? "text-green-700 dark:text-green-400" : "text-indigo-800 dark:text-indigo-200"}`}>
                              {pol.policyNumber}
                            </span>
                            {isPaid && (
                              <span className="rounded bg-green-100 px-1 py-0.5 text-[9px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300 shrink-0">
                                client premium paid directly
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`font-semibold ${isPaid ? "text-green-600 dark:text-green-400" : "text-indigo-700 dark:text-indigo-300"}`}>
                              {formatCurrency(polTotal, stmtCurrency)}
                            </span>
                            {invoice && (
                              isExpanded ? <ChevronUp className="h-3 w-3 text-neutral-400" /> : <ChevronDown className="h-3 w-3 text-neutral-400" />
                            )}
                          </div>
                        </div>
                        {pol.items.length > 1 && (
                          <div className={`mt-1 space-y-0.5 pl-[18px] ${isPaid ? "text-green-600/70 dark:text-green-500/60" : "text-neutral-500 dark:text-neutral-400"}`}>
                            {pol.items.map((it) => {
                              const label = String(it.description ?? "").replace(/^[^·]*·\s*/, "").trim() || "Premium";
                              return (
                                <div key={it.id} className="flex items-center justify-between text-[10px]">
                                  <span className="truncate">{label}</span>
                                  <span>{formatCurrency(resolvedAmt(it), stmtCurrency)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </button>

                      {isExpanded && invoice && (
                        <div className="border-t border-neutral-200 dark:border-neutral-700 px-2 py-2 space-y-2">
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="rounded bg-neutral-50 dark:bg-neutral-800/50 p-1.5">
                              <div className="text-[10px] text-neutral-500 dark:text-neutral-400">Invoice</div>
                              <div className="font-medium text-[11px]">{invoice.invoiceNumber}</div>
                            </div>
                            <div className="rounded bg-green-50 dark:bg-green-900/20 p-1.5">
                              <div className="text-[10px] text-green-600 dark:text-green-400">Paid</div>
                              <div className="font-semibold text-green-700 dark:text-green-300">{formatCurrency(invoice.paidAmountCents, invoice.currency)}</div>
                            </div>
                            <div className={`rounded p-1.5 ${invRemaining > 0 ? "bg-orange-50 dark:bg-orange-900/20" : "bg-green-50 dark:bg-green-900/20"}`}>
                              <div className={`text-[10px] ${invRemaining > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"}`}>Remaining</div>
                              <div className={`font-semibold ${invRemaining > 0 ? "text-orange-700 dark:text-orange-300" : "text-green-700 dark:text-green-300"}`}>
                                {formatCurrency(invRemaining, invoice.currency)}
                              </div>
                            </div>
                          </div>

                          {invoice.payments.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400">Payments</div>
                              {invoice.payments.map((p) => (
                                <div key={p.id} className="flex items-center justify-between gap-2 rounded border border-neutral-100 dark:border-neutral-700 p-1.5 text-[11px]">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium">{formatCurrency(p.amountCents, p.currency)}</span>
                                    <Badge variant="custom" className={`text-[9px] ${statusBadgeClass(p.status)}`}>
                                      {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                                    </Badge>
                                  </div>
                                  {isAdmin && p.status === "submitted" && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] text-green-600" disabled={verifyingId === p.id} onClick={() => handleVerify(invoice.id, p.id, "verify")}>
                                        <Check className="h-3 w-3 mr-0.5" />Verify
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] text-red-600" disabled={verifyingId === p.id} onClick={() => {
                                        const note = prompt("Rejection reason (optional):");
                                        if (note !== null) { setRejectionNote(note); handleVerify(invoice.id, p.id, "reject"); }
                                      }}>
                                        <X className="h-3 w-3 mr-0.5" />Reject
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {invRemaining > 0 && !isPaid && (
                            <InlinePaymentForm
                              invoiceId={invoice.id}
                              remainingCents={invRemaining}
                              currency={invoice.currency}
                              defaultPayer="agent"
                              onSuccess={() => setRefreshKey((k) => k + 1)}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {commissionInvs.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 px-1">
                  Commission
                </div>
                {commissionInvs.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-2 rounded bg-amber-50/60 dark:bg-amber-900/10 px-2 py-1.5 text-xs border border-amber-100 dark:border-amber-800/40">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3 w-3 shrink-0 text-amber-500" />
                      <span className="font-medium text-amber-800 dark:text-amber-200 truncate">{inv.invoiceNumber}</span>
                    </div>
                    <span className="shrink-0 font-semibold text-amber-700 dark:text-amber-300">
                      −{formatCurrency(inv.totalAmountCents, inv.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {clientSchedule && scheduleCard(clientSchedule, "Client Statement Billing", invoices)}

      {/* No invoices message */}
      {!hideInvoiceCards && invoices.length === 0 && (
        <div className="py-3 text-center text-xs text-neutral-400">
          {hasClientSchedule
            ? "Client premiums will be included in the next statement."
            : "No receivable invoices yet. Pay individually or add to a statement below."}
        </div>
      )}

      {/* Individual invoices */}
      {!hideInvoiceCards && invoices.map((inv) => {
        const isExpanded = expandedInvoice === inv.id;
        const remaining = inv.totalAmountCents - inv.paidAmountCents;
        const methodLabel = (m: string | null) =>
          PAYMENT_METHOD_OPTIONS.find((o) => o.value === m)?.label ?? m ?? "—";

        return (
          <div key={inv.id} className="rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden">
            {/* Invoice header */}
            <button
              type="button"
              onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
              className="w-full px-3 py-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                  <span className="text-sm font-medium">{inv.invoiceNumber}</span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {inv.scheduleId && (
                    <Badge variant="custom" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 text-[10px]">
                      On Statement
                    </Badge>
                  )}
                  <Badge variant="custom" className={invoiceStatusClass(inv.status)}>
                    {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                  </Badge>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-neutral-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-neutral-400" />
                  )}
                </span>
              </div>
              <div className="mt-0.5 pl-6 text-xs text-neutral-500 dark:text-neutral-400 wrap-break-word">
                <span className="whitespace-nowrap">{formatCurrency(inv.paidAmountCents, inv.currency)} / {formatCurrency(inv.totalAmountCents, inv.currency)}</span>
                {inv.notes && <span className="block sm:inline"> <span className="hidden sm:inline">&middot; </span>{inv.notes}</span>}
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-neutral-200 dark:border-neutral-700 px-3 py-3 space-y-3">
                {/* Summary row */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                    <div className="text-neutral-500 dark:text-neutral-400">Total</div>
                    <div className="font-semibold">{formatCurrency(inv.totalAmountCents, inv.currency)}</div>
                  </div>
                  <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-2">
                    <div className="text-green-600 dark:text-green-400">Paid</div>
                    <div className="font-semibold text-green-700 dark:text-green-300">
                      {formatCurrency(inv.paidAmountCents, inv.currency)}
                    </div>
                  </div>
                  <div className={`rounded-md p-2 ${remaining > 0 ? "bg-orange-50 dark:bg-orange-900/20" : "bg-green-50 dark:bg-green-900/20"}`}>
                    <div className={remaining > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"}>
                      Remaining
                    </div>
                    <div className={`font-semibold ${remaining > 0 ? "text-orange-700 dark:text-orange-300" : "text-green-700 dark:text-green-300"}`}>
                      {formatCurrency(remaining, inv.currency)}
                    </div>
                  </div>
                </div>

                {/* Statement toggle */}
                {(() => {
                  const matchingSchedule = inv.direction === "receivable" ? clientSchedule : agentSchedule;
                  if (inv.scheduleId) {
                    return (
                      <div className="flex items-center justify-between rounded-md bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-xs text-indigo-700 dark:text-indigo-300">
                          <CalendarClock className="h-3.5 w-3.5" />
                          <span>On statement billing — payment will be collected on schedule</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px] text-indigo-600 hover:text-red-600 dark:text-indigo-400"
                          disabled={togglingSchedule === inv.id}
                          onClick={(e) => { e.stopPropagation(); handleToggleStatement(inv.id, null); }}
                        >
                          {togglingSchedule === inv.id ? "..." : "Release"}
                        </Button>
                      </div>
                    );
                  }
                  if (matchingSchedule && remaining > 0) {
                    return (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                        disabled={togglingSchedule === inv.id}
                        onClick={(e) => { e.stopPropagation(); handleToggleStatement(inv.id, matchingSchedule.id); }}
                      >
                        <CalendarClock className="h-3.5 w-3.5 mr-1" />
                        {togglingSchedule === inv.id ? "Adding..." : "Add to Statement"}
                      </Button>
                    );
                  }
                  return null;
                })()}

                {/* Payment history */}
                {inv.payments.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Payments</div>
                    {inv.payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-start justify-between gap-2 rounded-md border border-neutral-100 dark:border-neutral-700 p-2 text-xs"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">
                              {formatCurrency(p.amountCents, p.currency)}
                            </span>
                            <Badge variant="custom" className={statusBadgeClass(p.status)}>
                              {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-neutral-500 dark:text-neutral-400">
                            <span>{methodLabel(p.paymentMethod)}</span>
                            {p.referenceNumber && (
                              <>
                                <span className="text-neutral-300 dark:text-neutral-600">&middot;</span>
                                <span className="truncate max-w-[100px]">Ref: {p.referenceNumber}</span>
                              </>
                            )}
                          </div>
                          {p.paymentDate && (
                            <div className="text-neutral-400">
                              {new Date(p.paymentDate).toLocaleDateString()}
                            </div>
                          )}
                          {p.notes && (
                            <div className="text-neutral-400 italic">{p.notes}</div>
                          )}
                          {p.rejectionNote && (
                            <div className="text-red-600 dark:text-red-400">
                              Rejected: {p.rejectionNote}
                            </div>
                          )}
                        </div>
                        {/* Verify/reject buttons for admin on submitted payments */}
                        {isAdmin && p.status === "submitted" && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-green-600 hover:bg-green-50 hover:text-green-700"
                              disabled={verifyingId === p.id}
                              onClick={() => handleVerify(inv.id, p.id, "verify")}
                            >
                              <Check className="h-3.5 w-3.5 mr-0.5" />
                              Verify
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                              disabled={verifyingId === p.id}
                              onClick={() => {
                                const note = prompt("Rejection reason (optional):");
                                if (note !== null) {
                                  setRejectionNote(note);
                                  handleVerify(inv.id, p.id, "reject");
                                }
                              }}
                            >
                              <X className="h-3.5 w-3.5 mr-0.5" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Fully paid indicator */}
                {remaining <= 0 && inv.payments.length > 0 && (
                  <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs font-medium text-green-700 dark:text-green-300">
                    <Check className="h-4 w-4" />
                    Fully Paid
                  </div>
                )}

                {remaining > 0 && (
                  <InlinePaymentForm
                    invoiceId={inv.id}
                    remainingCents={remaining}
                    currency={inv.currency}
                    onSuccess={() => setRefreshKey((k) => k + 1)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Agent settlement payables — only show when there are payables or invoices manually added to the agent statement */}
      {(() => {
        const hasInvsOnAgentStatement = !!agentSchedule && [...invoices, ...payables].some(
          (inv) => inv.scheduleId === agentSchedule.id,
        );
        const showAgentSection = payables.length > 0 || hasInvsOnAgentStatement;
        if (!showAgentSection) return null;
        return (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Agent Settlement
            </span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>
          {hasInvsOnAgentStatement && agentSchedule && scheduleCard(agentSchedule, "Agent Statement Billing", [...invoices, ...payables])}
          {!hideInvoiceCards && payables.map((inv) => {
            const isExpanded = expandedInvoice === inv.id;
            return (
              <div key={inv.id} className="rounded-md border border-amber-200 dark:border-amber-800 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
                  className="w-full px-3 py-2.5 text-left hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors"
                >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="text-sm font-medium">{inv.invoiceNumber}</span>
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {inv.scheduleId && (
                    <Badge variant="custom" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 text-[10px]">
                      On Statement
                    </Badge>
                  )}
                  <Badge variant="custom" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    Payable
                  </Badge>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-neutral-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-neutral-400" />
                  )}
                </span>
              </div>
              <div className="mt-0.5 pl-6 text-xs text-neutral-500 dark:text-neutral-400 wrap-break-word">
                <span className="whitespace-nowrap">{formatCurrency(inv.totalAmountCents, inv.currency)} to {inv.entityName || "Agent"}</span>
                {inv.notes && <span className="block sm:inline"> <span className="hidden sm:inline">&middot; </span>{inv.notes}</span>}
              </div>
            </button>
            {isExpanded && (
              <div className="border-t border-amber-200 dark:border-amber-700 px-3 py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 p-2">
                    <div className="text-amber-600 dark:text-amber-400">Premium Amount</div>
                    <div className="font-semibold text-amber-800 dark:text-amber-200">
                      {formatCurrency(inv.totalAmountCents, inv.currency)}
                    </div>
                  </div>
                  <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                    <div className="text-neutral-500 dark:text-neutral-400">Status</div>
                    <div className="font-semibold">
                      {inv.paidAmountCents >= inv.totalAmountCents ? "Settled" : "Outstanding"}
                    </div>
                  </div>
                </div>

                {/* Statement toggle for agent payables */}
                {(() => {
                  const payableRemaining = inv.totalAmountCents - inv.paidAmountCents;
                  return (
                    <div className="space-y-2">
                      {inv.scheduleId && (
                        <div className="flex items-center justify-between rounded-md bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2">
                          <div className="flex items-center gap-1.5 text-xs text-indigo-700 dark:text-indigo-300">
                            <CalendarClock className="h-3.5 w-3.5" />
                            <span>On statement billing</span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px] text-indigo-600 hover:text-red-600 dark:text-indigo-400"
                            disabled={togglingSchedule === inv.id}
                            onClick={(e) => { e.stopPropagation(); handleToggleStatement(inv.id, null); }}
                          >
                            {togglingSchedule === inv.id ? "..." : "Release"}
                          </Button>
                        </div>
                      )}
                      {!inv.scheduleId && agentSchedule && payableRemaining > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                          disabled={togglingSchedule === inv.id}
                          onClick={(e) => { e.stopPropagation(); handleToggleStatement(inv.id, agentSchedule.id); }}
                        >
                          <CalendarClock className="h-3.5 w-3.5 mr-1" />
                          {togglingSchedule === inv.id ? "Adding..." : "Add to Statement"}
                        </Button>
                      )}
                      {payableRemaining > 0 && (
                        <InlinePaymentForm
                          invoiceId={inv.id}
                          remainingCents={payableRemaining}
                          currency={inv.currency}
                          onSuccess={() => setRefreshKey((k) => k + 1)}
                        />
                      )}
                      {payableRemaining <= 0 && inv.paidAmountCents > 0 && (
                        <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs font-medium text-green-700 dark:text-green-300">
                          <Check className="h-4 w-4" />
                          Settled
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
              </div>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}
