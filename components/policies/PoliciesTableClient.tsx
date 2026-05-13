"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Trash2, Ban, CheckCircle2, Info, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { deepEqual, formSnapshot } from "@/lib/form-utils";
import { RowActionMenu } from "@/components/ui/row-action-menu";
import dynamic from "next/dynamic";
import type { PolicyDetail } from "@/lib/types/policy";
import { RecordDetailsDrawer } from "@/components/ui/record-details-drawer";
import { FieldEditDialog, loadEditFields, type EditField } from "@/components/ui/field-edit-dialog";
import { getDisplayNameFromSnapshot } from "@/lib/field-resolver";
import { useTableViewPresets } from "@/lib/view-presets/use-table-view-presets";
import type { ViewPreset, ViewPresetColumnGroup } from "@/lib/view-presets/types";
import { TableViewPresetBar } from "@/components/ui/table-view-preset-bar";
import { TableViewPresetEditor } from "@/components/ui/table-view-preset-editor";
import { usePagination } from "@/lib/pagination/use-pagination";
import { Pagination } from "@/components/ui/pagination";
import { confirmDialog } from "@/components/ui/global-dialogs";

const PolicySnapshotView = dynamic(
  () => import("@/components/policies/PolicySnapshotView").then((m) => m.PolicySnapshotView),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);
const WorkflowTab = dynamic(
  () => import("@/components/policies/tabs/WorkflowTab").then((m) => m.WorkflowTab),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);
const AccountingTab = dynamic(
  () => import("@/components/policies/tabs/AccountingTab").then((m) => m.AccountingTab),
  { loading: () => <div className="py-4 text-center text-sm text-neutral-400">Loading...</div> },
);
import { Activity, DollarSign } from "lucide-react";
import type { DrawerTab } from "@/components/ui/drawer-tabs";
import { formatDDMMYYYYHHMM } from "@/lib/format/date";
import { useSession } from "next-auth/react";
import { StickyNote, ChevronDown, ChevronUp, Eye, X, ArrowUpDown } from "lucide-react";
import { CompactSelect } from "@/components/ui/compact-select";

type NoteEntry = { text: string; at: string; by?: { id?: number; email?: string } };

function NotesPanel({ notes, onDelete }: { notes: NoteEntry[]; onDelete?: (index: number) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const [deletingIdx, setDeletingIdx] = React.useState<number | null>(null);
  if (notes.length === 0) return null;

  const visible = expanded ? notes : notes.slice(-3);
  const hasMore = notes.length > 3;
  const offset = expanded ? 0 : Math.max(0, notes.length - 3);

  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <StickyNote className="h-3.5 w-3.5" />
          Notes
          <span className="text-[10px] font-normal text-neutral-400">({notes.length})</span>
        </div>
        {hasMore && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1 text-[11px]"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Show less" : `Show all ${notes.length}`}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span className="hidden sm:inline">{expanded ? "Show less" : `Show all ${notes.length}`}</span>
            <span className="sm:hidden">{expanded ? "Less" : notes.length}</span>
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((n, visIdx) => {
          const realIdx = offset + visIdx;
          return (
            <div
              key={`note-${realIdx}`}
              className="group relative rounded border border-neutral-100 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/50"
            >
              {onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    if (deletingIdx !== null) return;
                    setDeletingIdx(realIdx);
                    onDelete(realIdx);
                  }}
                  disabled={deletingIdx === realIdx}
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-600 group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-300"
                  title="Delete note"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <div className="whitespace-pre-wrap pr-5">{n.text}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-400 dark:text-neutral-500">
                <span>{formatDDMMYYYYHHMM(n.at)}</span>
                {n.by?.email && <span>{n.by.email}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Row = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
  isActive: boolean;
  displayName?: string;
  carExtra?: Record<string, unknown> | null;
};

function extractNameFromExtra(extra: Record<string, unknown> | null | undefined): string {
  if (!extra) return "";
  return getDisplayNameFromSnapshot({
    insuredSnapshot: extra.insuredSnapshot as Record<string, unknown> | null | undefined,
    packagesSnapshot: extra.packagesSnapshot as Record<string, unknown> | null | undefined,
  });
}

export default function PoliciesTableClient({
  initialRows,
  initialTotal,
  initialPageSize,
  entityLabel,
  flowKey,
  currentUserType,
  showMonthTabs,
}: {
  initialRows: Row[];
  /** Total row count for the SSR-seeded first page. Required when
   *  `initialRows` is provided; falls back to `initialRows.length` to keep
   *  pre-migration callers working. */
  initialTotal?: number;
  initialPageSize?: number;
  entityLabel?: string;
  /** Optional flow scope (`policyset`, `endorsement`, ...). Forwarded to
   *  `/api/policies?flow=...` so paging respects the same filter the
   *  server used for the first page. */
  flowKey?: string;
  currentUserType?: string;
  /** Whether to show the year + month tab strip above the table.
   *  Defaults to `true`. Pass `false` on pages where start-date
   *  filtering is not relevant (e.g. endorsements, client views). */
  showMonthTabs?: boolean;
}) {
  const label = entityLabel || "Policy";
  const showMonthTabsEffective = showMonthTabs !== false;
  const session = useSession();
  const sessionUserType = (session.data?.user as any)?.userType as string | undefined;
  const effectiveUserType = currentUserType ?? sessionUserType;
  const isAdmin = effectiveUserType === "admin" || effectiveUserType === "internal_staff";
  const isClientUser = effectiveUserType === "direct_client";

  // Month-year tab filter
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = React.useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = React.useState<number | null>(null); // null = All

  // Pagination: hook owns rows / total / page state. Optimistic updates
  // (toggle active, soft-delete, rename) go through the hook helpers so
  // they survive a refetch correctly.
  const paginationParams = React.useMemo(() => {
    const base: Record<string, string | number | boolean | null | undefined> = {};
    if (flowKey) base.flow = flowKey;
    if (selectedMonth !== null) {
      base.startYear = selectedYear;
      base.startMonth = selectedMonth;
    }
    return Object.keys(base).length > 0 ? base : undefined;
  }, [flowKey, selectedYear, selectedMonth]);
  const {
    rows,
    total,
    page,
    pageSize,
    loading: rowsLoading,
    setPage,
    setPageSize,
    patchRow,
    removeRow,
  } = usePagination<Row>({
    url: "/api/policies",
    scope: `policies:${entityLabel ?? "default"}`,
    params: paginationParams,
    initialRows,
    initialTotal: initialTotal ?? initialRows.length,
    initialPageSize: initialPageSize,
  });

  function patchRowById(id: number, next: Partial<Row>) {
    const idx = rows.findIndex((r) => r.policyId === id);
    if (idx >= 0) patchRow(idx, { ...rows[idx], ...next });
  }

  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [deepLinkSection, setDeepLinkSection] = React.useState<string | undefined>(undefined);
  const [deepLinkDocTemplate, setDeepLinkDocTemplate] = React.useState<string | undefined>(undefined);
  const [deepLinkDocAudience, setDeepLinkDocAudience] = React.useState<"client" | "agent" | undefined>(undefined);
  // `?openTab=accounting` jumps straight to the Accounting tab so links
  // from the Accounting dashboard (and the new "View statement" button)
  // land on the reconciled per-policy view — see the skill at
  // `.cursor/skills/accounting-view-reconciliation/SKILL.md`.
  const [deepLinkTabId, setDeepLinkTabId] = React.useState<string | undefined>(undefined);
  const [detail, setDetail] = React.useState<PolicyDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [openingId, setOpeningId] = React.useState<number | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  // Edit dialog state
  const [editOpen, setEditOpen] = React.useState(false);
  const [editPkg, setEditPkg] = React.useState("");
  const [editPkgLabel, setEditPkgLabel] = React.useState("");
  const [editFields, setEditFields] = React.useState<EditField[]>([]);
  const [editValues, setEditValues] = React.useState<Record<string, unknown>>({});
  const [editLoading, setEditLoading] = React.useState(false);
  const [editSaving, setEditSaving] = React.useState(false);
  const editInitialSnapshotRef = React.useRef<Record<string, unknown>>({});
  // Toggle active confirm dialog
  const [toggleConfirm, setToggleConfirm] = React.useState<{ id: number; currentlyActive: boolean } | null>(null);
  const [toggling, setToggling] = React.useState(false);

  const MAX_COLS = 4;
  const PRESETS_KEY = `policies-presets-${entityLabel ?? "default"}`;

  type FieldOption = { path: string; label: string };
  type FieldGroup = { groupKey: string; groupLabel: string; fields: FieldOption[] };

  const BUILTIN_FIELDS: FieldOption[] = [
    { path: "_builtin.policyNumber", label: `${label} #` },
    { path: "_builtin.displayName", label: "Name" },
    { path: "_builtin.createdAt", label: "Created Date" },
    { path: "_builtin.isActive", label: "Status" },
  ];

  const flattenExtra = React.useCallback((extra: Record<string, unknown> | null | undefined): Record<string, unknown> => {
    if (!extra) return {};
    const flat: Record<string, unknown> = {};
    const insured = extra.insuredSnapshot as Record<string, unknown> | undefined;
    const pkgs = extra.packagesSnapshot as Record<string, unknown> | undefined;
    if (insured && typeof insured === "object") {
      for (const [k, v] of Object.entries(insured)) {
        if (v === null || v === undefined || (typeof v === "string" && !v.trim())) continue;
        if (typeof v === "object" && !Array.isArray(v)) continue;
        flat[`insured.${k}`] = v;
      }
    }
    if (pkgs && typeof pkgs === "object") {
      for (const [pkg, entry] of Object.entries(pkgs)) {
        if (!entry || typeof entry !== "object") continue;
        const vals = ("values" in (entry as Record<string, unknown>)
          ? (entry as { values?: Record<string, unknown> }).values
          : entry) as Record<string, unknown> | undefined;
        if (!vals || typeof vals !== "object") continue;
        for (const [k, v] of Object.entries(vals)) {
          if (v === null || v === undefined || (typeof v === "string" && !v.trim())) continue;
          if (typeof v === "object" && !Array.isArray(v)) continue;
          flat[`pkg.${pkg}.${k}`] = v;
        }
      }
    }
    return flat;
  }, []);

  const humanizeKey = (raw: string): string => {
    let stripped = raw.replace(/^[a-zA-Z0-9]+__/, "").replace(/^_+/, "");
    stripped = stripped.replace(/__+/g, " ").replace(/_+/g, " ");
    stripped = stripped.replace(/([a-z])([A-Z])/g, "$1 $2");
    return stripped.replace(/\b\w/g, (c) => c.toUpperCase()).trim() || raw;
  };

  const pkgNames = React.useMemo(() => {
    const names = new Set<string>();
    names.add("insured");
    for (const r of rows) {
      const pkgs = (r.carExtra as Record<string, unknown> | undefined)?.packagesSnapshot as Record<string, unknown> | undefined;
      if (pkgs) for (const k of Object.keys(pkgs)) names.add(k);
    }
    return Array.from(names);
  }, [rows]);

  const [fieldLabels, setFieldLabels] = React.useState<Record<string, string>>({});
  const [fieldSortOrders, setFieldSortOrders] = React.useState<Record<string, number>>({});
  const [fieldLabelCases, setFieldLabelCases] = React.useState<Record<string, "original" | "upper" | "lower" | "title">>({});
  const [packageLabels, setPackageLabels] = React.useState<Record<string, string>>({});
  const [packageSortOrders, setPackageSortOrders] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    if (pkgNames.length === 0) return;
    let cancelled = false;
    const ts = Date.now();
    Promise.all([
      fetch(`/api/form-options?groupKey=packages&_t=${ts}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ...pkgNames.map((pkg) =>
        fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}&_t=${ts}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : [])).catch(() => [])
          .then((fRows: Array<{ value?: string; label?: string; sortOrder?: number; meta?: { labelCase?: "original" | "upper" | "lower" | "title" } | null }>) => ({ pkg, fRows }))
      ),
    ]).then(([pkgRows, ...fieldResults]) => {
      if (cancelled) return;
      const pLabels: Record<string, string> = { insured: "Insured" };
      const pOrders: Record<string, number> = { insured: -1 };
      if (Array.isArray(pkgRows)) {
        for (const row of pkgRows as Array<{ value?: string; label?: string; sortOrder?: number }>) {
          const key = String(row?.value ?? "").trim();
          const lbl = String(row?.label ?? "").trim();
          if (key && lbl) pLabels[key] = lbl;
          if (key) {
            const so = Number(row?.sortOrder);
            pOrders[key] = Number.isFinite(so) ? so : 0;
          }
        }
      }
      setPackageLabels(pLabels);
      setPackageSortOrders(pOrders);
      const labels: Record<string, string> = {};
      const orders: Record<string, number> = {};
      const cases: Record<string, "original" | "upper" | "lower" | "title"> = {};
      for (const { pkg, fRows } of fieldResults as Array<{ pkg: string; fRows: Array<{ value?: string; label?: string; sortOrder?: number; meta?: { labelCase?: "original" | "upper" | "lower" | "title" } | null }> }>) {
        if (!Array.isArray(fRows)) continue;
        for (const row of fRows) {
          const key = String(row?.value ?? "").trim();
          const rawLbl = String(row?.label ?? "").trim();
          if (!key || !rawLbl) continue;
          const labelCase = row?.meta?.labelCase;
          const lbl = !labelCase || labelCase === "original" ? rawLbl
            : labelCase === "upper" ? rawLbl.toUpperCase()
            : labelCase === "lower" ? rawLbl.toLowerCase()
            : rawLbl.replace(/\b\w/g, (c) => c.toUpperCase());
          const so = Number(row?.sortOrder);
          const order = Number.isFinite(so) ? so : 0;
          const effectiveCase = (labelCase ?? "original") as "original" | "upper" | "lower" | "title";
          const prefixes = pkg === "insured" ? ["insured"] : [`pkg.${pkg}`];
          for (const pfx of prefixes) {
            labels[`${pfx}.${key}`] = lbl;
            labels[`${pfx}.${pkg}__${key}`] = lbl;
            labels[`${pfx}.${pkg}_${key}`] = lbl;
            orders[`${pfx}.${key}`] = order;
            orders[`${pfx}.${pkg}__${key}`] = order;
            orders[`${pfx}.${pkg}_${key}`] = order;
            cases[`${pfx}.${key}`] = effectiveCase;
            cases[`${pfx}.${pkg}__${key}`] = effectiveCase;
            cases[`${pfx}.${pkg}_${key}`] = effectiveCase;
          }
        }
      }
      setFieldLabels(labels);
      setFieldSortOrders(orders);
      setFieldLabelCases(cases);
    });
    return () => { cancelled = true; };
  }, [pkgNames.join(",")]);

  const getFieldLabel = React.useCallback((path: string): string => {
    const builtin = BUILTIN_FIELDS.find((b) => b.path === path);
    if (builtin) return builtin.label;
    if (fieldLabels[path]) return fieldLabels[path];
    const parts = path.split(".");
    const raw = parts[parts.length - 1];
    const stripped = raw.replace(/^[a-zA-Z0-9]+__/, "").replace(/^_+/, "");
    const normalizedPath = parts.length === 3
      ? `pkg.${parts[1]}.${stripped}` : parts.length === 2 ? `insured.${stripped}` : path;
    if (fieldLabels[normalizedPath]) return fieldLabels[normalizedPath];
    return humanizeKey(raw);
  }, [fieldLabels, label]);

  const getFieldSortOrder = React.useCallback((path: string): number => {
    if (fieldSortOrders[path] !== undefined) return fieldSortOrders[path];
    const parts = path.split(".");
    const raw = parts[parts.length - 1];
    const stripped = raw.replace(/^[a-zA-Z0-9]+__/, "").replace(/^_+/, "");
    const normalizedPath = parts.length === 3
      ? `pkg.${parts[1]}.${stripped}` : parts.length === 2 ? `insured.${stripped}` : path;
    if (fieldSortOrders[normalizedPath] !== undefined) return fieldSortOrders[normalizedPath];
    return 9999;
  }, [fieldSortOrders]);

  const availableFields = React.useMemo<FieldOption[]>(() => {
    const pathSet = new Set<string>();
    for (const r of rows) {
      const flat = flattenExtra(r.carExtra);
      for (const path of Object.keys(flat)) pathSet.add(path);
    }
    return Array.from(pathSet)
      .map((path) => ({ path, label: getFieldLabel(path) }))
      .sort((a, b) => {
        const oa = getFieldSortOrder(a.path);
        const ob = getFieldSortOrder(b.path);
        if (oa !== ob) return oa - ob;
        return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
      });
  }, [rows, flattenExtra, getFieldLabel, getFieldSortOrder]);

  const groupedFields = React.useMemo<FieldGroup[]>(() => {
    const groups = new Map<string, FieldOption[]>();
    groups.set("_builtin", [...BUILTIN_FIELDS]);
    for (const f of availableFields) {
      const parts = f.path.split(".");
      const groupKey = parts[0] === "insured" ? "insured" : (parts[1] ?? "other");
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(f);
    }
    const builtinLabel: Record<string, string> = { _builtin: "General" };
    return Array.from(groups.entries())
      .map(([groupKey, fields]) => ({
        groupKey,
        groupLabel: builtinLabel[groupKey] || packageLabels[groupKey] || humanizeKey(groupKey),
        fields,
      }))
      .sort((a, b) => {
        if (a.groupKey === "_builtin") return -1;
        if (b.groupKey === "_builtin") return 1;
        const oa = packageSortOrders[a.groupKey] ?? 9999;
        const ob = packageSortOrders[b.groupKey] ?? 9999;
        if (oa !== ob) return oa - ob;
        return a.groupLabel.localeCompare(b.groupLabel, undefined, { sensitivity: "base" });
      });
  }, [availableFields, packageLabels, packageSortOrders, label]);

  const columnGroups = React.useMemo<ViewPresetColumnGroup[]>(
    () =>
      groupedFields.map((g) => ({
        groupKey: g.groupKey,
        groupLabel: g.groupLabel,
        options: g.fields.map((f) => ({ path: f.path, label: f.label })),
      })),
    [groupedFields],
  );

  const presetScope = entityLabel ?? "default";
  const {
    presets,
    activePresetId,
    setActivePresetId,
    activePreset,
    upsertPreset,
    deletePreset,
    setDefault,
  } = useTableViewPresets({ scope: presetScope, legacyLocalStorageKey: PRESETS_KEY });
  const activeColumns = activePreset?.columns ?? [];

  const [configOpen, setConfigOpen] = React.useState(false);
  const [editingPreset, setEditingPreset] = React.useState<ViewPreset | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftColumns, setDraftColumns] = React.useState<string[]>([]);

  function openNewPreset() {
    setEditingPreset(null);
    setDraftName(`View ${presets.length + 1}`);
    setDraftColumns([]);
    setConfigOpen(true);
  }

  function openEditPreset(preset: ViewPreset) {
    setEditingPreset(preset);
    setDraftName(preset.name);
    setDraftColumns([...preset.columns]);
    setConfigOpen(true);
  }

  function saveCurrentPreset() {
    const name = draftName.trim() || "Untitled";
    if (draftColumns.length === 0) {
      toast.error("Select at least one column");
      return;
    }
    if (editingPreset) {
      const updated = upsertPreset({
        ...editingPreset,
        name,
        columns: draftColumns,
      });
      if (!updated) return;
    } else {
      const created = upsertPreset({
        id: `preset_${Date.now()}`,
        name,
        columns: draftColumns,
        isDefault: presets.length === 0,
      });
      if (!created) return;
      setActivePresetId(created.id);
    }
    setConfigOpen(false);
  }

  function applyCaseToText(text: string, mode?: "original" | "upper" | "lower" | "title"): string {
    if (!mode || mode === "original") return text;
    if (mode === "upper") return text.toUpperCase();
    if (mode === "lower") return text.toLowerCase();
    // Title: lowercase everything first, then capitalise the first letter of each word.
    // Without the lowercase step, "KWAN SIU MAN" stays all-caps because the
    // regex only touches the first character of each word — the rest are unchanged.
    return text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // For the built-in displayName column, derive the case from the most
  // representative insured name field — try lastName → firstName → companyName.
  function getDisplayNameCase(): "original" | "upper" | "lower" | "title" {
    const candidates = [
      "insured.lastName", "insured.lastname", "insured.last_name",
      "insured.firstName", "insured.firstname", "insured.first_name",
      "insured.companyName", "insured.companyname", "insured.company_name",
    ];
    for (const k of candidates) {
      const c = fieldLabelCases[k];
      if (c && c !== "original") return c;
    }
    return "original";
  }

  function getColumnValue(row: Row, path: string): React.ReactNode {
    if (path === "_builtin.policyNumber") {
      return <span className="font-mono">{row.policyNumber}</span>;
    }
    if (path === "_builtin.displayName") {
      // displayName is pre-computed for SSR rows; fall back to extractNameFromExtra
      // for rows fetched client-side (e.g. after changing page size) where the API
      // only returns carExtra, not a pre-computed displayName.
      const name = row.displayName || extractNameFromExtra(row.carExtra);
      if (!name) return <span className="text-neutral-400">—</span>;
      return applyCaseToText(name, getDisplayNameCase());
    }
    if (path === "_builtin.createdAt") return formatDDMMYYYYHHMM(row.createdAt);
    if (path === "_builtin.isActive") {
      return (
        <span className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          row.isActive !== false
            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
        )}>
          {row.isActive !== false ? "Active" : "Inactive"}
        </span>
      );
    }
    const flat = flattenExtra(row.carExtra);
    const v = flat[path];
    if (v === null || v === undefined) return <span className="text-neutral-400">—</span>;
    if (Array.isArray(v)) return v.map(String).join(", ");
    if (typeof v === "boolean") return v ? "Yes" : "No";
    const text = String(v);
    const fieldCase = fieldLabelCases[path];
    return applyCaseToText(text, fieldCase);
  }

  // Sorting — dynamic based on active view columns
  const [sortKey, setSortKey] = React.useState<string>(activeColumns[0] ?? "_builtin.policyNumber");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  React.useEffect(() => {
    if (activeColumns.length > 0 && !activeColumns.includes(sortKey)) {
      setSortKey(activeColumns[0]);
    }
  }, [activeColumns.join(",")]);

  const sortOptions = React.useMemo(() => {
    if (activeColumns.length === 0) {
      return [{ value: "_builtin.policyNumber", label: `${label} #` }];
    }
    return activeColumns.map((path) => ({ value: path, label: getFieldLabel(path) }));
  }, [activeColumns, getFieldLabel, label]);

  function getSortValue(row: Row, path: string): string | number {
    if (path === "_builtin.policyNumber") return row.policyNumber;
    if (path === "_builtin.displayName") return row.displayName ?? "";
    if (path === "_builtin.createdAt") return Date.parse(row.createdAt) || 0;
    if (path === "_builtin.isActive") return row.isActive !== false ? 1 : 0;
    const flat = flattenExtra(row.carExtra);
    const v = flat[path];
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return v;
    if (typeof v === "boolean") return v ? 1 : 0;
    return String(v);
  }

  const sorted = React.useMemo(() => {
    const r = [...rows];
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
  }, [rows, sortKey, sortDir, flattenExtra]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) =>
      r.policyNumber.toLowerCase().includes(q) ||
      (r.displayName ?? "").toLowerCase().includes(q)
    );
  }, [sorted, query]);

  async function openDetails(id: number, opts?: { silent?: boolean }): Promise<PolicyDetail | null> {
    if (!opts?.silent) {
      setOpenId(id);
      setDetail(null);
      setLoading(true);
      setDrawerOpen(false);
      requestAnimationFrame(() => setDrawerOpen(true));
      setOpeningId(id);
    }
    try {
      const res = await fetch(`/api/policies/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setDetail(json);
      return json as PolicyDetail;
    } catch (err: unknown) {
      const message = (err as { message?: string } | undefined)?.message ?? "Failed to load details";
      if (!opts?.silent) toast.error(message);
      if (!opts?.silent) {
        setDrawerOpen(false);
        setTimeout(() => setOpenId(null), 250);
      }
      return null;
    } finally {
      if (!opts?.silent) {
        setLoading(false);
        setOpeningId(null);
      }
    }
  }

  async function refreshCurrent() {
    if (openId === null || refreshing) return;
    setRefreshing(true);
    try {
      await openDetails(openId, { silent: true });
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteNote(noteIndex: number) {
    if (!detail) return;
    try {
      const res = await fetch(`/api/policies/${detail.policyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteNoteIndex: noteIndex }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Note deleted");
      await openDetails(detail.policyId, { silent: true });
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Failed to delete note");
    }
  }

  const detailFlowKey = React.useMemo(
    () => (detail as any)?.flowKey ?? ((detail?.extraAttributes as Record<string, unknown> | undefined)?.flowKey as string) ?? undefined,
    [detail],
  );

  const premiumTabConfig = React.useMemo(() => {
    const fk = (detailFlowKey ?? "").toLowerCase();
    if (fk === "appaccounting") return null;
    if (fk === "policyset" || fk === "" || !detailFlowKey) return { label: "Premium", context: "policy" as const };
    if (fk.includes("endorsement")) return { label: "Endorsement Premium", context: "self" as const };
    if (fk.includes("collaborator") || fk === "collaboratorset") return { label: "Premium Payable", context: "collaborator" as const };
    if (fk.includes("insurance") || fk === "insuranceset") return { label: "Insurer Premium", context: "insurer" as const };
    if (fk.includes("client")) return { label: "Client Premium", context: "client" as const };
    if (fk.includes("agent")) return { label: "Agent Settlement", context: "agent" as const };
    return null;
  }, [detailFlowKey]);

  const snapshotHiddenPkgs = React.useMemo(() => {
    const hidden = new Set<string>();
    if (premiumTabConfig) {
      hidden.add("accounting");
      hidden.add("premiumRecord");
    }
    return hidden.size > 0 ? hidden : undefined;
  }, [premiumTabConfig]);


  const isOwnPackage = React.useCallback((pkgName: string): boolean => {
    const fk = (detailFlowKey ?? "").toLowerCase();
    const pk = pkgName.toLowerCase();
    if (fk === "appaccounting") {
      return pk === "accounting" || pk === "premiumrecord";
    }
    // policyset and clientSet both own insured/contactinfo
    if (fk === "policyset" || fk === "clientset" || fk === "" || !detailFlowKey) {
      return pk !== "accounting" && pk !== "premiumrecord";
    }
    // Other flows (collaboratorSet, InsuranceSet, agentSet, etc.)
    // own their specific packages but NOT insured/contactinfo or premium
    return pk !== "accounting" && pk !== "premiumrecord"
      && pk !== "insured" && pk !== "contactinfo";
  }, [detailFlowKey]);

  async function openEditDialog(pkgName: string, pkgLabel: string, currentValues: Record<string, unknown>) {
    editInitialSnapshotRef.current = {};
    setEditPkg(pkgName);
    setEditPkgLabel(pkgLabel);
    setEditValues({ ...currentValues });
    setEditFields([]);
    setEditOpen(true);
    setEditLoading(true);
    try {
      const lookupPkg = pkgName === "accounting" ? "premiumRecord" : pkgName;
      const { fields, values } = await loadEditFields(lookupPkg, currentValues, pkgName);
      setEditFields(fields);
      setEditValues(values);
      editInitialSnapshotRef.current = formSnapshot(values);
    } catch {
      toast.error("Failed to load field definitions");
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEdit() {
    if (!detail || !editPkg) return;
    if (deepEqual(formSnapshot(editValues), editInitialSnapshotRef.current)) {
      toast.info("No changes to save");
      return;
    }
    setEditSaving(true);
    try {
      const snap = (detail.extraAttributes ?? {}) as Record<string, unknown>;
      const isInsuredPkg = editPkg === "insured" || editPkg === "contactinfo";

      const pkgsSnap = (snap.packagesSnapshot ?? {}) as Record<string, unknown>;
      const insuredAlsoInPkgs = isInsuredPkg && editPkg in pkgsSnap;

      const initial = editInitialSnapshotRef.current;
      const changedOnly: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(editValues)) {
        const oldVal = initial[key];
        if (JSON.stringify(val ?? null) !== JSON.stringify(oldVal ?? null)) {
          changedOnly[key] = val;
        }
      }

      if (isInsuredPkg) {
        const insured = { ...((snap.insuredSnapshot ?? {}) as Record<string, unknown>) };
        for (const [key, val] of Object.entries(changedOnly)) {
          const prefixed2 = `${editPkg}__${key}`;
          const prefixed1 = `${editPkg}_${key}`;
          let found = false;
          if (prefixed2 in insured) { insured[prefixed2] = val; found = true; }
          if (prefixed1 in insured) { insured[prefixed1] = val; found = true; }
          if (key in insured) { insured[key] = val; found = true; }
          if (!found) insured[`${editPkg}_${key}`] = val;
        }

        if (insuredAlsoInPkgs) {
          const pkgs = { ...pkgsSnap };
          const existingPkg = (pkgs[editPkg] ?? {}) as Record<string, unknown>;
          const isStructured = existingPkg && typeof existingPkg === "object" && ("values" in existingPkg || "category" in existingPkg);
          const oldValues: Record<string, unknown> = isStructured
            ? { ...((existingPkg as { values?: Record<string, unknown> }).values ?? {}) }
            : { ...existingPkg };
          const remapped: Record<string, unknown> = { ...oldValues };
          for (const [key, val] of Object.entries(changedOnly)) {
            const prefixed2 = `${editPkg}__${key}`;
            const prefixed1 = `${editPkg}_${key}`;
            if (key in remapped) {
              remapped[key] = val;
            } else if (prefixed2 in remapped) {
              remapped[prefixed2] = val;
            } else if (prefixed1 in remapped) {
              remapped[prefixed1] = val;
            } else {
              remapped[key] = val;
            }
          }
          if (isStructured) {
            pkgs[editPkg] = { ...existingPkg, values: remapped };
          } else {
            pkgs[editPkg] = remapped;
          }
          const res = await fetch(`/api/policies/${detail.policyId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ insured, packages: pkgs }),
          });
          if (!res.ok) throw new Error(await res.text());
        } else {
          const res = await fetch(`/api/policies/${detail.policyId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ insured }),
          });
          if (!res.ok) throw new Error(await res.text());
        }
      } else {
        const pkgs = { ...((snap.packagesSnapshot ?? {}) as Record<string, unknown>) };
        const existingPkg = (pkgs[editPkg] ?? {}) as Record<string, unknown>;
        const isStructured = existingPkg && typeof existingPkg === "object" && ("values" in existingPkg || "category" in existingPkg);
        const oldValues: Record<string, unknown> = isStructured
          ? ((existingPkg as { values?: Record<string, unknown> }).values ?? {})
          : { ...existingPkg };

        const remapped: Record<string, unknown> = { ...oldValues };
        for (const [key, val] of Object.entries(changedOnly)) {
          const prefixed2 = `${editPkg}__${key}`;
          const prefixed1 = `${editPkg}_${key}`;
          if (key in remapped) {
            remapped[key] = val;
          } else if (prefixed2 in remapped) {
            remapped[prefixed2] = val;
          } else if (prefixed1 in remapped) {
            remapped[prefixed1] = val;
          } else {
            remapped[key] = val;
          }
        }

        if (isStructured) {
          pkgs[editPkg] = { ...existingPkg, values: remapped };
        } else {
          pkgs[editPkg] = remapped;
        }
        const res = await fetch(`/api/policies/${detail.policyId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ packages: pkgs }),
        });
        if (!res.ok) throw new Error(await res.text());
      }

      toast.success("Saved");
      setEditOpen(false);
      const updated = await openDetails(detail.policyId, { silent: true });
      if (updated) {
        const newName = extractNameFromExtra(updated.extraAttributes as Record<string, unknown> | undefined);
        const idx = rows.findIndex((x) => x.policyId === detail.policyId);
        if (idx >= 0) patchRow(idx, { ...rows[idx], displayName: newName || rows[idx].displayName });
      }
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Save failed");
    } finally {
      setEditSaving(false);
    }
  }

  // Open details automatically when policyId is provided via query string
  React.useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const raw = sp.get("policyId") ?? sp.get("open") ?? sp.get("id");
      const openSection = sp.get("openSection") ?? undefined;
      const docTemplate = sp.get("docTemplate") ?? undefined;
      const docAudienceRaw = sp.get("docAudience");
      const docAudience = docAudienceRaw === "agent" || docAudienceRaw === "client"
        ? docAudienceRaw
        : undefined;
      const openTab = sp.get("openTab") ?? undefined;
      const id = Number(raw);
      if (Number.isFinite(id) && id > 0) {
        setDeepLinkSection(openSection);
        setDeepLinkDocTemplate(docTemplate);
        setDeepLinkDocAudience(docAudience);
        setDeepLinkTabId(openTab);
        void openDetails(id);
      }
    } catch {
      // ignore
    }
  }, []);

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setOpenId(null), 250);
  }

  async function confirmToggleActive() {
    if (!toggleConfirm) return;
    const { id, currentlyActive } = toggleConfirm;
    setToggling(true);
    try {
      const res = await fetch(`/api/policies/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !currentlyActive }),
      });
      if (!res.ok) throw new Error(await res.text());
      patchRowById(id, { isActive: !currentlyActive });
      toast.success(currentlyActive ? "Record disabled" : "Record enabled");
      setToggleConfirm(null);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? `Failed to ${currentlyActive ? "disable" : "enable"}`);
    } finally {
      setToggling(false);
    }
  }

  async function remove(id: number) {
    const ok = await confirmDialog({
      title: "Delete this record?",
      description: "This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/policies/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Delete failed");

      if (data.softDeleted) {
        patchRowById(id, { isActive: false });
        toast.success(data.message ?? "Endorsement deactivated and changes rolled back.");
      } else {
        removeRow((x) => x.policyId === id);
        toast.success("Deleted");
      }
      if (openId === id) closeDrawer();
    } catch (err: unknown) {
      const message = (err as { message?: string } | undefined)?.message ?? "Delete failed";
      toast.error(message);
    }
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <div className="space-y-3">
      {/* Month / year tab strip — hidden when showMonthTabs={false} */}
      {showMonthTabsEffective && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-900/50">
          {/* Year selector */}
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
          {/* "All" tab */}
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
          {/* Month tabs */}
          {MONTHS.map((m, i) => {
            const monthNum = i + 1;
            return (
              <button
                key={m}
                onClick={() => { setSelectedMonth(monthNum); setSelectedYear(selectedYear); }}
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
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={`Search...`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="secondary" onClick={() => setQuery((q) => q)}>
          Search
        </Button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <TableViewPresetBar
            presets={presets}
            activePresetId={activePresetId}
            activePreset={activePreset}
            onSelect={setActivePresetId}
            onEditActive={() => activePreset && openEditPreset(activePreset)}
            onNew={openNewPreset}
            emptySetupLabel="Set Up Columns"
          />
          <label className="hidden sm:inline text-neutral-500 dark:text-neutral-400">Sort</label>
          <CompactSelect
            options={sortOptions}
            value={sortKey}
            onChange={setSortKey}
            icon={<ArrowUpDown />}
            iconLabel="Sort"
          />
          <Button
            type="button"
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
      {/* Horizontal scroll on small screens — column count is user-configurable
          via presets, so we can't predict which to hide. Scrolling is the safe
          mobile fallback. */}
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {activeColumns.length > 0 ? (
              activeColumns.map((path) => (
                <TableHead key={path} className="text-xs whitespace-nowrap">{getFieldLabel(path)}</TableHead>
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
            <TableHead className="w-[140px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.policyId} className={`cursor-pointer group border-l-2 border-l-transparent transition-colors ${r.isActive === false ? "text-neutral-400 dark:text-neutral-500 hover:bg-red-50/60 dark:hover:bg-red-950/30 hover:border-l-red-500" : "text-green-600 dark:text-green-400 hover:bg-green-50/60 dark:hover:bg-green-950/30 hover:border-l-green-500"}`} onClick={() => openDetails(r.policyId)}>
              {activeColumns.length > 0 ? (
                activeColumns.map((path) => (
                  <TableCell key={path} className="max-w-[200px] text-sm wrap-break-word">
                    {getColumnValue(r, path)}
                  </TableCell>
                ))
              ) : (
                <TableCell className="font-mono">
                  {r.policyNumber}
                </TableCell>
              )}
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-end gap-2.5">
                <Eye className={`h-4 w-4 opacity-0 group-hover:opacity-80 transition-opacity shrink-0 cursor-pointer ${r.isActive === false ? "text-red-500" : "text-green-500"}`} onClick={() => openDetails(r.policyId)} />
                {!isClientUser && (
                  <RowActionMenu
                    actions={[
                      {
                        label: r.isActive === false ? "Enable" : "Disable",
                        icon: r.isActive === false
                          ? <CheckCircle2 className="h-4 w-4" />
                          : <Ban className="h-4 w-4" />,
                        onClick: () => setToggleConfirm({ id: r.policyId, currentlyActive: r.isActive !== false }),
                      },
                      {
                        label: "Delete",
                        icon: <Trash2 className="h-4 w-4" />,
                        onClick: () => remove(r.policyId),
                        variant: "destructive",
                      },
                    ]}
                  />
                )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        loading={rowsLoading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        itemNoun={`${label.toLowerCase()}${total === 1 ? "" : "s"}`}
      />

      <RecordDetailsDrawer
        open={openId !== null}
        drawerOpen={drawerOpen}
        onClose={closeDrawer}
        title={`${label} Details`}
        initialTabId={
          deepLinkTabId
            ?? (deepLinkSection || deepLinkDocTemplate ? "workflow" : undefined)
        }
        loading={loading}
        extraAttributes={detail?.extraAttributes as Record<string, unknown> | undefined}
        onRefresh={refreshCurrent}
        refreshing={refreshing}
        statusHistory={
          ((detail?.extraAttributes as Record<string, unknown> | undefined)?.statusHistory as Array<{
            status: string; changedAt: string; changedBy?: string; note?: string;
          }>) ?? undefined
        }
        functionTabs={detail ? ([
          {
            id: "workflow",
            label: "Workflow",
            icon: <Activity className="h-3 w-3" />,
            content: (
              <WorkflowTab
                detail={detail}
                flowKey={detailFlowKey}
                currentStatus={
                  ((detail.extraAttributes as Record<string, unknown> | undefined)?.status as string) ?? undefined
                }
                statusHistory={
                  ((detail.extraAttributes as Record<string, unknown> | undefined)?.statusHistory as Array<{
                    status: string; changedAt: string; changedBy?: string; note?: string;
                  }>) ?? undefined
                }
                isAdmin={!isClientUser}
                currentUserType={effectiveUserType}
                onRefresh={refreshCurrent}
                initialSection={deepLinkSection}
                initialDocTemplateValue={deepLinkDocTemplate}
                initialDocAudience={deepLinkDocAudience}
              />
            ),
          },
          ...(premiumTabConfig ? [{
            id: "accounting",
            label: premiumTabConfig.label,
            icon: <DollarSign className="h-3 w-3" />,
            content: (
              <AccountingTab
                policyId={detail.policyId}
                policyNumber={detail.policyNumber}
                canEdit={(isAdmin || sessionUserType === "accounting") && premiumTabConfig.context === "policy"}
                policyExtra={detail.extraAttributes as Record<string, unknown> | null | undefined}
                onUpdate={refreshCurrent}
                context={premiumTabConfig.context}
              />
            ),
          }] : []),
        ] satisfies Omit<DrawerTab, "permanent">[]) : undefined}
      >
        {detail ? (
          <>
            <PolicySnapshotView
              detail={detail}
              entityLabel={label}
              onEditPackage={isClientUser ? undefined : openEditDialog}
              canEditPackage={isOwnPackage}
              hiddenPackages={snapshotHiddenPkgs}
            />
            {!isClientUser && (
              <NotesPanel
                notes={
                  (Array.isArray((detail.extraAttributes as Record<string, unknown> | undefined)?.notes)
                    ? (detail.extraAttributes as Record<string, unknown>).notes as NoteEntry[]
                    : [])
                }
                onDelete={deleteNote}
              />
            )}
          </>
        ) : (
          <div className="text-neutral-500 dark:text-neutral-400">No details.</div>
        )}
      </RecordDetailsDrawer>

      <FieldEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title={`Edit ${editPkgLabel}`}
        fields={editFields}
        values={editValues}
        onValuesChange={setEditValues}
        loading={editLoading}
        saving={editSaving}
        onSave={saveEdit}
      />

      <Dialog open={toggleConfirm !== null} onOpenChange={(o) => { if (!o) setToggleConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {toggleConfirm?.currentlyActive ? "Disable Record" : "Enable Record"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {toggleConfirm?.currentlyActive
              ? `Are you sure you want to disable this record? It will remain in the list but marked as inactive.`
              : `Are you sure you want to re-enable this record?`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToggleConfirm(null)} disabled={toggling}>
              Cancel
            </Button>
            <Button
              variant={toggleConfirm?.currentlyActive ? "destructive" : "default"}
              onClick={confirmToggleActive}
              disabled={toggling}
            >
              {toggling ? "Saving..." : toggleConfirm?.currentlyActive ? "Disable" : "Enable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TableViewPresetEditor
        open={configOpen}
        onOpenChange={setConfigOpen}
        editing={editingPreset}
        draftName={draftName}
        setDraftName={setDraftName}
        draftColumns={draftColumns}
        setDraftColumns={setDraftColumns}
        maxColumns={MAX_COLS}
        getSelectedLabel={getFieldLabel}
        columnGroups={columnGroups}
        savedViewsPanel={
          editingPreset
            ? undefined
            : {
                presets,
                onEdit: openEditPreset,
                onDelete: deletePreset,
                onSetDefault: setDefault,
              }
        }
        onSave={saveCurrentPreset}
        editTitle="Edit View"
        newTitle="Set Up Table Columns"
      />
    </div>
  );
}
