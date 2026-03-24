"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { PremiumType, EntityType, InvoiceDirection } from "@/lib/types/accounting";

type PolicyPremiumRow = {
  policyId: number;
  policyNumber: string;
  premiumId: number | null;
  lineKey: string | null;
  lineLabel: string | null;
  currency: string;
  grossPremiumCents: number | null;
  netPremiumCents: number | null;
  clientPremiumCents: number | null;
  agentCommissionCents: number | null;
  collaboratorId: number | null;
  insurerPolicyId: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  flowOptions: Array<{ value: string; label: string }>;
};

function fmtCurrency(cents: number | null, currency = "HKD"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

const PREMIUM_FIELD_MAP: Record<PremiumType, string> = {
  net_premium: "netPremiumCents",
  agent_premium: "agentCommissionCents",
  client_premium: "clientPremiumCents",
};

export function CreateInvoiceDialog({ open, onClose, onCreated, flowOptions }: Props) {
  const [step, setStep] = React.useState(1);
  const [saving, setSaving] = React.useState(false);
  const [loadingPolicies, setLoadingPolicies] = React.useState(false);

  // Step 1: Invoice type
  const [direction, setDirection] = React.useState<InvoiceDirection>("payable");
  const [premiumType, setPremiumType] = React.useState<PremiumType>("net_premium");
  const [entityType, setEntityType] = React.useState<EntityType>("collaborator");
  const [entityName, setEntityName] = React.useState("");
  const [invoiceDate, setInvoiceDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [flowFilter, setFlowFilter] = React.useState("");

  // Step 2: Select policies
  const [availablePolicies, setAvailablePolicies] = React.useState<PolicyPremiumRow[]>([]);
  const [selectedItems, setSelectedItems] = React.useState<Array<{ policyId: number; policyNumber: string; premiumId: number | null; lineKey: string | null; amountCents: number; description: string }>>([]);

  React.useEffect(() => {
    if (direction === "payable") {
      setPremiumType("net_premium");
      setEntityType("collaborator");
    } else {
      setPremiumType("agent_premium");
      setEntityType("agent");
    }
  }, [direction]);

  React.useEffect(() => {
    if (premiumType === "net_premium") setEntityType("collaborator");
    else if (premiumType === "agent_premium") setEntityType("agent");
    else setEntityType("client");
  }, [premiumType]);

  const loadPolicies = React.useCallback(async () => {
    setLoadingPolicies(true);
    try {
      const params = new URLSearchParams();
      if (flowFilter) params.set("flow", flowFilter);
      const res = await fetch(`/api/accounting/policies-premiums?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load policies");
      const data = await res.json();
      setAvailablePolicies(data.filter((r: PolicyPremiumRow) => r.premiumId !== null));
    } catch {
      toast.error("Failed to load policies");
    } finally {
      setLoadingPolicies(false);
    }
  }, [flowFilter]);

  const goToStep2 = () => {
    if (!entityName.trim()) {
      toast.error("Please enter an entity name");
      return;
    }
    setStep(2);
    void loadPolicies();
  };

  const togglePolicy = (row: PolicyPremiumRow) => {
    const key = `${row.policyId}-${row.lineKey}`;
    const exists = selectedItems.find((s) => `${s.policyId}-${s.lineKey}` === key);
    if (exists) {
      setSelectedItems((prev) => prev.filter((s) => `${s.policyId}-${s.lineKey}` !== key));
    } else {
      const field = PREMIUM_FIELD_MAP[premiumType];
      const cents = (row as any)[field] ?? 0;
      setSelectedItems((prev) => [
        ...prev,
        {
          policyId: row.policyId,
          policyNumber: row.policyNumber,
          premiumId: row.premiumId,
          lineKey: row.lineKey,
          amountCents: Math.abs(cents),
          description: `${row.policyNumber}${row.lineLabel ? ` - ${row.lineLabel}` : ""}`,
        },
      ]);
    }
  };

  const updateItemAmount = (idx: number, cents: number) => {
    setSelectedItems((prev) => prev.map((item, i) => (i === idx ? { ...item, amountCents: cents } : item)));
  };

  const totalCents = selectedItems.reduce((s, i) => s + i.amountCents, 0);

  const handleSubmit = async () => {
    if (selectedItems.length === 0) {
      toast.error("Please select at least one policy");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/accounting/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceType: "individual",
          direction,
          premiumType,
          entityType,
          entityName: entityName.trim(),
          currency: "HKD",
          invoiceDate: invoiceDate || null,
          dueDate: dueDate || null,
          notes: notes || null,
          items: selectedItems.map((item) => ({
            policyId: item.policyId,
            policyPremiumId: item.premiumId,
            lineKey: item.lineKey,
            amountCents: item.amountCents,
            description: item.description,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create invoice");
      }

      toast.success("Invoice created successfully");
      resetForm();
      onCreated();
    } catch (err: any) {
      toast.error(err.message || "Failed to create invoice");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setStep(1);
    setDirection("payable");
    setPremiumType("net_premium");
    setEntityType("collaborator");
    setEntityName("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setDueDate("");
    setNotes("");
    setFlowFilter("");
    setSelectedItems([]);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Create Invoice — Details" : "Create Invoice — Select Policies"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Direction</Label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as InvoiceDirection)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  <option value="payable">Payable (We Pay Out)</option>
                  <option value="receivable">Receivable (We Receive)</option>
                </select>
              </div>
              <div>
                <Label>Premium Type</Label>
                <select
                  value={premiumType}
                  onChange={(e) => setPremiumType(e.target.value as PremiumType)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  <option value="net_premium">Net Premium</option>
                  <option value="agent_premium">Agent Premium</option>
                  <option value="client_premium">Client Premium</option>
                </select>
              </div>
            </div>

            <div>
              <Label>
                {entityType === "collaborator" ? "Collaborator Name" : entityType === "agent" ? "Agent Name" : "Client Name"}
              </Label>
              <Input
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                placeholder={`Enter ${entityType} name...`}
                className="mt-1"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Invoice Date</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
              </div>
            </div>

            {flowOptions.length > 0 && (
              <div>
                <Label>Filter by Flow</Label>
                <select
                  value={flowFilter}
                  onChange={(e) => setFlowFilter(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  <option value="">All Flows</option>
                  {flowOptions.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <Label>Notes</Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {loadingPolicies ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
              </div>
            ) : availablePolicies.length === 0 ? (
              <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                No policies with premium data found.
              </div>
            ) : (
              <div className="max-h-[40vh] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-neutral-50 dark:bg-neutral-900">
                    <tr className="border-b border-neutral-200 dark:border-neutral-800">
                      <th className="w-8 p-2" />
                      <th className="p-2 text-left font-medium">Policy</th>
                      <th className="p-2 text-left font-medium">Line</th>
                      <th className="p-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availablePolicies.map((row) => {
                      const field = PREMIUM_FIELD_MAP[premiumType];
                      const cents = (row as any)[field] ?? 0;
                      const key = `${row.policyId}-${row.lineKey}`;
                      const isSelected = selectedItems.some((s) => `${s.policyId}-${s.lineKey}` === key);
                      return (
                        <tr
                          key={key}
                          className={`cursor-pointer border-b border-neutral-100 transition-colors dark:border-neutral-800 ${isSelected ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-50 dark:hover:bg-neutral-900"}`}
                          onClick={() => togglePolicy(row)}
                        >
                          <td className="p-2 text-center">
                            <input type="checkbox" checked={isSelected} readOnly className="h-4 w-4 rounded" />
                          </td>
                          <td className="p-2 font-medium">{row.policyNumber}</td>
                          <td className="p-2 text-neutral-600 dark:text-neutral-400">{row.lineLabel || row.lineKey || "—"}</td>
                          <td className="p-2 text-right tabular-nums">{fmtCurrency(cents, row.currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selectedItems.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Selected Items ({selectedItems.length})</h4>
                <div className="space-y-1">
                  {selectedItems.map((item, idx) => (
                    <div key={`${item.policyId}-${item.lineKey}`} className="flex items-center gap-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                      <span className="flex-1 text-sm">{item.description}</span>
                      <Input
                        type="number"
                        value={(item.amountCents / 100).toFixed(2)}
                        onChange={(e) => updateItemAmount(idx, Math.round(Number(e.target.value) * 100))}
                        className="w-28 text-right"
                        step="0.01"
                      />
                      <Button size="sm" variant="ghost" onClick={() => setSelectedItems((prev) => prev.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-md bg-neutral-100 p-2 text-sm font-semibold dark:bg-neutral-800">
                  <span>Total</span>
                  <span>{fmtCurrency(totalCents)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 2 && (
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
          )}
          {step === 1 ? (
            <Button onClick={goToStep2}>
              Next — Select Policies
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={saving || selectedItems.length === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Invoice
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
