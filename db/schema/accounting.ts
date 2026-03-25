import { integer, jsonb, pgTable, serial, text, timestamp, varchar, boolean, index, date } from "drizzle-orm/pg-core";
import { policies } from "./insurance";
import { users, organisations } from "./core";

export const accountingPaymentSchedules = pgTable("accounting_payment_schedules", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  entityPolicyId: integer("entity_policy_id").references(() => policies.id, { onDelete: "set null" }),
  entityType: varchar("entity_type", { length: 20 }).notNull(), // 'collaborator', 'agent', 'client'
  entityName: varchar("entity_name", { length: 256 }),
  frequency: varchar("frequency", { length: 20 }).notNull().default("monthly"), // weekly, monthly
  billingDay: integer("billing_day"),
  currency: varchar("currency", { length: 8 }).notNull().default("HKD"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
});

export const accountingInvoices = pgTable("accounting_invoices", {
  id: serial("id").primaryKey(),
  organisationId: integer("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invoiceNumber: varchar("invoice_number", { length: 100 }).notNull(),
  invoiceType: varchar("invoice_type", { length: 30 }).notNull(), // 'individual', 'statement'
  direction: varchar("direction", { length: 20 }).notNull(), // 'payable', 'receivable'
  premiumType: varchar("premium_type", { length: 30 }).notNull(), // 'net_premium', 'agent_premium', 'client_premium'
  entityPolicyId: integer("entity_policy_id").references(() => policies.id, { onDelete: "set null" }),
  entityType: varchar("entity_type", { length: 20 }).notNull(), // 'collaborator', 'agent', 'client'
  entityName: varchar("entity_name", { length: 256 }),
  scheduleId: integer("schedule_id").references(() => accountingPaymentSchedules.id, { onDelete: "set null" }),
  parentInvoiceId: integer("parent_invoice_id").references((): any => accountingInvoices.id, { onDelete: "set null" }),
  totalAmountCents: integer("total_amount_cents").notNull().default(0),
  paidAmountCents: integer("paid_amount_cents").notNull().default(0),
  currency: varchar("currency", { length: 8 }).notNull().default("HKD"),
  invoiceDate: date("invoice_date"),
  dueDate: date("due_date"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  documentStatus: jsonb("document_status"),
  notes: text("notes"),
  cancellationDate: date("cancellation_date"),
  refundReason: text("refund_reason"),
  verifiedBy: integer("verified_by").references(() => users.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at", { mode: "string" }),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  orgIdx: index("accounting_invoices_org_idx").on(t.organisationId),
  statusIdx: index("accounting_invoices_status_idx").on(t.status),
  entityIdx: index("accounting_invoices_entity_idx").on(t.entityType, t.entityPolicyId),
  parentIdx: index("accounting_invoices_parent_idx").on(t.parentInvoiceId),
}));

export const accountingInvoiceItems = pgTable("accounting_invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => accountingInvoices.id, { onDelete: "cascade" }),
  policyId: integer("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  policyPremiumId: integer("policy_premium_id"),
  lineKey: varchar("line_key", { length: 64 }),
  amountCents: integer("amount_cents").notNull(),
  gainCents: integer("gain_cents").default(0),
  description: text("description"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  invoiceIdx: index("accounting_invoice_items_invoice_idx").on(t.invoiceId),
  policyIdx: index("accounting_invoice_items_policy_idx").on(t.policyId),
}));

export const accountingPayments = pgTable("accounting_payments", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => accountingInvoices.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("HKD"),
  paymentDate: date("payment_date"),
  paymentMethod: varchar("payment_method", { length: 50 }),
  referenceNumber: varchar("reference_number", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("recorded"),
  notes: text("notes"),
  submittedBy: integer("submitted_by").references(() => users.id, { onDelete: "set null" }),
  verifiedBy: integer("verified_by").references(() => users.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at", { mode: "string" }),
  rejectionNote: text("rejection_note"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  invoiceIdx: index("accounting_payments_invoice_idx").on(t.invoiceId),
  statusIdx: index("accounting_payments_status_idx").on(t.status),
}));

export const accountingDocuments = pgTable("accounting_documents", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => accountingInvoices.id, { onDelete: "cascade" }),
  paymentId: integer("payment_id").references(() => accountingPayments.id, { onDelete: "cascade" }),
  docType: varchar("doc_type", { length: 30 }).notNull(), // 'invoice', 'payment_proof', 'receipt', 'quotation', 'statement', 'credit_note'
  fileName: varchar("file_name", { length: 255 }).notNull(),
  storedPath: varchar("stored_path", { length: 500 }).notNull(),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 128 }),
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  invoiceIdx: index("accounting_documents_invoice_idx").on(t.invoiceId),
  paymentIdx: index("accounting_documents_payment_idx").on(t.paymentId),
}));
