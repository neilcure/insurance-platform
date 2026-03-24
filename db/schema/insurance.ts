import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { organisations, clients, users } from "./core";

export const policies = pgTable("policies", {
  id: serial("id").primaryKey(),
  policyNumber: text("policy_number").notNull().unique(),
  organisationId: integer("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  agentId: integer("agent_id").references(() => users.id, { onDelete: "set null" }),
  createdBy: integer("created_by"),
  isActive: boolean("is_active").notNull().default(true),
  documentTracking: jsonb("document_tracking"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const cars = pgTable("cars", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  plateNumber: text("plate_number").notNull(),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  // Optional JSON snapshot storage for MVP
  extraAttributes: jsonb("extra_attributes").$type<Record<string, unknown> | null>().default(null),
});

export const coverages = pgTable("coverages", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  limitAmountCents: integer("limit_amount_cents"),
  premiumCents: integer("premium_cents"),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").default("pending").notNull(),
  paidAt: timestamp("paid_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const policyDrafts = pgTable("policy_drafts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  wizardState: jsonb("wizard_state").$type<Record<string, unknown>>().notNull(),
  currentStep: integer("current_step").notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
});


