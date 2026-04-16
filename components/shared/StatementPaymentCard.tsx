"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PAYMENT_STATUS_LABELS, type PaymentStatus } from "@/lib/types/accounting";
import { Check, X, ChevronDown, ChevronUp, FileText, Trash2, UserCheck } from "lucide-react";
import { InlinePaymentForm } from "@/components/ui/inline-payment-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type StatementItem = {
  id: number;
  policyId: number;
  policyPremiumId?: number | null;
  amountCents: number;
  displayAmountCents?: number | null;
  clientPremiumCents?: number | null;
  description: string | null;
  status: string;
  paymentBadge?: string;
};

export type InvoicePayment = {
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

export type InvoiceInfo = {
  id: number;
  invoiceNumber: string;
  invoiceType: string;
  direction: string;
  entityPolicyId?: number | null;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  status: string;
  notes: string | null;
  payments: InvoicePayment[];
};

export type StatementTotals = {
  totalDue: number;
  clientPaidTotal: number;
  agentPaidTotal: number;
  commissionTotal: number;
  outstanding: number;
  creditToAgent: number;
};

export interface StatementPaymentCardProps {
  statementNumber?: string;
  statementStatus?: string;
  totals: StatementTotals;
  currency: string;
  items: StatementItem[];
  receivableInvoices: InvoiceInfo[];
  commissionInvoices: InvoiceInfo[];
  isAdmin: boolean;
  onRefresh: () => void;
  /** Who is making the payment — locks InlinePaymentForm payer. */
  defaultPayer?: "client" | "agent";
  /** Map of policyId → client premium cents (for "Client Paid Agent" action). */
  clientPremiumByPolicy?: Map<number, number>;
  /** Existing client-to-agent payment records per policyId. */
  ctaPaymentsByPolicy?: Record<number, { id: number; invoiceId: number; amountCents: number; currency: string; paymentDate: string | null; paymentMethod: string | null; status: string; payer: string | null; notes: string | null; createdAt: string }[]>;
}

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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function StatementPaymentCard({
  statementNumber,
  statementStatus,
  totals,
  currency,
  items,
  receivableInvoices,
  commissionInvoices,
  isAdmin,
  onRefresh,
  defaultPayer,
  clientPremiumByPolicy,
  ctaPaymentsByPolicy,
}: StatementPaymentCardProps) {
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [verifyingId, setVerifyingId] = React.useState<number | null>(null);
  const [rejectionNote, setRejectionNote] = React.useState("");
  const [confirmDialog, setConfirmDialog] = React.useState<{
    type: "delete" | "reject";
    invoiceId: number;
    paymentId: number;
  } | null>(null);
  const [dialogNote, setDialogNote] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // "Mark Client Paid" dialog — wraps InlinePaymentForm in a dialog
  const [ctaDialog, setCtaDialog] = React.useState<{
    invoiceId: number;
    clientPremiumCents: number;
  } | null>(null);

  const { totalDue, clientPaidTotal, agentPaidTotal, commissionTotal, outstanding, creditToAgent } = totals;

  const premiumItems = items.filter((it) =>
    it.policyPremiumId
    && !/commission:/i.test(it.description ?? "")
    && !/credit:/i.test(it.description ?? ""),
  );

  const invoiceByPolicy = new Map<number, InvoiceInfo>();
  for (const inv of receivableInvoices) {
    if (inv.entityPolicyId) invoiceByPolicy.set(inv.entityPolicyId, inv);
  }

  const resolvedAmt = (it: StatementItem) => Number(it.displayAmountCents ?? it.amountCents) || 0;

  const handleVerify = async (invoiceId: number, paymentId: number, action: "verify" | "reject") => {
    setVerifyingId(paymentId);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          action,
          rejectionNote: action === "reject" ? rejectionNote : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      setRejectionNote("");
      onRefresh();
    } catch {
      setErrorMsg("Operation failed");
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
        if (!res.ok) throw new Error("Failed");
      } else if (type === "reject") {
        setRejectionNote(dialogNote);
        const res = await fetch(`/api/accounting/invoices/${invoiceId}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId, action: "reject", rejectionNote: dialogNote.trim() || null }),
        });
        if (!res.ok) throw new Error("Failed");
        setRejectionNote("");
      }
      onRefresh();
    } catch {
      setErrorMsg("Operation failed");
    } finally {
      setVerifyingId(null);
      setDialogNote("");
    }
  };

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

  const ctaDialogEl = (
    <Dialog open={!!ctaDialog} onOpenChange={(open) => { if (!open) setCtaDialog(null); }}>
      <DialogContent className="max-w-sm p-0 overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <DialogTitle><span className="text-sm">Mark Client Paid Agent</span></DialogTitle>
          {ctaDialog && (
            <p className="text-[10px] text-neutral-400 mt-1">
              Client premium: {formatCurrency(ctaDialog.clientPremiumCents, currency)}
            </p>
          )}
        </div>
        {ctaDialog && (
          <div className="px-2 pb-3">
            <InlinePaymentForm
              invoiceId={ctaDialog.invoiceId}
              remainingCents={ctaDialog.clientPremiumCents}
              currency={currency}
              defaultPayer="client_to_agent"
              buttonLabel="Mark Client Paid"
              startOpen
              onSuccess={() => { setCtaDialog(null); onRefresh(); }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-3">
      {confirmDialogEl}
      {errorDialogEl}
      {ctaDialogEl}
      {/* ---- Header ---- */}
      <div className="rounded-md border border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="text-xs font-medium text-indigo-800 dark:text-indigo-200">
            {statementNumber || "Statement"}
          </div>
          {statementStatus && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {statementStatus.replace(/_/g, " ")}
            </span>
          )}
        </div>

        {/* ---- Totals ---- */}
        {totalDue > 0 && (
          <div className="border-t border-indigo-200 dark:border-indigo-800 px-3 py-2 space-y-0.5 text-xs">
            <div className="grid grid-cols-[1fr_80px_80px] gap-1 border-b border-neutral-200 dark:border-neutral-700 pb-0.5 mb-0.5">
              <span />
              <span className="text-[10px] font-medium text-neutral-400 text-right">credit</span>
              <span className="text-[10px] font-medium text-neutral-400 text-right">debit</span>
            </div>

            <div className="grid grid-cols-[1fr_80px_80px] gap-1 py-0.5">
              <span className="font-medium text-neutral-600 dark:text-neutral-300">Total Due</span>
              <span />
              <span className="font-semibold text-neutral-800 dark:text-neutral-200 text-right">{formatCurrency(totalDue, currency)}</span>
            </div>

            {clientPaidTotal > 0 && (
              <div className="grid grid-cols-[1fr_80px_80px] gap-1 py-0.5 rounded bg-green-50 dark:bg-green-900/30 px-1">
                <span className="font-medium text-green-700 dark:text-green-400">Client Paid Directly</span>
                <span className="font-semibold text-green-700 dark:text-green-300 text-right">{formatCurrency(clientPaidTotal, currency)}</span>
                <span />
              </div>
            )}

            {agentPaidTotal > 0 && (
              <div className="grid grid-cols-[1fr_80px_80px] gap-1 py-0.5 rounded bg-green-50 dark:bg-green-900/30 px-1">
                <span className="font-medium text-green-700 dark:text-green-400">Agent Paid</span>
                <span className="font-semibold text-green-700 dark:text-green-300 text-right">{formatCurrency(agentPaidTotal, currency)}</span>
                <span />
              </div>
            )}

            {commissionTotal > 0 && (
              <div className="grid grid-cols-[1fr_80px_80px] gap-1 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 px-1">
                <span className="font-medium text-amber-700 dark:text-amber-400">Commission</span>
                <span className="font-semibold text-amber-700 dark:text-amber-300 text-right">{formatCurrency(commissionTotal, currency)}</span>
                <span />
              </div>
            )}

            <div className="border-t-2 border-neutral-400 dark:border-neutral-600 mt-1 pt-1">
              <div className={cn(
                "grid grid-cols-[1fr_80px_80px] gap-1 py-0.5 rounded px-1",
                outstanding > 0 ? "bg-red-50 dark:bg-red-900/30" : "",
              )}>
                <span className={cn("font-bold", outstanding > 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400")}>
                  Outstanding
                </span>
                <span />
                <span className={cn("font-bold text-right", outstanding > 0 ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300")}>
                  {formatCurrency(outstanding, currency)}
                </span>
              </div>
              {creditToAgent > 0 && (
                <div className="grid grid-cols-[1fr_80px_80px] gap-1 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 px-1 mt-0.5">
                  <span className="font-bold text-amber-700 dark:text-amber-400">Credit to Agent</span>
                  <span className="font-bold text-amber-700 dark:text-amber-300 text-right">{formatCurrency(creditToAgent, currency)}</span>
                  <span />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---- Line Items ---- */}
      {premiumItems.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Line Items ({premiumItems.length})
          </div>
          {premiumItems.map((item) => {
            const isPaid = item.status === "paid_individually";
            const badgeStr = item.paymentBadge ?? "";
            const isClientPaid = badgeStr.includes("Client paid directly");
            const isAgentPaid = badgeStr.includes("Agent paid");
            const isCtaPaid = badgeStr.includes("Client paid agent");
            const amt = resolvedAmt(item);
            const invoice = invoiceByPolicy.get(item.policyId);
            const invRemaining = invoice ? invoice.totalAmountCents - invoice.paidAmountCents : 0;
            const isExpanded = expandedId === item.id;

            return (
              <div
                key={item.id}
                className={cn(
                  "rounded text-xs border overflow-hidden",
                  isPaid
                    ? "border-green-200/60 dark:border-green-800/30"
                    : "bg-white/60 dark:bg-indigo-900/10 border-neutral-100 dark:border-neutral-800",
                )}
              >
                <button
                  type="button"
                  onClick={() => invoice && setExpandedId(isExpanded ? null : item.id)}
                  className={cn("w-full px-2 py-1.5 text-left", invoice ? "cursor-pointer hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30" : "")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className={cn("h-3 w-3 shrink-0", isPaid ? "text-green-400 dark:text-green-500" : "text-indigo-400")} />
                      <span className={cn("font-medium truncate text-[11px]", isPaid ? "text-green-700 dark:text-green-400" : "text-indigo-800 dark:text-indigo-200")}>
                        {item.description ?? "Premium"}
                      </span>
                      {isClientPaid && (
                        <span className="rounded bg-green-100 px-1 py-0.5 text-[9px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300 shrink-0">
                          Client paid directly
                        </span>
                      )}
                      {isAgentPaid && (
                        <span className="rounded bg-blue-100 px-1 py-0.5 text-[9px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 shrink-0">
                          Agent paid
                        </span>
                      )}
                      {isCtaPaid && (
                        <span className="rounded bg-purple-100 px-1 py-0.5 text-[9px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 shrink-0">
                          Client paid agent
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn("font-semibold", isPaid ? "text-green-600 dark:text-green-400" : "text-indigo-700 dark:text-indigo-300")}>
                        {formatCurrency(amt, currency)}
                      </span>
                      {invoice && (
                        isExpanded ? <ChevronUp className="h-3 w-3 text-neutral-400" /> : <ChevronDown className="h-3 w-3 text-neutral-400" />
                      )}
                    </div>
                  </div>
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
                      <div className={cn("rounded p-1.5", invRemaining > 0 ? "bg-orange-50 dark:bg-orange-900/20" : "bg-green-50 dark:bg-green-900/20")}>
                        <div className={cn("text-[10px]", invRemaining > 0 ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400")}>Remaining</div>
                        <div className={cn("font-semibold", invRemaining > 0 ? "text-orange-700 dark:text-orange-300" : "text-green-700 dark:text-green-300")}>
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
                            {isAdmin && (
                              <div className="flex items-center gap-1 shrink-0">
                                {p.status === "submitted" && (
                                  <>
                                    <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] text-green-600" disabled={verifyingId === p.id} onClick={() => handleVerify(invoice.id, p.id, "verify")}>
                                      <Check className="h-3 w-3 mr-0.5" />Verify
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] text-red-600" disabled={verifyingId === p.id} onClick={() => openRejectDialog(invoice.id, p.id)}>
                                      <X className="h-3 w-3 mr-0.5" />Reject
                                    </Button>
                                  </>
                                )}
                                <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] text-neutral-500 hover:text-red-600" disabled={verifyingId === p.id} onClick={() => openDeleteDialog(invoice.id, p.id)}>
                                  <Trash2 className="h-3 w-3" />
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
                        defaultPayer={defaultPayer}
                        onSuccess={onRefresh}
                      />
                    )}

                    {defaultPayer === "agent" && (() => {
                      const ctaPayments = ctaPaymentsByPolicy?.[item.policyId] ?? [];
                      const hasCtaPayment = ctaPayments.length > 0;
                      return (
                        <div className="space-y-1.5">
                          {hasCtaPayment ? (
                            <div className="space-y-1">
                              <div className="text-[10px] font-medium text-purple-600 dark:text-purple-400">Client → Agent Payments</div>
                              {ctaPayments.map((cp) => (
                                <div key={cp.id} className="flex items-center justify-between gap-2 rounded border border-purple-100 dark:border-purple-800/40 bg-purple-50/50 dark:bg-purple-900/10 p-1.5 text-[11px]">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium">{formatCurrency(cp.amountCents, cp.currency)}</span>
                                    <Badge variant="custom" className={`text-[9px] ${statusBadgeClass(cp.status as PaymentStatus)}`}>
                                      {PAYMENT_STATUS_LABELS[cp.status as PaymentStatus] ?? cp.status}
                                    </Badge>
                                  </div>
                                  {isAdmin && (
                                    <Button size="sm" variant="ghost" className="h-5 px-1 text-[10px] text-neutral-500 hover:text-red-600" disabled={verifyingId === cp.id} onClick={() => openDeleteDialog(cp.invoiceId, cp.id)}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full border-purple-200 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-900/30"
                              onClick={() => {
                                const cpCents = clientPremiumByPolicy?.get(item.policyId) ?? 0;
                                setCtaDialog({ invoiceId: invoice.id, clientPremiumCents: cpCents || resolvedAmt(item) });
                              }}
                            >
                              <UserCheck className="h-3.5 w-3.5 mr-1" />
                              Mark Client Paid
                            </Button>
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
      )}

      {/* ---- Commission Invoices ---- */}
      {commissionInvoices.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Commission ({commissionInvoices.length})
          </div>
          {commissionInvoices.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-2 rounded bg-amber-50/60 dark:bg-amber-900/10 px-2 py-1.5 text-xs border border-amber-100 dark:border-amber-800/40"
            >
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
  );
}
