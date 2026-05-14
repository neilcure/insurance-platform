"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlinePaymentForm } from "@/components/ui/inline-payment-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import {
  DollarSign,
  AlertCircle,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
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
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
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
  tooltip,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  iconColor: string;
  // Hover-only explainer surfaced as a native `title` so the
  // card stays compact but a confused user can hover any of the
  // money cards to read what it means and why a value of 0 is
  // (or isn't) suspicious. Avoids the "what does Outstanding
  // (Payable) mean and why is it 0 when I have an unpaid
  // client invoice?" support ticket.
  tooltip?: string;
}) {
  return (
    <Card className="overflow-hidden" title={tooltip}>
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
  const t = useT();
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [schedules, setSchedules] = React.useState<ScheduleSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expandedInvoice, setExpandedInvoice] = React.useState<number | null>(null);
  const [verifyingId, setVerifyingId] = React.useState<number | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [directionFilter, setDirectionFilter] = React.useState<"all" | InvoiceDirection>("all");
  // Ledger-tab filter. Splits the Accounting page into one ledger at
  // a time (Client Premium / Agent Settlement / Agent Commission /
  // Credit Notes / Statements). `all` = everything, mirroring the
  // previous mixed view. Client-side only — categories are derived
  // from `classifyInvoice` on the row, not a server column.
  type LedgerTab = "all" | "client_receivable" | "agent_receivable" | "agent_commission_payable" | "credit_note" | "statement_bundle";
  const [ledgerTab, setLedgerTab] = React.useState<LedgerTab>("client_receivable");
  // Orphan rows (orphan_no_policy warning) are typically ghost rows
  // from quotes that never became policies, or agent settlements
  // whose parent policy was paid via client-direct so the agent has
  // nothing to settle. They have no policy link, no plate, no
  // counterparty context — so by default we hide them. Toggle to
  // OFF if you actually want to investigate / clean them up.
  const [hideOrphans, setHideOrphans] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [showSettings, setShowSettings] = React.useState(false);
  // Seed with the same defaults the API returns so the table has
  // its normal columns on first paint — without this, the table
  // would briefly flash with no data columns (only the Expand
  // chevron) before the GET /api/admin/accounting-display response
  // lands. Once the API returns the user's saved choice it
  // replaces this seed.
  const [displayColumns, setDisplayColumns] = React.useState<DisplayColumn[]>(() => [
    { key: "invoiceDate", label: "Date", enabled: true },
    { key: "invoiceNumber", label: "Document", enabled: true },
    { key: "type", label: "Type", enabled: true },
    { key: "insuredName", label: "Insured", enabled: true },
    { key: "plate", label: "Vehicle Plate", enabled: true },
    { key: "agentName", label: "Agent", enabled: false },
    { key: "clientName", label: "Client Name", enabled: false },
    { key: "policyNumber", label: "Policy", enabled: true },
    { key: "direction", label: "Direction", enabled: false },
    { key: "entityType", label: "Entity Type", enabled: false },
    { key: "premiumType", label: "Premium Type", enabled: false },
    { key: "notes", label: "Notes", enabled: false },
    { key: "quotationNo", label: "Quotation No.", enabled: false },
    { key: "receiptNo", label: "Receipt No.", enabled: false },
    { key: "dueDate", label: "Due Date", enabled: false },
    { key: "remaining", label: "Outstanding", enabled: true },
    { key: "total", label: "Total", enabled: true },
    { key: "status", label: "Status", enabled: true },
  ]);
  const [savingCols, setSavingCols] = React.useState(false);

  // Month-year tab filter. Selecting a month constrains BOTH the
  // stat cards AND the records list to invoices whose underlying
  // policy's start date falls in that (year, month). `selectedMonth`
  // null = "All" (no period filter applied).
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = React.useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = React.useState<number | null>(null);

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
      startYear: selectedMonth !== null ? selectedYear : undefined,
      startMonth: selectedMonth !== null ? selectedMonth : undefined,
      _t: refreshKey > 0 ? refreshKey : undefined,
    }),
    [statusFilter, directionFilter, refreshKey, selectedYear, selectedMonth],
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
    const params = new URLSearchParams({ _t: String(Date.now()) });
    if (selectedMonth !== null) {
      params.set("startYear", String(selectedYear));
      params.set("startMonth", String(selectedMonth));
    }
    fetch(`/api/accounting/stats?${params.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setStats(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey, selectedYear, selectedMonth]);

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

  // Client-side sort of the current page. The default order from the
  // API is `createdAt DESC` (newest first); the user can flip it or
  // sort by another column from the table header. Page-bound only —
  // multi-page sort would require server support.
  type SortKey = "date" | "docNumber" | "total" | "outstanding" | "status" | "insuredName" | "agentName";
  const [sortKey, setSortKey] = React.useState<SortKey>("date");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const sortedInvoices = React.useMemo(() => {
    // First filter by the active ledger tab so each tab shows ONLY
    // one type of record (client receivable / agent settlement /
    // commission / credit note / statement). `all` keeps every row.
    let filtered = ledgerTab === "all"
      ? invoices
      : invoices.filter((inv) => classifyInvoice(inv) === ledgerTab);
    // Drop orphan rows unless the user explicitly opts in. They're
    // almost always dead data the user doesn't want to see.
    if (hideOrphans) {
      filtered = filtered.filter((inv) => !inv.warnings.includes("orphan_no_policy"));
    }
    const arr = [...filtered];
    const factor = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "date": {
          const av = new Date(a.invoiceDate ?? a.createdAt).getTime();
          const bv = new Date(b.invoiceDate ?? b.createdAt).getTime();
          return (av - bv) * factor;
        }
        case "docNumber":
          return a.invoiceNumber.localeCompare(b.invoiceNumber) * factor;
        case "total":
          return (a.totalAmountCents - b.totalAmountCents) * factor;
        case "outstanding": {
          const ao = a.totalAmountCents - a.paidAmountCents;
          const bo = b.totalAmountCents - b.paidAmountCents;
          return (ao - bo) * factor;
        }
        case "status":
          return String(a.status).localeCompare(String(b.status)) * factor;
        case "insuredName": {
          const an = (a.insuredDisplayName ?? a.parentInsuredDisplayName ?? "").toLowerCase();
          const bn = (b.insuredDisplayName ?? b.parentInsuredDisplayName ?? "").toLowerCase();
          return an.localeCompare(bn) * factor;
        }
        case "agentName": {
          const aa = (a.entityType === "agent" ? (a.entityName ?? a.agentName ?? "") : (a.agentName ?? "")).toLowerCase();
          const ba = (b.entityType === "agent" ? (b.entityName ?? b.agentName ?? "") : (b.agentName ?? "")).toLowerCase();
          return aa.localeCompare(ba) * factor;
        }
        default:
          return 0;
      }
    });
    return arr;
  }, [invoices, sortKey, sortDir, ledgerTab, hideOrphans]);

  // Count of orphans on the current page so we can surface "N
  // orphan rows hidden — show?" affordance without scanning the
  // entire list twice.
  const orphanCount = React.useMemo(
    () => invoices.filter((inv) => inv.warnings.includes("orphan_no_policy")).length,
    [invoices],
  );

  // Per-tab counts so the tab bar can show "Agent Settlement (12)"
  // at a glance — no need to click each tab to see what's there.
  // Computed AFTER the orphan filter is applied so the badge
  // matches the row count the user actually sees in the table.
  // Without this, "Hide 4 orphans" toggled ON would still show
  // "Agent Settlement (7)" even though only 3 rows render —
  // making the user think rows are missing.
  const ledgerCounts = React.useMemo(() => {
    const visible = hideOrphans
      ? invoices.filter((inv) => !inv.warnings.includes("orphan_no_policy"))
      : invoices;
    const c = {
      all: visible.length,
      client_receivable: 0,
      agent_receivable: 0,
      agent_commission_payable: 0,
      credit_note: 0,
      statement_bundle: 0,
    };
    for (const inv of visible) {
      const cat = classifyInvoice(inv);
      if (cat in c) {
        c[cat as keyof typeof c] += 1;
      }
    }
    return c;
  }, [invoices, hideOrphans]);

  const toggleSort = React.useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "date" ? "desc" : "asc");
      return key;
    });
  }, []);

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3" />
      : <ArrowDown className="h-3 w-3" />;
  }

  // Cluster the (already sorted) rows by their `groupPolicyId` so
  // every document belonging to the SAME policy appears together —
  // DN, quotation, debit notes, credit notes, agent commission
  // payables, endorsements. The user's chosen sort order is
  // preserved WITHIN each cluster; groups themselves are ordered by
  // the position of their first sorted row, so e.g. sorting by Total
  // desc surfaces the policy with the biggest record at the top with
  // all its sibling docs in tow.
  type InvoiceGroup = {
    key: string;
    groupId: number | null;
    rows: FullInvoiceRow[];
    parentPolicyNumber: string | null;
    parentInsuredDisplayName: string | null;
    parentVehicleRegistration: string | null;
    groupTotalCents: number;
    groupOutstandingCents: number;
    currency: string;
  };
  const groupedInvoices = React.useMemo<InvoiceGroup[]>(() => {
    const map = new Map<string, InvoiceGroup>();
    const order: string[] = [];
    for (const inv of sortedInvoices) {
      // Rows with no group (orphans, statement-only legacy entries)
      // become their own single-row "group" so they still slot into
      // the rendering pipeline without a header banner.
      const key = inv.groupPolicyId !== null ? `g${inv.groupPolicyId}` : `u${inv.id}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          groupId: inv.groupPolicyId,
          rows: [],
          parentPolicyNumber: null,
          parentInsuredDisplayName: null,
          parentVehicleRegistration: null,
          groupTotalCents: 0,
          groupOutstandingCents: 0,
          currency: inv.currency,
        };
        map.set(key, g);
        order.push(key);
      }
      g.rows.push(inv);
      g.groupTotalCents += inv.totalAmountCents;
      g.groupOutstandingCents += inv.totalAmountCents - inv.paidAmountCents;
      // The row at the GROUP ROOT (parent policy) is the most
      // reliable source for the banner; fall back to whatever the
      // endorsement row already knows about its parent.
      const isGroupRoot = inv.groupPolicyId !== null && inv.groupPolicyId === inv.policyId;
      if (isGroupRoot) {
        g.parentPolicyNumber = inv.policyNumber ?? g.parentPolicyNumber;
        g.parentInsuredDisplayName = inv.insuredDisplayName ?? g.parentInsuredDisplayName;
        g.parentVehicleRegistration = inv.vehicleRegistration ?? g.parentVehicleRegistration;
      } else {
        g.parentPolicyNumber ??= inv.parentPolicyNumber ?? inv.policyNumber;
        g.parentInsuredDisplayName ??= inv.parentInsuredDisplayName ?? inv.insuredDisplayName ?? null;
        g.parentVehicleRegistration ??= inv.parentVehicleRegistration ?? inv.vehicleRegistration ?? null;
      }
    }
    return order.map((k) => map.get(k)!);
  }, [sortedInvoices]);

  const directionTone = (direction: InvoiceDirection): string =>
    direction === "receivable"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
      : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ── Column registry ───────────────────────────────────────────
  // Every column the user can toggle / reorder via the Record
  // Display Settings panel. Keys MUST match the entries in
  // `DEFAULT_COLUMNS` in app/api/admin/accounting-display/route.ts.
  // Adding a new column: add an entry here AND there.
  //
  // The user's choice of which columns are enabled + the ORDER
  // they appear in lives in `displayColumns` (saved per-tenant in
  // app_settings). `visibleColumns` below filters + orders the
  // registry per the user's preference. The Expand chevron column
  // is NOT in this registry — it's always appended last as a UI
  // affordance, not data.
  type AccountingCellCtx = {
    category: ReturnType<typeof classifyInvoice>;
    displayDate: string;
    recordId: ReturnType<typeof getStableRecordId>;
    insuredLabel: string | null;
    plateLabel: string | null;
    policyLabel: string | null;
    headlineDocNumber: string;
    remaining: number;
  };
  type ColumnDef = {
    label: string;
    headClass: string;
    cellClass: string;
    renderHead: () => React.ReactNode;
    renderCell: (inv: FullInvoiceRow, ctx: AccountingCellCtx) => React.ReactNode;
  };
  const headBtnClass = "inline-flex items-center gap-1 hover:text-neutral-700 dark:hover:text-neutral-200";

  // Pluck the first value in `documentNumbers` whose key matches a
  // predicate. Used to extract Quotation / Receipt numbers for
  // their own dedicated columns without re-running the headline
  // selection logic.
  const findDocNumberByKind = (
    inv: FullInvoiceRow,
    match: (k: string) => boolean,
  ): string | null => {
    if (!inv.documentNumbers) return null;
    for (const [k, n] of Object.entries(inv.documentNumbers)) {
      if (match(k.toLowerCase())) return n;
    }
    return null;
  };

  // Compute the per-row Status badge. Extracted into a function so
  // the column registry doesn't carry 70 lines of inline JSX.
  // Priority order matches the per-row "is paid?" rules in
  // .cursor/skills/accounting-view-reconciliation/SKILL.md §6.1.
  const renderStatusBadge = (inv: FullInvoiceRow): React.ReactNode => {
    const total = inv.totalAmountCents;
    const paid = inv.paidAmountCents;
    const outstanding = total - paid;
    type State = { label: string; tone: string; icon: string | null; sub?: string };
    let state: State;
    if (inv.status === "cancelled") {
      state = { label: "VOID", tone: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200", icon: "✕" };
    } else if (inv.status === "refunded") {
      state = { label: "REFUNDED", tone: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200", icon: "↩" };
    } else if (inv.status === "statement_created") {
      state = { label: "BUNDLED", tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200", icon: "▣" };
    } else if (inv.status === "draft") {
      state = { label: "DRAFT", tone: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200", icon: null };
    } else if (total === 0) {
      state = { label: "ZERO", tone: "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300", icon: null };
    } else if (inv.wasClientPaidDirectly) {
      state = { label: "PAID", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200", icon: "✓", sub: "Client paid admin directly" };
    } else if (inv.hasClientDirectSubmitted) {
      state = { label: "PENDING VERIFY", tone: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200", icon: "▷", sub: "Client-direct payment submitted" };
    } else if (outstanding <= 0) {
      state = { label: "PAID", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200", icon: "✓" };
    } else if (paid > 0) {
      state = { label: "PARTIAL", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200", icon: "◐" };
    } else if (inv.status === "overdue") {
      state = { label: "OVERDUE", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200", icon: "⚠" };
    } else {
      state = { label: "UNPAID", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200", icon: null };
    }
    return (
      <div className="flex flex-col items-start gap-0.5">
        <Badge variant="custom" className={cn("text-[10px] font-bold tracking-wide", state.tone)} title={state.sub}>
          {state.icon && <span className="mr-1">{state.icon}</span>}
          {state.label}
        </Badge>
        {state.sub && (
          <span className="text-[9px] text-emerald-700 dark:text-emerald-300 font-medium">{state.sub}</span>
        )}
        <span className="text-[9px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          {INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status}
        </span>
      </div>
    );
  };

  const colRegistry: Record<string, ColumnDef> = {
    invoiceDate: {
      label: "Date",
      headClass: "w-[110px] hidden md:table-cell",
      cellClass: "hidden md:table-cell whitespace-nowrap text-xs text-neutral-500 dark:text-neutral-400",
      renderHead: () => (
        <button type="button" onClick={() => toggleSort("date")} className={headBtnClass}>
          Date {sortIcon("date")}
        </button>
      ),
      renderCell: (_inv, ctx) => new Date(ctx.displayDate).toLocaleDateString(),
    },
    invoiceNumber: {
      label: "Document",
      headClass: "min-w-[140px]",
      cellClass: "",
      renderHead: () => (
        <button type="button" onClick={() => toggleSort("docNumber")} className={headBtnClass}>
          Document {sortIcon("docNumber")}
        </button>
      ),
      renderCell: (inv, ctx) => (
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="font-mono text-sm font-semibold break-all">{ctx.headlineDocNumber}</span>
            {inv.warnings.map((w) => (
              <Badge
                key={w}
                variant="custom"
                className={cn(
                  "shrink-0 text-[10px]",
                  WARNING_LABELS[w].tone === "danger"
                    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
                )}
                title={WARNING_LABELS[w].title}
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                {w.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
          <span className="text-[10px] font-mono text-neutral-400" title="Internal record ID — stays the same across template changes">
            {ctx.recordId.primary}
          </span>
        </div>
      ),
    },
    type: {
      label: "Type",
      headClass: "hidden sm:table-cell min-w-[150px]",
      cellClass: "hidden sm:table-cell",
      renderHead: () => "Type",
      renderCell: (inv, ctx) => (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="custom" className={cn("shrink-0 text-[10px]", CATEGORY_ACCENT[ctx.category])}>
            {CATEGORY_LABELS[ctx.category]}
          </Badge>
          {inv.isEndorsement && (
            <Badge variant="custom" className="shrink-0 text-[10px] bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              Endorsement
            </Badge>
          )}
          {shouldShowClientPaidDirectlyBadge(inv) && (
            <Badge variant="custom" className="shrink-0 text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800" title="Client paid admin directly. The agent commission is materialised on a separate payable (AP-…) row.">
              Client paid directly
            </Badge>
          )}
        </div>
      ),
    },
    insuredName: {
      label: "Insured",
      headClass: "hidden lg:table-cell min-w-[160px]",
      cellClass: "hidden lg:table-cell",
      renderHead: () => (
        <button type="button" onClick={() => toggleSort("insuredName")} className={headBtnClass}>
          Insured {sortIcon("insuredName")}
        </button>
      ),
      renderCell: (_inv, ctx) =>
        ctx.insuredLabel ? (
          <span className="flex items-center gap-1.5 font-medium text-sm text-neutral-900 dark:text-neutral-100 truncate">
            <User className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
            {ctx.insuredLabel}
          </span>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        ),
    },
    plate: {
      label: "Vehicle Plate",
      headClass: "hidden lg:table-cell min-w-[100px]",
      cellClass: "hidden lg:table-cell",
      renderHead: () => "Vehicle",
      // Plain mono — no fake "license plate" pill. The user finds
      // the badge styling distracting and the column header
      // already tells you what kind of value this is.
      renderCell: (_inv, ctx) =>
        ctx.plateLabel ? (
          <span className="font-mono text-xs text-neutral-700 dark:text-neutral-300">
            {ctx.plateLabel}
          </span>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        ),
    },
    agentName: {
      label: "Agent",
      headClass: "hidden lg:table-cell min-w-[140px]",
      cellClass: "hidden lg:table-cell",
      renderHead: () => (
        <button type="button" onClick={() => toggleSort("agentName")} className={headBtnClass}>
          Agent {sortIcon("agentName")}
        </button>
      ),
      renderCell: (inv) => {
        const agent = inv.entityType === "agent" ? (inv.entityName ?? inv.agentName) : inv.agentName;
        return agent ? (
          <span className="flex items-center gap-1 text-[12px] text-amber-700 dark:text-amber-300 truncate" title={`Agent: ${agent}`}>
            <Briefcase className="h-3 w-3 shrink-0" />
            {agent}
          </span>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        );
      },
    },
    clientName: {
      label: "Client Name",
      headClass: "hidden lg:table-cell min-w-[140px]",
      cellClass: "hidden lg:table-cell",
      renderHead: () => "Client",
      renderCell: (inv) =>
        inv.clientName ? (
          <span className="text-[12px] text-neutral-700 dark:text-neutral-300 truncate" title={inv.clientName}>
            {inv.clientName}
          </span>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        ),
    },
    policyNumber: {
      label: "Policy",
      headClass: "hidden md:table-cell min-w-[150px]",
      cellClass: "hidden md:table-cell",
      renderHead: () => "Policy",
      renderCell: (_inv, ctx) =>
        ctx.policyLabel ? (
          <span className="font-mono text-xs text-neutral-700 dark:text-neutral-300 break-all">
            {ctx.policyLabel}
          </span>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        ),
    },
    direction: {
      label: "Direction",
      headClass: "hidden md:table-cell",
      cellClass: "hidden md:table-cell",
      renderHead: () => "Direction",
      renderCell: (inv) => (
        <Badge variant="custom" className={cn("shrink-0 text-[10px]", directionTone(inv.direction))}>
          {inv.direction === "receivable" ? "Receivable" : "Payable"}
        </Badge>
      ),
    },
    entityType: {
      label: "Entity Type",
      headClass: "hidden md:table-cell",
      cellClass: "hidden md:table-cell text-xs capitalize",
      renderHead: () => "Entity",
      renderCell: (inv) => inv.entityType,
    },
    premiumType: {
      label: "Premium Type",
      headClass: "hidden md:table-cell",
      cellClass: "hidden md:table-cell text-xs",
      renderHead: () => "Premium",
      renderCell: (inv) =>
        PREMIUM_TYPE_LABELS[inv.premiumType as PremiumType] ?? inv.premiumType.replace(/_/g, " "),
    },
    notes: {
      label: "Notes",
      headClass: "hidden md:table-cell min-w-[160px]",
      cellClass: "hidden md:table-cell text-xs italic text-neutral-500 dark:text-neutral-400",
      renderHead: () => "Notes",
      renderCell: (inv) =>
        inv.notes ? (
          <span title={inv.notes} className="line-clamp-2">{inv.notes}</span>
        ) : (
          <span className="text-neutral-400">—</span>
        ),
    },
    quotationNo: {
      label: "Quotation No.",
      headClass: "hidden md:table-cell",
      cellClass: "hidden md:table-cell text-xs font-mono",
      renderHead: () => "Quotation",
      renderCell: (inv) =>
        findDocNumberByKind(inv, (k) => k.includes("quot")) ?? (
          <span className="text-neutral-400">—</span>
        ),
    },
    receiptNo: {
      label: "Receipt No.",
      headClass: "hidden md:table-cell",
      cellClass: "hidden md:table-cell text-xs font-mono",
      renderHead: () => "Receipt",
      renderCell: (inv) =>
        findDocNumberByKind(inv, (k) => k.includes("receipt")) ?? (
          <span className="text-neutral-400">—</span>
        ),
    },
    dueDate: {
      label: "Due Date",
      headClass: "hidden md:table-cell",
      cellClass: "hidden md:table-cell text-xs",
      renderHead: () => "Due Date",
      renderCell: (inv) =>
        inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : <span className="text-neutral-400">—</span>,
    },
    remaining: {
      label: "Outstanding",
      headClass: "hidden sm:table-cell",
      cellClass: "hidden sm:table-cell whitespace-nowrap",
      renderHead: () => (
        <button type="button" onClick={() => toggleSort("outstanding")} className={headBtnClass}>
          Outstanding {sortIcon("outstanding")}
        </button>
      ),
      renderCell: (inv, ctx) => (
        <span className={cn("text-sm font-semibold", ctx.remaining > 0 ? "text-orange-600" : "text-green-600")}>
          {formatCurrency(ctx.remaining, inv.currency)}
        </span>
      ),
    },
    total: {
      label: "Total",
      headClass: "",
      cellClass: "whitespace-nowrap",
      renderHead: () => (
        <button type="button" onClick={() => toggleSort("total")} className={headBtnClass}>
          Total {sortIcon("total")}
        </button>
      ),
      renderCell: (inv) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{formatCurrency(inv.totalAmountCents, inv.currency)}</span>
          <span className="text-[10px] text-neutral-400">Paid {formatCurrency(inv.paidAmountCents, inv.currency)}</span>
        </div>
      ),
    },
    status: {
      label: "Status",
      headClass: "hidden sm:table-cell",
      cellClass: "hidden sm:table-cell",
      renderHead: () => (
        <button type="button" onClick={() => toggleSort("status")} className={headBtnClass}>
          Status {sortIcon("status")}
        </button>
      ),
      renderCell: (inv) => renderStatusBadge(inv),
    },
  };

  // The visible, ordered list of column definitions. Order is the
  // user's saved order in `displayColumns`; only enabled entries
  // make it through. The "Expand" affordance is NOT here — it's
  // appended as a separate TableCell in the JSX so it always sits
  // on the rightmost edge as an interaction control, not data.
  const visibleColumns = displayColumns
    .filter((c) => c.enabled && colRegistry[c.key])
    .map((c) => ({ key: c.key, def: colRegistry[c.key] }));

  // Banner / expanded-detail rows span the full table width. With
  // the new column system this is dynamic: data columns the user
  // has visible + 1 for the always-rendered Expand cell.
  const fullColSpan = visibleColumns.length + 1;

  // Up/down reorder handlers for the panel. Mutating the array
  // order means the column order in the table updates immediately
  // (same `displayColumns` drives both).
  const moveColumn = (key: string, dir: "up" | "down") => {
    const idx = displayColumns.findIndex((c) => c.key === key);
    if (idx < 0) return;
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= displayColumns.length) return;
    const next = [...displayColumns];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setDisplayColumns(next);
    void saveColumns(next);
  };

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("nav.accounting", "Accounting")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">{t("accounting.display", "Display")}</span>
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

      {/* Year + month tab strip — filters BOTH the stat cards above
          and the records list below by the underlying policy's start
          date. "All" clears the period filter. */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/50">
        <div className="flex items-center gap-0.5 mr-1">
          <button
            onClick={() => setSelectedYear((y) => y - 1)}
            className="rounded p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            title="Previous year"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[42px] text-center text-xs font-semibold tabular-nums">{selectedYear}</span>
          <button
            onClick={() => setSelectedYear((y) => y + 1)}
            className="rounded p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            title="Next year"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={() => setSelectedMonth(null)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            selectedMonth === null
              ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800",
          )}
        >
          All
        </button>
        {MONTHS.map((m, i) => {
          const monthNum = i + 1;
          return (
            <button
              key={m}
              onClick={() => setSelectedMonth(monthNum)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                selectedMonth === monthNum
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800",
              )}
            >
              {m}
            </button>
          );
        })}
      </div>

      {showSettings && displayColumns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 justify-between">
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Record Display Settings
              </span>
              <button
                type="button"
                onClick={() => {
                  // Reset all toggles to ON so the user can recover
                  // from "I turned everything off and the table looks
                  // empty" — a common mistake the previous version
                  // of this panel made very easy to fall into.
                  const reset = displayColumns.map((c) => ({ ...c, enabled: true }));
                  setDisplayColumns(reset);
                  void saveColumns(reset);
                }}
                className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30"
                title="Re-enable every toggle below"
              >
                Reset all
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-neutral-500 mb-3">
              Every column in the table below is fully under your control.
              Toggle the eye to show or hide the column; use the arrows to
              reorder it. The table renders columns top-to-bottom in the
              order shown here. <strong className="text-neutral-700 dark:text-neutral-200">If you hide every column, the table will have no data columns at all</strong> — only the expand chevron.
            </p>
            <div className="space-y-1.5">
              {displayColumns.map((col, idx) => (
                <div
                  key={col.key}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                    col.enabled
                      ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                      : "border-neutral-200 bg-neutral-50/50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/30 dark:text-neutral-500"
                  }`}
                >
                  {/* Position number — gives the user a sense of
                      where they are in the order. */}
                  <span className="font-mono text-[10px] tabular-nums w-5 text-center text-neutral-400 dark:text-neutral-500 shrink-0">
                    {idx + 1}
                  </span>
                  {/* Reorder controls. Up/down arrows swap with the
                      previous/next row. Disabled at the boundaries
                      so the user can't push past the start/end. */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveColumn(col.key, "up")}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move up (show earlier)"
                      aria-label={`Move ${col.label} up`}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveColumn(col.key, "down")}
                      disabled={idx === displayColumns.length - 1}
                      className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move down (show later)"
                      aria-label={`Move ${col.label} down`}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                  {/* Visibility toggle. Clicking the eye / label
                      flips `enabled`. */}
                  <button
                    type="button"
                    onClick={() => toggleColumn(col.key)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    title={col.enabled ? "Hide this column" : "Show this column"}
                  >
                    {col.enabled ? (
                      <Eye className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                    )}
                    <span className="truncate font-medium">{col.label}</span>
                  </button>
                </div>
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
              title="Money In — Outstanding"
              value={formatCurrency(stats.receivable.outstandingCents)}
              subtitle={`${stats.receivable.recordCount} record${stats.receivable.recordCount !== 1 ? "s" : ""} · ${formatCurrency(stats.receivable.billedCents)} total invoiced`}
              icon={Clock}
              iconColor="bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
              tooltip="Money clients / agents still owe us. Sum of (total − paid) across every open receivable invoice. `Total invoiced` is the size of the receivable book — paid plus unpaid."
            />
            <StatCard
              title="Money In — Collected"
              value={formatCurrency(stats.receivable.collectedCents)}
              subtitle="Lifetime, capped per record"
              icon={CheckCircle2}
              iconColor="bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400"
              tooltip="Money we have received. Lifetime sum, capped at each invoice's total so overpayments don't inflate this number."
            />
            <StatCard
              title="Money Out — Outstanding"
              value={formatCurrency(stats.payable.outstandingCents)}
              subtitle={`${stats.payable.recordCount} record${stats.payable.recordCount !== 1 ? "s" : ""} · commissions we still owe agents`}
              icon={DollarSign}
              iconColor="bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
              tooltip="Money WE owe out. Mainly agent commissions when the client paid admin directly. Unpaid CLIENT invoices belong in `Money In — Outstanding`, not here."
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
                const latestEntry = getLatestLifecycleEntry(inv);
                const docNumber = latestEntry?.documentNumber ?? inv.invoiceNumber;
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
                          <span className="font-mono font-medium text-neutral-600 dark:text-neutral-300">{docNumber}</span>
                          <span
                            className="text-[10px]"
                            title="Internal record ID — stays the same across template changes"
                          >
                            ({recordId.primary})
                          </span>
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
          were sent), the lifecycle setCode is.

          IMPORTANT: this is a per-DOCUMENT view, not a reconciled
          per-policy obligation view. The reconciled view (Total Due,
          Client Paid Directly, Agent Paid, Commission, Outstanding,
          Credit to Agent) lives on the policy detail Accounting tab
          and the agent details summary card. See the skill at
          `.cursor/skills/accounting-view-reconciliation/SKILL.md`. */}
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Accounting Records</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {orphanCount > 0 && (
                <label
                  className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1.5 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                  title="Orphan rows have no linked policy. They're usually dead data from cancelled quotes or rows whose parent policy was paid via client-direct. Toggle to show / hide."
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={hideOrphans}
                    onChange={(e) => setHideOrphans(e.target.checked)}
                  />
                  Hide {orphanCount} orphan{orphanCount === 1 ? "" : "s"}
                </label>
              )}
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
          {/* Ledger tabs — split the records into ONE ledger at a
              time. The "Direction" filter is gone now because each
              ledger implies a direction (Client Premium / Agent
              Settlement are receivables, Agent Commission is
              payable). All / Statements / Credit Notes are the only
              cross-direction views. */}
          <div className="flex flex-wrap gap-1.5 border-b border-neutral-200 dark:border-neutral-700 -mb-px">
            {([
              { key: "client_receivable", label: "Client Premium", desc: "Client owes admin (paid by client directly)", tone: "blue" },
              { key: "agent_receivable", label: "Agent Settlement", desc: "Agent collected from client; agent owes admin", tone: "emerald" },
              { key: "agent_commission_payable", label: "Agent Commission", desc: "Admin owes agent commission", tone: "amber" },
              { key: "credit_note", label: "Credit Notes", desc: "Refunds / reversals", tone: "rose" },
              { key: "statement_bundle", label: "Statements", desc: "Monthly bundles of invoices", tone: "purple" },
              { key: "all", label: "All", desc: "Every record across every ledger", tone: "neutral" },
            ] as { key: LedgerTab; label: string; desc: string; tone: string }[]).map((tab) => {
              const isActive = ledgerTab === tab.key;
              const count = ledgerCounts[tab.key];
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setLedgerTab(tab.key)}
                  title={tab.desc}
                  className={cn(
                    "px-3 py-1.5 text-xs sm:text-sm rounded-t-md border-b-2 -mb-px transition-colors whitespace-nowrap",
                    isActive
                      ? cn(
                          "font-semibold",
                          tab.tone === "blue" && "border-blue-500 text-blue-700 dark:text-blue-300",
                          tab.tone === "emerald" && "border-emerald-500 text-emerald-700 dark:text-emerald-300",
                          tab.tone === "amber" && "border-amber-500 text-amber-700 dark:text-amber-300",
                          tab.tone === "rose" && "border-rose-500 text-rose-700 dark:text-rose-300",
                          tab.tone === "purple" && "border-purple-500 text-purple-700 dark:text-purple-300",
                          tab.tone === "neutral" && "border-neutral-500 text-neutral-800 dark:text-neutral-200",
                        )
                      : "border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300 dark:text-neutral-400 dark:hover:text-neutral-200",
                  )}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={cn(
                      "ml-1.5 inline-flex items-center justify-center min-w-[18px] px-1 rounded-full text-[10px] font-semibold",
                      isActive
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <div className="py-8 text-center text-sm text-neutral-400">Loading records...</div>
          ) : invoices.length === 0 ? (
            <div className="py-8 text-center text-sm text-neutral-400">
              {statusFilter === "all" && ledgerTab === "all"
                ? "No accounting records found."
                : "No matching records for the selected filters."}
            </div>
          ) : sortedInvoices.length === 0 ? (
            // Tab is selected but no records of that category exist
            // on the current page. Tell the user explicitly so they
            // don't think the page is broken.
            <div className="py-8 text-center text-sm text-neutral-400">
              No records in this ledger. Switch tabs or pick another month.
            </div>
          ) : (
            // Table view — one row per record, sortable columns, with
            // an inline expanded panel below when a row is opened.
            // Per the responsive-layout workspace rule we wrap the
            // table in an overflow-x-auto and hide non-essential
            // columns on mobile.
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              {/* Medium-density override: trim default p-4 to py-2/px-3
                  on every td and px-3 on every th so a record fits in
                  ~2 lines (main row + small subtitle) instead of ~5. */}
              <Table className="[&_th]:px-3 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top text-sm">
                <TableHeader>
                  <TableRow>
                    {/* Iterate ONLY columns the user enabled — in
                        their saved order. Each column's renderHead
                        renders the (possibly sortable) header
                        button. The trailing Expand column always
                        renders last as a UI affordance. */}
                    {visibleColumns.map(({ key, def }) => (
                      <TableHead key={key} className={def.headClass}>
                        {def.renderHead()}
                      </TableHead>
                    ))}
                    <TableHead className="w-[40px]" aria-label="Expand"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
              {groupedInvoices.map((group) => {
                // Show a banner row before a policy's records when
                // EITHER (a) the policy has > 1 record (typical: DN
                // + AP + endorsements), or (b) the single record is
                // an endorsement (parent policy context matters).
                return (
                  <React.Fragment key={group.key}>
                    {/* Group banner removed — the rows themselves
                        carry enough context (insured name, vehicle,
                        policy number column). A separator row between
                        groups adds visual noise without adding value. */}
                    {group.rows.map((inv) => {
                    const isExpanded = expandedInvoice === inv.id;
                    const remaining = getOutstandingCents(inv);
                    const category = classifyInvoice(inv);
                    const recordId = getStableRecordId(inv);
                    const latestEntry = getLatestLifecycleEntry(inv);
                    // Headline: use the policy's actual Invoice number
                    // whenever one exists. The row's `invoiceNumber`
                    // column rotates as new templates (DN, Receipt,
                    // etc.) are sent, but `documentNumbers` carries
                    // the FULL map of every document type ever issued
                    // for this policy via `policy.documentTracking`,
                    // so an Invoice that was sent earlier is still
                    // there — just under its own key. We pull it out
                    // here so every row that's been invoiced reads
                    // the same way (HIDIINV-…), instead of switching
                    // to HIDIDEBT-… the moment a Debit Note was sent.
                    //
                    // Selection order:
                    //   1. The Invoice number from the policy's
                    //      document tracking map.
                    //   2. The Debit Note number (for endorsement
                    //      flows that go straight to DN — no Invoice
                    //      was ever issued).
                    //   3. The lifecycle's latest non-quotation entry.
                    //   4. The row's stored invoiceNumber (last-resort).
                    const findByKind = (kindMatch: (k: string) => boolean): string | null => {
                      if (!inv.documentNumbers) return null;
                      for (const [key, number] of Object.entries(inv.documentNumbers)) {
                        if (kindMatch(key.toLowerCase())) return number;
                      }
                      return null;
                    };
                    // PLAIN invoice — must contain "invoice" but NOT
                    // an endorsement / debit / credit prefix. Pull the
                    // regular `HIDIINV-…` before any custom variant
                    // like an "Endorsement Invoice" (`HIDIEDINV-…`)
                    // your admin may have configured.
                    const isPlainInvoiceKey = (k: string) =>
                      k.includes("invoice")
                      && !k.includes("endorsement")
                      && !k.includes("endorse")
                      && !k.includes("ed_invoice")
                      && !k.includes("edinvoice")
                      && !k.includes("renewal")
                      && !k.includes("debit")
                      && !k.includes("credit");
                    // ANY invoice-like key — endorsement-invoice,
                    // renewal-invoice, etc. Only used when no plain
                    // invoice exists for this row.
                    const isAnyInvoiceKey = (k: string) =>
                      k.includes("invoice")
                      && !k.includes("debit") && !k.includes("credit");
                    const isDebitKey = (k: string) =>
                      k.includes("debit_note") || k.includes("debitnote");
                    const headlineDocNumber =
                      findByKind(isPlainInvoiceKey)
                      ?? findByKind(isAnyInvoiceKey)
                      ?? findByKind(isDebitKey)
                      ?? latestEntry?.documentNumber
                      ?? inv.invoiceNumber;
                    // Type badge dropped from the headline — the Type
                    // column already labels the category (Client
                    // Premium / Agent Settlement / etc.) so a second
                    // INVOICE/DEBIT NOTE/RECEIPT label here was
                    // redundant and inconsistent across rows.
                    const headlineDocType: string | null = null;
                    const displayDate = inv.invoiceDate ?? inv.createdAt;
                    const policyLabel = inv.parentPolicyNumber ?? inv.policyNumber;
                    // For client rows: snapshot insured → parent insured →
                    // policy client → finally the row's stored `entityName`
                    // (which is populated at creation time even when the
                    // policy link is later orphaned).
                    const insuredLabel = inv.insuredDisplayName
                      ?? inv.parentInsuredDisplayName
                      ?? inv.clientName
                      ?? (inv.entityType === "client" ? inv.entityName : null);
                    const plateLabel = inv.vehicleRegistration ?? inv.parentVehicleRegistration;
                    // Bundle the per-row computed locals so the
                    // column registry's `renderCell` can read them
                    // without having to re-derive them per cell.
                    const cellCtx: AccountingCellCtx = {
                      category,
                      displayDate,
                      recordId,
                      insuredLabel,
                      plateLabel,
                      policyLabel,
                      headlineDocNumber,
                      remaining,
                    };

                    return (
                      <React.Fragment key={inv.id}>
                      <TableRow
                        onClick={() => setExpandedInvoice(isExpanded ? null : inv.id)}
                        className={cn(
                          "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40",
                          isExpanded && "bg-neutral-50/60 dark:bg-neutral-800/30",
                          // No left-edge category stripe — the Type
                          // column (and the Category Ledger tabs
                          // above the table) already encode category
                          // explicitly, so the coloured bar was
                          // visual noise.
                        )}
                      >
                        {/* Iterate ONLY the columns the user has
                            enabled in their saved order. Every cell
                            is wrapped in a <TableCell> with its
                            registry-defined class; the content
                            comes from `def.renderCell(inv, ctx)`.
                            If `visibleColumns.length === 0` the
                            row renders no data cells at all — only
                            the trailing Expand chevron — which is
                            exactly what the user asked for ("no
                            default is showed if i hide all"). */}
                        {visibleColumns.map(({ key, def }) => (
                          <TableCell key={key} className={def.cellClass}>
                            {def.renderCell(inv, cellCtx)}
                          </TableCell>
                        ))}

                        {/* Expand / collapse chevron */}
                        <TableCell className="w-[40px] text-right">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 inline-block text-neutral-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 inline-block text-neutral-400" />
                          )}
                        </TableCell>
                      </TableRow>

                        {isExpanded && (
                          <TableRow
                            className="bg-neutral-50/40 dark:bg-neutral-900/30 hover:bg-neutral-50/40 dark:hover:bg-neutral-900/30"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <TableCell colSpan={fullColSpan} className="px-3.5 py-3">
                          <div className="space-y-3">
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
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                  </React.Fragment>
                );
              })}
                </TableBody>
              </Table>
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
