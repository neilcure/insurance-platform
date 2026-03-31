"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  AlertCircle,
  Clock,
  CheckCircle2,
  FileText,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  RefreshCw,
  Settings2,
  GripVertical,
  Eye,
  EyeOff,
  User,
  Briefcase,
} from "lucide-react";
import {
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  type PaymentStatus,
  type InvoiceStatus,
} from "@/lib/types/accounting";

type DisplayColumn = {
  key: string;
  label: string;
  enabled: boolean;
};

type Stats = {
  pendingVerification: number;
  overdue: number;
  totalReceivableCents: number;
  totalPaidCents: number;
  totalOutstandingCents: number;
  receivableCount: number;
  pendingPaymentCount: number;
  invoicesByStatus: Record<string, { count: number; totalCents: number }>;
};

type PaymentRow = {
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
  rejectionNote: string | null;
  createdAt: string;
};

type InvoiceRow = {
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
  payments: PaymentRow[];
  policyNumber: string | null;
  clientName: string | null;
  agentName: string | null;
  documentNumbers: Record<string, string> | null;
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
    default:
      return "bg-neutral-100 text-neutral-600";
  }
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  iconColor: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-1.5">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{title}</div>
          <div className={`shrink-0 rounded-md p-1.5 ${iconColor}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        </div>
        <div className="mt-1.5 text-lg font-bold">{value}</div>
        {subtitle && (
          <div className="text-[11px] text-neutral-400">{subtitle}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountingPage() {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [invoices, setInvoices] = React.useState<InvoiceRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [invoicesLoading, setInvoicesLoading] = React.useState(true);
  const [expandedInvoice, setExpandedInvoice] = React.useState<number | null>(null);
  const [verifyingId, setVerifyingId] = React.useState<number | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showSettings, setShowSettings] = React.useState(false);
  const [displayColumns, setDisplayColumns] = React.useState<DisplayColumn[]>([]);
  const [savingCols, setSavingCols] = React.useState(false);

  // Load display column settings
  React.useEffect(() => {
    fetch("/api/admin/accounting-display")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.columns) setDisplayColumns(data.columns); })
      .catch(() => {});
  }, []);

  const isColEnabled = React.useCallback(
    (key: string) => {
      const col = displayColumns.find((c) => c.key === key);
      return col ? col.enabled : true;
    },
    [displayColumns],
  );

  const saveColumns = async (cols: DisplayColumn[]) => {
    setSavingCols(true);
    try {
      await fetch("/api/admin/accounting-display", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: cols }),
      });
      setDisplayColumns(cols);
    } catch { /* silent */ }
    setSavingCols(false);
  };

  const toggleColumn = (key: string) => {
    const updated = displayColumns.map((c) =>
      c.key === key ? { ...c, enabled: !c.enabled } : c,
    );
    setDisplayColumns(updated);
    void saveColumns(updated);
  };

  React.useEffect(() => {
    fetch(`/api/accounting/stats?_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setStats(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  React.useEffect(() => {
    setInvoicesLoading(true);
    fetch(`/api/accounting/invoices?includePayments=1&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setInvoices(Array.isArray(data) ? data : []))
      .catch(() => setInvoices([]))
      .finally(() => setInvoicesLoading(false));
  }, [refreshKey]);

  const handleVerify = async (invoiceId: number, paymentId: number, action: "verify" | "reject") => {
    const note = action === "reject" ? prompt("Rejection reason (optional):") : null;
    if (action === "reject" && note === null) return;

    setVerifyingId(paymentId);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          action,
          rejectionNote: action === "reject" ? (note?.trim() || null) : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed");
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setVerifyingId(null);
    }
  };

  const methodLabel = (m: string | null) =>
    PAYMENT_METHOD_OPTIONS.find((o) => o.value === m)?.label ?? m ?? "—";

  const filtered = React.useMemo(() => {
    if (statusFilter === "all") return invoices;
    return invoices.filter((inv) => inv.status === statusFilter);
  }, [invoices, statusFilter]);

  const pendingPayments = React.useMemo(() => {
    const result: { invoice: InvoiceRow; payment: PaymentRow }[] = [];
    for (const inv of invoices) {
      for (const p of inv.payments ?? []) {
        if (p.status === "submitted") {
          result.push({ invoice: inv, payment: p });
        }
      }
    }
    return result;
  }, [invoices]);

  // Extract specific doc numbers from the documentNumbers map
  function getDocNumber(inv: InvoiceRow, prefix: string): string | null {
    if (!inv.documentNumbers) return null;
    for (const [, num] of Object.entries(inv.documentNumbers)) {
      if (typeof num === "string" && num.toUpperCase().startsWith(prefix.toUpperCase())) return num;
    }
    return null;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounting</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="h-4 w-4 mr-1" />
            Display
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Display column settings panel */}
      {showSettings && displayColumns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Invoice Display Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-neutral-500 mb-3">
              Choose which fields appear on each invoice card. Changes save automatically.
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
              {displayColumns.map((col) => (
                <button
                  key={col.key}
                  type="button"
                  onClick={() => toggleColumn(col.key)}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    col.enabled
                      ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                      : "border-neutral-200 text-neutral-400 dark:border-neutral-700 dark:text-neutral-500"
                  }`}
                >
                  {col.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {col.label}
                </button>
              ))}
            </div>
            {savingCols && <p className="mt-2 text-[10px] text-neutral-400">Saving...</p>}
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <div className="h-16 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Receivable"
            value={formatCurrency(stats.totalReceivableCents)}
            subtitle={`${stats.receivableCount} invoice${stats.receivableCount !== 1 ? "s" : ""}`}
            icon={DollarSign}
            iconColor="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
          />
          <StatCard
            title="Total Collected"
            value={formatCurrency(stats.totalPaidCents)}
            icon={CheckCircle2}
            iconColor="bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400"
          />
          <StatCard
            title="Outstanding"
            value={formatCurrency(stats.totalOutstandingCents)}
            icon={Clock}
            iconColor="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
          />
          <StatCard
            title="Pending Review"
            value={String(stats.pendingPaymentCount)}
            subtitle={stats.overdue > 0 ? `${stats.overdue} overdue` : undefined}
            icon={AlertCircle}
            iconColor={stats.pendingPaymentCount > 0
              ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400"
              : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
            }
          />
        </div>
      ) : null}

      {/* Pending payments requiring review */}
      {pendingPayments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              Payments Pending Review
              <Badge variant="custom" className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                {pendingPayments.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingPayments.map(({ invoice: inv, payment: p }) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 dark:border-neutral-700 p-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{formatCurrency(p.amountCents, p.currency)}</span>
                      <span className="text-neutral-400">&middot;</span>
                      <span className="text-neutral-500">{methodLabel(p.paymentMethod)}</span>
                      {p.referenceNumber && (
                        <>
                          <span className="text-neutral-400">&middot;</span>
                          <span className="text-neutral-500">Ref: {p.referenceNumber}</span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-neutral-400">
                      Invoice: {inv.invoiceNumber}
                      {inv.clientName && <> &middot; {inv.clientName}</>}
                      {inv.policyNumber && <> &middot; {inv.policyNumber}</>}
                      {p.paymentDate && <> &middot; {new Date(p.paymentDate).toLocaleDateString()}</>}
                    </div>
                    {p.notes && <div className="text-xs text-neutral-400 italic">{p.notes}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-3 text-green-600 hover:bg-green-50 hover:text-green-700"
                      disabled={verifyingId === p.id}
                      onClick={() => handleVerify(inv.id, p.id, "verify")}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Verify
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-3 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={verifyingId === p.id}
                      onClick={() => handleVerify(inv.id, p.id, "reject")}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoice list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-base">All Invoices</CardTitle>
            <div className="flex items-center gap-2">
              <select
                className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                {Object.entries(INVOICE_STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <div className="py-8 text-center text-sm text-neutral-400">Loading invoices...</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-400">
              {statusFilter === "all" ? "No invoices found." : `No ${INVOICE_STATUS_LABELS[statusFilter as InvoiceStatus] ?? statusFilter} invoices.`}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((inv) => {
                const isExpanded = expandedInvoice === inv.id;
                const remaining = inv.totalAmountCents - inv.paidAmountCents;
                const quotationNo = getDocNumber(inv, "QUO") || getDocNumber(inv, "HIDIQUO");
                const receiptNo = getDocNumber(inv, "REC");

                return (
                  <div key={inv.id} className="rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                    {/* Collapsed header */}
                    <button
                      type="button"
                      onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                          {isColEnabled("invoiceNumber") && (
                            <span className="font-semibold text-sm truncate">{inv.invoiceNumber}</span>
                          )}
                          <Badge variant="custom" className={invoiceStatusClass(inv.status)}>
                            {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                          </Badge>
                          {isColEnabled("direction") && (
                            <Badge variant="custom" className={
                              inv.direction === "receivable"
                                ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                                : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            }>
                              {inv.direction === "receivable" ? "Receivable" : "Payable"}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-medium">
                            <span className="text-neutral-400">{formatCurrency(inv.paidAmountCents, inv.currency)}</span>
                            <span className="text-neutral-300 mx-0.5">/</span>
                            <span className="font-semibold">{formatCurrency(inv.totalAmountCents, inv.currency)}</span>
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-neutral-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-neutral-400" />
                          )}
                        </div>
                      </div>

                      {/* Subtitle row with key info */}
                      <div className="flex items-center gap-x-3 gap-y-0.5 mt-1 flex-wrap text-xs text-neutral-500 dark:text-neutral-400">
                        {isColEnabled("clientName") && inv.clientName && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {inv.clientName}
                          </span>
                        )}
                        {isColEnabled("policyNumber") && inv.policyNumber && (
                          <span className="font-mono text-[11px] text-neutral-400">{inv.policyNumber}</span>
                        )}
                        {isColEnabled("agentName") && inv.agentName && (
                          <span className="flex items-center gap-1">
                            <Briefcase className="h-3 w-3" />
                            {inv.agentName}
                          </span>
                        )}
                        {isColEnabled("notes") && inv.notes && (
                          <span className="italic truncate max-w-[200px]">{inv.notes}</span>
                        )}
                        {isColEnabled("quotationNo") && quotationNo && (
                          <span className="text-[10px] font-mono bg-neutral-100 dark:bg-neutral-800 rounded px-1 py-0.5">{quotationNo}</span>
                        )}
                        {isColEnabled("receiptNo") && receiptNo && (
                          <span className="text-[10px] font-mono bg-green-100 dark:bg-green-900/30 rounded px-1 py-0.5 text-green-700 dark:text-green-400">{receiptNo}</span>
                        )}
                      </div>
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-neutral-200 dark:border-neutral-700 px-3.5 py-3 space-y-3">
                        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                          {isColEnabled("entityType") && (
                            <div>
                              <div className="text-neutral-400">Entity Type</div>
                              <div className="font-medium capitalize">{inv.entityType}</div>
                            </div>
                          )}
                          {isColEnabled("premiumType") && (
                            <div>
                              <div className="text-neutral-400">Premium Type</div>
                              <div className="font-medium">{inv.premiumType.replace(/_/g, " ")}</div>
                            </div>
                          )}
                          {isColEnabled("remaining") && (
                            <div>
                              <div className="text-neutral-400">Remaining</div>
                              <div className={`font-medium ${remaining > 0 ? "text-orange-600" : "text-green-600"}`}>
                                {formatCurrency(remaining, inv.currency)}
                              </div>
                            </div>
                          )}
                          {isColEnabled("invoiceDate") && (
                            <div>
                              <div className="text-neutral-400">Invoice Date</div>
                              <div className="font-medium">
                                {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : "—"}
                              </div>
                            </div>
                          )}
                          {isColEnabled("dueDate") && (
                            <div>
                              <div className="text-neutral-400">Due Date</div>
                              <div className="font-medium">
                                {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}
                              </div>
                            </div>
                          )}
                          {isColEnabled("policyNumber") && inv.policyNumber && (
                            <div>
                              <div className="text-neutral-400">Policy No.</div>
                              <div className="font-medium font-mono">{inv.policyNumber}</div>
                            </div>
                          )}
                          {isColEnabled("clientName") && inv.clientName && (
                            <div>
                              <div className="text-neutral-400">Client</div>
                              <div className="font-medium">{inv.clientName}</div>
                            </div>
                          )}
                          {isColEnabled("agentName") && inv.agentName && (
                            <div>
                              <div className="text-neutral-400">Agent</div>
                              <div className="font-medium">{inv.agentName}</div>
                            </div>
                          )}
                        </div>

                        {/* Document numbers */}
                        {inv.documentNumbers && Object.keys(inv.documentNumbers).length > 0 && (
                          <div>
                            <div className="text-xs font-medium text-neutral-500 mb-1">Document Numbers</div>
                            <div className="flex flex-wrap gap-1.5">
                              {Object.entries(inv.documentNumbers).map(([key, num]) => (
                                <span
                                  key={key}
                                  className="inline-flex items-center gap-1 rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[11px] font-mono"
                                >
                                  <span className="text-neutral-400 capitalize">{key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")}:</span>
                                  <span className="font-medium">{num}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Notes */}
                        {inv.notes && (
                          <div className="text-xs text-neutral-500 italic bg-neutral-50 dark:bg-neutral-800/30 rounded-md px-2.5 py-1.5">
                            {inv.notes}
                          </div>
                        )}

                        {inv.payments && inv.payments.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="text-xs font-medium text-neutral-500">Payments ({inv.payments.length})</div>
                            {inv.payments.map((p) => (
                              <div
                                key={p.id}
                                className="flex items-start justify-between gap-2 rounded-md border border-neutral-100 dark:border-neutral-700 p-2 text-xs"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium">{formatCurrency(p.amountCents, p.currency)}</span>
                                    <Badge variant="custom" className={statusBadgeClass(p.status)}>
                                      {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                                    </Badge>
                                  </div>
                                  <div className="text-neutral-500">
                                    {methodLabel(p.paymentMethod)}
                                    {p.referenceNumber && <> &middot; Ref: {p.referenceNumber}</>}
                                    {p.paymentDate && <> &middot; {new Date(p.paymentDate).toLocaleDateString()}</>}
                                  </div>
                                  {p.notes && <div className="text-neutral-400 italic">{p.notes}</div>}
                                  {p.rejectionNote && (
                                    <div className="text-red-600 dark:text-red-400">Rejected: {p.rejectionNote}</div>
                                  )}
                                </div>
                                {p.status === "submitted" && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-green-600 hover:bg-green-50"
                                      disabled={verifyingId === p.id}
                                      onClick={() => handleVerify(inv.id, p.id, "verify")}
                                    >
                                      <Check className="h-3.5 w-3.5 mr-0.5" /> Verify
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-red-600 hover:bg-red-50"
                                      disabled={verifyingId === p.id}
                                      onClick={() => handleVerify(inv.id, p.id, "reject")}
                                    >
                                      <X className="h-3.5 w-3.5 mr-0.5" /> Reject
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {(!inv.payments || inv.payments.length === 0) && (
                          <div className="text-xs text-neutral-400">No payments recorded yet.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
