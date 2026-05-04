import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { policies } from "./insurance";
import { users } from "./core";

export const policyDocuments = pgTable("policy_documents", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  documentTypeKey: varchar("document_type_key", { length: 128 }).notNull(),
  fileName: text("file_name").notNull(),
  storedPath: text("stored_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 128 }),
  status: varchar("status", { length: 32 }).notNull().default("uploaded"),
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  uploadedByRole: varchar("uploaded_by_role", { length: 32 }).notNull(),
  verifiedBy: integer("verified_by").references(() => users.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at", { mode: "string" }),
  rejectionNote: text("rejection_note"),
  paymentMeta: jsonb("payment_meta"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

/**
 * Token-based public download bundles. Powers the "WhatsApp Files"
 * feature: the sender selects uploaded files + PDF templates,
 * we mint a row here, and the recipient gets a wa.me link with the
 * `/d/<token>` URL embedded in the chat text. Tapping it on their
 * phone opens our public download page with NO LOGIN required —
 * the token IS the credential.
 *
 * Why a separate table (instead of stuffing into `signing_sessions`)
 * - signing_sessions is for the e-signature flow; mixing concerns
 *   would force every signing query to filter by purpose.
 * - This row never produces a signed PDF; it's a read-only listing.
 *
 * Security notes
 * - `token` is 32+ hex chars (>=128 bits entropy), unguessable.
 * - `expires_at` is enforced server-side on every read.
 * - `last_accessed_at` + `access_count` give a basic audit trail
 *   so the sender can see whether the recipient actually opened it.
 * - `policy_id` cascades on delete so removing a policy invalidates
 *   pending share links automatically.
 */
export const documentShares = pgTable(
  "document_shares",
  {
    id: serial("id").primaryKey(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    policyId: integer("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    /** Selected `policy_documents.id` values, e.g. `[12, 34]`. */
    documentIds: jsonb("document_ids").$type<number[]>().notNull().default([]),
    /** Selected `form_options.id` values for PDF merge templates. */
    pdfTemplateIds: jsonb("pdf_template_ids").$type<number[]>().notNull().default([]),
    /** When true, generated PDFs flatten AcroForm fields (tamper-proof). */
    flattenPdfs: boolean("flatten_pdfs").notNull().default(true),
    /** Human-readable label shown to the recipient on /d/<token>. */
    label: text("label"),
    /** Pre-filled WhatsApp message text the sender used (audit). */
    messageSent: text("message_sent"),
    /** Recipient mobile (international form, no `+`) for audit. */
    recipientPhone: varchar("recipient_phone", { length: 32 }),
    /** Recipient display name (audit). */
    recipientName: text("recipient_name"),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { mode: "string" }),
    accessCount: integer("access_count").notNull().default(0),
  },
  (t) => ({
    tokenIdx: index("document_shares_token_idx").on(t.token),
    policyIdIdx: index("document_shares_policy_id_idx").on(t.policyId),
    expiresIdx: index("document_shares_expires_at_idx").on(t.expiresAt),
  }),
);
