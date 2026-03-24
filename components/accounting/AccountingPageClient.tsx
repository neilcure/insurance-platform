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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { CompactSelect } from "@/components/ui/compact-select";
import { RowActionMenu } from "@/components/ui/row-action-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus,
  Filter,
  FileText,
  Receipt,
  DollarSign,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CreditCard,
  Upload,
  Loader2,
  Settings2,
  ArrowUpDown,
  X,
  TrendingUp,
} from "lucide-react";
import type {
  AccountingInvoiceRow,
  InvoiceStatus,
  PremiumType,
  EntityType,
  InvoiceWithItems,
} from "@/lib/types/accounting";
import {
  INVOICE_STATUS_LABELS,
  PREMIUM_TYPE_LABELS,
  ENTITY_TYPE_LABELS,
} from "@/lib/types/accounting";
import { RecordDetailsDrawer } from "@/components/ui/record-details-drawer";
import type { DrawerTab } from "@/components/ui/drawer-tabs";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";
import { InvoiceOverviewTab } from "./InvoiceDetailDrawer";
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

// ── Column definitions for invoices ──
type FieldOption = { path: string; label: string };
type ColumnPreset = { id: string; name: string; columns: string[]; isDefault: boolean };

const INVOICE_FIELDS: FieldOption[] = [
  { path: "invoiceNumber", label: "Invoice #" },
  { path: "invoiceType", label: "Type" },
  { path: "direction", label: "Direction" },
  { path: "premiumType", label: "Premium" },
  { path: "entityName", label: "Entity" },
  { path: "totalAmount", label: "Amount" },
  { path: "netPremium", label: "Net Premium" },
  { path: "paidAmount", label: "Paid" },
  { path: "remaining", label: "Remaining" },
  { path: "gain", label: "Gain" },
  { path: "status", label: "Status" },
  { path: "invoiceDate", label: "Invoice Date" },
  { path: "dueDate", label: "Due Date" },
  { path: "currency", label: "Currency" },
  { path: "notes", label: "Notes" },
];

function getColumnValue(inv: AccountingInvoiceRow, path: string): React.ReactNode {
  switch (path) {
    case "invoiceNumber":
      return <span className="font-mono font-medium">{inv.invoiceNumber}</span>;
    case "invoiceType":
      return (
        <Badge variant="outline" className="text-[10px]">
          {inv.invoiceType === "statement" ? "Statement" : "Individual"}
        </Badge>
      );
    case "direction":
      return (
        <span className={inv.direction === "payable" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
          {inv.direction === "payable" ? "Payable" : "Receivable"}
        </span>
      );
    case "premiumType":
      return <span className="text-xs">{PREMIUM_TYPE_LABELS[inv.premiumType as PremiumType] || inv.premiumType}</span>;
    case "entityName":
      return (
        <div className="max-w-[120px] truncate text-xs">
          {inv.entityName || ENTITY_TYPE_LABELS[inv.entityType as EntityType] || inv.entityType}
        </div>
      );
    case "totalAmount":
      return <span className="font-medium tabular-nums">{fmtCurrency(inv.totalAmountCents, inv.currency)}</span>;
    case "netPremium":
      return <span className="tabular-nums">{fmtCurrency(inv.totalNetPremiumCents ?? 0, inv.currency)}</span>;
    case "paidAmount":
      return <span className="tabular-nums">{fmtCurrency(inv.paidAmountCents, inv.currency)}</span>;
    case "remaining": {
      const rem = inv.totalAmountCents - inv.paidAmountCents;
      return (
        <span className={cn("tabular-nums font-medium", rem > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
          {fmtCurrency(rem, inv.currency)}
        </span>
      );
    }
    case "gain": {
      const g = inv.totalGainCents ?? 0;
      if (g === 0) return <span className="tabular-nums text-neutral-400">—</span>;
      return (
        <span className={cn("tabular-nums font-medium", g > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
          {g > 0 ? "+" : ""}{fmtCurrency(g, inv.currency)}
        </span>
      );
    }
    case "status":
      return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[inv.status as InvoiceStatus] || ""}`}>
          {INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] || inv.status}
        </span>
      );
    case "invoiceDate":
      return <span className="text-xs text-neutral-500 dark:text-neutral-400">{fmtDate(inv.invoiceDate)}</span>;
    case "dueDate":
      return <span className="text-xs text-neutral-500 dark:text-neutral-400">{fmtDate(inv.dueDate)}</span>;
    case "currency":
      return <span className="text-xs">{inv.currency}</span>;
    case "notes":
      return inv.notes ? <div className="max-w-[150px] truncate text-xs text-neutral-500">{inv.notes}</div> : <span className="text-neutral-400">—</span>;
    default:
      return <span className="text-neutral-400">—</span>;
  }
}

function getSortValue(inv: AccountingInvoiceRow, path: string): string | number {
  switch (path) {
    case "invoiceNumber": return inv.invoiceNumber;
    case "invoiceType": return inv.invoiceType;
    case "direction": return inv.direction;
    case "premiumType": return inv.premiumType;
    case "entityName": return inv.entityName || inv.entityType;
    case "totalAmount": return inv.totalAmountCents;
    case "netPremium": return inv.totalNetPremiumCents ?? 0;
    case "paidAmount": return inv.paidAmountCents;
    case "remaining": return inv.totalAmountCents - inv.paidAmountCents;
    case "gain": return inv.totalGainCents ?? 0;
    case "status": return inv.status;
    case "invoiceDate": return inv.invoiceDate ? Date.parse(inv.invoiceDate) : 0;
    case "dueDate": return inv.dueDate ? Date.parse(inv.dueDate) : 0;
    case "currency": return inv.currency;
    case "notes": return inv.notes || "";
    default: return "";
  }
}

type TabId = "invoices" | "schedules";
const MAX_COLS = 6;
const MAX_PRESETS = 5;
const PRESETS_KEY = "accounting-invoices-presets";

export function AccountingPageClient({ flowOptions }: Props) {
  const [activeTab, setActiveTab] = React.useState<TabId>("invoices");
  const [invoices, setInvoices] = React.useState<AccountingInvoiceRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);

  // Drawer state
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<InvoiceWithItems | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  // Search & Filters
  const [query, setQuery] = React.useState("");
  const [flowFilter, setFlowFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [directionFilter, setDirectionFilter] = React.useState("");
  const [premiumTypeFilter, setPremiumTypeFilter] = React.useState("");
  const [showFilters, setShowFilters] = React.useState(false);

  // ── Column presets system ──
  const [presets, setPresets] = React.useState<ColumnPreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/view-presets?scope=${encodeURIComponent(PRESETS_KEY)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => {
        try {
          const stored = localStorage.getItem(PRESETS_KEY);
          if (stored) return JSON.parse(stored) as ColumnPreset[];
        } catch {}
        return [];
      })
      .then((data: ColumnPreset[]) => {
        if (cancelled) return;
        setPresets(Array.isArray(data) ? data : []);
        setPresetsLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const savePresets = (next: ColumnPreset[]) => {
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch {}
    fetch(`/api/view-presets?scope=${encodeURIComponent(PRESETS_KEY)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
  };

  const defaultPreset = presets.find((p) => p.isDefault) ?? presets[0] ?? null;
  const [activePresetId, setActivePresetId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (presetsLoaded && activePresetId === null && defaultPreset) {
      setActivePresetId(defaultPreset.id);
    }
  }, [presetsLoaded, defaultPreset?.id]);

  const activePreset = presets.find((p) => p.id === activePresetId) ?? defaultPreset;
  const activeColumns = activePreset?.columns ?? [];

  // Config dialog state
  const [configOpen, setConfigOpen] = React.useState(false);
  const [editingPreset, setEditingPreset] = React.useState<ColumnPreset | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftColumns, setDraftColumns] = React.useState<string[]>([]);

  function openNewPreset() {
    if (presets.length >= MAX_PRESETS) {
      toast.error(`Maximum ${MAX_PRESETS} views allowed`);
      return;
    }
    setEditingPreset(null);
    setDraftName(`View ${presets.length + 1}`);
    setDraftColumns([]);
    setConfigOpen(true);
  }

  function openEditPreset(preset: ColumnPreset) {
    setEditingPreset(preset);
    setDraftName(preset.name);
    setDraftColumns([...preset.columns]);
    setConfigOpen(true);
  }

  function toggleDraftColumn(path: string) {
    setDraftColumns((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path);
      if (prev.length >= MAX_COLS) return prev;
      return [...prev, path];
    });
  }

  function saveCurrentPreset() {
    const name = draftName.trim() || "Untitled";
    if (draftColumns.length === 0) {
      toast.error("Select at least one column");
      return;
    }
    if (editingPreset) {
      const next = presets.map((p) =>
        p.id === editingPreset.id ? { ...p, name, columns: draftColumns } : p,
      );
      savePresets(next);
    } else {
      const newPreset: ColumnPreset = {
        id: `preset_${Date.now()}`,
        name,
        columns: draftColumns,
        isDefault: presets.length === 0,
      };
      savePresets([...presets, newPreset]);
      setActivePresetId(newPreset.id);
    }
    setConfigOpen(false);
  }

  function deletePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    if (next.length > 0 && !next.some((p) => p.isDefault)) next[0].isDefault = true;
    savePresets(next);
    if (activePresetId === id) setActivePresetId(next[0]?.id ?? null);
  }

  function setDefault(id: string) {
    savePresets(presets.map((p) => ({ ...p, isDefault: p.id === id })));
  }

  const getFieldLabel = (path: string): string => {
    return INVOICE_FIELDS.find((f) => f.path === path)?.label ?? path;
  };

  // ── Sorting ──
  const [sortKey, setSortKey] = React.useState<string>(activeColumns[0] ?? "invoiceNumber");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  React.useEffect(() => {
    if (activeColumns.length > 0 && !activeColumns.includes(sortKey)) {
      setSortKey(activeColumns[0]);
    }
  }, [activeColumns.join(",")]);

  const sortOptions = React.useMemo(() => {
    if (activeColumns.length === 0) {
      return [{ value: "invoiceNumber", label: "Invoice #" }];
    }
    return activeColumns.map((path) => ({ value: path, label: getFieldLabel(path) }));
  }, [activeColumns]);

  // ── Data loading ──
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
    } catch {
      toast.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, directionFilter, premiumTypeFilter, flowFilter]);

  React.useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  // Sorted + filtered invoices
  const sorted = React.useMemo(() => {
    const r = [...invoices];
    r.sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [invoices, sortKey, sortDir]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((inv) =>
      inv.invoiceNumber.toLowerCase().includes(q) ||
      (inv.entityName ?? "").toLowerCase().includes(q) ||
      (inv.notes ?? "").toLowerCase().includes(q) ||
      inv.status.toLowerCase().includes(q) ||
      inv.premiumType.toLowerCase().includes(q)
    );
  }, [sorted, query]);

  // ── Drawer ──
  const loadDetail = React.useCallback(async (invoiceId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      toast.error("Failed to load invoice details");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function openDetails(invoiceId: number) {
    setOpenId(invoiceId);
    setDetail(null);
    void loadDetail(invoiceId);
    requestAnimationFrame(() => setDrawerOpen(true));
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => {
      setOpenId(null);
      setDetail(null);
    }, 350);
  }

  async function refreshCurrent() {
    if (!openId) return;
    setRefreshing(true);
    await loadDetail(openId);
    setRefreshing(false);
  }

  function handleInvoiceUpdated() {
    void loadInvoices();
    if (openId) void loadDetail(openId);
  }

  // ── Summary ──
  const summaryStats = React.useMemo(() => {
    const payable = invoices.filter((i) => i.direction === "payable");
    const receivable = invoices.filter((i) => i.direction === "receivable");
    const pendingVerification = invoices.filter((i) => i.status === "submitted");
    return {
      totalPayable: payable.reduce((s, i) => s + i.totalAmountCents - i.paidAmountCents, 0),
      totalReceivable: receivable.reduce((s, i) => s + i.totalAmountCents - i.paidAmountCents, 0),
      totalGain: invoices.reduce((s, i) => s + (i.totalGainCents ?? 0), 0),
      pendingCount: pendingVerification.length,
      overdueCount: invoices.filter((i) => i.status === "overdue").length,
    };
  }, [invoices]);

  const functionTabs: DrawerTab[] | undefined = detail
    ? [
        {
          id: "payments",
          label: "Payments",
          icon: <CreditCard className="h-3 w-3" />,
          content: <InvoiceOverviewTab invoice={detail} section="payments" onUpdated={handleInvoiceUpdated} />,
        },
        {
          id: "documents",
          label: "Documents",
          icon: <FileText className="h-3 w-3" />,
          content: <InvoiceOverviewTab invoice={detail} section="documents" onUpdated={handleInvoiceUpdated} />,
        },
        {
          id: "docstatus",
          label: "Doc Status",
          icon: <Upload className="h-3 w-3" />,
          content: <InvoiceOverviewTab invoice={detail} section="lifecycle" onUpdated={handleInvoiceUpdated} />,
        },
      ]
    : undefined;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-red-100 p-2 dark:bg-red-900"><DollarSign className="h-5 w-5 text-red-600 dark:text-red-400" /></div>
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Total Payable</p>
                <p className="text-lg font-semibold text-red-600 dark:text-red-400">{fmtCurrency(summaryStats.totalPayable)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-100 p-2 dark:bg-green-900"><DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" /></div>
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Total Receivable</p>
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">{fmtCurrency(summaryStats.totalReceivable)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-100 p-2 dark:bg-emerald-900"><TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /></div>
              <div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Total Gain</p>
                <p className={cn("text-lg font-semibold", summaryStats.totalGain >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                  {summaryStats.totalGain > 0 ? "+" : ""}{fmtCurrency(summaryStats.totalGain)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-orange-100 p-2 dark:bg-orange-900"><FileText className="h-5 w-5 text-orange-600 dark:text-orange-400" /></div>
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
              <div className="rounded-lg bg-yellow-100 p-2 dark:bg-yellow-900"><Receipt className="h-5 w-5 text-yellow-600 dark:text-yellow-400" /></div>
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

      {/* Row 1: Search input + Search button + Actions */}
      <div className="flex items-center gap-2">
        <Input placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => setQuery((q) => q)}>Search</Button>
        <RowActionMenu
          label="Actions"
          actions={[
            { label: "New Invoice", icon: <Plus className="h-4 w-4" />, onClick: () => setShowCreateDialog(true) },
            { label: "Filters", icon: <Filter className="h-4 w-4" />, onClick: () => setShowFilters((v) => !v) },
            { label: "Refresh", icon: <RefreshCw className="h-4 w-4" />, onClick: () => void loadInvoices() },
          ]}
        />
      </div>

      {/* Row 2: Views + Sort */}
      <div className="flex flex-wrap items-center gap-2">

        <div className="ml-auto flex items-center gap-2 text-sm">
          {presets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-auto max-w-20 flex-col gap-0 py-1 sm:h-9 sm:max-w-none sm:flex-row sm:gap-1.5 sm:py-0">
                  <span className="truncate text-[9px] leading-tight sm:text-xs">{activePreset?.name ?? "View"}</span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Saved Views</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {presets.map((p) => (
                  <DropdownMenuCheckboxItem
                    key={p.id}
                    checked={activePresetId === p.id}
                    onCheckedChange={() => setActivePresetId(p.id)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="flex-1">{p.name}</span>
                    {p.isDefault && <span className="ml-1 text-[10px] text-neutral-400">default</span>}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {activePreset && (
            <Button variant="outline" size="sm" className="h-auto flex-col gap-0 py-1 sm:h-9 sm:flex-row sm:gap-1 sm:py-0" onClick={() => openEditPreset(activePreset)}>
              <span className="text-[9px] leading-tight sm:hidden">Edit</span>
              <Settings2 className="h-4 w-4" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-auto flex-col gap-0 py-1 sm:h-9 sm:flex-row sm:gap-1.5 sm:py-0" onClick={openNewPreset}>
            <span className="text-[9px] leading-tight sm:hidden">{presets.length === 0 ? "Set Up" : "New"}</span>
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">{presets.length === 0 ? "Set Up Columns" : "New View"}</span>
          </Button>
          <label className="hidden sm:inline text-neutral-500 dark:text-neutral-400">Sort</label>
          <CompactSelect
            options={sortOptions}
            value={sortKey}
            onChange={setSortKey}
            icon={<ArrowUpDown />}
            iconLabel="Sort"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="h-auto flex-col gap-0 py-1 sm:h-9 sm:flex-row sm:py-0"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            <span className="text-[9px] leading-tight sm:hidden">{sortDir === "asc" ? "Asc" : "Desc"}</span>
            {sortDir === "asc" ? <ChevronUp className="h-4 w-4 sm:hidden" /> : <ChevronDown className="h-4 w-4 sm:hidden" />}
            <span className="hidden sm:inline">{sortDir === "asc" ? "Asc" : "Desc"}</span>
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Flow</label>
              <select value={flowFilter} onChange={(e) => setFlowFilter(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                <option value="">All Flows</option>
                {flowOptions.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Direction</label>
              <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                <option value="">All Directions</option>
                <option value="payable">Payable (We Pay)</option>
                <option value="receivable">Receivable (We Receive)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Premium Type</label>
              <select value={premiumTypeFilter} onChange={(e) => setPremiumTypeFilter(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                <option value="">All Types</option>
                <option value="net_premium">Net Premium</option>
                <option value="agent_premium">Agent Premium</option>
                <option value="client_premium">Client Premium</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
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
      <div>
        <Table>
          <TableHeader>
            <TableRow>
              {activeColumns.length > 0 ? (
                activeColumns.map((path) => (
                  <TableHead key={path} className="text-xs">{getFieldLabel(path)}</TableHead>
                ))
              ) : (
                <TableHead>
                  <button
                    type="button"
                    onClick={openNewPreset}
                    className="text-neutral-400 underline decoration-dashed underline-offset-4 hover:text-neutral-600 dark:hover:text-neutral-300"
                  >
                    Set up columns...
                  </button>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length || 1} className="py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeColumns.length || 1} className="py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  No invoices found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer group border-l-2 border-l-transparent transition-colors hover:bg-neutral-50/60 dark:hover:bg-neutral-900/60 hover:border-l-yellow-500"
                  onClick={() => openDetails(inv.id)}
                >
                  {activeColumns.length > 0 ? (
                    activeColumns.map((path) => (
                      <TableCell key={path} className="max-w-[200px] text-sm">
                        {getColumnValue(inv, path)}
                      </TableCell>
                    ))
                  ) : (
                    <TableCell className="font-mono text-neutral-400">
                      {inv.invoiceNumber}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Left-side drawer for invoice details */}
      <RecordDetailsDrawer
        open={openId !== null}
        drawerOpen={drawerOpen}
        onClose={closeDrawer}
        title={detail ? `Invoice ${detail.invoiceNumber}` : "Invoice Details"}
        loading={detailLoading}
        onRefresh={refreshCurrent}
        refreshing={refreshing}
        functionTabs={functionTabs}
      >
        {detail ? (
          <InvoiceOverviewTab invoice={detail} section="overview" onUpdated={handleInvoiceUpdated} />
        ) : detailLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-neutral-500">Invoice not found</div>
        )}
      </RecordDetailsDrawer>

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

      {/* Column preset configuration dialog */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingPreset ? "Edit View" : "Set Up Table Columns"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">View Name</label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. My Default View" />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium">
                  Columns <span className="font-normal text-neutral-400">({draftColumns.length}/{MAX_COLS})</span>
                </label>
                {draftColumns.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setDraftColumns([])}>Clear all</Button>
                )}
              </div>

              {draftColumns.length > 0 && (
                <div className="mb-3 space-y-1">
                  {draftColumns.map((path, i) => (
                    <div key={path} className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                      <span className="w-4 text-center text-[10px] font-medium text-neutral-400">{i + 1}</span>
                      <span className="flex-1">{getFieldLabel(path)}</span>
                      <button type="button" disabled={i === 0} onClick={() => setDraftColumns((prev) => { const next = [...prev]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; })} className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 disabled:opacity-20 dark:hover:text-neutral-200" title="Move up">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button type="button" disabled={i === draftColumns.length - 1} onClick={() => setDraftColumns((prev) => { const next = [...prev]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next; })} className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 disabled:opacity-20 dark:hover:text-neutral-200" title="Move down">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                      <button type="button" onClick={() => setDraftColumns((prev) => prev.filter((p) => p !== path))} className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200" title="Remove">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="max-h-80 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700">
                <div className="sticky top-0 border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
                  Invoice Fields
                </div>
                {INVOICE_FIELDS.map((f) => {
                  const checked = draftColumns.includes(f.path);
                  const disabled = !checked && draftColumns.length >= MAX_COLS;
                  return (
                    <label
                      key={f.path}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
                        disabled && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleDraftColumn(f.path)}
                        className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600"
                      />
                      <span>{f.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {presets.length > 0 && !editingPreset && (
              <div>
                <label className="mb-1 block text-sm font-medium">Saved Views</label>
                <div className="space-y-1">
                  {presets.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        {p.isDefault && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Default</span>
                        )}
                        <span className="text-xs text-neutral-400">{p.columns.length} cols</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {!p.isDefault && (
                          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setDefault(p.id)}>Set Default</Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => { setConfigOpen(false); setTimeout(() => openEditPreset(p), 150); }}>Edit</Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[11px] text-red-500 hover:text-red-600" onClick={() => deletePreset(p.id)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(false)}>Cancel</Button>
            <Button onClick={saveCurrentPreset} disabled={draftColumns.length === 0}>
              {editingPreset ? "Update View" : "Save View"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </>
      )}
    </div>
  );
}
