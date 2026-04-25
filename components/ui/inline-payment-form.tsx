"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DollarSign, Loader2, Upload, FileText, X } from "lucide-react";
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from "@/lib/types/accounting";

function formatCurrency(cents: number, currency = "HKD"): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export interface InlinePaymentFormProps {
  invoiceId: number;
  remainingCents: number;
  currency?: string;
  /** Lock the payer field to this value (hidden from UI). */
  defaultPayer?: string;
  /** Label override for the trigger button. */
  buttonLabel?: string;
  /** Button style variant. */
  buttonVariant?: "outline" | "default" | "ghost";
  /** Extra className for the trigger button. */
  buttonClassName?: string;
  /** Icon override for the trigger button — pass null to suppress. */
  buttonIcon?: React.ReactNode | null;
  /** When true the form starts already open (no trigger button). */
  startOpen?: boolean;
  onSuccess: () => void;
}

export function InlinePaymentForm({
  invoiceId,
  remainingCents,
  currency = "HKD",
  defaultPayer,
  buttonLabel = "Record Payment",
  buttonVariant = "outline",
  buttonClassName,
  buttonIcon,
  startOpen = false,
  onSuccess,
}: InlinePaymentFormProps) {
  const [open, setOpen] = React.useState(startOpen);
  const [method, setMethod] = React.useState<PaymentMethod>("bank_transfer");
  const [amount, setAmount] = React.useState(startOpen && remainingCents > 0 ? (remainingCents / 100).toFixed(2) : "");
  const [date, setDate] = React.useState(() => new Date().toISOString().split("T")[0]);
  const [ref, setRef] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [proofFile, setProofFile] = React.useState<File | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const reset = () => {
    setMethod("bank_transfer");
    setAmount("");
    setDate(new Date().toISOString().split("T")[0]);
    setRef("");
    setNotes("");
    setProofFile(null);
    if (!startOpen) setOpen(false);
  };

  const handleSubmit = async () => {
    const cents = Math.round(Number(amount) * 100);
    if (!cents || cents <= 0) return;
    setSaving(true);
    try {
      let res: Response;

      if (proofFile) {
        const fd = new FormData();
        fd.append("amountCents", String(cents));
        fd.append("paymentDate", date || "");
        fd.append("paymentMethod", method);
        fd.append("referenceNumber", ref.trim());
        fd.append("notes", notes.trim());
        if (defaultPayer) fd.append("payer", defaultPayer);
        fd.append("proofFile", proofFile);
        res = await fetch(`/api/accounting/invoices/${invoiceId}/payments`, {
          method: "POST",
          body: fd,
        });
      } else {
        res = await fetch(`/api/accounting/invoices/${invoiceId}/payments`, {
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
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to record payment");
      }
      reset();
      onSuccess();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const iconEl = buttonIcon === null ? null : (buttonIcon ?? <DollarSign className="h-3.5 w-3.5 mr-1" />);

  if (!open) {
    return (
      <Button
        size="sm"
        variant={buttonVariant}
        className={buttonClassName ?? "w-full"}
        onClick={() => {
          setAmount((remainingCents / 100).toFixed(2));
          setOpen(true);
        }}
      >
        {iconEl}
        {buttonLabel}
      </Button>
    );
  }

  return (
    <>
    <Dialog open={!!errorMsg} onOpenChange={(o) => { if (!o) setErrorMsg(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Error</DialogTitle></DialogHeader>
        <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>
        <DialogFooter><Button size="sm" onClick={() => setErrorMsg(null)}>OK</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <input
      ref={fileInputRef}
      type="file"
      className="hidden"
      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) setProofFile(f);
        e.target.value = "";
      }}
    />

    <div className="space-y-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 p-3 bg-neutral-50 dark:bg-neutral-800/30">
      <div className="text-xs font-medium">{buttonLabel}</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-neutral-500 mb-0.5">Amount ({currency})</div>
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

      {/* Proof upload */}
      {proofFile ? (
        <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-800/30">
          <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <span className="text-xs font-medium truncate flex-1">{proofFile.name}</span>
          <button type="button" onClick={() => setProofFile(null)} className="text-neutral-400 hover:text-red-500">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-1.5 text-xs"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          Attach Payment Proof
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={saving || !amount || Number(amount) <= 0}
          onClick={handleSubmit}
        >
          {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Saving...</> : buttonLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
        <span className="text-[11px] text-neutral-400 sm:ml-auto">
          Max: {formatCurrency(remainingCents, currency)}
        </span>
      </div>
    </div>
    </>
  );
}
