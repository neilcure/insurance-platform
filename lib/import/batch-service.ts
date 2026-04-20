/**
 * Batch service — the "engine" that powers the staging-area architecture.
 *
 * This module is deliberately pure of HTTP concerns: every function takes/returns
 * plain data, so the same logic can be invoked from API routes, CLI scripts, or
 * background workers.
 *
 * Lifecycle of a batch:
 *
 *   uploadAndStage()    -> creates an `import_batches` row + N `import_batch_rows`
 *                          rows (status='pending'), runs validation in the chosen
 *                          mode, and refreshes the aggregated summary.
 *
 *   revalidateBatch()   -> re-runs validation on the current `raw_values` of
 *                          every pending row (used after admin edits, or after
 *                          flipping mode strict <-> migration).
 *
 *   updateRowValues()   -> patches a single row's raw_values + re-validates JUST
 *                          that row, then updates the batch's aggregate counts.
 *
 *   skipRow / unskipRow -> toggles a row out of the commit set.
 *
 *   commitBatch()       -> iterates pending rows in excel order, builds the
 *                          payload via the existing payload builder, resolves
 *                          entity refs / clients, calls POST /api/policies, and
 *                          marks each row 'committed' or 'failed'.
 *                          The same row can be retried (edit -> re-commit).
 *
 *   cancelBatch()       -> marks the batch 'cancelled'. Already-committed rows
 *                          stay committed (no rollback) — admin can see exactly
 *                          which records made it.
 */

import { db } from "@/db/client";
import { eq, and, sql, inArray, asc } from "drizzle-orm";
import {
  importBatches,
  importBatchRows,
  type ImportBatch,
  type ImportBatchRow,
} from "@/db/schema/imports";

import { loadFlowImportSchema, flattenFields, type ImportFlowSchema, type ImportFieldDef } from "./schema";
import { parseImportWorkbook, fieldColumnId } from "./excel";
import { validateRows, type ValidatedRow, type RowError } from "./validate";
import { buildPolicyPayload } from "./payload";
import { applyConditionalGating } from "./conditional-gates";
import { evaluateFormulaFields } from "./formula-eval";
import { resolveOrCreateClient } from "./client-resolver";
import {
  EntityResolutionCache,
  applyEntityReferences,
  attachRefResolutionInfo,
} from "./entity-resolver";
import { serverFetch } from "@/lib/auth/server-fetch";

/** Hard cap on rows per upload. Matches existing import endpoints. */
export const MAX_BATCH_ROWS = 500;

/** Default downstream client-flow used by the auto-create-client step. */
const DEFAULT_CLIENT_FLOW_KEY = "clientSet";

/** Max distinct values shown per "unknown values" group in the summary. */
const SUMMARY_SAMPLE_LIMIT = 25;

// ---------------------------------------------------------------------------
//  Types returned to the API/UI
// ---------------------------------------------------------------------------

export type BatchSummary = {
  /**
   * Per-column unknown select values. For plain select columns we track
   * one bucket of unique strings. For `option_child_collapsed` columns
   * (e.g. "Model" — depends on "Make"), we ALSO break the unknowns down
   * by their parent value so the "Add to options" UI can group them
   * correctly: "Camry, Corolla under Toyota" vs "Civic under Honda".
   */
  unknownValuesByColumn: Record<
    string,
    {
      columnLabel: string;
      uniqueCount: number;
      rowCount: number;
      samples: string[];
      /** Set only for collapsed-child columns. Keyed by lower-cased parent
       *  value. Each entry holds the parent's display label + the per-value
       *  buckets (so we can render "Toyota → [Camry × 3, Corolla × 2]"). */
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
  /** Per-column row counts where a Required cell is empty */
  missingRequiredByColumn: Record<string, { columnLabel: string; rowCount: number }>;
  /** Per-column off-category warnings: these rows have data in fields that
   *  don't belong to their selected category */
  offCategoryByColumn: Record<string, { columnLabel: string; rowCount: number }>;
  /** Other warnings grouped by column (catch-all) */
  otherWarningsByColumn: Record<
    string,
    { columnLabel: string; rowCount: number; samples: string[] }
  >;
  /** Other errors grouped by column (catch-all) */
  otherErrorsByColumn: Record<
    string,
    { columnLabel: string; rowCount: number; samples: string[] }
  >;
  /** File-level: unknown columns ignored during parse */
  unknownColumns: string[];
  /** File-level: required columns that are missing from the sheet entirely */
  missingColumns: string[];
};

export type BatchAggregates = {
  totalRows: number;
  readyRows: number;
  warningRows: number;
  errorRows: number;
  committedRows: number;
  failedRows: number;
  skippedRows: number;
};

export type CreateBatchOptions = {
  flowKey: string;
  filename: string;
  fileSizeBytes: number;
  fileBuffer: Buffer;
  clientFlowKey?: string;
  createdBy?: number | null;
};

export type CreateBatchResult = {
  batch: ImportBatch;
  aggregates: BatchAggregates;
  summary: BatchSummary;
};

// ---------------------------------------------------------------------------
//  Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compact snapshot of a row's validation state — used to decide which bucket
 * (ready / warning / error) the row belongs to for the batch's aggregates.
 */
type RowState = "ready" | "warning" | "error";

function classifyRow(row: { errors: RowError[]; warnings: RowError[]; status: string }): RowState | "skipped" | "committed" | "failed" {
  if (row.status === "skipped") return "skipped";
  if (row.status === "committed") return "committed";
  if (row.status === "failed") return "failed";
  if (row.errors.length > 0) return "error";
  if (row.warnings.length > 0) return "warning";
  return "ready";
}

/** Build the issue-summary blob from the in-memory rows and schema. */
export function buildBatchSummary(
  rows: Array<{ errors: RowError[]; warnings: RowError[]; rawValues: Record<string, unknown>; status: string }>,
  schema: ImportFlowSchema,
  parseMeta: { unknownColumns: string[]; missingColumns: string[] },
): BatchSummary {
  const fields = flattenFields(schema);
  const labelById = new Map(fields.map((f) => [fieldColumnId(f), f.label]));
  const fieldById = new Map(fields.map((f) => [fieldColumnId(f), f]));

  // Pre-compute parent column ids for collapsed-child columns so we can
  // group their unknown values per parent value (Make → Model bucketing).
  const parentColIdByCollapsed = new Map<string, { parentColId: string; parentLabel: string }>();
  for (const f of fields) {
    if (f.virtual?.kind !== "option_child_collapsed") continue;
    const v = f.virtual;
    const parentField = fields.find((p) => p.pkg === v.pkg && p.key === v.parentKey);
    if (!parentField) continue;
    parentColIdByCollapsed.set(fieldColumnId(f), {
      parentColId: fieldColumnId(parentField),
      parentLabel: v.parentLabel,
    });
  }

  // Helpers to bucket rows per column
  const unknownValuesByColumn: BatchSummary["unknownValuesByColumn"] = {};
  const missingRequiredByColumn: BatchSummary["missingRequiredByColumn"] = {};
  const offCategoryByColumn: BatchSummary["offCategoryByColumn"] = {};
  const otherWarningsByColumn: BatchSummary["otherWarningsByColumn"] = {};
  const otherErrorsByColumn: BatchSummary["otherErrorsByColumn"] = {};

  // Per-column accumulators for unique values / row counts.
  // Keep tracking sets local so we can compute counts at the end.
  const unknownValueSets = new Map<string, Map<string, number>>(); // colId -> value -> rowCount
  // For collapsed columns: colId -> parentValueLower -> value -> rowCount.
  const unknownValueByParentSets = new Map<string, Map<string, Map<string, number>>>();

  for (const row of rows) {
    // We only summarise rows that are actually contributing — skip already
    // committed/skipped/failed rows from the issue picture.
    if (row.status === "committed" || row.status === "skipped") continue;

    for (const e of row.errors) {
      if (!e.column) continue;
      const label = labelById.get(e.column) ?? e.column;
      if (e.message === "Required") {
        const slot = (missingRequiredByColumn[e.column] ??= { columnLabel: label, rowCount: 0 });
        slot.rowCount++;
      } else {
        const slot = (otherErrorsByColumn[e.column] ??= { columnLabel: label, rowCount: 0, samples: [] });
        slot.rowCount++;
        if (slot.samples.length < SUMMARY_SAMPLE_LIMIT && !slot.samples.includes(e.message)) {
          slot.samples.push(e.message);
        }
      }
    }

    for (const w of row.warnings) {
      if (!w.column) continue;
      const label = labelById.get(w.column) ?? w.column;

      // Detect "Unknown value" warnings — pull the actual cell value out of
      // raw_values so the admin sees what the source spreadsheet contained.
      if (/^Unknown values? "?/i.test(w.message)) {
        const cellVal = row.rawValues[w.column];
        const cellStr = cellVal === null || cellVal === undefined ? "" : String(cellVal).trim();
        if (cellStr) {
          const valueMap = unknownValueSets.get(w.column) ?? new Map<string, number>();
          valueMap.set(cellStr, (valueMap.get(cellStr) ?? 0) + 1);
          unknownValueSets.set(w.column, valueMap);

          // Collapsed-child column? Also track per-parent so the UI can
          // render "Toyota → [Camry × 3, Corolla × 2]" buckets and the
          // "Add to options" endpoint knows which parent each value
          // belongs under.
          const parentInfo = parentColIdByCollapsed.get(w.column);
          if (parentInfo) {
            const parentRaw = row.rawValues[parentInfo.parentColId];
            const parentLower =
              parentRaw === null || parentRaw === undefined
                ? ""
                : String(parentRaw).trim().toLowerCase();
            if (parentLower) {
              const byParent =
                unknownValueByParentSets.get(w.column) ??
                new Map<string, Map<string, number>>();
              const valueMap2 = byParent.get(parentLower) ?? new Map<string, number>();
              valueMap2.set(cellStr, (valueMap2.get(cellStr) ?? 0) + 1);
              byParent.set(parentLower, valueMap2);
              unknownValueByParentSets.set(w.column, byParent);
            }
          }
        }
      } else if (/^Off-category data/i.test(w.message)) {
        const slot = (offCategoryByColumn[w.column] ??= { columnLabel: label, rowCount: 0 });
        slot.rowCount++;
      } else {
        const slot = (otherWarningsByColumn[w.column] ??= { columnLabel: label, rowCount: 0, samples: [] });
        slot.rowCount++;
        if (slot.samples.length < SUMMARY_SAMPLE_LIMIT && !slot.samples.includes(w.message)) {
          slot.samples.push(w.message);
        }
      }
    }
  }

  // Materialise the unknown-value buckets
  for (const [colId, valueMap] of unknownValueSets) {
    const label = labelById.get(colId) ?? colId;
    const samples = Array.from(valueMap.keys()).slice(0, SUMMARY_SAMPLE_LIMIT);
    let totalRowCount = 0;
    for (const c of valueMap.values()) totalRowCount += c;

    let byParent: BatchSummary["unknownValuesByColumn"][string]["byParent"];
    const byParentMap = unknownValueByParentSets.get(colId);
    const parentInfo = parentColIdByCollapsed.get(colId);
    if (byParentMap && parentInfo) {
      byParent = {};
      for (const [parentLower, vm] of byParentMap) {
        // Use the parent FIELD's option label when we recognise the value;
        // fall back to the raw lower-cased key otherwise. This lets the UI
        // show "Toyota" instead of "toyota" on the bucket header.
        const parentField = fieldById.get(parentInfo.parentColId);
        let parentDisplay = parentLower;
        const opt = parentField?.options.find(
          (o) => (o.value ?? "").toLowerCase() === parentLower,
        );
        if (opt) parentDisplay = opt.label ?? opt.value ?? parentLower;
        byParent[parentLower] = {
          parentLabel: parentDisplay,
          parentColumnId: parentInfo.parentColId,
          values: Array.from(vm.entries())
            .map(([value, rowCount]) => ({ value, rowCount }))
            .sort((a, b) => b.rowCount - a.rowCount)
            .slice(0, SUMMARY_SAMPLE_LIMIT),
        };
      }
    }

    unknownValuesByColumn[colId] = {
      columnLabel: label,
      uniqueCount: valueMap.size,
      rowCount: totalRowCount,
      samples,
      ...(byParent ? { byParent } : {}),
    };
  }

  return {
    unknownValuesByColumn,
    missingRequiredByColumn,
    offCategoryByColumn,
    otherWarningsByColumn,
    otherErrorsByColumn,
    unknownColumns: parseMeta.unknownColumns,
    missingColumns: parseMeta.missingColumns,
  };
}

/** Compute aggregates from the rows AS THEY EXIST IN MEMORY (post-validation). */
function computeAggregates(
  rows: Array<{ errors: RowError[]; warnings: RowError[]; status: string }>,
): BatchAggregates {
  const agg: BatchAggregates = {
    totalRows: rows.length,
    readyRows: 0,
    warningRows: 0,
    errorRows: 0,
    committedRows: 0,
    failedRows: 0,
    skippedRows: 0,
  };
  for (const r of rows) {
    const cls = classifyRow(r);
    switch (cls) {
      case "ready":     agg.readyRows++;     break;
      case "warning":   agg.warningRows++;   break;
      case "error":     agg.errorRows++;     break;
      case "committed": agg.committedRows++; break;
      case "failed":    agg.failedRows++;    break;
      case "skipped":   agg.skippedRows++;   break;
    }
  }
  return agg;
}

/** Convert a single ParsedImportRow's raw values into the `raw_values` jsonb shape. */
function toRawValues(values: Record<string, unknown>): Record<string, unknown> {
  // We store values as strings where they came from Excel — the validator
  // normalises everything anyway. Dates are serialised as ISO strings to
  // survive the JSON roundtrip cleanly.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    if (v instanceof Date) {
      out[k] = v.toISOString();
    } else if (typeof v === "object") {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Public service functions
// ---------------------------------------------------------------------------

/**
 * Upload + parse + stage a new batch in a single transaction.
 *
 * Returns the persisted batch + aggregates + summary so the caller can
 * immediately render the review page without an extra round-trip.
 */
export async function uploadAndStage(opts: CreateBatchOptions): Promise<CreateBatchResult> {
  const schema = await loadFlowImportSchema(opts.flowKey);
  if (schema.packages.length === 0) {
    throw new Error(`No fields configured for flow "${opts.flowKey}"`);
  }

  const parsed = await parseImportWorkbook(opts.fileBuffer, schema);
  if (parsed.rows.length > MAX_BATCH_ROWS) {
    throw new Error(
      `Too many rows: ${parsed.rows.length}. Maximum per import is ${MAX_BATCH_ROWS}.`,
    );
  }

  const validated = validateRows(parsed.rows, schema);

  // Resolve entity-picker refs against the DB. Returns:
  //   • Hard errors appended to row.errors for missing references.
  //   • A `resolvedRefs` map (per excelRow) so the staging UI can show
  //     "Acme Insurance Ltd" instead of the raw "INS-0001".
  // Cache is per-upload — usually 200 rows pointing at ~10 distinct
  // insurers, so we get massive de-dup.
  const resolvedByRow = await attachRefResolutionInfo(
    validated,
    schema,
    new EntityResolutionCache(),
  );

  // Pair each ValidatedRow with its raw values for the staging table
  const rowsForDb = validated.map((v) => ({
    excelRow: v.excelRow,
    rawValues: toRawValues(v.values),
    errors: v.errors,
    warnings: v.warnings,
    resolvedRefs: resolvedByRow.get(v.excelRow) ?? {},
    status: "pending" as const,
  }));

  const summary = buildBatchSummary(rowsForDb, schema, {
    unknownColumns: parsed.unknownColumns,
    missingColumns: parsed.missingColumns,
  });
  const aggregates = computeAggregates(rowsForDb);

  // Insert batch + rows. Drizzle doesn't expose interactive transactions on
  // every driver, so we do batch insert + row insert sequentially. If the row
  // insert fails we delete the batch.
  const [batch] = await db
    .insert(importBatches)
    .values({
      flowKey: opts.flowKey,
      clientFlowKey: opts.clientFlowKey ?? DEFAULT_CLIENT_FLOW_KEY,
      createdBy: opts.createdBy ?? null,
      filename: opts.filename,
      fileSizeBytes: opts.fileSizeBytes,
      status: "review",
      totalRows: aggregates.totalRows,
      readyRows: aggregates.readyRows,
      warningRows: aggregates.warningRows,
      errorRows: aggregates.errorRows,
      committedRows: 0,
      failedRows: 0,
      skippedRows: 0,
      summary: summary as unknown as Record<string, unknown>,
    })
    .returning();

  if (rowsForDb.length > 0) {
    try {
      await db.insert(importBatchRows).values(
        rowsForDb.map((r) => ({
          batchId: batch.id,
          excelRow: r.excelRow,
          rawValues: r.rawValues,
          errors: r.errors,
          warnings: r.warnings,
          resolvedRefs: r.resolvedRefs,
          status: r.status,
        })),
      );
    } catch (e) {
      // Roll back the batch row on staging failure
      await db.delete(importBatches).where(eq(importBatches.id, batch.id));
      throw e;
    }
  }

  return { batch, aggregates, summary };
}

/**
 * Re-validate every PENDING row in a batch (skipped / committed / failed
 * rows are left alone). Refreshes the row's errors/warnings columns and
 * the batch's aggregates + summary.
 *
 * Use this after:
 *   • Bulk edit (e.g. "skip all rows with unknown Make").
 *   • The flow's schema changed underneath.
 */
export async function revalidateBatch(batchId: number): Promise<{
  aggregates: BatchAggregates;
  summary: BatchSummary;
}> {
  const batch = await getBatchOrThrow(batchId);

  const dbRows = await db
    .select()
    .from(importBatchRows)
    .where(eq(importBatchRows.batchId, batchId))
    .orderBy(asc(importBatchRows.excelRow));

  const schema = await loadFlowImportSchema(batch.flowKey);

  // Only revalidate rows that aren't already committed/skipped/failed
  const pending = dbRows.filter((r) => r.status === "pending");

  const synthetic = pending.map((r) => ({
    excelRow: r.excelRow,
    values: r.rawValues,
  }));
  const validated = validateRows(synthetic, schema);

  // Re-resolve entity refs — admins use re-validate after fixing master data
  // (e.g. adding a missing insurer in another tab), so this is the step
  // that makes the "missing record" errors disappear AND refreshes the
  // displayed company / agent name in the UI.
  const resolvedByRow = await attachRefResolutionInfo(
    validated,
    schema,
    new EntityResolutionCache(),
  );

  // Update each row's errors/warnings/resolvedRefs if changed
  const updated = new Map<number, ValidatedRow>();
  for (let i = 0; i < pending.length; i++) {
    updated.set(pending[i].id, validated[i]);
  }

  for (const r of pending) {
    const v = updated.get(r.id);
    if (!v) continue;
    await db
      .update(importBatchRows)
      .set({
        errors: v.errors,
        warnings: v.warnings,
        resolvedRefs: resolvedByRow.get(v.excelRow) ?? {},
        updatedAt: sql`now()`,
      })
      .where(eq(importBatchRows.id, r.id));
  }

  // Refresh batch aggregates and summary using the merged view
  // (re-pull all rows so we account for skipped/committed too).
  const refreshed = await db
    .select()
    .from(importBatchRows)
    .where(eq(importBatchRows.batchId, batchId));

  const summary = buildBatchSummary(
    refreshed.map((r) => ({
      errors: r.errors,
      warnings: r.warnings,
      rawValues: r.rawValues,
      status: r.status,
    })),
    schema,
    {
      unknownColumns:
        ((batch.summary as { unknownColumns?: string[] } | null)?.unknownColumns ?? []) as string[],
      missingColumns:
        ((batch.summary as { missingColumns?: string[] } | null)?.missingColumns ?? []) as string[],
    },
  );
  const aggregates = computeAggregates(refreshed);

  await db
    .update(importBatches)
    .set({
      readyRows: aggregates.readyRows,
      warningRows: aggregates.warningRows,
      errorRows: aggregates.errorRows,
      committedRows: aggregates.committedRows,
      failedRows: aggregates.failedRows,
      skippedRows: aggregates.skippedRows,
      summary: summary as unknown as Record<string, unknown>,
      updatedAt: sql`now()`,
    })
    .where(eq(importBatches.id, batchId));

  return { aggregates, summary };
}

/** Patch a single row's raw values, then re-validate JUST that row. */
export async function updateRowValues(
  batchId: number,
  rowId: number,
  patch: Record<string, unknown>,
): Promise<{ row: ImportBatchRow; aggregates: BatchAggregates; summary: BatchSummary }> {
  const batch = await getBatchOrThrow(batchId);
  if (batch.status === "committing" || batch.status === "committed") {
    throw new Error(`Batch is ${batch.status}; rows are read-only.`);
  }

  const [existing] = await db
    .select()
    .from(importBatchRows)
    .where(and(eq(importBatchRows.id, rowId), eq(importBatchRows.batchId, batchId)));
  if (!existing) throw new Error("Row not found");
  if (existing.status === "committed") {
    throw new Error("Row already committed; cannot edit.");
  }

  // Merge patch into raw values. Empty string clears the cell.
  const merged: Record<string, unknown> = { ...existing.rawValues };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") {
      delete merged[k];
    } else {
      merged[k] = typeof v === "string" ? v : String(v);
    }
  }

  const schema = await loadFlowImportSchema(batch.flowKey);
  const [validated] = validateRows(
    [{ excelRow: existing.excelRow, values: merged }],
    schema,
  );

  // Single-row resolve: cheap because the cache is empty and we only check
  // the columns this row actually has values for. Catches the common case
  // of admin pasting a real policy number into the Picker and saving, AND
  // refreshes the resolved company / agent name on the row.
  const resolvedByRow = await attachRefResolutionInfo(
    [validated],
    schema,
    new EntityResolutionCache(),
  );

  const [updatedRow] = await db
    .update(importBatchRows)
    .set({
      rawValues: merged,
      errors: validated.errors,
      warnings: validated.warnings,
      resolvedRefs: resolvedByRow.get(validated.excelRow) ?? {},
      edited: true,
      // If a previously failed row was edited, return it to pending so it
      // can be retried.
      status: existing.status === "failed" ? "pending" : existing.status,
      lastCommitError: existing.status === "failed" ? null : existing.lastCommitError,
      updatedAt: sql`now()`,
    })
    .where(eq(importBatchRows.id, rowId))
    .returning();

  // Refresh batch aggregates / summary
  const allRows = await db
    .select()
    .from(importBatchRows)
    .where(eq(importBatchRows.batchId, batchId));
  const aggregates = computeAggregates(allRows);
  const summary = buildBatchSummary(
    allRows.map((r) => ({
      errors: r.errors,
      warnings: r.warnings,
      rawValues: r.rawValues,
      status: r.status,
    })),
    schema,
    {
      unknownColumns:
        ((batch.summary as { unknownColumns?: string[] } | null)?.unknownColumns ?? []) as string[],
      missingColumns:
        ((batch.summary as { missingColumns?: string[] } | null)?.missingColumns ?? []) as string[],
    },
  );

  await db
    .update(importBatches)
    .set({
      readyRows: aggregates.readyRows,
      warningRows: aggregates.warningRows,
      errorRows: aggregates.errorRows,
      committedRows: aggregates.committedRows,
      failedRows: aggregates.failedRows,
      skippedRows: aggregates.skippedRows,
      summary: summary as unknown as Record<string, unknown>,
      updatedAt: sql`now()`,
    })
    .where(eq(importBatches.id, batchId));

  return { row: updatedRow, aggregates, summary };
}

/** Mark a row as skipped (or unskip). Skipped rows are excluded from commit. */
export async function setRowSkipped(
  batchId: number,
  rowId: number,
  skipped: boolean,
): Promise<{ row: ImportBatchRow; aggregates: BatchAggregates }> {
  const batch = await getBatchOrThrow(batchId);
  if (batch.status === "committing" || batch.status === "committed") {
    throw new Error(`Batch is ${batch.status}; rows are read-only.`);
  }

  const [existing] = await db
    .select()
    .from(importBatchRows)
    .where(and(eq(importBatchRows.id, rowId), eq(importBatchRows.batchId, batchId)));
  if (!existing) throw new Error("Row not found");
  if (existing.status === "committed") {
    throw new Error("Row already committed; cannot change skip state.");
  }

  const newStatus: ImportBatchRow["status"] = skipped ? "skipped" : "pending";
  const [updated] = await db
    .update(importBatchRows)
    .set({ status: newStatus, updatedAt: sql`now()` })
    .where(eq(importBatchRows.id, rowId))
    .returning();

  const allRows = await db
    .select()
    .from(importBatchRows)
    .where(eq(importBatchRows.batchId, batchId));
  const aggregates = computeAggregates(allRows);

  await db
    .update(importBatches)
    .set({
      readyRows: aggregates.readyRows,
      warningRows: aggregates.warningRows,
      errorRows: aggregates.errorRows,
      committedRows: aggregates.committedRows,
      failedRows: aggregates.failedRows,
      skippedRows: aggregates.skippedRows,
      updatedAt: sql`now()`,
    })
    .where(eq(importBatches.id, batchId));

  return { row: updated, aggregates };
}

/** Bulk-skip every row matching a predicate (e.g. "all rows with unknown Make"). */
export async function bulkSkipRows(
  batchId: number,
  rowIds: number[],
): Promise<{ updated: number; aggregates: BatchAggregates }> {
  const batch = await getBatchOrThrow(batchId);
  if (batch.status === "committing" || batch.status === "committed") {
    throw new Error(`Batch is ${batch.status}; rows are read-only.`);
  }
  if (rowIds.length === 0) {
    const allRows = await db
      .select()
      .from(importBatchRows)
      .where(eq(importBatchRows.batchId, batchId));
    return { updated: 0, aggregates: computeAggregates(allRows) };
  }

  const result = await db
    .update(importBatchRows)
    .set({ status: "skipped", updatedAt: sql`now()` })
    .where(
      and(
        eq(importBatchRows.batchId, batchId),
        inArray(importBatchRows.id, rowIds),
        // Don't touch already-committed rows
        sql`${importBatchRows.status} <> 'committed'`,
      ),
    )
    .returning({ id: importBatchRows.id });

  const allRows = await db
    .select()
    .from(importBatchRows)
    .where(eq(importBatchRows.batchId, batchId));
  const aggregates = computeAggregates(allRows);

  await db
    .update(importBatches)
    .set({
      readyRows: aggregates.readyRows,
      warningRows: aggregates.warningRows,
      errorRows: aggregates.errorRows,
      committedRows: aggregates.committedRows,
      failedRows: aggregates.failedRows,
      skippedRows: aggregates.skippedRows,
      updatedAt: sql`now()`,
    })
    .where(eq(importBatches.id, batchId));

  return { updated: result.length, aggregates };
}

export type CommitProgressSnapshot = {
  status: ImportBatch["status"];
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  remaining: number;
  lastError?: string;
};

/**
 * Commit the batch — iterate every PENDING row in excelRow order, build the
 * payload, resolve refs, auto-create client (if needed), and POST to /api/policies.
 *
 * Rows with hard errors are skipped (admin must fix or skip them first).
 * Rows already 'committed' are skipped.
 *
 * This function is synchronous — it returns when the batch finishes (success
 * or failure). The caller (API route) sets a reasonable HTTP timeout; for very
 * large batches the `/progress` endpoint can be polled mid-commit.
 */
export async function commitBatch(batchId: number): Promise<CommitProgressSnapshot> {
  const batch = await getBatchOrThrow(batchId);
  if (batch.status === "committed") {
    return progressFor(batch, []);
  }
  if (batch.status === "cancelled") {
    throw new Error("Batch was cancelled.");
  }
  if (batch.status === "committing") {
    throw new Error("Batch commit is already in progress.");
  }

  const schema = await loadFlowImportSchema(batch.flowKey);
  const fields = flattenFields(schema);
  const fieldByColumnId = new Map(fields.map((f) => [fieldColumnId(f), f]));

  // Mark batch as committing
  await db
    .update(importBatches)
    .set({
      status: "committing",
      committingStartedAt: sql`now()`,
      lastError: null,
      updatedAt: sql`now()`,
    })
    .where(eq(importBatches.id, batchId));

  // Pull pending rows in order
  const pending = await db
    .select()
    .from(importBatchRows)
    .where(and(eq(importBatchRows.batchId, batchId), eq(importBatchRows.status, "pending")))
    .orderBy(asc(importBatchRows.excelRow));

  // Skip rows that have hard errors (defensive — UI should already have hidden them)
  const ready = pending.filter((r) => r.errors.length === 0);

  const entityCache = new EntityResolutionCache();
  const clientFlowKey = batch.clientFlowKey;

  let succeeded = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const row of ready) {
    try {
      const validatedShape: ValidatedRow = {
        excelRow: row.excelRow,
        values: applyValidatorNormalisation(row.rawValues, fieldByColumnId),
        errors: [],
        warnings: row.warnings,
      };
      const { payload, clientNumber, agentNumber, entityRefs } = buildPolicyPayload(validatedShape, schema);

      // Resolve entity refs (insurer, collaborators, agent)
      const refsForResolution = [...entityRefs];
      if (agentNumber) {
        refsForResolution.push({
          scope: "package",
          pkg: "policy",
          columnId: "policy.agentNumber",
          fullKey: "policy__agentNumber",
          refFlow: "__agent__",
          refValue: agentNumber,
          mappings: [],
        });
      }
      const refErrors = await applyEntityReferences(payload, refsForResolution, entityCache);
      if (refErrors.length > 0) {
        throw new Error(refErrors.map((e) => `${e.columnId}: ${e.message}`).join("; "));
      }

      // Strip values for fields whose visibility gate fails, then evaluate
      // formula fields. ORDER MATTERS:
      //
      //   1. applyConditionalGating runs FIRST so a TPO row with stray
      //      Section I excess values gets cleaned up — otherwise those zero
      //      values would render on the policy detail page (bug fix matching
      //      the wizard, which never lets the user input gated values in the
      //      first place).
      //
      //   2. evaluateFormulaFields runs SECOND so formulas like
      //      `{startedDate} + 364` resolve against the cleaned snapshot —
      //      and so derived fields aren't computed from values that were
      //      about to be dropped anyway.
      //
      // Both passes mutate `payload` in place and return notes; we discard
      // the notes here for now. (Surfacing them to the review UI is a
      // future polish — see GatedFieldNote / ComputedFormulaNote types.)
      applyConditionalGating(payload, schema);
      evaluateFormulaFields(payload, schema);

      // Auto-create / resolve client.
      //
      // IMPORTANT — two systems both called "client" coexist here:
      //   • `clients` table   — legacy, FK target of `policies.client_id`
      //   • `policies` table with flow_key="clientSet" — the new dynamic-flow
      //     "client policy" record (what `resolveOrCreateClient` returns)
      //
      // resolveOrCreateClient returns a policies.id (clientSet flow), NOT a
      // clients.id. Putting that id into payload.policy.clientId triggered
      // a 23503 FK violation on policies_client_id_fkey, leaving the freshly
      // created clientSet policy orphaned and zero real policies created
      // ("I imported 1 row, 2 clients created, 0 policies" bug).
      //
      // Fix: keep the linkage in the SNAPSHOT (insured.clientPolicyId /
      // clientPolicyNumber) — listing/lookup queries already read from those
      // jsonb keys (see /api/policies GET clientFilterExpr) — and DO NOT
      // populate the legacy policies.client_id column.
      let resolvedClientNumber: string | undefined;
      let clientCreated = false;
      let createdClientPolicyId: number | undefined;
      if (Object.keys(payload.insured).length > 0 || clientNumber) {
        const resolved = await resolveOrCreateClient({
          clientNumber,
          insured: payload.insured,
          clientFlowKey,
        });
        payload.insured.clientPolicyId = resolved.clientPolicyId;
        payload.insured.clientPolicyNumber = resolved.clientPolicyNumber;
        // NOTE: deliberately NOT setting payload.policy.clientId here.
        resolvedClientNumber = resolved.clientPolicyNumber;
        clientCreated = resolved.created;
        if (resolved.created) createdClientPolicyId = resolved.clientPolicyId;
      }

      let res: Response;
      let body: {
        error?: string;
        policyId?: number;
        recordId?: number;
        policyNumber?: string;
        recordNumber?: string;
      };
      try {
        res = await serverFetch("/api/policies", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        body = (await res.json().catch(() => ({}))) as typeof body;
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      } catch (postErr) {
        // Roll back the just-auto-created client policy so a failed commit
        // doesn't leave dangling clientSet rows in /dashboard/clients.
        // (We only delete clients THIS row created — never an existing one
        // matched by clientNumber, which `clientCreated=false` guarantees.)
        if (createdClientPolicyId) {
          try {
            await serverFetch(`/api/policies/${createdClientPolicyId}`, {
              method: "DELETE",
            });
          } catch { /* best-effort rollback; surface the original error */ }
        }
        throw postErr;
      }

      const policyId = Number(body.recordId ?? body.policyId ?? 0);
      const policyNumber = String(body.recordNumber ?? body.policyNumber ?? "");

      await db
        .update(importBatchRows)
        .set({
          status: "committed",
          createdPolicyId: Number.isFinite(policyId) && policyId > 0 ? policyId : null,
          createdPolicyNumber: policyNumber || null,
          resolvedClientNumber: resolvedClientNumber ?? null,
          clientCreated,
          commitAttempts: row.commitAttempts + 1,
          lastCommitError: null,
          committedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(importBatchRows.id, row.id));
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      lastError = message;
      await db
        .update(importBatchRows)
        .set({
          status: "failed",
          commitAttempts: row.commitAttempts + 1,
          lastCommitError: message,
          updatedAt: sql`now()`,
        })
        .where(eq(importBatchRows.id, row.id));
      failed++;
    }
  }

  // Final aggregate refresh
  const finalRows = await db
    .select()
    .from(importBatchRows)
    .where(eq(importBatchRows.batchId, batchId));
  const aggregates = computeAggregates(finalRows);

  await db
    .update(importBatches)
    .set({
      status: "committed",
      committedAt: sql`now()`,
      readyRows: aggregates.readyRows,
      warningRows: aggregates.warningRows,
      errorRows: aggregates.errorRows,
      committedRows: aggregates.committedRows,
      failedRows: aggregates.failedRows,
      skippedRows: aggregates.skippedRows,
      lastError: lastError ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(importBatches.id, batchId));

  return {
    status: "committed",
    total: ready.length,
    done: ready.length,
    succeeded,
    failed,
    remaining: 0,
    lastError,
  };
}

/** Cancel a batch (no rollback of already-committed rows). */
export async function cancelBatch(batchId: number): Promise<void> {
  const batch = await getBatchOrThrow(batchId);
  if (batch.status === "committed") {
    throw new Error("Cannot cancel a fully committed batch.");
  }
  await db
    .update(importBatches)
    .set({ status: "cancelled", updatedAt: sql`now()` })
    .where(eq(importBatches.id, batchId));
}

/**
 * Permanently delete a batch + its staging rows.
 *
 * Only the staging records go away — any policies/clients that were created
 * during commit are NOT touched (the batch row's `created_policy_id` is just
 * an `integer`, with no FK to `policies`). Used for housekeeping the
 * /dashboard/imports list.
 *
 * Disallowed while the batch is actively being processed (`parsing` or
 * `committing`) to avoid race conditions with the worker.
 */
export async function deleteBatch(batchId: number): Promise<void> {
  const batch = await getBatchOrThrow(batchId);
  if (batch.status === "parsing" || batch.status === "committing") {
    throw new Error(
      `Cannot delete a batch while it is ${batch.status}. Cancel it first or wait for it to finish.`,
    );
  }
  // ON DELETE CASCADE on import_batch_rows.batch_id removes child rows.
  await db.delete(importBatches).where(eq(importBatches.id, batchId));
}

/** Get the live progress snapshot for a batch. */
export async function getBatchProgress(batchId: number): Promise<CommitProgressSnapshot> {
  const batch = await getBatchOrThrow(batchId);
  const rows = await db
    .select({ status: importBatchRows.status })
    .from(importBatchRows)
    .where(eq(importBatchRows.batchId, batchId));
  return progressFor(batch, rows);
}

function progressFor(
  batch: ImportBatch,
  rows: Array<{ status: ImportBatchRow["status"] }>,
): CommitProgressSnapshot {
  let succeeded = 0;
  let failed = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === "committed") succeeded++;
    else if (r.status === "failed") failed++;
    else if (r.status === "pending") pending++;
  }
  const target = succeeded + failed + pending;
  return {
    status: batch.status,
    total: target,
    done: succeeded + failed,
    succeeded,
    failed,
    remaining: pending,
    lastError: batch.lastError ?? undefined,
  };
}

// ---------------------------------------------------------------------------
//  Read helpers
// ---------------------------------------------------------------------------

export async function getBatchOrThrow(batchId: number): Promise<ImportBatch> {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!batch) throw new Error(`Batch ${batchId} not found`);
  return batch;
}

export async function listBatches(filter?: { flowKey?: string; createdBy?: number }): Promise<ImportBatch[]> {
  const wheres = [];
  if (filter?.flowKey) wheres.push(eq(importBatches.flowKey, filter.flowKey));
  if (filter?.createdBy) wheres.push(eq(importBatches.createdBy, filter.createdBy));
  const where = wheres.length === 0 ? undefined : wheres.length === 1 ? wheres[0] : and(...wheres);
  const q = db.select().from(importBatches);
  const rows = where ? await q.where(where).orderBy(sql`${importBatches.createdAt} desc`)
                     : await q.orderBy(sql`${importBatches.createdAt} desc`);
  return rows;
}

export async function getBatchRows(
  batchId: number,
  opts?: { status?: ImportBatchRow["status"][]; limit?: number; offset?: number },
): Promise<ImportBatchRow[]> {
  const wheres = [eq(importBatchRows.batchId, batchId)];
  if (opts?.status && opts.status.length > 0) {
    wheres.push(inArray(importBatchRows.status, opts.status));
  }
  let q = db.select().from(importBatchRows).where(and(...wheres)).orderBy(asc(importBatchRows.excelRow)).$dynamic();
  if (opts?.limit !== undefined) q = q.limit(opts.limit);
  if (opts?.offset !== undefined) q = q.offset(opts.offset);
  return await q;
}

// ---------------------------------------------------------------------------
//  Internal: re-normalise raw_values via the validator (so the payload builder
//  receives the same shape it would from a fresh upload).
// ---------------------------------------------------------------------------

function applyValidatorNormalisation(
  rawValues: Record<string, unknown>,
  fieldByColumnId: Map<string, ImportFieldDef>,
): Record<string, unknown> {
  // We DON'T care about issues here — they were enforced by the caller
  // (commitBatch only commits rows with errors=[]). What we DO care about
  // is producing the same normalised shape the wizard sees: numbers as
  // numbers, selects as option.value, etc. Hand-rolled to avoid having to
  // rebuild a synthetic ImportFlowSchema every commit row.
  const out: Record<string, unknown> = {};
  for (const [colId, raw] of Object.entries(rawValues)) {
    const f = fieldByColumnId.get(colId);
    if (!f) { out[colId] = raw; continue; }
    if (raw === null || raw === undefined || raw === "") continue;

    // Numbers
    if (f.inputType === "number" || f.inputType === "currency" || f.inputType === "negative_currency") {
      const n = Number(String(raw).replace(/,/g, ""));
      out[colId] = Number.isFinite(n) ? n : raw;
      continue;
    }
    // Booleans
    if (f.inputType === "boolean" || f.inputType === "checkbox") {
      const s = String(raw).toLowerCase();
      if (["true", "yes", "y", "1"].includes(s)) { out[colId] = true; continue; }
      if (["false", "no", "n", "0"].includes(s)) { out[colId] = false; continue; }
      out[colId] = raw;
      continue;
    }
    // Dates: keep as string — validator already DD-MM-YYYY-formatted on insert
    // (matches wizard's maskDDMMYYYY output; see lib/import/validate.ts).
    // Selects: normalise to canonical option.value when match
    if (f.inputType === "select" || f.inputType === "radio") {
      const lower = String(raw).toLowerCase();
      const match = f.options.find(
        (o) => (o.value ?? "").toLowerCase() === lower || (o.label ?? "").toLowerCase() === lower,
      );
      out[colId] = match ? match.value : raw;
      continue;
    }
    if (f.inputType === "multi_select") {
      const parts = String(raw).split(/[,;|]+/).map((p) => p.trim()).filter(Boolean);
      const matched = parts.map((p) => {
        const lo = p.toLowerCase();
        const m = f.options.find(
          (o) => (o.value ?? "").toLowerCase() === lo || (o.label ?? "").toLowerCase() === lo,
        );
        return m ? m.value : p;
      });
      out[colId] = matched;
      continue;
    }
    out[colId] = raw;
  }
  return out;
}
