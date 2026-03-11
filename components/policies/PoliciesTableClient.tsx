"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Trash2, Ban, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { DetailsButton } from "@/components/ui/details-button";
import { PolicySnapshotView } from "@/components/policies/PolicySnapshotView";
import type { PolicyDetail } from "@/lib/types/policy";
import { RecordDetailsDrawer } from "@/components/ui/record-details-drawer";
import { FieldEditDialog, loadEditFields, type EditField } from "@/components/ui/field-edit-dialog";
import { StatusTab } from "@/components/policies/tabs/StatusTab";
import { ActionsTab } from "@/components/policies/tabs/ActionsTab";
import { DocumentsTab } from "@/components/policies/tabs/DocumentsTab";
import { Activity, Zap, FileText } from "lucide-react";
import type { DrawerTab } from "@/components/ui/drawer-tabs";
import type { WorkflowActionRow } from "@/lib/types/workflow-action";
import type { DocumentTemplateRow } from "@/lib/types/document-template";
import { formatDDMMYYYYHHMM } from "@/lib/format/date";
import { StickyNote, ChevronDown, ChevronUp, X } from "lucide-react";

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
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Show less" : `Show all ${notes.length}`}
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
};

function extractNameFromExtra(extra: Record<string, unknown> | null | undefined): string {
  if (!extra) return "";
  const insured = extra.insuredSnapshot as Record<string, unknown> | undefined;
  const pkgs = extra.packagesSnapshot as Record<string, unknown> | undefined;
  const norm = (k: string) => k.replace(/^[a-zA-Z0-9]+__/, "").replace(/^_+/, "").toLowerCase().replace(/[^a-z]/g, "");
  const insuredType = String(insured?.insuredType ?? insured?.insured__category ?? "").trim().toLowerCase();

  if (insuredType === "personal" && insured) {
    let first = "", last = "";
    for (const [k, v] of Object.entries(insured)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (!last && /lastname|surname/.test(n)) last = s;
      if (!first && /firstname/.test(n)) first = s;
    }
    const combined = [last, first].filter(Boolean).join(" ");
    if (combined) return combined;
  }

  const findInObj = (obj: Record<string, unknown>, patterns: RegExp[]): string => {
    for (const [k, v] of Object.entries(obj)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (patterns.some((p) => p.test(n))) return s;
    }
    return "";
  };

  const COMPANY_PATTERNS = [/companyname/, /coname/, /organisationname/, /orgname/];
  const GENERIC_PATTERNS = [/^fullname$/, /^name$/];

  const tryAllSources = (patterns: RegExp[]): string => {
    if (insured) { const r = findInObj(insured, patterns); if (r) return r; }
    if (pkgs) {
      for (const entry of Object.values(pkgs)) {
        if (!entry || typeof entry !== "object") continue;
        const vals = (entry as { values?: Record<string, unknown> }).values ?? (entry as Record<string, unknown>);
        const r = findInObj(vals as Record<string, unknown>, patterns);
        if (r) return r;
      }
    }
    return "";
  };

  const company = tryAllSources(COMPANY_PATTERNS);
  if (company) return company;
  return tryAllSources(GENERIC_PATTERNS);
}

export default function PoliciesTableClient({ initialRows, entityLabel }: { initialRows: Row[]; entityLabel?: string }) {
  const label = entityLabel || "Policy";
  const [rows, setRows] = React.useState<Row[]>(initialRows);
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<number | null>(null);
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
  // Toggle active confirm dialog
  const [toggleConfirm, setToggleConfirm] = React.useState<{ id: number; currentlyActive: boolean } | null>(null);
  const [toggling, setToggling] = React.useState(false);
  const [hasActions, setHasActions] = React.useState(false);
  const [hasDocs, setHasDocs] = React.useState(false);

  // Sorting
  const hasNames = rows.some((r) => !!r.displayName);
  const [sortKey, setSortKey] = React.useState<"createdAt" | "policyNumber" | "displayName">("policyNumber");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const sorted = React.useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      if (sortKey === "createdAt") {
        const ad = Date.parse(a.createdAt);
        const bd = Date.parse(b.createdAt);
        const cmp = (Number.isFinite(ad) ? ad : 0) - (Number.isFinite(bd) ? bd : 0);
        return sortDir === "asc" ? cmp : -cmp;
      }
      if (sortKey === "displayName") {
        const cmp = (a.displayName ?? "").localeCompare(b.displayName ?? "", undefined, { sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = a.policyNumber.localeCompare(b.policyNumber, undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [rows, sortKey, sortDir]);

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
    () => ((detail?.extraAttributes as Record<string, unknown> | undefined)?.flowKey as string) ?? undefined,
    [detail],
  );

  React.useEffect(() => {
    if (!detail) {
      setHasActions(false);
      setHasDocs(false);
      return;
    }
    let cancelled = false;
    const fk = detailFlowKey;

    function matches(flows: string[] | undefined): boolean {
      if (!flows || flows.length === 0) return true;
      if (!fk) return false;
      return flows.includes(fk);
    }

    Promise.all([
      fetch(`/api/form-options?groupKey=workflow_actions&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`/api/form-options?groupKey=document_templates&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]).then(([actions, docs]: [WorkflowActionRow[], DocumentTemplateRow[]]) => {
      if (cancelled) return;
      setHasActions(actions.some((a) => a.meta && matches(a.meta.flows)));
      setHasDocs(docs.some((d) => d.meta && matches(d.meta.flows)));
    });

    return () => { cancelled = true; };
  }, [detail, detailFlowKey]);

  async function openEditDialog(pkgName: string, pkgLabel: string, currentValues: Record<string, unknown>) {
    setEditPkg(pkgName);
    setEditPkgLabel(pkgLabel);
    setEditValues({ ...currentValues });
    setEditFields([]);
    setEditOpen(true);
    setEditLoading(true);
    try {
      const { fields, values } = await loadEditFields(pkgName, currentValues);
      setEditFields(fields);
      setEditValues(values);
    } catch {
      toast.error("Failed to load field definitions");
    } finally {
      setEditLoading(false);
    }
  }

  async function saveEdit() {
    if (!detail || !editPkg) return;
    setEditSaving(true);
    try {
      const snap = (detail.extraAttributes ?? {}) as Record<string, unknown>;
      const isInsuredPkg = editPkg === "insured" || editPkg === "contactinfo";

      if (isInsuredPkg) {
        const insured = { ...((snap.insuredSnapshot ?? {}) as Record<string, unknown>) };
        for (const [key, val] of Object.entries(editValues)) {
          const prefixed2 = `${editPkg}__${key}`;
          const prefixed1 = `${editPkg}_${key}`;
          let found = false;
          if (prefixed2 in insured) { insured[prefixed2] = val; found = true; }
          if (prefixed1 in insured) { insured[prefixed1] = val; found = true; }
          if (key in insured) { insured[key] = val; found = true; }
          if (!found) insured[`${editPkg}_${key}`] = val;
        }
        const res = await fetch(`/api/policies/${detail.policyId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ insured }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const pkgs = { ...((snap.packagesSnapshot ?? {}) as Record<string, unknown>) };
        const existingPkg = (pkgs[editPkg] ?? {}) as Record<string, unknown>;
        const isStructured = existingPkg && typeof existingPkg === "object" && ("values" in existingPkg || "category" in existingPkg);
        const oldValues: Record<string, unknown> = isStructured
          ? ((existingPkg as { values?: Record<string, unknown> }).values ?? {})
          : { ...existingPkg };

        const remapped: Record<string, unknown> = { ...oldValues };
        for (const [key, val] of Object.entries(editValues)) {
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
        setRows((r) => r.map((x) => x.policyId === detail.policyId ? { ...x, displayName: newName || x.displayName } : x));
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
      const id = Number(raw);
      if (Number.isFinite(id) && id > 0) {
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
      setRows((r) => r.map((x) => x.policyId === id ? { ...x, isActive: !currentlyActive } : x));
      toast.success(currentlyActive ? "Record disabled" : "Record enabled");
      setToggleConfirm(null);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? `Failed to ${currentlyActive ? "disable" : "enable"}`);
    } finally {
      setToggling(false);
    }
  }

  async function remove(id: number) {
    const ok = window.confirm(`Delete this record? This cannot be undone.`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/policies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setRows((r) => r.filter((x) => x.policyId !== id));
      toast.success("Deleted");
      if (openId === id) closeDrawer();
    } catch (err: unknown) {
      const message = (err as { message?: string } | undefined)?.message ?? "Delete failed";
      toast.error(message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder={`Search...`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="secondary" onClick={() => setQuery((q) => q)}>
          Search
        </Button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label className="text-neutral-500 dark:text-neutral-400">Sort</label>
          <select
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
          >
            <option value="policyNumber">{label} #</option>
            <option value="createdAt">Date</option>
            {hasNames && <option value="displayName">Name</option>}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="h-9"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{label} #</TableHead>
            {hasNames && <TableHead>Name</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.policyId}>
              <TableCell className={`font-mono ${r.isActive !== false ? "text-green-600 dark:text-green-400" : "text-neutral-400 dark:text-neutral-500"}`}>
                {r.policyNumber}
              </TableCell>
              {hasNames && (
                <TableCell className="max-w-[200px] wrap-break-word">
                  {r.displayName || <span className="text-neutral-400">—</span>}
                </TableCell>
              )}
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <DetailsButton
                    onClick={() => openDetails(r.policyId)}
                    loading={openingId === r.policyId}
                  />
                  <Button
                    size="sm"
                    variant={r.isActive === false ? "secondary" : "outline"}
                    onClick={() => setToggleConfirm({ id: r.policyId, currentlyActive: r.isActive !== false })}
                    className="inline-flex items-center gap-2"
                  >
                    {r.isActive === false ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 sm:hidden lg:inline" />
                        <span className="hidden sm:inline">Enable</span>
                      </>
                    ) : (
                      <>
                        <Ban className="h-4 w-4 sm:hidden lg:inline" />
                        <span className="hidden sm:inline">Disable</span>
                      </>
                    )}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r.policyId)} className="inline-flex items-center gap-2">
                    <Trash2 className="h-4 w-4 sm:hidden lg:inline" />
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>

      <RecordDetailsDrawer
        open={openId !== null}
        drawerOpen={drawerOpen}
        onClose={closeDrawer}
        title={`${label} Details`}
        loading={loading}
        extraAttributes={detail?.extraAttributes as Record<string, unknown> | undefined}
        onRefresh={refreshCurrent}
        refreshing={refreshing}
        functionTabs={detail ? ([
          {
            id: "status",
            label: "Status",
            icon: <Activity className="h-3 w-3" />,
            content: (
              <StatusTab
                policyId={detail.policyId}
                currentStatus={
                  ((detail.extraAttributes as Record<string, unknown> | undefined)?.status as string) ?? undefined
                }
                statusHistory={
                  ((detail.extraAttributes as Record<string, unknown> | undefined)?.statusHistory as Array<{
                    status: string; changedAt: string; changedBy?: string; note?: string;
                  }>) ?? undefined
                }
                onStatusChange={refreshCurrent}
              />
            ),
          },
          ...(hasActions ? [{
            id: "actions",
            label: "Actions",
            icon: <Zap className="h-3 w-3" />,
            content: (
              <ActionsTab
                policyId={detail.policyId}
                policyNumber={detail.policyNumber}
                detail={detail}
                currentAgent={detail.agent}
                flowKey={detailFlowKey}
                onActionComplete={refreshCurrent}
              />
            ),
          }] : []),
          ...(hasDocs ? [{
            id: "documents",
            label: "Documents",
            icon: <FileText className="h-3 w-3" />,
            content: (
              <DocumentsTab
                detail={detail}
                flowKey={detailFlowKey}
              />
            ),
          }] : []),
        ] satisfies Omit<DrawerTab, "permanent">[]) : undefined}
      >
        {detail ? (
          <>
            <PolicySnapshotView detail={detail} entityLabel={label} onEditPackage={openEditDialog} />
            <NotesPanel
              notes={
                (Array.isArray((detail.extraAttributes as Record<string, unknown> | undefined)?.notes)
                  ? (detail.extraAttributes as Record<string, unknown>).notes as NoteEntry[]
                  : [])
              }
              onDelete={deleteNote}
            />
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
    </div>
  );
}
