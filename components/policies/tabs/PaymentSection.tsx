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
  type PaymentMethod,
  type PaymentStatus,
  type InvoiceStatus,
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
} from "lucide-react";

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
}: {
  policyId: number;
  isAdmin: boolean;
  onSummaryChange?: (summary: PaymentSummary) => void;
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

  const summaryRef = React.useRef(onSummaryChange);
  summaryRef.current = onSummaryChange;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/accounting/invoices/by-policy/${policyId}?_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch invoices");
        return r.json();
      })
      .then((data: InvoiceWithPayments[]) => {
        if (cancelled) return;
        const receivable = data.filter((inv) => inv.direction === "receivable");
        const payableInvs = data.filter((inv) => inv.direction === "payable");
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
  }, [policyId, refreshKey]);

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

  if (invoices.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-neutral-400">
        No receivable invoices found for this policy. Invoices are created when documents are confirmed.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {invoices.map((inv) => {
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
              <div className="mt-0.5 pl-6 text-xs text-neutral-500 dark:text-neutral-400">
                {formatCurrency(inv.paidAmountCents, inv.currency)} / {formatCurrency(inv.totalAmountCents, inv.currency)}
                {inv.notes && <> &middot; {inv.notes}</>}
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
                          <div className="text-neutral-500 dark:text-neutral-400">
                            {methodLabel(p.paymentMethod)}
                            {p.referenceNumber && <> &middot; Ref: {p.referenceNumber}</>}
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

                {/* Record payment form toggle */}
                {remaining > 0 && (
                  <>
                    {showPaymentForm === inv.id ? (
                      <div className="space-y-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 p-3 bg-neutral-50 dark:bg-neutral-800/30">
                        <div className="text-xs font-medium">Record Payment</div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Method</Label>
                            <select
                              className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                              value={paymentMethod}
                              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                            >
                              {PAYMENT_METHOD_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">
                              Amount ({inv.currency})
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max={remaining / 100}
                              placeholder={(remaining / 100).toFixed(2)}
                              value={paymentAmount}
                              onChange={(e) => setPaymentAmount(e.target.value)}
                              className="mt-1 h-8 text-sm"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Date</Label>
                            <Input
                              type="date"
                              value={paymentDate}
                              onChange={(e) => setPaymentDate(e.target.value)}
                              className="mt-1 h-8 text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">
                              {paymentMethod === "cheque" ? "Cheque No." : "Reference"}
                            </Label>
                            <Input
                              type="text"
                              placeholder={paymentMethod === "cheque" ? "Cheque number" : "Reference number"}
                              value={referenceNumber}
                              onChange={(e) => setReferenceNumber(e.target.value)}
                              className="mt-1 h-8 text-sm"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">Notes (optional)</Label>
                          <Input
                            type="text"
                            placeholder="Payment notes..."
                            value={paymentNotes}
                            onChange={(e) => setPaymentNotes(e.target.value)}
                            className="mt-1 h-8 text-sm"
                          />
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            disabled={submitting || !paymentAmount || Number(paymentAmount) <= 0}
                            onClick={() => handleRecordPayment(inv.id)}
                          >
                            {submitting ? "Saving..." : "Record Payment"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={resetForm}
                          >
                            Cancel
                          </Button>
                          {paymentAmount && Number(paymentAmount) > 0 && Number(paymentAmount) < remaining / 100 && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Partial payment
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setShowPaymentForm(inv.id);
                          setPaymentAmount((remaining / 100).toFixed(2));
                        }}
                      >
                        <DollarSign className="h-3.5 w-3.5 mr-1" />
                        Record Payment
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Agent Commission Payables */}
      {payables.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              Agent Commission
            </span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>
          {payables.map((inv) => {
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
                  <div className="mt-0.5 pl-6 text-xs text-neutral-500 dark:text-neutral-400">
                    {formatCurrency(inv.totalAmountCents, inv.currency)} to {inv.entityName || "Agent"}
                    {inv.notes && <> &middot; {inv.notes}</>}
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-amber-200 dark:border-amber-700 px-3 py-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 p-2">
                        <div className="text-amber-600 dark:text-amber-400">Commission Amount</div>
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
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Client Premium − Agent Premium = Commission payable to agent when client pays directly.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
