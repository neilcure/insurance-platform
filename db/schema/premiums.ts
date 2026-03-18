import { integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { policies } from "./insurance";
import { users, organisations } from "./core";

export const policyPremiums = pgTable("policy_premiums", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  lineKey: varchar("line_key", { length: 64 }).notNull().default("main"),
  lineLabel: varchar("line_label", { length: 128 }),
  currency: varchar("currency", { length: 8 }).notNull().default("HKD"),

  // Per-line entity associations (TPO + OD may have different insurer/collaborator per line)
  organisationId: integer("organisation_id").references(() => organisations.id, { onDelete: "set null" }),
  collaboratorId: integer("collaborator_id").references(() => policies.id, { onDelete: "set null" }),
  insurerPolicyId: integer("insurer_policy_id").references(() => policies.id, { onDelete: "set null" }),

  grossPremiumCents: integer("gross_premium_cents"),
  netPremiumCents: integer("net_premium_cents"),
  clientPremiumCents: integer("client_premium_cents"),
  agentCommissionCents: integer("agent_commission_cents"),
  commissionRate: numeric("commission_rate", { precision: 6, scale: 2 }),

  extraValues: jsonb("extra_values").$type<Record<string, unknown> | null>().default(null),

  note: text("note"),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  policyLineUnique: uniqueIndex("policy_premiums_policy_line_unique").on(t.policyId, t.lineKey),
}));
