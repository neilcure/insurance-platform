"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
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
  Trash2,
} from "lucide-react";
import { InlinePaymentForm } from "@/components/ui/inline-payment-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  StatementPaymentCard,
  type StatementTotals,
  type StatementItem,
  type InvoiceInfo,
} from "@/components/shared/StatementPaymentCard";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

type ScheduleInfo = {
  id: number;
  frequency: ScheduleFrequency;
  entityType: string;
  entityName: string | null;
  billingDay: number | null;
  isActive: boolean;
};

type AgentStmtItem = {
  id: number;
  policyId: number;
  policyPremiumId?: number | null;
  description: string | null;
  amountCents: number;
  displayAmountCents?: number;
  clientPremiumCents?: number;
  status: string;
  paymentBadge?: string;
};

type CtaPaymentRecord = {
  id: number;
  invoiceId: number;
  amountCents: number;
  currency: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  status: string;
  payer: string | null;
  notes: string | null;
  createdAt: string;
};

type AgentStmtData = {
  statementNumber: string;
  statementStatus: string;
  totalDue: number;
  activeTotal: number;
  paidIndividuallyTotal: number;
  commissionTotal: number;
  agentPaidTotal: number;
  clientPaidTotal: number;
  currency: string;
  items: AgentStmtItem[];
  policyClients: Record<number, { policyNumber: string; clientName: string }>;
  clientPaidPolicyIds: number[];
  ctaPaymentsByPolicy?: Record<number, CtaPaymentRecord[]>;
};

type StatementItemInfo = {
  id: number;
  policyId: number;
  policyPremiumId: number | null;
  amountCents: number;
  description: string | null;
  status: string;
  paymentBadge?: string;
};

type StatementData = {
  id: number;
  statementNumber: string;
  status: string;
  totalDue?: number;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  entityType: string;
  entityName: string | null;
  items: StatementItemInfo[];
  activeTotal: number;
  paidIndividuallyTotal: number;
  commissionTotal?: number;
  agentPaidTotal?: number;
  clientPaidTotal?: number;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function buildTotals(
  src: { totalDue?: number; activeTotal: number; paidIndividuallyTotal?: number; clientPaidTotal?: number; agentPaidTotal?: number; commissionTotal?: number } | null,
  fallbackReceivable: InvoiceWithPayments[],
  fallbackPayable: InvoiceWithPayments[],
  fallbackAgentPaid: number,
): StatementTotals {
  if (src) {
    const totalDue = src.totalDue ?? (src.activeTotal + (src.paidIndividuallyTotal ?? 0));
    const commissionTotal = src.commissionTotal ?? 0;
    return {
      totalDue,
      clientPaidTotal: src.clientPaidTotal ?? 0,
      agentPaidTotal: src.agentPaidTotal ?? 0,
      commissionTotal,
      outstanding: Math.max(src.activeTotal ?? 0, 0),
      creditToAgent: commissionTotal,
    };
  }
  const totalDue = fallbackReceivable.reduce((sum, inv) => sum + (inv.totalAmountCents - inv.paidAmountCents), 0);
  const commissionTotal = fallbackPayable.reduce((sum, inv) => sum + (inv.totalAmountCents - inv.paidAmountCents), 0);
  return {
    totalDue,
    clientPaidTotal: 0,
    agentPaidTotal: fallbackAgentPaid,
    commissionTotal,
    outstanding: totalDue,
    creditToAgent: commissionTotal,
  };
}

function isCommissionItem(it: { description: string | null }): boolean {
  const d = String(it.description ?? "").toLowerCase();
  return d.includes("commission:") || d.includes("credit:");
}

function buildTotalsFromItems(
  items: StatementItem[],
  agentPaid: number,
): { totalDue: number; activeTotal: number; paidIndividuallyTotal: number; commissionTotal: number; agentPaidTotal: number; clientPaidTotal: number } {
  const premiumItems = items.filter((it) => !isCommissionItem(it));
  const activeTotal = premiumItems
    .filter((it) => it.status === "active")
    .reduce((s, it) => s + (it.displayAmountCents ?? it.amountCents), 0);
  const paidIndividuallyTotal = premiumItems
    .filter((it) => it.status === "paid_individually")
    .reduce((s, it) => s + (it.displayAmountCents ?? it.amountCents), 0);
  const commissionTotal = items
    .filter((it) => isCommissionItem(it))
    .reduce((s, it) => s + (it.displayAmountCents ?? it.amountCents), 0);
  const clientPaidTotal = premiumItems
    .filter((it) => it.paymentBadge?.toLowerCase().includes("client"))
    .reduce((s, it) => s + (it.displayAmountCents ?? it.amountCents), 0);
  return {
    totalDue: activeTotal + paidIndividuallyTotal,
    activeTotal,
    paidIndividuallyTotal,
    commissionTotal,
    agentPaidTotal: agentPaid,
    clientPaidTotal,
  };
}

function toStatementItems(items: (AgentStmtItem | StatementItemInfo)[]): StatementItem[] {
  return items.map((it) => ({
    id: it.id,
    policyId: it.policyId,
    policyPremiumId: it.policyPremiumId,
    amountCents: it.amountCents,
    displayAmountCents: "displayAmountCents" in it ? it.displayAmountCents : null,
    clientPremiumCents: "clientPremiumCents" in it ? (it as AgentStmtItem).clientPremiumCents : undefined,
    description: it.description,
    status: it.status,
    paymentBadge: "paymentBadge" in it ? it.paymentBadge : undefined,
  }));
}

function toInvoiceInfos(invs: InvoiceWithPayments[]): InvoiceInfo[] {
  return invs.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceType: inv.invoiceType,
    direction: inv.direction,
    entityPolicyId: inv.entityPolicyId,
    totalAmountCents: inv.totalAmountCents,
    paidAmountCents: inv.paidAmountCents,
    currency: inv.currency,
    status: inv.status,
    notes: inv.notes,
    payments: inv.payments,
  }));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PaymentSection({
  policyId,
  agentId,
  clientId,
  clientRecordId,
  isAdmin,
  onSummaryChange,
  externalRefreshKey,
  endorsementPolicyIds,
  hideInvoiceCards,
  initialSchedules,
}: {
  policyId?: number;
  agentId?: number;
  clientId?: number;
  clientRecordId?: number;
  isAdmin: boolean;
  onSummaryChange?: (summary: PaymentSummary) => void;
  externalRefreshKey?: number;
  endorsementPolicyIds?: number[];
  hideInvoiceCards?: boolean;
  initialSchedules?: { id: number; entityType: string; frequency?: string | null; entityName?: string | null; billingDay?: number | null; isActive?: boolean }[];
}) {
  const effectiveClientId = clientId || clientRecordId;
  const isAgentMode = !!agentId && !policyId && !effectiveClientId;
  const isClientMode = !!effectiveClientId && !policyId && !agentId;

  const [invoices, setInvoices] = React.useState<InvoiceWithPayments[]>([]);
  const [payables, setPayables] = React.useState<InvoiceWithPayments[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedInvoice, setExpandedInvoice] = React.useState<number | null>(null);
  const [verifyingId, setVerifyingId] = React.useState<number | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [rejectionNote, setRejectionNote] = React.useState("");
  const [togglingSchedule, setTogglingSchedule] = React.useState<number | null>(null);

  const [confirmDialog, setConfirmDialog] = React.useState<{
    type: "delete" | "reject";
    invoiceId: number;
    paymentId: number;
  } | null>(null);
  const [dialogNote, setDialogNote] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [schedules, setSchedules] = React.useState<ScheduleInfo[] | undefined>(
    initialSchedules as ScheduleInfo[] | undefined,
  );
  const clientSchedule = schedules?.find((s) => s.entityType === "client") ?? null;
  const agentSchedule = schedules?.find((s) => s.entityType === "agent") ?? null;
  const hasClientSchedule = !!clientSchedule;
  const allScheduleIds = React.useMemo(() => new Set(schedules?.map((s) => s.id) ?? []), [schedules]);

  const [statementsBySchedule, setStatementsBySchedule] = React.useState<Record<number, StatementData | null>>({});
  const [itemActionBusy, setItemActionBusy] = React.useState<number | null>(null);

  const [agentStmtData, setAgentStmtData] = React.useState<AgentStmtData | null>(null);
  const [agentStmtLoaded, setAgentStmtLoaded] = React.useState(false);

  const refresh = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  /* ---------- data fetching ---------- */

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
        const agentPaidTotal = Number(s.agentPaidTotal) || 0;
        const clientPaidTotal = Number(s.clientPaidTotal) || 0;
        const totalDue = Number(s.totalDue) || (activeTotal + paidIndividuallyTotal);
        setAgentStmtData({
          statementNumber: String(s.statementNumber ?? "").trim(),
          statementStatus: String(s.statementStatus ?? s.status ?? "draft").trim(),
          totalDue, activeTotal, paidIndividuallyTotal, commissionTotal, agentPaidTotal, clientPaidTotal,
          currency: String(s.currency ?? "HKD"),
          items: Array.isArray(s.items) ? s.items : [],
          policyClients: (s.policyClients ?? {}) as Record<number, { policyNumber: string; clientName: string }>,
          clientPaidPolicyIds: Array.isArray(s.clientPaidPolicyIds) ? s.clientPaidPolicyIds : [],
          ctaPaymentsByPolicy: s.ctaPaymentsByPolicy ?? {},
        });
        setAgentStmtLoaded(true);
        if (j.invoicesCreated) refresh();
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
    } else if (isClientMode) {
      setSchedules([]);
    } else if (policyId) {
      fetch(`/api/accounting/schedules/by-policy/${policyId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { schedules: [] }))
        .then((data) => {
          const arr = data.schedules ?? (data.schedule ? [data.schedule] : []);
          setSchedules(arr);
        })
        .catch(() => setSchedules([]));
    }
  }, [policyId, agentId, effectiveClientId, isAgentMode, isClientMode, refreshKey, externalRefreshKey]);

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
      : isClientMode
      ? fetch(`/api/accounting/invoices/by-client/${effectiveClientId}?_t=${Date.now()}`, { cache: "no-store" })
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
  }, [policyId, agentId, effectiveClientId, isAgentMode, isClientMode, refreshKey, externalRefreshKey, endorsementPolicyIds?.join(",")]);

  /* ---------- actions ---------- */

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
      refresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setVerifyingId(null);
    }
  };

  const openDeleteDialog = (invoiceId: number, paymentId: number) => {
    setConfirmDialog({ type: "delete", invoiceId, paymentId });
  };

  const openRejectDialog = (invoiceId: number, paymentId: number) => {
    setDialogNote("");
    setConfirmDialog({ type: "reject", invoiceId, paymentId });
  };

  const executeConfirmDialog = async () => {
    if (!confirmDialog) return;
    const { type, invoiceId, paymentId } = confirmDialog;
    setConfirmDialog(null);
    setVerifyingId(paymentId);
    try {
      if (type === "delete") {
        const res = await fetch(`/api/accounting/invoices/${invoiceId}/payments?paymentId=${paymentId}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || "Failed to delete payment");
        }
      } else if (type === "reject") {
        setRejectionNote(dialogNote);
        const res = await fetch(`/api/accounting/invoices/${invoiceId}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId, action: "reject", rejectionNote: dialogNote.trim() || null }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || "Failed to reject payment");
        }
        setRejectionNote("");
      }
      refresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setVerifyingId(null);
      setDialogNote("");
    }
  };

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
      refresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setItemActionBusy(null);
    }
  };

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
      refresh();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setTogglingSchedule(null);
    }
  };

  /* ---------- confirm dialog ---------- */

  const confirmDialogEl = (
    <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {confirmDialog?.type === "delete" ? "Delete Payment" : "Reject Payment"}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {confirmDialog?.type === "delete"
            ? "Are you sure you want to delete this payment record? This action cannot be undone."
            : "Are you sure you want to reject this payment?"}
        </p>
        {confirmDialog?.type === "reject" && (
          <div className="mt-2">
            <label className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Rejection reason (optional)</label>
            <input
              type="text"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              value={dialogNote}
              onChange={(e) => setDialogNote(e.target.value)}
              placeholder="Enter reason..."
              autoFocus
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setConfirmDialog(null)}>Cancel</Button>
          <Button
            size="sm"
            variant={confirmDialog?.type === "delete" ? "destructive" : "default"}
            className={confirmDialog?.type === "delete" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
            onClick={executeConfirmDialog}
          >
            {confirmDialog?.type === "delete" ? "Delete" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const errorDialogEl = (
    <Dialog open={!!errorMsg} onOpenChange={(open) => { if (!open) setErrorMsg(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Error</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
        <DialogFooter>
          <Button size="sm" onClick={() => setErrorMsg(null)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  /* ---------- loading / error ---------- */

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

  /* ---------------------------------------------------------------- */
  /*  Build the agent statement card (shared between both modes)       */
  /* ---------------------------------------------------------------- */

  const renderAgentStatementCard = (
    sched: ScheduleInfo,
    linkedReceivable: InvoiceWithPayments[],
    linkedPayable: InvoiceWithPayments[],
    filterPolicyIds?: Set<number>,
  ) => {
    const useEnriched = agentStmtData;
    const stmt = statementsBySchedule[sched.id] ?? null;

    const stmtNumber = useEnriched ? agentStmtData.statementNumber : stmt?.statementNumber;
    const stmtStatus = useEnriched ? agentStmtData.statementStatus : (stmt?.status ?? "draft");
    const stmtCurrency = useEnriched ? agentStmtData.currency : (stmt?.currency ?? linkedReceivable[0]?.currency ?? "HKD");

    const agentPaidOnSchedule = linkedReceivable.reduce((sum, inv) => {
      const agentPayments = (inv.payments ?? [])
        .filter((p) => (p.status === "recorded" || p.status === "verified" || p.status === "confirmed") && (!p.payer || p.payer === "agent"))
        .reduce((s, p) => s + (p.amountCents ?? 0), 0);
      return sum + agentPayments;
    }, 0);

    let allItems = useEnriched
      ? toStatementItems(agentStmtData.items)
      : stmt ? toStatementItems(stmt.items) : [];

    if (filterPolicyIds && filterPolicyIds.size > 0) {
      allItems = allItems.filter((it) => filterPolicyIds.has(Number(it.policyId)));
    }

    const filteredDataSource = filterPolicyIds
      ? buildTotalsFromItems(allItems, agentPaidOnSchedule)
      : (useEnriched ? agentStmtData : stmt);

    const totals = buildTotals(filteredDataSource, linkedReceivable, linkedPayable, agentPaidOnSchedule);

    const receivableByPolicy = new Map<number, InvoiceWithPayments>();
    for (const inv of linkedReceivable) {
      if (inv.entityPolicyId) receivableByPolicy.set(inv.entityPolicyId, inv);
    }

    const commissionInvs = linkedPayable.filter((inv) => {
      const isCommission = String(inv.notes ?? "").toLowerCase().startsWith("agent commission");
      if (isCommission) return true;
      return inv.scheduleId === sched.id;
    });

    // Build client premium map: policyId → total client premium cents
    const cpMap = new Map<number, number>();
    for (const it of allItems) {
      const polId = Number(it.policyId);
      if (it.clientPremiumCents && it.clientPremiumCents > 0) {
        cpMap.set(polId, (cpMap.get(polId) ?? 0) + it.clientPremiumCents);
      }
    }

    return (
      <StatementPaymentCard
        statementNumber={stmtNumber}
        statementStatus={stmtStatus}
        totals={totals}
        currency={stmtCurrency}
        items={allItems}
        receivableInvoices={toInvoiceInfos(Array.from(receivableByPolicy.values()))}
        commissionInvoices={toInvoiceInfos(commissionInvs)}
        isAdmin={isAdmin}
        onRefresh={refresh}
        defaultPayer="agent"
        clientPremiumByPolicy={cpMap}
        ctaPaymentsByPolicy={agentStmtData?.ctaPaymentsByPolicy}
      />
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Client schedule card (policy page only)                          */
  /* ---------------------------------------------------------------- */

  const renderClientScheduleCard = (sched: ScheduleInfo) => {
    const stmt = statementsBySchedule[sched.id] ?? null;
    const onStatementInvs = invoices.filter((inv) => inv.scheduleId === sched.id);
    const receivableOnStatement = onStatementInvs.filter((inv) => inv.direction === "receivable");

    const activeItems = stmt?.items.filter((it) => it.status === "active") ?? [];
    const paidItems = stmt?.items.filter((it) => it.status === "paid_individually") ?? [];
    const hasItems = stmt ? stmt.items.length > 0 : onStatementInvs.length > 0;

    return (
      <div className="rounded-md border border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2">
          <CalendarClock className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-indigo-800 dark:text-indigo-200">
              Client Statement Billing
            </div>
            <div className="text-[11px] text-indigo-600 dark:text-indigo-400">
              {sched.entityName ? `${sched.entityName} — ` : ""}
              {SCHEDULE_FREQUENCY_LABELS[sched.frequency] ?? sched.frequency}
              {sched.billingDay ? ` (day ${sched.billingDay})` : ""}
            </div>
          </div>
          {stmt ? (
            <Badge variant="custom" className="text-[10px] bg-indigo-200 text-indigo-800 dark:bg-indigo-800 dark:text-indigo-200 font-mono">
              {stmt.statementNumber}
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
              {stmt ? `Items on ${stmt.statementNumber}` : "Policies on this statement"}
              {" "}({stmt ? activeItems.length : onStatementInvs.length})
            </div>

            {stmt ? (
              <>
                {activeItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded bg-white/60 dark:bg-indigo-900/20 px-2 py-1.5 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3 w-3 shrink-0 text-indigo-400" />
                      <span className="font-medium truncate text-indigo-800 dark:text-indigo-200">
                        {item.description ?? "Premium"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                        {formatCurrency(item.amountCents)}
                      </span>
                      {isAdmin && (
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-neutral-400 hover:text-red-500"
                          disabled={itemActionBusy === item.id}
                          onClick={() => handleStatementItemAction(stmt.id, item.id, "remove")}
                          title="Remove from statement">
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {paidItems.length > 0 && (
                  <>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mt-2 mb-0.5">
                      Paid ({paidItems.length})
                    </div>
                    {paidItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-2 rounded bg-neutral-100/60 dark:bg-neutral-800/30 px-2 py-1.5 text-xs opacity-60">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <FileText className="h-3 w-3 shrink-0 text-neutral-400" />
                          <span className="font-medium text-neutral-500 dark:text-neutral-400 truncate line-through">
                            {item.description ?? "Premium"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="font-semibold text-neutral-400 line-through">{formatCurrency(item.amountCents)}</span>
                          {isAdmin && (
                            <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] text-indigo-500 hover:text-indigo-700"
                              disabled={itemActionBusy === item.id}
                              onClick={() => handleStatementItemAction(stmt.id, item.id, "reactivate")}
                              title="Move back to statement">
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
              receivableOnStatement.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-2 rounded bg-white/60 dark:bg-indigo-900/20 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText className="h-3 w-3 shrink-0 text-indigo-400" />
                    <span className="font-medium text-indigo-800 dark:text-indigo-200">{inv.invoiceNumber}</span>
                    {inv.notes && <span className="text-indigo-500 dark:text-indigo-400 truncate max-w-[120px]">· {inv.notes}</span>}
                  </div>
                  <span className="shrink-0 font-semibold text-indigo-700 dark:text-indigo-300">
                    {formatCurrency(inv.totalAmountCents - inv.paidAmountCents, inv.currency)}
                  </span>
                </div>
              ))
            )}
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

  /* ---------------------------------------------------------------- */
  /*  Individual invoice card (policy page)                            */
  /* ---------------------------------------------------------------- */

  const renderInvoiceCard = (inv: InvoiceWithPayments) => {
    const isExpanded = expandedInvoice === inv.id;
    const remaining = inv.totalAmountCents - inv.paidAmountCents;
    const methodLabel = (m: string | null) =>
      PAYMENT_METHOD_OPTIONS.find((o) => o.value === m)?.label ?? m ?? "—";

    return (
      <div key={inv.id} className="rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden">
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
              {isExpanded ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
            </span>
          </div>
          <div className="mt-0.5 pl-6 text-xs text-neutral-500 dark:text-neutral-400 wrap-break-word">
            <span className="whitespace-nowrap">{formatCurrency(inv.paidAmountCents, inv.currency)} / {formatCurrency(inv.totalAmountCents, inv.currency)}</span>
            {inv.notes && <span className="block sm:inline"> <span className="hidden sm:inline">&middot; </span>{inv.notes}</span>}
          </div>
        </button>

        {isExpanded && (
          <div className="border-t border-neutral-200 dark:border-neutral-700 px-3 py-3 space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                <div className="text-neutral-500 dark:text-neutral-400">Total</div>
                <div className="font-semibold">{formatCurrency(inv.totalAmountCents, inv.currency)}</div>
              </div>
              <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-2">
                <div className="text-green-600 dark:text-green-400">Paid</div>
                <div className="font-semibold text-green-700 dark:text-green-300">{formatCurrency(inv.paidAmountCents, inv.currency)}</div>
              </div>
              <div className={cn("rounded-md p-2", remaining > 0 ? "bg-orange-50 dark:bg-orange-900/20" : "bg-green-50 dark:bg-green-900/20")}>
                <div className={remaining > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"}>Remaining</div>
                <div className={cn("font-semibold", remaining > 0 ? "text-orange-700 dark:text-orange-300" : "text-green-700 dark:text-green-300")}>
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
                    <Button size="sm" variant="ghost" className="h-6 text-[11px] text-indigo-600 hover:text-red-600 dark:text-indigo-400"
                      disabled={togglingSchedule === inv.id}
                      onClick={(e) => { e.stopPropagation(); handleToggleStatement(inv.id, null); }}>
                      {togglingSchedule === inv.id ? "..." : "Release"}
                    </Button>
                  </div>
                );
              }
              if (matchingSchedule && remaining > 0) {
                return (
                  <Button size="sm" variant="outline" className="w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                    disabled={togglingSchedule === inv.id}
                    onClick={(e) => { e.stopPropagation(); handleToggleStatement(inv.id, matchingSchedule.id); }}>
                    <CalendarClock className="h-3.5 w-3.5 mr-1" />
                    {togglingSchedule === inv.id ? "Adding..." : "Add to Statement"}
                  </Button>
                );
              }
              return null;
            })()}

            {/* Payments */}
            {inv.payments.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Payments</div>
                {inv.payments.map((p) => (
                  <div key={p.id} className="flex items-start justify-between gap-2 rounded-md border border-neutral-100 dark:border-neutral-700 p-2 text-xs">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{formatCurrency(p.amountCents, p.currency)}</span>
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
                      {p.paymentDate && <div className="text-neutral-400">{new Date(p.paymentDate).toLocaleDateString()}</div>}
                      {p.notes && <div className="text-neutral-400 italic">{p.notes}</div>}
                      {p.rejectionNote && <div className="text-red-600 dark:text-red-400">Rejected: {p.rejectionNote}</div>}
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-1 shrink-0">
                        {p.status === "submitted" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600 hover:bg-green-50 hover:text-green-700"
                              disabled={verifyingId === p.id} onClick={() => handleVerify(inv.id, p.id, "verify")}>
                              <Check className="h-3.5 w-3.5 mr-0.5" />Verify
                            </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={verifyingId === p.id} onClick={() => openRejectDialog(inv.id, p.id)}>
                          <X className="h-3.5 w-3.5 mr-0.5" />Reject
                        </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                          disabled={verifyingId === p.id} onClick={() => openDeleteDialog(inv.id, p.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {remaining <= 0 && inv.payments.length > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs font-medium text-green-700 dark:text-green-300">
                <Check className="h-4 w-4" />Fully Paid
              </div>
            )}

            {remaining > 0 && (
              <InlinePaymentForm invoiceId={inv.id} remainingCents={remaining} currency={inv.currency} onSuccess={refresh} defaultPayer={isClientMode ? "client" : undefined} />
            )}
          </div>
        )}
      </div>
    );
  };

  /* ---------------------------------------------------------------- */
  /*  Payable invoice card (agent payables on policy page)             */
  /* ---------------------------------------------------------------- */

  const renderPayableCard = (inv: InvoiceWithPayments) => {
    const isExpanded = expandedInvoice === inv.id;
    const payableRemaining = inv.totalAmountCents - inv.paidAmountCents;

    return (
      <div key={inv.id} className="rounded-md border border-amber-200 dark:border-amber-800 overflow-hidden">
        <button type="button" onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
          className="w-full px-3 py-2.5 text-left hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors">
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
              {isExpanded ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
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
                <div className="font-semibold text-amber-800 dark:text-amber-200">{formatCurrency(inv.totalAmountCents, inv.currency)}</div>
              </div>
              <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                <div className="text-neutral-500 dark:text-neutral-400">Status</div>
                <div className="font-semibold">{inv.paidAmountCents >= inv.totalAmountCents ? "Settled" : "Outstanding"}</div>
              </div>
            </div>

            {inv.scheduleId && (
              <div className="flex items-center justify-between rounded-md bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2">
                <div className="flex items-center gap-1.5 text-xs text-indigo-700 dark:text-indigo-300">
                  <CalendarClock className="h-3.5 w-3.5" /><span>On statement billing</span>
                </div>
                <Button size="sm" variant="ghost" className="h-6 text-[11px] text-indigo-600 hover:text-red-600 dark:text-indigo-400"
                  disabled={togglingSchedule === inv.id}
                  onClick={(e) => { e.stopPropagation(); handleToggleStatement(inv.id, null); }}>
                  {togglingSchedule === inv.id ? "..." : "Release"}
                </Button>
              </div>
            )}
            {!inv.scheduleId && agentSchedule && payableRemaining > 0 && (
              <Button size="sm" variant="outline" className="w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                disabled={togglingSchedule === inv.id}
                onClick={(e) => { e.stopPropagation(); handleToggleStatement(inv.id, agentSchedule.id); }}>
                <CalendarClock className="h-3.5 w-3.5 mr-1" />
                {togglingSchedule === inv.id ? "Adding..." : "Add to Statement"}
              </Button>
            )}
            {payableRemaining > 0 && (
              <InlinePaymentForm invoiceId={inv.id} remainingCents={payableRemaining} currency={inv.currency} onSuccess={refresh} />
            )}
            {payableRemaining <= 0 && inv.paidAmountCents > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs font-medium text-green-700 dark:text-green-300">
                <Check className="h-4 w-4" />Settled
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ================================================================ */
  /*  AGENT MODE — full page for agent details                         */
  /* ================================================================ */

  if (isAgentMode) {
    const allInvs = [...invoices, ...payables];
    const agentSched = agentSchedule ?? schedules?.find((s) => s.entityType === "agent") ?? null;

    if (allInvs.length === 0 && !agentSched && agentStmtLoaded) {
      return <div className="text-xs text-neutral-500 dark:text-neutral-400">No payment records yet.</div>;
    }
    if (!agentStmtLoaded) {
      return <div className="text-xs text-neutral-500 dark:text-neutral-400">Loading payments...</div>;
    }

    const onStatementReceivables = invoices;
    const commissionInvs = payables.filter((inv) => {
      const isCommission = String(inv.notes ?? "").toLowerCase().startsWith("agent commission");
      return isCommission || (agentSched ? inv.scheduleId === agentSched.id : !!inv.scheduleId);
    });

    return (
      <>
        {confirmDialogEl}
        {errorDialogEl}
        <div className="space-y-3">
          {agentSched && renderAgentStatementCard(agentSched, onStatementReceivables, commissionInvs)}
        </div>
      </>
    );
  }

  /* ================================================================ */
  /*  CLIENT MODE — client details page                                */
  /* ================================================================ */

  if (isClientMode) {
    const clientReceivables = invoices.filter(
      (inv) => inv.direction === "receivable" && inv.invoiceType !== "statement",
    );

    if (clientReceivables.length === 0) {
      return <div className="text-xs text-neutral-500 dark:text-neutral-400">No payment records yet.</div>;
    }

    const totalDueCents = clientReceivables.reduce((sum, inv) => sum + inv.totalAmountCents, 0);
    const totalPaidCents = clientReceivables.reduce((sum, inv) => sum + inv.paidAmountCents, 0);
    const outstandingCents = totalDueCents - totalPaidCents;
    const currency = clientReceivables[0]?.currency ?? "HKD";

    return (
      <>
        {confirmDialogEl}
        {errorDialogEl}
        <div className="space-y-3">
          {/* Summary */}
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 px-3 py-2.5 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-neutral-500 dark:text-neutral-400">Total Due</span>
              <span className="font-semibold">{formatCurrency(totalDueCents, currency)}</span>
            </div>
            {totalPaidCents > 0 && (
              <div className="flex items-center justify-between text-green-700 dark:text-green-400">
                <span>Paid</span>
                <span className="font-semibold">{formatCurrency(totalPaidCents, currency)}</span>
              </div>
            )}
            <div className={cn(
              "flex items-center justify-between font-semibold rounded px-1.5 py-0.5 -mx-1.5",
              outstandingCents > 0
                ? "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20"
                : "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20",
            )}>
              <span>Outstanding</span>
              <span>{formatCurrency(Math.max(outstandingCents, 0), currency)}</span>
            </div>
          </div>

          {/* Individual invoices with payment forms */}
          {clientReceivables.map((inv) => (
            <React.Fragment key={inv.id}>{renderInvoiceCard(inv)}</React.Fragment>
          ))}
        </div>
      </>
    );
  }

  /* ================================================================ */
  /*  POLICY MODE — policy details page                                */
  /* ================================================================ */

  const hasInvsOnAgentStatement = !!agentSchedule && [...invoices, ...payables].some(
    (inv) => inv.scheduleId === agentSchedule.id,
  );
  const showAgentSection = payables.length > 0 || hasInvsOnAgentStatement;

  return (
    <>
      {confirmDialogEl}
      {errorDialogEl}
      <div className="space-y-3">
        {clientSchedule && renderClientScheduleCard(clientSchedule)}

        {!hideInvoiceCards && invoices.length === 0 && (
          <div className="py-3 text-center text-xs text-neutral-400">
            {hasClientSchedule
              ? "Client premiums will be included in the next statement."
              : "No receivable invoices yet. Pay individually or add to a statement below."}
          </div>
        )}

        {!hideInvoiceCards && invoices.map((inv) => (
          <React.Fragment key={inv.id}>{renderInvoiceCard(inv)}</React.Fragment>
        ))}

        {showAgentSection && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Agent Settlement
              </span>
              <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            </div>

            {hasInvsOnAgentStatement && agentSchedule && renderAgentStatementCard(
              agentSchedule,
              invoices.filter((inv) => inv.scheduleId === agentSchedule.id),
              payables.filter((inv) => inv.scheduleId === agentSchedule.id),
              new Set([policyId!, ...(endorsementPolicyIds ?? [])]),
            )}

            {!hideInvoiceCards && payables.map((inv) => (
              <React.Fragment key={inv.id}>{renderPayableCard(inv)}</React.Fragment>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
