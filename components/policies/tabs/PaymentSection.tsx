"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  SCHEDULE_FREQUENCY_LABELS,
  type PaymentMethod,
  type PaymentStatus,
  type InvoiceStatus,
  type ScheduleFrequency,
} from "@/lib/types/accounting";
import {
  DollarSign,
  Check,
  X,
  Clock,
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

export function PaymentSection({
  policyId,
  isAdmin,
  onSummaryChange,
  externalRefreshKey,
  endorsementPolicyIds,
  hideInvoiceCards,
}: {
  policyId: number;
  isAdmin: boolean;
  onSummaryChange?: (summary: PaymentSummary) => void;
  externalRefreshKey?: number;
  endorsementPolicyIds?: number[];
  hideInvoiceCards?: boolean;
}) {
  const [invoices, setInvoices] = React.useState<InvoiceWithPayments[]>([]);
  const [payables, setPayables] = React.useState<InvoiceWithPayments[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedInvoice, setExpandedInvoice] = React.useState<number | null>(null);
  const [showPaymentForm, setShowPaymentForm] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [verifyingId, setVerifyingId] = React.useState<number | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>("bank_transfer");
  const [paymentAmount, setPaymentAmount] = React.useState("");
  const [paymentDate, setPaymentDate] = React.useState(() => new Date().toISOString().split("T")[0]);
  const [referenceNumber, setReferenceNumber] = React.useState("");
  const [paymentNotes, setPaymentNotes] = React.useState("");
  const [rejectionNote, setRejectionNote] = React.useState("");

  type ScheduleInfo = {
    id: number;
    frequency: ScheduleFrequency;
    entityType: string;
    entityName: string | null;
    billingDay: number | null;
    isActive: boolean;
  };
  const [schedules, setSchedules] = React.useState<ScheduleInfo[] | undefined>(undefined);
  const clientSchedule = schedules?.find((s) => s.entityType === "client") ?? null;
  const agentSchedule = schedules?.find((s) => s.entityType === "agent") ?? null;
  const hasClientSchedule = !!clientSchedule;

  React.useEffect(() => {
    fetch(`/api/accounting/schedules/by-policy/${policyId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { schedules: [] }))
      .then((data) => {
        const arr = data.schedules ?? (data.schedule ? [data.schedule] : []);
        setSchedules(arr);
      })
      .catch(() => setSchedules([]));
  }, [policyId, refreshKey, externalRefreshKey]);

  const summaryRef = React.useRef(onSummaryChange);
  summaryRef.current = onSummaryChange;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const allIds = [policyId, ...(endorsementPolicyIds ?? [])];
    const fetches = allIds.map((id) =>
      fetch(`/api/accounting/invoices/by-policy/${id}?_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((data: InvoiceWithPayments[]) => data)
        .catch(() => [] as InvoiceWithPayments[]),
    );

    Promise.all(fetches)
      .then((results) => {
        if (cancelled) return;
        const data = results.flat();
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
  }, [policyId, refreshKey, externalRefreshKey, endorsementPolicyIds?.join(",")]);

  const resetForm = () => {
    setPaymentMethod("bank_transfer");
    setPaymentAmount("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setReferenceNumber("");
    setPaymentNotes("");
    setShowPaymentForm(null);
  };

  const handleRecordPayment = async (invoiceId: number) => {
    const cents = Math.round(Number(paymentAmount) * 100);
    if (!cents || cents <= 0) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: cents,
          paymentDate: paymentDate || null,
          paymentMethod,
          referenceNumber: referenceNumber.trim() || null,
          notes: paymentNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to record payment");
      }
      resetForm();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

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
    const onStatementInvs = linkedInvs.filter((inv) =>
      matchAllSchedules ? inv.scheduleId && allScheduleIds.has(inv.scheduleId) : inv.scheduleId === s.id,
    );

    const receivableOnStatement = onStatementInvs.filter((inv) => inv.direction === "receivable");
    const payableOnStatement = onStatementInvs.filter((inv) => inv.direction === "payable");

    const totalReceivable = receivableOnStatement.reduce((sum, inv) => sum + (inv.totalAmountCents - inv.paidAmountCents), 0);
    const totalPayable = payableOnStatement.reduce((sum, inv) => sum + (inv.totalAmountCents - inv.paidAmountCents), 0);
    const netDue = totalReceivable - totalPayable;

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
          <Badge variant="custom" className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
            Period Pay
          </Badge>
        </div>

        {onStatementInvs.length > 0 && (
          <div className="border-t border-indigo-200 dark:border-indigo-800 px-3 py-2 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400 mb-1">
              Policies on this statement ({onStatementInvs.length})
            </div>
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
              {totalPayable > 0 && (
                <>
                  <div className="flex items-center justify-between text-indigo-500 dark:text-indigo-400">
                    <span>Receivable</span>
                    <span>{formatCurrency(totalReceivable)}</span>
                  </div>
                  <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                    <span>Less commission</span>
                    <span>−{formatCurrency(totalPayable)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between font-medium">
                {netDue > 0 ? (
                  <>
                    <span className="text-indigo-600 dark:text-indigo-400">
                      {totalPayable > 0 ? "Net due from agent" : "Total on statement"}
                    </span>
                    <span className="font-bold text-indigo-800 dark:text-indigo-200">{formatCurrency(netDue)}</span>
                  </>
                ) : netDue < 0 ? (
                  <>
                    <span className="text-amber-600 dark:text-amber-400">Commission credit to agent</span>
                    <span className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(Math.abs(netDue))}</span>
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

        {onStatementInvs.length === 0 && (
          <div className="border-t border-indigo-200 dark:border-indigo-800 px-3 py-1.5">
            <div className="text-[11px] text-indigo-500 dark:text-indigo-400 italic">
              No policies added to this statement yet.
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Client schedule card — only when no agent schedule (agent schedule takes over receivables) */}
      {clientSchedule && !agentSchedule && scheduleCard(clientSchedule, "Client Statement Billing", invoices)}

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
                  const matchingSchedule = inv.direction === "receivable" ? (agentSchedule ?? clientSchedule) : agentSchedule;
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

      {/* Agent Premium Payables — only show when there are payables or invoices manually added to the agent statement */}
      {(() => {
        const hasInvsOnAgentStatement = agentSchedule && [...invoices, ...payables].some(
          (inv) => inv.scheduleId && allScheduleIds.has(inv.scheduleId),
        );
        const showAgentSection = payables.length > 0 || hasInvsOnAgentStatement;
        if (!showAgentSection) return null;
        return (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Agent Premium
            </span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>
          {hasInvsOnAgentStatement && agentSchedule && scheduleCard(agentSchedule, "Agent Statement Billing", [...invoices, ...payables], true)}
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
