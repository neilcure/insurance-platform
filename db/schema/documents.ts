import { integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
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
