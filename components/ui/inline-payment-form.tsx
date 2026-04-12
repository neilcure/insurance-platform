"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DollarSign, Loader2 } from "lucide-react";
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from "@/lib/types/accounting";

function formatCurrency(cents: number, currency = "HKD"): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function InlinePaymentForm({
  invoiceId,
  remainingCents,
  currency = "HKD",
  defaultPayer,
  onSuccess,
}: {
  invoiceId: number;
  remainingCents: number;
  currency?: string;
  defaultPayer?: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [method, setMethod] = React.useState<PaymentMethod>("bank_transfer");
  const [amount, setAmount] = React.useState("");
  const [date, setDate] = React.useState(() => new Date().toISOString().split("T")[0]);
  const [ref, setRef] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const reset = () => {
    setMethod("bank_transfer");
    setAmount("");
    setDate(new Date().toISOString().split("T")[0]);
    setRef("");
    setNotes("");
    setOpen(false);
  };

  const handleSubmit = async () => {
    const cents = Math.round(Number(amount) * 100);
    if (!cents || cents <= 0) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: cents,
          paymentDate: date || null,
          paymentMethod: method,
          referenceNumber: ref.trim() || null,
          notes: notes.trim() || null,
          ...(defaultPayer ? { payer: defaultPayer } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to record payment");
      }
      reset();
      onSuccess();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => {
          setAmount((remainingCents / 100).toFixed(2));
          setOpen(true);
        }}
      >
        <DollarSign className="h-3.5 w-3.5 mr-1" />
        Record Payment
      </Button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 p-3 bg-neutral-50 dark:bg-neutral-800/30">
      <div className="text-xs font-medium">Record Payment</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-neutral-500 mb-0.5">Amount</div>
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <div className="text-[10px] text-neutral-500 mb-0.5">Method</div>
          <select
            className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-neutral-500 mb-0.5">Date</div>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <div className="text-[10px] text-neutral-500 mb-0.5">Reference</div>
          <Input
            type="text"
            placeholder="Ref..."
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <div>
        <div className="text-[10px] text-neutral-500 mb-0.5">Notes</div>
        <Input
          type="text"
          placeholder="Payment notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={saving || !amount || Number(amount) <= 0}
          onClick={handleSubmit}
        >
          {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Saving...</> : "Record Payment"}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
        <span className="text-[11px] text-neutral-400 ml-auto">
          Max: {formatCurrency(remainingCents, currency)}
        </span>
      </div>
    </div>
  );
}
