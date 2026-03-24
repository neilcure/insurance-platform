"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus,
  Filter,
  FileText,
  Receipt,
  DollarSign,
  Eye,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import type {
  AccountingInvoiceRow,
  InvoiceDirection,
  InvoiceStatus,
  PremiumType,
  EntityType,
} from "@/lib/types/accounting";
import {
  INVOICE_STATUS_LABELS,
  PREMIUM_TYPE_LABELS,
  ENTITY_TYPE_LABELS,
  DIRECTION_LABELS,
} from "@/lib/types/accounting";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";
import { InvoiceDetailDrawer } from "./InvoiceDetailDrawer";
import { SchedulesPanel } from "./SchedulesPanel";

type Props = {
  flowOptions: Array<{ value: string; label: string }>;
};

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  partial: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  submitted: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  cancelled: "bg-neutral-300 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-500",
};

function fmtCurrency(cents: number, currency = "HKD"): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

type TabId = "invoices" | "schedules";

export function AccountingPageClient({ flowOptions }: Props) {
  const [activeTab, setActiveTab] = React.useState<TabId>("invoices");
  const [invoices, setInvoices] = React.useState<AccountingInvoiceRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [selectedInvoice, setSelectedInvoice] = React.useState<AccountingInvoiceRow | null>(null);

  // Filters
  const [flowFilter, setFlowFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [directionFilter, setDirectionFilter] = React.useState("");
  const [premiumTypeFilter, setPremiumTypeFilter] = React.useState("");
  const [showFilters, setShowFilters] = React.useState(false);

  const loadInvoices = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (directionFilter) params.set("direction", directionFilter);
      if (premiumTypeFilter) params.set("premiumType", premiumTypeFilter);
      if (flowFilter) params.set("flow", flowFilter);
      const res = await fetch(`/api/accounting/invoices?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load invoices");
      const data = await res.json();
      setInvoices(data);
    } catch (err) {
      toast.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, directionFilter, premiumTypeFilter, flowFilter]);

  React.useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const summaryStats = React.useMemo(() => {
    const payable = invoices.filter((i) => i.direction === "payable");
    const receivable = invoices.filter((i) => i.direction === "receivable");
    const pendingVerification = invoices.filter((i) => i.status === "submitted");
    return {
      totalPayable: payable.reduce((s, i) => s + i.totalAmountCents - i.paidAmountCents, 0),
      totalReceivable: receivable.reduce((s, i) => s + i.totalAmountCents - i.paidAmountCents, 0),
      pendingCount: pendingVerification.length,
      overdueCount: invoices.filter((i) => i.status === "overdue").length,
    };
  }, [invoices]);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900">
                <DollarSign className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Total Payable</p>
                <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                  {fmtCurrency(summaryStats.totalPayable)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900">
                <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Total Receivable</p>
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                  {fmtCurrency(summaryStats.totalReceivable)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-orange-100 p-2 dark:bg-orange-900">
                <FileText className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Pending Verification</p>
                <p className="text-lg font-semibold">{summaryStats.pendingCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-yellow-100 p-2 dark:bg-yellow-900">
                <Receipt className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Overdue</p>
                <p className="text-lg font-semibold">{summaryStats.overdueCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 rounded-lg border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-900">
        {(["invoices", "schedules"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
            }`}
          >
            {tab === "invoices" ? "Invoices" : "Payment Schedules"}
          </button>
        ))}
      </div>

      {activeTab === "schedules" ? (
        <SchedulesPanel flowOptions={flowOptions} />
      ) : (
      <>

      {/* Actions bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">New Invoice</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowFilters((v) => !v)}>
            <Filter className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Filters</span>
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={loadInvoices}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Flow</label>
              <select
                value={flowFilter}
                onChange={(e) => setFlowFilter(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">All Flows</option>
                {flowOptions.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Direction</label>
              <select
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">All Directions</option>
                <option value="payable">Payable (We Pay)</option>
                <option value="receivable">Receivable (We Receive)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Premium Type</label>
              <select
                value={premiumTypeFilter}
                onChange={(e) => setPremiumTypeFilter(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">All Types</option>
                <option value="net_premium">Net Premium</option>
                <option value="agent_premium">Agent Premium</option>
                <option value="client_premium">Client Premium</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="submitted">Submitted</option>
                <option value="partial">Partially Paid</option>
                <option value="paid">Paid</option>
                <option value="verified">Verified</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoices table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">Loading...</div>
          ) : invoices.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              No invoices found. Create your first invoice to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden sm:table-cell">Direction</TableHead>
                    <TableHead className="hidden sm:table-cell">Premium</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id} className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900">
                      <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {inv.invoiceType === "statement" ? "Statement" : "Individual"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className={inv.direction === "payable" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                          {inv.direction === "payable" ? "Pay" : "Receive"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs">
                        {PREMIUM_TYPE_LABELS[inv.premiumType as PremiumType] || inv.premiumType}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[120px] truncate text-xs">
                          {inv.entityName || ENTITY_TYPE_LABELS[inv.entityType as EntityType] || inv.entityType}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {fmtCurrency(inv.totalAmountCents, inv.currency)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-right tabular-nums">
                        {fmtCurrency(inv.paidAmountCents, inv.currency)}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[inv.status as InvoiceStatus] || ""}`}>
                          {INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] || inv.status}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-neutral-500 dark:text-neutral-400">
                        {fmtDate(inv.invoiceDate)}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => setSelectedInvoice(inv)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create invoice dialog */}
      <CreateInvoiceDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={() => {
          setShowCreateDialog(false);
          void loadInvoices();
        }}
        flowOptions={flowOptions}
      />

      {/* Invoice detail drawer */}
      {selectedInvoice && (
        <InvoiceDetailDrawer
          invoiceId={selectedInvoice.id}
          open={!!selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onUpdated={loadInvoices}
        />
      )}

      </>
      )}
    </div>
  );
}
