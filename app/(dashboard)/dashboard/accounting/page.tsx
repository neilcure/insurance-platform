"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlinePaymentForm } from "@/components/ui/inline-payment-form";
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
  Eye,
  EyeOff,
  User,
  Briefcase,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import {
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  PREMIUM_TYPE_LABELS,
  DIRECTION_LABELS,
  type PaymentStatus,
  type InvoiceStatus,
  type InvoiceDirection,
  type PremiumType,
} from "@/lib/types/accounting";
import { usePagination } from "@/lib/pagination/use-pagination";
import { Pagination } from "@/components/ui/pagination";
import { confirmDialog, promptDialog, alertDialog } from "@/components/ui/global-dialogs";
import {
  classifyInvoice,
  getStableRecordId,
  getLatestLifecycleEntry,
  getOutstandingCents,
  shouldShowNotes,
  shouldShowClientPaidDirectlyBadge,
  CATEGORY_LABELS,
  CATEGORY_ACCENT,
  WARNING_LABELS,
  type InvoiceRow,
} from "./_lib/invoice-row-meta";

type DisplayColumn = {
  key: string;
  label: string;
  enabled: boolean;
};

type Stats = {
  receivable: {
    billedCents: number;
    collectedCents: number;
    outstandingCents: number;
    overpaidCents: number;
    recordCount: number;
  };
  payable: {
    billedCents: number;
    collectedCents: number;
    outstandingCents: number;
    overpaidCents: number;
    recordCount: number;
  };
  creditNote: {
    billedCents: number;
    collectedCents: number;
    outstandingCents: number;
    recordCount: number;
  };
  pendingPaymentCount: number;
  pendingVerification: number;
  overdue: number;
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

type FullInvoiceRow = InvoiceRow & {
  payments: PaymentRow[];
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

function invoiceStatusClass(status: InvoiceStatus | string): string {
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

type ScheduleSummary = {
  id: number;
  entityType: string;
  entityName: string | null;
  frequency: string;
  billingDay: number | null;
  isActive: boolean;
  lastGeneratedAt: string | null;
  lastPeriodStart: string | null;
  lastPeriodEnd: string | null;
};

const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  bimonthly: "Every 2 Months",
  quarterly: "Quarterly",
};

/**
 * Strip a tracking-key down to a short tag for the lifecycle strip.
 *   "motor_insurance_quotation"  → "QUOTATION"
 *   "motor_insurance_invoice"    → "INVOICE"
 *   "motor_insurance_debit_note" → "DEBIT NOTE"
 *   "motor_insurance_receipt"    → "RECEIPT"
 *
 * We keep the rule local so a new tracking-key naming convention
 * doesn't silently disappear from the UI — if no known suffix is
 * found we just upper-case the trailing word.
 */
function lifecycleTagFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes("quotation") || lower.includes("quote")) return "QUOTATION";
  if (lower.includes("debit_note") || lower.includes("debitnote")) return "DEBIT NOTE";
  if (lower.includes("credit_note") || lower.includes("creditnote")) return "CREDIT NOTE";
  if (lower.includes("receipt")) return "RECEIPT";
  if (lower.includes("statement")) return "STATEMENT";
  if (lower.includes("invoice")) return "INVOICE";
  if (lower.includes("endorsement")) return "ENDORSEMENT";
  // Fallback: use the trailing token after the last underscore, upper-cased.
  const parts = key.split(/[._]/g);
  return (parts[parts.length - 1] || key).toUpperCase();
}

export default function AccountingPage() {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [schedules, setSchedules] = React.useState<ScheduleSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expandedInvoice, setExpandedInvoice] = React.useState<number | null>(null);
  const [verifyingId, setVerifyingId] = React.useState<number | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [directionFilter, setDirectionFilter] = React.useState<"all" | InvoiceDirection>("all");
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showSettings, setShowSettings] = React.useState(false);
  const [displayColumns, setDisplayColumns] = React.useState<DisplayColumn[]>([]);
  const [savingCols, setSavingCols] = React.useState(false);

  // Server-side filter + pagination. Status and direction changes reset
  // the page to 0 automatically (handled by `usePagination` when params
  // change). The `excludeStatementType=1` flag pushes the "no statement
  // rows" filter to the server so the page count is accurate.
  const invoiceParams = React.useMemo(
    () => ({
      includePayments: 1,
      excludeStatementType: 1,
      status: statusFilter !== "all" ? statusFilter : undefined,
      direction: directionFilter !== "all" ? directionFilter : undefined,
      _t: refreshKey > 0 ? refreshKey : undefined,
    }),
    [statusFilter, directionFilter, refreshKey],
  );
  const {
    rows: invoices,
    total: invoicesTotal,
    page: invoicesPage,
    pageSize: invoicesPageSize,
    loading: invoicesLoading,
    setPage: setInvoicesPage,
    setPageSize: setInvoicesPageSize,
  } = usePagination<FullInvoiceRow>({
    url: "/api/accounting/invoices",
    scope: "accounting-invoices",
    params: invoiceParams,
  });

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
    fetch("/api/accounting/schedules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSchedules(Array.isArray(data) ? data.filter((s: ScheduleSummary) => s.isActive) : []))
      .catch(() => setSchedules([]));
  }, [refreshKey]);

  const handleVerify = async (invoiceId: number, paymentId: number, action: "verify" | "reject") => {
    let note: string | null = null;
    if (action === "reject") {
      // Native window.prompt is banned (.cursor/rules/no-native-dialogs);
      // route through the global lightbox helpers instead.
      const reason = await promptDialog({
        title: "Reject payment?",
        description: "Optional reason — shown to whoever submitted the payment.",
        placeholder: "e.g. amount didn't match invoice",
        confirmLabel: "Reject",
        cancelLabel: "Keep submitted",
      });
      if (reason === null) return;
      note = reason.trim() || null;
    } else {
      const ok = await confirmDialog({
        title: "Verify payment?",
        description: "This marks the payment as verified and counts it toward the invoice.",
        confirmLabel: "Verify",
      });
      if (!ok) return;
    }

    setVerifyingId(paymentId);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          action,
          rejectionNote: action === "reject" ? note : null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed");
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      await alertDialog({
        title: "Verification failed",
        description: (err as Error).message,
      });
    } finally {
      setVerifyingId(null);
    }
  };

  const methodLabel = (m: string | null) =>
    PAYMENT_METHOD_OPTIONS.find((o) => o.value === m)?.label ?? m ?? "—";

  // Pending payments are derived from the current page so the user can
  // verify / reject them. This intentionally only covers what the page
  // is showing — the headline "Pending Review" card uses an org-scoped
  // server count for the full picture. Keeping the two in sync on
  // refresh is the user's expectation.
  const pendingPayments = React.useMemo(() => {
    const result: { invoice: FullInvoiceRow; payment: PaymentRow }[] = [];
    for (const inv of invoices) {
      for (const p of inv.payments ?? []) {
        if (p.status === "submitted") {
          result.push({ invoice: inv, payment: p });
        }
      }
    }
    return result;
  }, [invoices]);

  // Group rows by their `groupPolicyId` so a parent policy and all of
  // its endorsements + their commission payables render as ONE related
  // cluster instead of being scattered across the list. Within each
  // group, rows are ordered by their underlying `policyId` (parent
  // first), then `createdAt` (oldest first) so the lifecycle reads
  // top-to-bottom.
  const groupedInvoices = React.useMemo(() => {
    const map = new Map<string, { groupId: number | null; rows: FullInvoiceRow[]; parentPolicyNumber: string | null }>();
    for (const inv of invoices) {
      const key = inv.groupPolicyId === null
        ? `__unlinked__${inv.id}`
        : `g${inv.groupPolicyId}`;
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(inv);
      } else {
        map.set(key, {
          groupId: inv.groupPolicyId,
          rows: [inv],
          parentPolicyNumber:
            inv.groupPolicyId === inv.policyId
              ? inv.policyNumber
              : inv.parentPolicyNumber ?? inv.policyNumber,
        });
      }
    }
    for (const v of map.values()) {
      v.rows.sort((a, b) => {
        const ap = a.policyId ?? 0;
        const bp = b.policyId ?? 0;
        if (ap !== bp) return ap - bp;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    }
    return Array.from(map.values());
  }, [invoices]);

  const directionTone = (direction: InvoiceDirection): string =>
    direction === "receivable"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
      : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Accounting</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Display</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {showSettings && displayColumns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Record Display Settings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-neutral-500 mb-3">
              Choose which fields appear on each accounting record. Changes save automatically.
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

      {/* Stats cards
          Receivable / Payable are computed in the API as direction-specific
          (one money flow per card, never mixed). Each card uses the SAME
          row counted exactly once across its lifecycle (quotation → debit
          note → receipt do NOT inflate the count — they're the same record).
          See `/api/accounting/stats` for the SQL contract. */}
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
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Outstanding (Receivable)"
              value={formatCurrency(stats.receivable.outstandingCents)}
              subtitle={`${stats.receivable.recordCount} record${stats.receivable.recordCount !== 1 ? "s" : ""} · ${formatCurrency(stats.receivable.billedCents)} billed`}
              icon={Clock}
              iconColor="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
            />
            <StatCard
              title="Collected (Receivable)"
              value={formatCurrency(stats.receivable.collectedCents)}
              subtitle="Lifetime, capped per record"
              icon={CheckCircle2}
              iconColor="bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400"
            />
            <StatCard
              title="Outstanding (Payable)"
              value={formatCurrency(stats.payable.outstandingCents)}
              subtitle={`${stats.payable.recordCount} record${stats.payable.recordCount !== 1 ? "s" : ""}`}
              icon={DollarSign}
              iconColor="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
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

          {/* Data integrity strip — shown only when something is actually
              broken so the user notices when a record's paid > total or
              there's an open credit-note balance. Each value is computed
              by the same per-row clamps the cards use, so it can never
              silently distort the headline numbers. */}
          {(stats.receivable.overpaidCents > 0 ||
            stats.payable.overpaidCents > 0 ||
            stats.creditNote.outstandingCents > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/20">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-amber-800 dark:text-amber-200">Data integrity</span>
              {stats.receivable.overpaidCents > 0 && (
                <Badge variant="custom" className="bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                  {formatCurrency(stats.receivable.overpaidCents)} overpaid (receivable)
                </Badge>
              )}
              {stats.payable.overpaidCents > 0 && (
                <Badge variant="custom" className="bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                  {formatCurrency(stats.payable.overpaidCents)} overpaid (payable)
                </Badge>
              )}
              {stats.creditNote.outstandingCents > 0 && (
                <Badge variant="custom" className="bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
                  {formatCurrency(stats.creditNote.outstandingCents)} owed back (credit notes)
                </Badge>
              )}
            </div>
          )}
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
              {pendingPayments.map(({ invoice: inv, payment: p }) => {
                const recordId = getStableRecordId(inv);
                return (
                  <div
                    key={p.id}
                    className="rounded-md border border-neutral-200 dark:border-neutral-700 p-3 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-sm font-medium">{formatCurrency(p.amountCents, p.currency)}</div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-500">
                          <span>{methodLabel(p.paymentMethod)}</span>
                          {p.referenceNumber && (
                            <>
                              <span className="text-neutral-300 dark:text-neutral-600">·</span>
                              <span className="truncate max-w-[120px]">Ref: {p.referenceNumber}</span>
                            </>
                          )}
                          {p.paymentDate && (
                            <>
                              <span className="text-neutral-300 dark:text-neutral-600">·</span>
                              <span>{new Date(p.paymentDate).toLocaleDateString()}</span>
                            </>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-neutral-400">
                          <span className="font-mono">Record {recordId.primary}</span>
                          {inv.clientName && (
                            <>
                              <span className="text-neutral-300 dark:text-neutral-600">·</span>
                              <span>{inv.clientName}</span>
                            </>
                          )}
                          {inv.policyNumber && (
                            <>
                              <span className="text-neutral-300 dark:text-neutral-600">·</span>
                              <span className="font-mono">{inv.policyNumber}</span>
                            </>
                          )}
                        </div>
                        {p.notes && <div className="text-[11px] text-neutral-400 italic wrap-break-word">{p.notes}</div>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-green-600 hover:bg-green-50 hover:text-green-700"
                          disabled={verifyingId === p.id}
                          onClick={() => handleVerify(inv.id, p.id, "verify")}
                          title="Verify payment"
                        >
                          <Check className="h-3.5 w-3.5 sm:hidden lg:inline" />
                          <span className="hidden sm:inline">Verify</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={verifyingId === p.id}
                          onClick={() => handleVerify(inv.id, p.id, "reject")}
                          title="Reject payment"
                        >
                          <X className="h-3.5 w-3.5 sm:hidden lg:inline" />
                          <span className="hidden sm:inline">Reject</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Records list — replaces the old "All Invoices". Each card is
          ONE accounting record (one row in `accounting_invoices`). If
          the same record received a quotation, then an invoice, then a
          debit note, then a receipt — it shows ONCE here, with the
          documents listed in its lifecycle strip. The invoiceNumber is
          NOT used as the record's identity (that rotated as templates
          were sent), the lifecycle setCode is. */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Accounting Records</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value as "all" | InvoiceDirection)}
                aria-label="Filter by direction"
              >
                <option value="all">All Directions</option>
                <option value="receivable">{DIRECTION_LABELS.receivable}</option>
                <option value="payable">{DIRECTION_LABELS.payable}</option>
              </select>
              <select
                className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
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
            <div className="py-8 text-center text-sm text-neutral-400">Loading records...</div>
          ) : invoices.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-400">
              {statusFilter === "all" && directionFilter === "all"
                ? "No accounting records found."
                : `No matching records for the selected filters.`}
            </div>
          ) : (
            <div className="space-y-4">
              {groupedInvoices.map((group) => (
                <div key={group.groupId ?? `unlinked-${group.rows[0]?.id}`} className="space-y-2">
                  {/* Group header — only render when the group has more
                      than one record OR the row IS an endorsement, so a
                      lone parent receivable doesn't get a redundant
                      header. */}
                  {(group.rows.length > 1 || group.rows.some((r) => r.isEndorsement)) && group.parentPolicyNumber && (
                    <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 pl-1">
                      <FileText className="h-3.5 w-3.5" />
                      <span>Policy</span>
                      <span className="font-mono font-medium text-neutral-700 dark:text-neutral-300">{group.parentPolicyNumber}</span>
                      <span className="text-neutral-300 dark:text-neutral-600">·</span>
                      <span>{group.rows.length} record{group.rows.length !== 1 ? "s" : ""}</span>
                    </div>
                  )}

                  {group.rows.map((inv) => {
                    const isExpanded = expandedInvoice === inv.id;
                    const remaining = getOutstandingCents(inv);
                    const category = classifyInvoice(inv);
                    const recordId = getStableRecordId(inv);
                    const latestEntry = getLatestLifecycleEntry(inv);

                    return (
                      <div
                        key={inv.id}
                        className={`rounded-md border overflow-hidden ${
                          inv.isEndorsement
                            ? "border-neutral-200 dark:border-neutral-700 ml-3 sm:ml-6"
                            : "border-neutral-200 dark:border-neutral-700"
                        }`}
                      >
                        {/* Collapsed header */}
                        <button
                          type="button"
                          onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
                          className="w-full text-left px-3.5 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                              <FileText className="h-4 w-4 shrink-0 text-neutral-400" />
                              {/* Stable record id — the headline does NOT
                                  rotate as the latest template changes.
                                  The latest document is shown as a tag
                                  next to it (lifecycle), not as the
                                  record's identity. */}
                              <span className="font-mono text-sm font-semibold">Record {recordId.primary}</span>
                              <Badge variant="custom" className={`shrink-0 ${CATEGORY_ACCENT[category]}`}>
                                {CATEGORY_LABELS[category]}
                              </Badge>
                              <Badge variant="custom" className={`shrink-0 ${invoiceStatusClass(inv.status)}`}>
                                {INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status}
                              </Badge>
                              {isColEnabled("direction") && (
                                <Badge variant="custom" className={`shrink-0 ${directionTone(inv.direction)}`}>
                                  {inv.direction === "receivable" ? "Receivable" : "Payable"}
                                </Badge>
                              )}
                              {inv.isEndorsement && (
                                <Badge variant="custom" className="shrink-0 bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                                  Endorsement
                                </Badge>
                              )}
                              {/* "Client paid directly" — when the client
                                  paid admin directly (not through the
                                  agent), the receivable's `paid > total`
                                  is BY DESIGN: the receivable total is
                                  `agentPremium` and the client paid
                                  `clientPremium`. The difference is on
                                  the AP-… commission payable row, NOT
                                  duplicated here. Per
                                  `.cursor/rules/insurance-platform-architecture.mdc`
                                  "Payment paths (who pays admin)". */}
                              {shouldShowClientPaidDirectlyBadge(inv) && (
                                <Badge
                                  variant="custom"
                                  className="shrink-0 bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800"
                                  title="Client paid admin directly. The agent commission is materialised on a separate payable (AP-…) row."
                                >
                                  Client paid directly
                                </Badge>
                              )}
                              {inv.warnings.map((w) => (
                                <Badge
                                  key={w}
                                  variant="custom"
                                  className={`shrink-0 ${
                                    WARNING_LABELS[w].tone === "danger"
                                      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                                      : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                                  }`}
                                  title={WARNING_LABELS[w].title}
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  {w.replace(/_/g, " ")}
                                </Badge>
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                              <span className="text-[11px] font-medium whitespace-nowrap">
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

                          {/* Subtitle row */}
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
                            {isColEnabled("notes") && shouldShowNotes(inv, category) && (
                              <span className="italic truncate max-w-[200px]">{inv.notes}</span>
                            )}
                            {/* Latest lifecycle document — replaces the
                                old quotationNo / receiptNo pair. The
                                full lifecycle is in the expanded view. */}
                            {latestEntry && (
                              <span className="text-[10px] font-mono bg-neutral-100 dark:bg-neutral-800 rounded px-1 py-0.5">
                                {lifecycleTagFromKey(latestEntry.trackingKey)}: {latestEntry.documentNumber}
                              </span>
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t border-neutral-200 dark:border-neutral-700 px-3.5 py-3 space-y-3">
                            {shouldShowClientPaidDirectlyBadge(inv) && (
                              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                                <div className="font-medium">Client paid admin directly</div>
                                <div className="mt-0.5">
                                  Receivable total is the agent net premium; the client paid the full client premium, so paid &gt; total is by design. The agent commission ({" "}
                                  <span className="font-mono">clientPremium − agentPremium</span>
                                  {" "}) is materialised on a separate payable (AP-…) row — it is NOT counted twice.
                                </div>
                              </div>
                            )}
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
                                  <div className="font-medium">{PREMIUM_TYPE_LABELS[inv.premiumType as PremiumType] ?? inv.premiumType.replace(/_/g, " ")}</div>
                                </div>
                              )}
                              {isColEnabled("remaining") && (
                                <div>
                                  <div className="text-neutral-400">Outstanding</div>
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

                            {/* Lifecycle strip — the chronological list
                                of every document generated for THIS
                                record (filtered by setCode so a
                                policy's invoice/credit-note/etc. don't
                                share each other's lifecycle entries). */}
                            {inv.documentLifecycle.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-neutral-500 mb-1.5">
                                  Document Lifecycle
                                </div>
                                <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
                                  {inv.documentLifecycle.map((entry, i) => {
                                    const isLatest = i === inv.documentLifecycle.length - 1;
                                    return (
                                      <li key={`${entry.trackingKey}-${entry.documentNumber}`} className="flex items-center gap-1">
                                        <span
                                          className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono ${
                                            isLatest
                                              ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
                                              : "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-300"
                                          }`}
                                          title={entry.timestamp ?? undefined}
                                        >
                                          <span className="text-[9px] font-semibold opacity-70">
                                            {lifecycleTagFromKey(entry.trackingKey)}
                                          </span>
                                          <span>{entry.documentNumber}</span>
                                          {entry.status && (
                                            <span className="text-[9px] uppercase opacity-60">
                                              {entry.status}
                                            </span>
                                          )}
                                        </span>
                                        {i < inv.documentLifecycle.length - 1 && (
                                          <ArrowRight className="h-3 w-3 text-neutral-400" />
                                        )}
                                      </li>
                                    );
                                  })}
                                </ol>
                                <p className="mt-1.5 text-[10px] text-neutral-400">
                                  All of the above are documents for THIS one record. They are not separate accounting entries.
                                </p>
                              </div>
                            )}

                            {/* Fallback: legacy documentNumbers map for
                                rows whose lifecycle couldn't be derived
                                (no setCode in invoiceNumber). Helps
                                surface data for older auto-created
                                rows without re-introducing the rotating
                                identity bug. */}
                            {inv.documentLifecycle.length === 0 &&
                              inv.documentNumbers &&
                              Object.keys(inv.documentNumbers).length > 0 && (
                                <div>
                                  <div className="text-xs font-medium text-neutral-500 mb-1">Related Document Numbers</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(inv.documentNumbers).map(([key, num]) => (
                                      <span
                                        key={key}
                                        className="inline-flex items-center gap-1 rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[11px] font-mono"
                                      >
                                        <span className="text-neutral-400 capitalize">{lifecycleTagFromKey(key)}:</span>
                                        <span className="font-medium">{num}</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                            )}

                            {shouldShowNotes(inv, category) && (
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
                                        {p.referenceNumber && <> · Ref: {p.referenceNumber}</>}
                                        {p.paymentDate && <> · {new Date(p.paymentDate).toLocaleDateString()}</>}
                                      </div>
                                      {p.notes && <div className="text-neutral-400 italic">{p.notes}</div>}
                                      {p.rejectionNote && (
                                        <div className="text-red-600 dark:text-red-400">Rejected: {p.rejectionNote}</div>
                                      )}
                                    </div>
                                    {p.status === "submitted" && (
                                      <div className="flex flex-wrap items-center gap-1 shrink-0">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 px-2 text-green-600 hover:bg-green-50"
                                          disabled={verifyingId === p.id}
                                          onClick={() => handleVerify(inv.id, p.id, "verify")}
                                          title="Verify payment"
                                        >
                                          <Check className="h-3.5 w-3.5 sm:hidden lg:inline" />
                                          <span className="hidden sm:inline">Verify</span>
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 px-2 text-red-600 hover:bg-red-50"
                                          disabled={verifyingId === p.id}
                                          onClick={() => handleVerify(inv.id, p.id, "reject")}
                                          title="Reject payment"
                                        >
                                          <X className="h-3.5 w-3.5 sm:hidden lg:inline" />
                                          <span className="hidden sm:inline">Reject</span>
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

                            {/* Record Payment — only when actually
                                actionable. Statement-bundled rows
                                (status='statement_created') are filtered
                                out by the architecture rule "NEVER
                                record payments on statement-type
                                invoices". */}
                            {remaining > 0 && inv.status !== "statement_created" && (
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
                </div>
              ))}
            </div>
          )}
          <Pagination
            page={invoicesPage}
            pageSize={invoicesPageSize}
            total={invoicesTotal}
            loading={invoicesLoading}
            onPageChange={setInvoicesPage}
            onPageSizeChange={setInvoicesPageSize}
            itemNoun={invoicesTotal === 1 ? "record" : "records"}
          />
        </CardContent>
      </Card>
      {schedules.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              Active Payment Schedules
              <Badge variant="custom" className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                {schedules.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 dark:border-neutral-700 p-2.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {s.entityType === "client" ? (
                      <User className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                    ) : (
                      <Briefcase className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium truncate">{s.entityName || `${s.entityType} #${s.id}`}</div>
                      <div className="text-neutral-500 dark:text-neutral-400">
                        {FREQ_LABELS[s.frequency] ?? s.frequency}
                        {s.billingDay ? ` · Day ${s.billingDay}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-neutral-500 dark:text-neutral-400">
                    {s.lastGeneratedAt ? (
                      <div>Last: {new Date(s.lastGeneratedAt).toLocaleDateString()}</div>
                    ) : (
                      <div>Never generated</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
