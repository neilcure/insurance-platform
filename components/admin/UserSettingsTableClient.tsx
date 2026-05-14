"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CompactSelect } from "@/components/ui/compact-select";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserRowActions } from "@/components/admin/user-row-actions";
import BackfillUserNumbersButton from "@/components/admin/backfill-user-numbers-button";
import { toast } from "sonner";
import { useTableViewPresets } from "@/lib/view-presets/use-table-view-presets";
import { isPlaceholderEmail } from "@/lib/auth/placeholder-email";
import type { ViewPreset, ViewPresetColumnGroup } from "@/lib/view-presets/types";
import { TableViewPresetBar } from "@/components/ui/table-view-preset-bar";
import { TableViewPresetEditor } from "@/components/ui/table-view-preset-editor";
import { Pagination } from "@/components/ui/pagination";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/pagination/types";

type UserType = "admin" | "agent" | "accounting" | "internal_staff" | "direct_client" | "service_provider";

type UserRow = {
  id: number;
  email: string;
  mobile: string | null;
  name: string | null;
  companyName: string | null;
  primaryId: string | null;
  accountType: "personal" | "company" | null;
  userType: UserType;
  isActive: boolean;
  hasCompletedSetup: boolean;
  createdAt: string;
  userNumber: string | null;
};

type ColumnKey =
  | "number"
  | "email"
  | "mobile"
  | "name"
  | "companyName"
  | "userType"
  | "status"
  | "createdAt"
  | "directPrimary"
  | "directSecondary";

type SortKey = "createdAt" | "email" | "number";

const ALL_COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: "number", label: "User #" },
  { key: "email", label: "Email" },
  { key: "mobile", label: "Mobile" },
  { key: "name", label: "Name" },
  { key: "companyName", label: "Company Name" },
  { key: "userType", label: "User Type" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created Date" },
  { key: "directPrimary", label: "Direct Client Main #" },
  { key: "directSecondary", label: "Direct Client Ref #" },
];

const DEFAULT_COLUMNS: ColumnKey[] = ["number", "email", "name", "companyName", "userType", "status"];

export default function UserSettingsTableClient({
  initialRows,
  canAssignAdmin,
  clientLinks,
  clientNumbers,
  profilePolicyNumbers,
}: {
  initialRows: UserRow[];
  canAssignAdmin: boolean;
  clientLinks: Record<number, string>;
  clientNumbers: Record<number, string>;
  profilePolicyNumbers: Record<number, string>;
}) {
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [mounted, setMounted] = React.useState(false);

  const PRESETS_KEY = "user-settings-table-presets";
  const PRESET_SCOPE = "admin-user-settings";

  const normalizePreset = React.useCallback((raw: unknown): ViewPreset | null => {
    if (!raw || typeof raw !== "object") return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.name !== "string") return null;
    const cols = Array.isArray(p.columns)
      ? p.columns.filter(
          (c): c is string =>
            typeof c === "string" && ALL_COLUMNS.some((col) => col.key === c),
        )
      : [];
    const sortKeyVal: SortKey =
      p.sortKey === "createdAt" || p.sortKey === "email" || p.sortKey === "number"
        ? p.sortKey
        : "createdAt";
    const sortDirVal: "asc" | "desc" = p.sortDir === "asc" ? "asc" : "desc";
    return {
      id: p.id,
      name: p.name,
      columns: cols.length > 0 ? cols : (DEFAULT_COLUMNS as string[]),
      isDefault: Boolean(p.isDefault),
      sortKey: sortKeyVal,
      sortDir: sortDirVal,
    };
  }, []);

  const {
    presets,
    userPresets,
    activePresetId,
    setActivePresetId,
    activePreset,
    upsertPreset,
    deletePreset,
  } = useTableViewPresets({
    scope: PRESET_SCOPE,
    legacyLocalStorageKey: PRESETS_KEY,
    normalizePreset,
  });

  const [configOpen, setConfigOpen] = React.useState(false);
  const [editingPreset, setEditingPreset] = React.useState<ViewPreset | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftSortKey, setDraftSortKey] = React.useState<SortKey>("createdAt");
  const [draftSortDir, setDraftSortDir] = React.useState<"asc" | "desc">("desc");
  const [draftColumns, setDraftColumns] = React.useState<string[]>(DEFAULT_COLUMNS as string[]);
  const [draftIsDefault, setDraftIsDefault] = React.useState(false);

  const PAGE_SIZE_STORAGE_KEY = "pagination:size:admin-user-settings";
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) {
        setPageSize(n);
      }
    } catch {}
  }, []);

  const handlePageSizeChange = React.useCallback((n: number) => {
    setPageSize(n);
    setPage(0);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(n));
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    if (!activePreset) return;
    if (activePreset.sortKey) setSortKey(activePreset.sortKey as SortKey);
    if (activePreset.sortDir) setSortDir(activePreset.sortDir);
    setDraftColumns(activePreset.columns);
  }, [activePreset]);

  function openNewPreset() {
    setEditingPreset(null);
    setDraftName(`View ${userPresets.length + 1}`);
    setDraftSortKey(sortKey);
    setDraftSortDir(sortDir);
    setDraftColumns(activePreset?.columns ?? (DEFAULT_COLUMNS as string[]));
    setDraftIsDefault(userPresets.length === 0);
    setConfigOpen(true);
  }

  function openEditPreset(preset: ViewPreset) {
    setEditingPreset(preset);
    setDraftName(preset.name);
    setDraftSortKey((preset.sortKey as SortKey) ?? "createdAt");
    setDraftSortDir(preset.sortDir ?? "desc");
    setDraftColumns(preset.columns);
    setDraftIsDefault(preset.isDefault);
    setConfigOpen(true);
  }

  function saveCurrentPreset() {
    const name = draftName.trim() || "Untitled";
    const columns = draftColumns.length > 0 ? draftColumns : (DEFAULT_COLUMNS as string[]);
    if (columns.length === 0) {
      toast.error("At least one column is required");
      return;
    }
    if (editingPreset) {
      const updated = upsertPreset({
        ...editingPreset,
        name,
        columns,
        sortKey: draftSortKey,
        sortDir: draftSortDir,
        isDefault: draftIsDefault,
      });
      if (!updated) return;
      setActivePresetId(updated.id);
    } else {
      const created = upsertPreset({
        id: `preset_${Date.now()}`,
        name,
        columns,
        isDefault: draftIsDefault || userPresets.length === 0,
        sortKey: draftSortKey,
        sortDir: draftSortDir,
      });
      if (!created) return;
      setActivePresetId(created.id);
    }
    setConfigOpen(false);
  }

  const activeColumns = React.useMemo<ColumnKey[]>(() => {
    const cols = activePreset?.columns?.length ? activePreset.columns : (DEFAULT_COLUMNS as string[]);
    return cols.filter((c): c is ColumnKey => ALL_COLUMNS.some((col) => col.key === c));
  }, [activePreset?.columns]);

  const userColumnGroups: ViewPresetColumnGroup[] = React.useMemo(
    () => [
      {
        groupKey: "user",
        groupLabel: "",
        options: ALL_COLUMNS.map((c) => ({ path: c.key, label: c.label })),
      },
    ],
    [],
  );

  const getDirectClientPrimaryNumber = React.useCallback(
    (userId: number): string => profilePolicyNumbers[userId] || clientNumbers[userId] || "",
    [profilePolicyNumbers, clientNumbers]
  );
  const getDirectClientSecondaryNumber = React.useCallback(
    (userId: number): string => {
      const primary = profilePolicyNumbers[userId] || "";
      const secondary = clientNumbers[userId] || "";
      if (!secondary) return "";
      if (primary && primary === secondary) return "";
      return secondary;
    },
    [profilePolicyNumbers, clientNumbers]
  );

  const getUserTypeLabel = React.useCallback((type: UserType) => {
    switch (type) {
      case "internal_staff":
        return "Internal Staff";
      case "direct_client":
        return "Direct Client";
      case "service_provider":
        return "Service Provider";
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  }, []);

  function renderHeaderCell(col: ColumnKey) {
    switch (col) {
      case "number":
        return <TableHead key={col}>User #</TableHead>;
      case "email":
        return <TableHead key={col}>Email</TableHead>;
      case "mobile":
        return <TableHead key={col} className="hidden sm:table-cell">Mobile</TableHead>;
      case "name":
        return <TableHead key={col} className="hidden md:table-cell min-w-[140px]">Name</TableHead>;
      case "companyName":
        return <TableHead key={col} className="hidden lg:table-cell min-w-[160px]">Company Name</TableHead>;
      case "userType":
        return <TableHead key={col} className="hidden sm:table-cell">Type</TableHead>;
      case "status":
        return <TableHead key={col} className="hidden sm:table-cell">Status</TableHead>;
      case "createdAt":
        return <TableHead key={col} className="hidden lg:table-cell">Created</TableHead>;
      case "directPrimary":
        return <TableHead key={col} className="hidden lg:table-cell">Direct Main #</TableHead>;
      case "directSecondary":
        return <TableHead key={col} className="hidden lg:table-cell">Direct Ref #</TableHead>;
      default:
        return null;
    }
  }

  function renderDataCell(u: UserRow, col: ColumnKey) {
    switch (col) {
      case "number":
        return (
          <TableCell
            key={col}
            title={
              u.userType === "direct_client"
                ? [getDirectClientPrimaryNumber(u.id), getDirectClientSecondaryNumber(u.id)].filter(Boolean).join(" / ")
                : (u.userNumber ?? "")
            }
            className={`font-mono text-xs ${
              u.isActive ? "text-green-600 dark:text-green-400" : "text-neutral-600 dark:text-neutral-400"
            }`}
          >
            {u.userType === "direct_client" ? (
              <div className="space-y-0.5">
                <div>{getDirectClientPrimaryNumber(u.id) || "—"}</div>
                {getDirectClientSecondaryNumber(u.id) ? (
                  <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {getDirectClientSecondaryNumber(u.id)}
                  </div>
                ) : null}
              </div>
            ) : (
              u.userNumber ?? "—"
            )}
          </TableCell>
        );
      case "email":
        return (
          <TableCell key={col} className="font-mono text-sm">
            {isPlaceholderEmail(u.email) ? (
              <span
                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                title="No email on file. Use Edit to set one before sending an invite."
              >
                Email not set
              </span>
            ) : (
              u.email
            )}
          </TableCell>
        );
      case "mobile":
        return <TableCell key={col} className="hidden sm:table-cell">{u.mobile || "—"}</TableCell>;
      case "name":
        return (
          <TableCell key={col} className="hidden md:table-cell max-w-[180px] align-top" title={u.name?.trim() || ""}>
            <span className="line-clamp-2 wrap-break-word whitespace-normal">{u.name?.trim() || "—"}</span>
          </TableCell>
        );
      case "companyName":
        return (
          <TableCell
            key={col}
            className="hidden lg:table-cell max-w-[220px] align-top"
            title={u.companyName?.trim() || ""}
          >
            <span className="line-clamp-2 wrap-break-word whitespace-normal">{u.companyName?.trim() || "—"}</span>
          </TableCell>
        );
      case "userType":
        return <TableCell key={col} className="hidden sm:table-cell">{getUserTypeLabel(u.userType)}</TableCell>;
      case "status":
        return (
          <TableCell key={col} className="hidden sm:table-cell">
            {!u.hasCompletedSetup ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                title="Account created but the user has not completed the invite flow yet."
              >
                Setup Pending
              </span>
            ) : u.isActive ? (
              <span className="text-green-600 dark:text-green-400">Active</span>
            ) : (
              <span className="text-neutral-500 dark:text-neutral-400">Inactive</span>
            )}
          </TableCell>
        );
      case "createdAt":
        return <TableCell key={col} className="hidden lg:table-cell">{new Date(u.createdAt).toLocaleDateString()}</TableCell>;
      case "directPrimary":
        return (
          <TableCell key={col} className="hidden lg:table-cell font-mono text-xs">
            {u.userType === "direct_client" ? getDirectClientPrimaryNumber(u.id) || "—" : "—"}
          </TableCell>
        );
      case "directSecondary":
        return (
          <TableCell key={col} className="hidden lg:table-cell font-mono text-xs text-neutral-500 dark:text-neutral-400">
            {u.userType === "direct_client" ? getDirectClientSecondaryNumber(u.id) || "—" : "—"}
          </TableCell>
        );
      default:
        return null;
    }
  }

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = initialRows.filter((u) => {
      if (!q) return true;
      const hay = [
        isPlaceholderEmail(u.email) ? "" : u.email,
        u.mobile ?? "",
        u.name ?? "",
        u.companyName ?? "",
        u.userNumber ?? "",
        u.userType,
        u.isActive ? "active" : "inactive",
        new Date(u.createdAt).toLocaleString(),
        getDirectClientPrimaryNumber(u.id),
        getDirectClientSecondaryNumber(u.id),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    return filtered.sort((a, b) => {
      const aNumber = a.userType === "direct_client" ? getDirectClientPrimaryNumber(a.id) || a.userNumber || "" : a.userNumber || "";
      const bNumber = b.userType === "direct_client" ? getDirectClientPrimaryNumber(b.id) || b.userNumber || "" : b.userNumber || "";
      const cmp =
        sortKey === "email"
          ? (a.email || "").localeCompare(b.email || "", undefined, { sensitivity: "base" })
          : sortKey === "number"
            ? aNumber.localeCompare(bNumber, undefined, { numeric: true, sensitivity: "base" })
            : (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [initialRows, query, sortKey, sortDir, getDirectClientPrimaryNumber, getDirectClientSecondaryNumber]);

  React.useEffect(() => {
    setPage(0);
  }, [query, sortKey, sortDir]);

  React.useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [rows.length, pageSize, page]);

  const pagedRows = React.useMemo(
    () => rows.slice(page * pageSize, page * pageSize + pageSize),
    [rows, page, pageSize],
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Input
          placeholder="Search..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setQuery((q) => q)}>
            Search
          </Button>
          <BackfillUserNumbersButton />
          <div className="ml-auto flex items-center gap-2 text-sm">
          {mounted ? (
            <TableViewPresetBar
              presets={presets}
              activePresetId={activePresetId}
              activePreset={activePreset}
              onSelect={setActivePresetId}
              onEditActive={() => activePreset && openEditPreset(activePreset)}
              onNew={openNewPreset}
              emptySetupLabel="Set Up View"
            />
          ) : null}
          <label className="hidden sm:inline text-neutral-500 dark:text-neutral-400">Sort</label>
          <CompactSelect
            options={[
              { value: "createdAt", label: "Created Date" },
              { value: "email", label: "Email" },
              { value: "number", label: "User #" },
            ]}
            value={sortKey}
            onChange={(v) => setSortKey(v as SortKey)}
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
      </div>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">Users # {rows.length}</div>

      <div className="overflow-x-auto">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              {activeColumns.map((col) => renderHeaderCell(col))}
              <TableHead className="w-[140px] whitespace-nowrap text-left">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.map((u) => (
              <TableRow key={u.id}>
                {activeColumns.map((col) => renderDataCell(u, col))}
                <TableCell className="block w-full md:table-cell md:w-[140px] md:whitespace-nowrap text-left">
                  <div className="flex justify-start">
                    <UserRowActions
                      userId={u.id}
                      userType={u.userType}
                      isActive={u.isActive}
                      hasCompletedSetup={u.hasCompletedSetup}
                      email={u.email}
                      mobile={u.mobile}
                      name={u.name}
                      accountType={u.accountType}
                      companyName={u.companyName}
                      primaryId={u.primaryId}
                      canAssignAdmin={canAssignAdmin}
                      linkedClientName={clientLinks[u.id] ?? null}
                      compact={true}
                    />
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
        total={rows.length}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
        itemNoun="users"
      />


      <TableViewPresetEditor
        open={configOpen}
        onOpenChange={setConfigOpen}
        editing={editingPreset}
        draftName={draftName}
        setDraftName={setDraftName}
        draftColumns={draftColumns}
        setDraftColumns={setDraftColumns}
        sortControls={{
          options: [
            { value: "createdAt", label: "Created Date" },
            { value: "email", label: "Email" },
            { value: "number", label: "User #" },
          ],
          sortKey: draftSortKey,
          setSortKey: (k) => setDraftSortKey(k as SortKey),
          sortDir: draftSortDir,
          setSortDir: setDraftSortDir,
        }}
        defaultToggle={{
          isDefault: draftIsDefault,
          setIsDefault: setDraftIsDefault,
        }}
        columnGroups={userColumnGroups}
        savedViewsPanel={
          editingPreset
            ? undefined
            : {
                presets,
                onEdit: openEditPreset,
                onDelete: deletePreset,
              }
        }
        onSave={saveCurrentPreset}
      />
    </div>
  );
}
