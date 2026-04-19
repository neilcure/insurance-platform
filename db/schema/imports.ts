/**
 * Schema for the bulk-import staging area.
 *
 * Two tables, both purely additive:
 *
 *   • import_batches      — one row per uploaded file. Tracks the batch's
 *                           lifecycle (parsing → review → committing →
 *                           committed / cancelled), aggregate counts, and a
 *                           jsonb `summary` of issue rollups (unknown values,
 *                           missing references, etc.).
 *
 *   • import_batch_rows   — one row per data row from the uploaded sheet.
 *                           Holds the parsed/cleaned values, current per-row
 *                           status, errors + warnings, and (after commit) the
 *                           created policy id.
 *
 * Rows are reviewed/edited/skipped in-place; nothing touches the live
 * `policies` table until the batch enters the `committing` phase, and even
 * then the staging row stays as the audit record.
 */
import {
  pgEnum,
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  varchar,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { users } from "./core";

export const importBatchStatusEnum = pgEnum("import_batch_status", [
  "parsing",     // file just uploaded, server is parsing
  "review",      // ready for admin review (default working state)
  "committing",  // commit job started, rows being created
  "committed",   // all done (some rows may still be 'failed'/'skipped')
  "cancelled",   // user cancelled before commit (or mid-commit)
]);

export const importBatchRowStatusEnum = pgEnum("import_batch_row_status", [
  "pending",     // waiting for commit
  "skipped",     // admin marked this row to be excluded
  "committed",   // policy successfully created
  "failed",      // commit attempted, DB rejected (e.g. unique constraint)
]);

export const importBatches = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    /**
     * Flow this batch was uploaded for (e.g. "policyset"). The batch's rows
     * are validated and committed against THIS flow's schema.
     */
    flowKey: varchar("flow_key", { length: 64 }).notNull(),
    /**
     * Optional client-flow override (defaults to "clientSet"). Used when the
     * batch auto-creates client records.
     */
    clientFlowKey: varchar("client_flow_key", { length: 64 })
      .notNull()
      .default("clientSet"),
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    filename: text("filename"),
    fileSizeBytes: integer("file_size_bytes"),
    status: importBatchStatusEnum("status").notNull().default("parsing"),
    /** Total rows parsed from the file (excludes example/header rows) */
    totalRows: integer("total_rows").notNull().default(0),
    /** Rows currently in 'pending' status with NO blocking errors */
    readyRows: integer("ready_rows").notNull().default(0),
    /** Rows currently in 'pending' status with at least one warning */
    warningRows: integer("warning_rows").notNull().default(0),
    /** Rows blocked by hard errors (cannot commit until fixed/skipped) */
    errorRows: integer("error_rows").notNull().default(0),
    /** Rows successfully committed */
    committedRows: integer("committed_rows").notNull().default(0),
    /** Rows that failed at commit time (DB-level error) */
    failedRows: integer("failed_rows").notNull().default(0),
    /** Rows the admin chose to exclude */
    skippedRows: integer("skipped_rows").notNull().default(0),
    /**
     * Aggregated issue summary, refreshed each time the batch is validated.
     * Shape:
     *   {
     *     unknownValuesByColumn: { [colId]: { uniqueCount, samples[], rowCount } },
     *     missingReferencesByColumn: { [colId]: { uniqueCount, samples[], rowCount } },
     *     missingRequiredByColumn: { [colId]: rowCount },
     *     unknownColumns: string[],
     *     missingColumns: string[],
     *   }
     */
    summary: jsonb("summary").$type<Record<string, unknown>>().default({}),
    /** Optional last error from the commit job (e.g. unhandled exception) */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    /** When the commit job started / finished */
    committingStartedAt: timestamp("committing_started_at", { mode: "string" }),
    committedAt: timestamp("committed_at", { mode: "string" }),
  },
  (t) => ({
    flowIdx: index("import_batches_flow_idx").on(t.flowKey),
    statusIdx: index("import_batches_status_idx").on(t.status),
    creatorIdx: index("import_batches_creator_idx").on(t.createdBy),
    createdAtIdx: index("import_batches_created_at_idx").on(t.createdAt),
  }),
);

export const importBatchRows = pgTable(
  "import_batch_rows",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    /** 1-based row number in the original Excel sheet (for user reference) */
    excelRow: integer("excel_row").notNull(),
    /**
     * Parsed cell values keyed by canonical column id (e.g. "insured.firstName").
     * This is the ONLY source of truth used by the validator + payload builder
     * — admin edits always update this jsonb, and validation re-runs after.
     */
    rawValues: jsonb("raw_values").$type<Record<string, unknown>>().notNull(),
    status: importBatchRowStatusEnum("status").notNull().default("pending"),
    /**
     * Hard validation errors — block commit until fixed or row is skipped.
     * Shape: [{ column: string|null, message: string }]
     */
    errors: jsonb("errors")
      .$type<Array<{ column: string | null; message: string }>>()
      .notNull()
      .default([]),
    /**
     * Soft validation warnings — do not block commit. In strict mode this is
     * always empty; in migration mode it's where unknown-select / off-category
     * messages land.
     */
    warnings: jsonb("warnings")
      .$type<Array<{ column: string | null; message: string }>>()
      .notNull()
      .default([]),
    /** True if the admin has manually edited this row's values since upload */
    edited: boolean("edited").notNull().default(false),
    /** Commit attempts (for retry semantics) */
    commitAttempts: integer("commit_attempts").notNull().default(0),
    lastCommitError: text("last_commit_error"),
    /** Created policy id when status='committed' */
    createdPolicyId: integer("created_policy_id"),
    createdPolicyNumber: text("created_policy_number"),
    /** Resolved client number (for auto-created or matched client) */
    resolvedClientNumber: text("resolved_client_number"),
    clientCreated: boolean("client_created").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    committedAt: timestamp("committed_at", { mode: "string" }),
  },
  (t) => ({
    batchIdx: index("import_batch_rows_batch_idx").on(t.batchId),
    batchStatusIdx: index("import_batch_rows_batch_status_idx").on(t.batchId, t.status),
    batchExcelRowIdx: index("import_batch_rows_batch_excel_row_idx").on(t.batchId, t.excelRow),
  }),
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
export type ImportBatchRow = typeof importBatchRows.$inferSelect;
export type NewImportBatchRow = typeof importBatchRows.$inferInsert;
