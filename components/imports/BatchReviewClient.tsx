"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  ArrowLeft,
  RefreshCw,
  Save,
  X,
  Pencil,
  Search,
} from "lucide-react";
import { EntityPickerDrawer } from "@/components/policies/EntityPickerDrawer";
import { AgentPickerDrawer } from "@/components/policies/AgentPickerDrawer";

// ---------------------------------------------------------------------------
//  Types — kept loose because they cross the server/client boundary as JSON
// ---------------------------------------------------------------------------

type Issue = { column: string | null; message: string };

/**
 * Resolved entity-picker payload — populated server-side by
 * attachRefResolutionInfo so we can render the human company / agent NAME
 * next to (or instead of) the raw record number the user typed.
 */
type ResolvedRef = {
  status: "ok" | "missing";
  displayName: string;
  recordNumber: string;
  kind: "agent" | "entity";
  rawInput: string;
};

type Row = {
  id: number;
  batchId: number;
  excelRow: number;
  rawValues: Record<string, unknown>;
  /** Per-column resolved refs (entity / agent pickers). May be missing on
   *  legacy rows uploaded before the resolved_refs column existed. */
  resolvedRefs?: Record<string, ResolvedRef> | null;
  status: "pending" | "skipped" | "committed" | "failed";
  errors: Issue[];
  warnings: Issue[];
  edited: boolean;
  commitAttempts: number;
  lastCommitError: string | null;
  createdPolicyId: number | null;
  createdPolicyNumber: string | null;
  resolvedClientNumber: string | null;
  clientCreated: boolean;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
};

type Batch = {
  id: number;
  flowKey: string;
  clientFlowKey: string;
  filename: string | null;
  fileSizeBytes: number | null;
  status: "parsing" | "review" | "committing" | "committed" | "cancelled";
  totalRows: number;
  readyRows: number;
  warningRows: number;
  errorRows: number;
  committedRows: number;
  failedRows: number;
  skippedRows: number;
  summary: BatchSummary | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  committingStartedAt: string | null;
  committedAt: string | null;
};

type BatchSummary = {
  unknownValuesByColumn?: Record<
    string,
    {
      columnLabel: string;
      uniqueCount: number;
      rowCount: number;
      samples: string[];
      /** Set only for collapsed-child columns (e.g. Make/Model). Lets us
       *  bucket Models by the Make they appeared under. */
      byParent?: Record<
        string,
        {
          parentLabel: string;
          parentColumnId: string;
          values: { value: string; rowCount: number }[];
        }
      >;
    }
  >;
  missingRequiredByColumn?: Record<string, { columnLabel: string; rowCount: number }>;
  offCategoryByColumn?: Record<string, { columnLabel: string; rowCount: number }>;
  otherWarningsByColumn?: Record<string, { columnLabel: string; rowCount: number; samples: string[] }>;
  otherErrorsByColumn?: Record<string, { columnLabel: string; rowCount: number; samples: string[] }>;
  unknownColumns?: string[];
  missingColumns?: string[];
};

type Column = {
  id: string;
  label: string;
  inputType: string;
  required: boolean;
  pkg: string;
  options: { label?: string; value?: string }[];
  isVirtual: boolean;
  /** Set for entity-picker / agent-picker columns. flow === "__agent__" uses
   *  the agent picker; anything else uses the entity (policy) picker. */
  entityPicker?: { flow: string };
};

type Aggregates = {
  totalRows: number;
  readyRows: number;
  warningRows: number;
  errorRows: number;
  committedRows: number;
  failedRows: number;
  skippedRows: number;
};

type StatusFilter = "all" | "pending" | "skipped" | "committed" | "failed" | "with_errors" | "with_warnings";

// ---------------------------------------------------------------------------
//  Top-level component
// ---------------------------------------------------------------------------

export default function BatchReviewClient({
  initialBatch,
  initialRows,
  columns,
}: {
  initialBatch: Batch;
  initialRows: Row[];
  columns: Column[];
}) {
  const router = useRouter();
  const [batch, setBatch] = React.useState<Batch>(initialBatch);
  const [rows, setRows] = React.useState<Row[]>(initialRows);
  const [filter, setFilter] = React.useState<StatusFilter>("with_errors");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [committing, setCommitting] = React.useState(false);
  const [openRowId, setOpenRowId] = React.useState<number | null>(null);

  const labelById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const c of columns) m.set(c.id, c.label);
    return m;
  }, [columns]);

  // ----- Filtered rows ---------------------------------------------------
  const filteredRows = React.useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "all") {
        // skip nothing
      } else if (filter === "with_errors") {
        if (r.errors.length === 0) return false;
      } else if (filter === "with_warnings") {
        if (r.warnings.length === 0) return false;
      } else if (r.status !== filter) {
        return false;
      }
      if (!term) return true;
      // search across raw values + any error/warning message
      const blob =
        Object.values(r.rawValues).map((v) => String(v ?? "")).join(" ") +
        " " +
        r.errors.map((e) => e.message).join(" ") +
        " " +
        r.warnings.map((e) => e.message).join(" ");
      return blob.toLowerCase().includes(term);
    });
  }, [rows, filter, searchTerm]);

  // ----- Aggregated counters that always reflect current rows[] ----------
  const liveAggregates: Aggregates = React.useMemo(() => {
    const a: Aggregates = {
      totalRows: rows.length,
      readyRows: 0,
      warningRows: 0,
      errorRows: 0,
      committedRows: 0,
      failedRows: 0,
      skippedRows: 0,
    };
    for (const r of rows) {
      if (r.status === "committed") a.committedRows++;
      else if (r.status === "skipped") a.skippedRows++;
      else if (r.status === "failed") a.failedRows++;
      else if (r.errors.length > 0) a.errorRows++;
      else if (r.warnings.length > 0) a.warningRows++;
      else a.readyRows++;
    }
    return a;
  }, [rows]);

  const commitable = liveAggregates.readyRows + liveAggregates.warningRows;
  const isLocked = batch.status === "committed" || batch.status === "cancelled" || batch.status === "committing";

  async function refreshRows() {
    const res = await fetch(`/api/imports/batches/${batch.id}/rows`);
    if (!res.ok) return;
    const body = (await res.json()) as { rows: Row[] };
    setRows(body.rows);
  }

  async function refreshBatch() {
    const res = await fetch(`/api/imports/batches/${batch.id}`);
    if (!res.ok) return;
    const body = (await res.json()) as { batch: Batch };
    setBatch(body.batch);
  }

  // ----- Row actions -----------------------------------------------------
  async function toggleSkip(row: Row, skipped: boolean) {
    if (busy || isLocked) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/imports/batches/${batch.id}/rows/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skipped }),
      });
      const body = (await res.json().catch(() => ({}))) as { row?: Row; aggregates?: Aggregates; error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.row) {
        setRows((rs) => rs.map((r) => (r.id === row.id ? body.row! : r)));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function bulkSkipFiltered() {
    if (busy || isLocked) return;
    const ids = filteredRows.filter((r) => r.status !== "committed").map((r) => r.id);
    if (ids.length === 0) {
      toast.info("Nothing to skip in current filter");
      return;
    }
    if (!window.confirm(`Skip ${ids.length} row(s)? They will be excluded from import.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/imports/batches/${batch.id}/rows`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bulk_skip", rowIds: ids }),
      });
      const body = (await res.json().catch(() => ({}))) as { updated?: number; error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success(`Skipped ${body.updated ?? ids.length} row(s)`);
      await refreshRows();
      await refreshBatch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveRowEdits(rowId: number, patch: Record<string, unknown>) {
    if (busy || isLocked) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/imports/batches/${batch.id}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: patch }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        row?: Row;
        aggregates?: Aggregates;
        summary?: BatchSummary;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.row) setRows((rs) => rs.map((r) => (r.id === rowId ? body.row! : r)));
      if (body.summary) setBatch((b) => ({ ...b, summary: body.summary! }));
      toast.success("Row updated");
      setOpenRowId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // ----- Commit phase ----------------------------------------------------
  async function startCommit() {
    if (committing || isLocked) return;
    if (commitable === 0) {
      toast.error("No commitable rows. Fix errors or skip rows first.");
      return;
    }
    if (
      !window.confirm(
        `Create ${commitable} polic${commitable === 1 ? "y" : "ies"}? This cannot be undone.`,
      )
    )
      return;

    setCommitting(true);
    setBatch((b) => ({ ...b, status: "committing" }));

    // Poll progress while the commit runs (the POST returns when finished
    // but the user wants live feedback for big batches).
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        try {
          const res = await fetch(`/api/imports/batches/${batch.id}/progress`);
          if (res.ok) {
            const p = (await res.json()) as {
              status: Batch["status"];
              done: number;
              succeeded: number;
              failed: number;
              total: number;
            };
            setBatch((b) => ({
              ...b,
              status: p.status,
              committedRows: p.succeeded,
              failedRows: p.failed,
            }));
            if (p.status !== "committing") break;
          }
        } catch {
          // ignore poll errors
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    poll();

    try {
      const res = await fetch(`/api/imports/batches/${batch.id}/commit`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as {
        succeeded?: number;
        failed?: number;
        total?: number;
        error?: string;
      };
      stopped = true;
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await refreshRows();
      await refreshBatch();
      const ok = body.succeeded ?? 0;
      const bad = body.failed ?? 0;
      if (ok > 0) toast.success(`${ok} polic${ok === 1 ? "y" : "ies"} created`);
      if (bad > 0) toast.error(`${bad} row(s) failed — see results below`);
      router.refresh();
    } catch (err) {
      stopped = true;
      toast.error(err instanceof Error ? err.message : "Commit failed");
      await refreshBatch();
    } finally {
      setCommitting(false);
    }
  }

  async function cancel() {
    if (busy || isLocked) return;
    if (!window.confirm("Cancel this batch? Already-committed rows stay committed.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/imports/batches/${batch.id}/cancel`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast.success("Batch cancelled");
      // Send the admin back to the imports list — there's nothing they can
      // do on a cancelled batch's review page (all action buttons are
      // hidden) so leaving them stranded here was confusing.
      router.push("/dashboard/imports");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  // ----- Render ----------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/dashboard/imports"
            className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3 w-3" /> Back to imports
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            Batch #{batch.id} — <code className="text-base">{batch.flowKey}</code>
            <BatchStatusBadge status={batch.status} />
          </h1>
          <p className="text-sm text-neutral-500">
            {batch.filename ?? "(no filename)"} · uploaded {new Date(batch.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isLocked && (
            <Button variant="outline" onClick={cancel} disabled={busy}>
              <X className="h-4 w-4" /> Cancel batch
            </Button>
          )}
          <Button onClick={startCommit} disabled={committing || isLocked || commitable === 0}>
            {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Commit {commitable} row{commitable === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      {/* Locked-state banner — explains why the action buttons are gone */}
      {batch.status === "cancelled" && (
        <Banner tone="err">
          <strong>Batch cancelled.</strong> No more rows can be committed from
          this batch. Already-committed rows (if any) stay committed. Start a
          new import from{" "}
          <Link href="/dashboard/imports" className="underline">
            Imports
          </Link>
          .
        </Banner>
      )}
      {batch.status === "committed" && (
        <Banner tone="ok">
          <strong>Batch committed.</strong> All commit-eligible rows have been
          processed. See per-row status below.
        </Banner>
      )}
      {batch.status === "committing" && (
        <Banner tone="warn">
          <strong>Commit in progress…</strong> Hang tight — rows are being
          written to the live tables.
        </Banner>
      )}

      {/* Empty-file guard: a freshly-downloaded template ships with row 4
       *  blank (we removed the demo example to fix the "1 row uploaded, 2
       *  policies?" bug). If a user uploads it without filling anything in,
       *  the parser correctly returns 0 rows but the screen looks "broken"
       *  — every counter is 0 with no explanation. This banner spells out
       *  what to do, so it doesn't read as an upload failure. */}
      {liveAggregates.totalRows === 0 &&
        batch.status !== "cancelled" &&
        batch.status !== "committed" && (
          <Banner tone="warn">
            <strong>No data rows found in this file.</strong> The upload
            succeeded, but the spreadsheet had no policy data to import.
            Open your template, fill in your records starting on{" "}
            <strong>row 4</strong> (rows 1–3 are headers, do not edit them),
            save, then re-upload from the{" "}
            <Link href="/dashboard/imports" className="underline">
              Imports
            </Link>{" "}
            page. You can cancel this empty batch — nothing has been written
            to your data.
          </Banner>
        )}

      {/* Aggregates */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-7">
        <Stat label="Total" value={liveAggregates.totalRows} />
        <Stat label="Ready" value={liveAggregates.readyRows} tone="ok" />
        <Stat label="Warnings" value={liveAggregates.warningRows} tone={liveAggregates.warningRows > 0 ? "warn" : undefined} />
        <Stat label="Errors" value={liveAggregates.errorRows} tone={liveAggregates.errorRows > 0 ? "err" : undefined} />
        <Stat label="Skipped" value={liveAggregates.skippedRows} />
        <Stat label="Committed" value={liveAggregates.committedRows} tone={liveAggregates.committedRows > 0 ? "ok" : undefined} />
        <Stat label="Failed" value={liveAggregates.failedRows} tone={liveAggregates.failedRows > 0 ? "err" : undefined} />
      </div>

      {/* Issue summary */}
      {batch.summary && (
        <SummaryPanel
          summary={batch.summary}
          locked={isLocked || busy}
          onAddOptions={async (additions) => {
            // Single round-trip: batches the extension to form_options on the
            // server AND re-validates the whole batch so all rows that were
            // blocked on this unknown value flip back to "ready".
            try {
              setBusy(true);
              const res = await fetch(`/api/imports/batches/${batch.id}/add-options`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ additions }),
              });
              const body = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
              const added = Number(body.added ?? 0);
              toast.success(
                added > 0
                  ? `Added ${added} option${added === 1 ? "" : "s"} and re-validated the batch.`
                  : "All values were already in the options list. Re-validated the batch.",
              );
              // Pull fresh rows + batch (the API already re-validated server-side)
              await refreshRows();
              await refreshBatch();
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Failed to add options";
              toast.error(msg);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {/* Row table */}
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Rows</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <FilterBar value={filter} onChange={setFilter} aggregates={liveAggregates} />
              <Input
                placeholder="Search…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 w-44"
              />
              {!isLocked && (
                <Button variant="outline" size="sm" onClick={bulkSkipFiltered} disabled={busy}>
                  Skip filtered
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => { refreshRows(); refreshBatch(); }} disabled={busy} title="Refresh">
                <RefreshCw className="h-4 w-4 sm:hidden lg:inline" />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            Showing {filteredRows.length} of {rows.length} row(s)
          </p>
        </CardHeader>
        <CardContent>
          <div className="max-h-[60vh] overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-900">
                <tr className="text-left">
                  <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Row</th>
                  <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Status</th>
                  <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Issues</th>
                  <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800">Preview</th>
                  <th className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-800 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <RowItem
                    key={r.id}
                    row={r}
                    columns={columns}
                    labelById={labelById}
                    open={openRowId === r.id}
                    onOpen={() => setOpenRowId(r.id)}
                    onClose={() => setOpenRowId(null)}
                    onSave={(patch) => saveRowEdits(r.id, patch)}
                    onSkipToggle={(skipped) => toggleSkip(r, skipped)}
                    locked={isLocked || busy}
                  />
                ))}
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-sm text-neutral-500">
                      No rows match the current filter
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Sub-components
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "err";
}) {
  const toneCls =
    tone === "ok" ? "text-green-700 dark:text-green-400" :
    tone === "warn" ? "text-amber-700 dark:text-amber-400" :
    tone === "err" ? "text-red-700 dark:text-red-400" :
    "text-neutral-900 dark:text-neutral-100";
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-lg font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

function FilterBar({
  value,
  onChange,
  aggregates,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
  aggregates: Aggregates;
}) {
  const items: { v: StatusFilter; label: string; count: number; tone?: "ok" | "warn" | "err" }[] = [
    { v: "all", label: "All", count: aggregates.totalRows },
    { v: "with_errors", label: "Errors", count: aggregates.errorRows, tone: "err" },
    { v: "with_warnings", label: "Warnings", count: aggregates.warningRows, tone: "warn" },
    { v: "pending", label: "Pending", count: aggregates.readyRows + aggregates.warningRows + aggregates.errorRows },
    { v: "skipped", label: "Skipped", count: aggregates.skippedRows },
    { v: "committed", label: "Committed", count: aggregates.committedRows, tone: "ok" },
    { v: "failed", label: "Failed", count: aggregates.failedRows, tone: "err" },
  ];
  return (
    <div className="inline-flex flex-wrap gap-1">
      {items.map((it) => (
        <button
          key={it.v}
          type="button"
          onClick={() => onChange(it.v)}
          className={`rounded-md border px-2 py-1 text-xs ${
            value === it.v
              ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
              : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300"
          }`}
        >
          {it.label}
          <span
            className={`ml-1 ${
              value === it.v
                ? "opacity-80"
                : it.tone === "err" ? "text-red-700 dark:text-red-400" :
                  it.tone === "warn" ? "text-amber-700 dark:text-amber-400" :
                  it.tone === "ok" ? "text-green-700 dark:text-green-400" :
                  "text-neutral-500"
            }`}
          >
            {it.count}
          </span>
        </button>
      ))}
    </div>
  );
}

type AddOptionsRequest = Array<{
  columnId: string;
  parentValue?: string;
  values: Array<{ value: string; label?: string }>;
}>;

function SummaryPanel({
  summary,
  locked,
  onAddOptions,
}: {
  summary: BatchSummary;
  locked: boolean;
  /** Send a list of additions to /add-options. Resolves when validation
   *  has refreshed; used to disable buttons during the round-trip. */
  onAddOptions: (additions: AddOptionsRequest) => Promise<void>;
}) {
  const unknownCols = Object.entries(summary.unknownValuesByColumn ?? {});
  const missingReq = Object.entries(summary.missingRequiredByColumn ?? {});
  const offCat = Object.entries(summary.offCategoryByColumn ?? {});
  const otherWarn = Object.entries(summary.otherWarningsByColumn ?? {});
  const otherErr = Object.entries(summary.otherErrorsByColumn ?? {});
  const fileMissing = summary.missingColumns ?? [];
  const fileUnknown = summary.unknownColumns ?? [];

  if (
    unknownCols.length === 0 &&
    missingReq.length === 0 &&
    offCat.length === 0 &&
    otherWarn.length === 0 &&
    otherErr.length === 0 &&
    fileMissing.length === 0 &&
    fileUnknown.length === 0
  ) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Issue summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {fileMissing.length > 0 && (
          <Banner tone="err">
            <strong>Missing required columns in file:</strong> {fileMissing.join(", ")}
          </Banner>
        )}
        {fileUnknown.length > 0 && (
          <Banner tone="warn">
            <strong>Ignored unknown columns in file:</strong> {fileUnknown.join(", ")}
          </Banner>
        )}

        {missingReq.length > 0 && (
          <IssueGroup
            tone="err"
            title="Missing required values"
            items={missingReq.map(([col, info]) => ({
              key: col,
              label: info.columnLabel,
              count: info.rowCount,
              detail: null,
            }))}
          />
        )}

        {otherErr.length > 0 && (
          <IssueGroup
            tone="err"
            title="Other errors"
            items={otherErr.map(([col, info]) => ({
              key: col,
              label: info.columnLabel,
              count: info.rowCount,
              detail: info.samples.length > 0 ? info.samples.join(" · ") : null,
            }))}
          />
        )}

        {unknownCols.length > 0 && (
          <UnknownValuesPanel
            entries={unknownCols}
            locked={locked}
            onAddOptions={onAddOptions}
          />
        )}

        {offCat.length > 0 && (
          <IssueGroup
            tone="warn"
            title="Off-category data"
            items={offCat.map(([col, info]) => ({
              key: col,
              label: info.columnLabel,
              count: info.rowCount,
              detail: null,
            }))}
          />
        )}

        {otherWarn.length > 0 && (
          <IssueGroup
            tone="warn"
            title="Other warnings"
            items={otherWarn.map(([col, info]) => ({
              key: col,
              label: info.columnLabel,
              count: info.rowCount,
              detail: info.samples.length > 0 ? info.samples.join(" · ") : null,
            }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

function IssueGroup({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "err" | "warn";
  items: { key: string; label: string; count: number; detail: string | null }[];
}) {
  const toneCls =
    tone === "err"
      ? "text-red-700 dark:text-red-300"
      : "text-amber-700 dark:text-amber-300";
  const Icon = tone === "err" ? AlertCircle : AlertTriangle;
  return (
    <div>
      <div className={`flex items-center gap-2 text-xs font-medium ${toneCls}`}>
        <Icon className="h-3.5 w-3.5" /> {title}
      </div>
      <ul className="mt-1 space-y-1">
        {items.map((it) => (
          <li key={it.key} className="flex items-baseline justify-between gap-2 rounded bg-neutral-50 px-2 py-1 text-xs dark:bg-neutral-900">
            <span>
              <span className="font-medium">{it.label}</span>
              {it.detail && <span className="ml-2 text-neutral-500">— {it.detail}</span>}
            </span>
            <Badge variant="outline">{it.count} row{it.count === 1 ? "" : "s"}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

type UnknownEntry = [
  string,
  NonNullable<BatchSummary["unknownValuesByColumn"]>[string],
];

/**
 * Inline "fix unknown values" panel — for every column that has unknown
 * values we show:
 *   • The list of values with row counts
 *   • A checkbox per value (default ALL checked)
 *   • An "Add selected to options" button that calls /add-options and
 *     re-validates the batch
 *
 * For collapsed columns (Make/Model and friends) the values are GROUPED by
 * parent value (Toyota, Honda, …) — each group has its own button, AND
 * if the parent value itself is unknown (admin pasted "Tesla" but Tesla
 * isn't a Make yet) the button automatically adds the parent first, then
 * the children, in one atomic POST. This is what makes the import "just
 * work" for noisy real-world data instead of forcing a 4-step manual
 * dance.
 */
function UnknownValuesPanel({
  entries,
  locked,
  onAddOptions,
}: {
  entries: UnknownEntry[];
  locked: boolean;
  onAddOptions: (additions: AddOptionsRequest) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  // Look up which parent column ids have unknown values themselves so we
  // can surface "add Make first" automatically.
  const parentColumnsWithUnknowns = new Map<string, Map<string, string>>();
  for (const [, info] of entries) {
    if (!info.byParent) continue;
    for (const bucket of Object.values(info.byParent)) {
      // Find the parent column entry (if it exists in `entries`) so we know
      // whether the parent value is also unknown.
      const parentEntry = entries.find(([cid]) => cid === bucket.parentColumnId);
      if (!parentEntry) continue;
      const parentLowerToValue = parentColumnsWithUnknowns.get(bucket.parentColumnId) ??
        new Map<string, string>();
      // Use the parent label as the canonical case-preserved value.
      parentLowerToValue.set(bucket.parentLabel.toLowerCase(), bucket.parentLabel);
      parentColumnsWithUnknowns.set(bucket.parentColumnId, parentLowerToValue);
    }
  }

  async function submit(additions: AddOptionsRequest) {
    if (busy || locked) return;
    setBusy(true);
    try {
      await onAddOptions(additions);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" /> Unknown values (not in current options list)
      </div>
      <ul className="mt-1 space-y-2">
        {entries.map(([col, info]) => (
          <li
            key={col}
            className="space-y-2 rounded bg-neutral-50 px-2 py-2 text-xs dark:bg-neutral-900"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <span className="font-medium">{info.columnLabel}</span>
                <span className="ml-2 text-neutral-500">
                  {info.uniqueCount} unique value{info.uniqueCount === 1 ? "" : "s"}
                </span>
              </div>
              <Badge variant="outline">
                {info.rowCount} row{info.rowCount === 1 ? "" : "s"}
              </Badge>
            </div>

            {info.byParent ? (
              // Grouped per-parent (Make/Model and friends)
              <div className="space-y-2">
                {Object.entries(info.byParent).map(([parentLower, bucket]) => {
                  const parentNeedsCreation =
                    parentColumnsWithUnknowns
                      .get(bucket.parentColumnId)
                      ?.has(parentLower) ?? false;
                  return (
                    <UnknownGroup
                      key={parentLower}
                      title={bucket.parentLabel}
                      values={bucket.values.map((v) => v.value)}
                      counts={bucket.values.map((v) => v.rowCount)}
                      busy={busy}
                      locked={locked}
                      hint={
                        parentNeedsCreation
                          ? `Will also add "${bucket.parentLabel}" to ${prettyColumnLabel(bucket.parentColumnId, entries)}.`
                          : undefined
                      }
                      onSubmit={(picked) => {
                        const additions: AddOptionsRequest = [];
                        if (parentNeedsCreation) {
                          additions.push({
                            columnId: bucket.parentColumnId,
                            values: [{ value: bucket.parentLabel }],
                          });
                        }
                        additions.push({
                          columnId: col,
                          parentValue: parentLower,
                          values: picked.map((v) => ({ value: v })),
                        });
                        return submit(additions);
                      }}
                    />
                  );
                })}
              </div>
            ) : (
              // Flat list (plain select / radio / category)
              <UnknownGroup
                values={info.samples}
                busy={busy}
                locked={locked}
                onSubmit={(picked) =>
                  submit([
                    { columnId: col, values: picked.map((v) => ({ value: v })) },
                  ])
                }
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function prettyColumnLabel(colId: string, entries: UnknownEntry[]): string {
  const found = entries.find(([cid]) => cid === colId);
  return found?.[1]?.columnLabel ?? colId;
}

function UnknownGroup({
  title,
  values,
  counts,
  hint,
  busy,
  locked,
  onSubmit,
}: {
  title?: string;
  values: string[];
  counts?: number[];
  hint?: string;
  busy: boolean;
  locked: boolean;
  onSubmit: (picked: string[]) => Promise<void> | void;
}) {
  // Default state: every unknown value is selected. Admin un-ticks the ones
  // that are typos or junk, then clicks Add.
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set(values));

  // If the upstream value list changes (after re-validate), reset selection.
  React.useEffect(() => {
    setPicked(new Set(values));
  }, [values.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(v: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  return (
    <div className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-950">
      {title && (
        <div className="mb-1 text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          {title}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <label
            key={v}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
          >
            <input
              type="checkbox"
              checked={picked.has(v)}
              onChange={() => toggle(v)}
              className="h-3 w-3"
              disabled={busy || locked}
            />
            <span>{v}</span>
            {counts?.[i] && counts[i] > 0 && (
              <span className="text-neutral-500">×{counts[i]}</span>
            )}
          </label>
        ))}
        {values.length === 0 && (
          <span className="text-neutral-500">No values to add.</span>
        )}
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-blue-700 dark:text-blue-300">{hint}</div>
      )}
      <div className="mt-1.5 flex justify-end">
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={busy || locked || picked.size === 0}
          onClick={() => onSubmit([...picked])}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Add {picked.size} to options
        </Button>
      </div>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "warn" | "err" | "ok";
  children: React.ReactNode;
}) {
  const cls =
    tone === "err"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200"
      : tone === "ok"
      ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-900/20 dark:text-green-200"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200";
  return <div className={`rounded-md border p-2 text-xs ${cls}`}>{children}</div>;
}

/**
 * Shows the batch's lifecycle state right next to the title so admins
 * always know if they're looking at a live, cancelled, or committed batch.
 * Without this, cancelling looks like nothing happened (the Cancel button
 * just quietly disappears).
 */
function BatchStatusBadge({ status }: { status: Batch["status"] }) {
  const map: Record<Batch["status"], { label: string; cls: string }> = {
    parsing: {
      label: "Parsing",
      cls: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    },
    review: {
      label: "Review",
      cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    },
    committing: {
      label: "Committing…",
      cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    },
    committed: {
      label: "Committed",
      cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
    },
    cancelled: {
      label: "Cancelled",
      cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    },
  };
  const { label, cls } = map[status];
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
//  Row + edit drawer
// ---------------------------------------------------------------------------

function RowItem({
  row,
  columns,
  labelById,
  open,
  onOpen,
  onClose,
  onSave,
  onSkipToggle,
  locked,
}: {
  row: Row;
  columns: Column[];
  labelById: Map<string, string>;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => void;
  onSkipToggle: (skipped: boolean) => void;
  locked: boolean;
}) {
  const tone =
    row.status === "committed" ? "bg-green-50/40 dark:bg-green-900/10" :
    row.status === "skipped" ? "opacity-60" :
    row.status === "failed" ? "bg-red-50/40 dark:bg-red-900/10" :
    row.errors.length > 0 ? "bg-red-50/30 dark:bg-red-900/10" :
    row.warnings.length > 0 ? "bg-amber-50/30 dark:bg-amber-900/10" :
    "";

  return (
    <>
      <tr className={tone}>
        <td className="border-b border-neutral-100 px-2 py-1 align-top text-xs dark:border-neutral-800">
          {row.excelRow}
        </td>
        <td className="border-b border-neutral-100 px-2 py-1 align-top dark:border-neutral-800">
          <RowStatusBadge row={row} />
          {row.edited && <span className="ml-1 text-[10px] text-neutral-500">(edited)</span>}
        </td>
        <td className="border-b border-neutral-100 px-2 py-1 align-top text-xs dark:border-neutral-800">
          {row.errors.length === 0 && row.warnings.length === 0 ? (
            <span className="text-neutral-400">—</span>
          ) : (
            <ul className="space-y-0.5">
              {row.errors.slice(0, 3).map((e, i) => (
                <li key={`e${i}`} className="text-red-700 dark:text-red-300">
                  • {e.column ? `${labelById.get(e.column) ?? e.column}: ` : ""}
                  {e.message}
                </li>
              ))}
              {row.warnings.slice(0, 3).map((w, i) => (
                <li key={`w${i}`} className="text-amber-700 dark:text-amber-300">
                  • {w.column ? `${labelById.get(w.column) ?? w.column}: ` : ""}
                  {w.message}
                </li>
              ))}
              {row.errors.length + row.warnings.length > 6 && (
                <li className="text-neutral-500">…and {row.errors.length + row.warnings.length - 6} more</li>
              )}
            </ul>
          )}
        </td>
        <td className="border-b border-neutral-100 px-2 py-1 align-top text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
          <RowPreview row={row} labelById={labelById} />
        </td>
        <td className="border-b border-neutral-100 px-2 py-1 align-top text-right dark:border-neutral-800">
          <div className="flex flex-wrap justify-end gap-1">
            {!locked && row.status !== "committed" && (
              <>
                <Button size="sm" variant="ghost" onClick={open ? onClose : onOpen}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onSkipToggle(row.status !== "skipped")}
                >
                  {row.status === "skipped" ? "Unskip" : "Skip"}
                </Button>
              </>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className="border-b border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
            <RowEditor
              row={row}
              columns={columns}
              onCancel={onClose}
              onSave={onSave}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function RowStatusBadge({ row }: { row: Row }) {
  if (row.status === "committed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> {row.createdPolicyNumber ?? `#${row.createdPolicyId ?? ""}`}
      </span>
    );
  }
  if (row.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
        <XCircle className="h-3.5 w-3.5" /> Failed
      </span>
    );
  }
  if (row.status === "skipped") {
    return <Badge variant="outline">Skipped</Badge>;
  }
  if (row.errors.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
        <AlertCircle className="h-3.5 w-3.5" /> {row.errors.length} error{row.errors.length === 1 ? "" : "s"}
      </span>
    );
  }
  if (row.warnings.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> {row.warnings.length} warning{row.warnings.length === 1 ? "" : "s"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> Ready
    </span>
  );
}

function RowPreview({ row, labelById }: { row: Row; labelById: Map<string, string> }) {
  const parts: string[] = [];
  let count = 0;
  // Show a resolved company / agent NAME when available — admins recognise
  // "Acme Insurance" instantly but record numbers (INS-0001) are noise.
  const refs = row.resolvedRefs ?? {};
  for (const [k, v] of Object.entries(row.rawValues)) {
    if (count >= 4) break;
    if (v === undefined || v === null || v === "") continue;
    const label = labelById.get(k) ?? k;
    const ref = refs[k];
    const display =
      ref && ref.status === "ok" && ref.displayName
        ? `${ref.displayName} (${ref.recordNumber || String(v)})`
        : String(v);
    parts.push(`${label}: ${display}`);
    count++;
  }
  if (row.lastCommitError) {
    return (
      <div className="space-y-1">
        <div>{parts.join(" · ") || "(empty)"}</div>
        <div className="text-red-700 dark:text-red-300">↳ {row.lastCommitError}</div>
      </div>
    );
  }
  return <span>{parts.join(" · ") || "(empty)"}</span>;
}

function RowEditor({
  row,
  columns,
  onCancel,
  onSave,
}: {
  row: Row;
  columns: Column[];
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  // Show every column that has a value OR is mentioned in an error/warning,
  // to keep the form compact. Admin can paste anything into the search box
  // below to find a specific column.
  const issueColumns = new Set<string>();
  for (const e of row.errors) if (e.column) issueColumns.add(e.column);
  for (const w of row.warnings) if (w.column) issueColumns.add(w.column);

  const visibleColumns = columns.filter(
    (c) => row.rawValues[c.id] !== undefined || issueColumns.has(c.id),
  );

  const [draft, setDraft] = React.useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of visibleColumns) {
      const v = row.rawValues[c.id];
      out[c.id] = v === null || v === undefined ? "" : String(v);
    }
    return out;
  });

  const [showAll, setShowAll] = React.useState(false);
  const [filter, setFilter] = React.useState("");

  const renderColumns = React.useMemo(() => {
    const base = showAll ? columns : visibleColumns;
    if (!filter.trim()) return base;
    const t = filter.trim().toLowerCase();
    return base.filter((c) => c.label.toLowerCase().includes(t) || c.id.toLowerCase().includes(t));
  }, [showAll, columns, visibleColumns, filter]);

  function handleSave() {
    // Build patch: send everything that differs from the current rawValues
    // (including blanks → cleared).
    const patch: Record<string, string> = {};
    for (const c of renderColumns) {
      const orig = row.rawValues[c.id];
      const origStr = orig === null || orig === undefined ? "" : String(orig);
      const next = draft[c.id] ?? "";
      if (next !== origStr) patch[c.id] = next;
    }
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    onSave(patch);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Edit row {row.excelRow}</div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter columns…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 w-44"
          />
          <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => {
                setShowAll(e.target.checked);
                if (e.target.checked) {
                  // Seed draft for newly visible columns with their current value
                  setDraft((d) => {
                    const next = { ...d };
                    for (const c of columns) {
                      if (next[c.id] === undefined) {
                        const v = row.rawValues[c.id];
                        next[c.id] = v === null || v === undefined ? "" : String(v);
                      }
                    }
                    return next;
                  });
                }
              }}
            />
            Show all columns
          </label>
        </div>
      </div>

      <div className="grid max-h-[40vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {renderColumns.map((c) => (
          <CellEditor
            key={c.id}
            column={c}
            value={draft[c.id] ?? ""}
            resolvedRef={row.resolvedRefs?.[c.id]}
            onChange={(v) => setDraft((d) => ({ ...d, [c.id]: v }))}
          />
        ))}
        {renderColumns.length === 0 && (
          <div className="col-span-full text-sm text-neutral-500">No columns match.</div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" /> Cancel
        </Button>
        <Button size="sm" onClick={handleSave}>
          <Save className="h-4 w-4" /> Save & re-validate
        </Button>
      </div>
    </div>
  );
}

function CellEditor({
  column,
  value,
  resolvedRef,
  onChange,
}: {
  column: Column;
  value: string;
  /** If present, shows the resolved company / agent name under the input so
   *  the admin can confirm "INS-0001" actually points at the right insurer. */
  resolvedRef?: ResolvedRef;
  onChange: (v: string) => void;
}) {
  // For select/radio: render a native dropdown when we have options.
  // For entity/agent picker: text input + a "Pick" button that opens the
  //   shared drawer used by the wizard. Selecting writes the policy/user
  //   number into the cell, so on save the resolver finds it.
  // For everything else: plain text. The validator runs on save and the
  //   ref-resolver runs as a post-pass — both will surface remaining issues.
  const isSelect = (column.inputType === "select" || column.inputType === "radio") && column.options.length > 0;
  const isAgentPicker = column.entityPicker?.flow === "__agent__";
  const isEntityPicker = !!column.entityPicker && !isAgentPicker;

  const [pickerOpen, setPickerOpen] = React.useState(false);

  return (
    <label className="text-xs">
      <div className="mb-0.5 flex items-center gap-1">
        <span className="font-medium">{column.label}</span>
        {column.required && <span className="text-red-600">*</span>}
        <code className="text-[10px] text-neutral-400">{column.id}</code>
      </div>
      {isSelect ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">—</option>
          {column.options.map((o, idx) => {
            const v = o.value ?? "";
            const lbl = o.label ?? v;
            return (
              <option key={`${v}-${idx}`} value={v}>
                {lbl} ({v})
              </option>
            );
          })}
        </select>
      ) : column.entityPicker ? (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1">
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-7 text-xs"
              placeholder={isAgentPicker ? "user number or name" : "record number or name"}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2"
              onClick={() => setPickerOpen(true)}
              title={isAgentPicker ? "Search agents" : "Search existing records"}
            >
              <Search className="h-3.5 w-3.5" />
              Pick
            </Button>
          </div>
          {value.trim() && resolvedRef && (
            resolvedRef.status === "ok" ? (
              <div className="text-[11px] text-green-700 dark:text-green-400">
                {resolvedRef.displayName || "(no name)"}
                {resolvedRef.recordNumber && resolvedRef.recordNumber !== value.trim() && (
                  <span className="ml-1 text-neutral-500">→ {resolvedRef.recordNumber}</span>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-red-700 dark:text-red-400">
                Not found — pick an existing {isAgentPicker ? "agent" : "record"} or create one first
              </div>
            )
          )}
        </div>
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 text-xs"
        />
      )}

      {isAgentPicker && (
        <AgentPickerDrawer
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(agent) => {
            // Use userNumber as the cell value so the resolver can re-find
            // them; fall back to id only if the user lacks a number.
            const next = agent.userNumber ?? String(agent.id);
            onChange(next);
          }}
        />
      )}
      {isEntityPicker && (
        <EntityPickerDrawer
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          flowKey={column.entityPicker!.flow}
          title={`Select ${column.label}`}
          onSelect={(sel) => {
            onChange(sel.policyNumber);
          }}
        />
      )}
    </label>
  );
}
