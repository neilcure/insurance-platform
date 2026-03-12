import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { policies } from "./insurance";
import { users } from "./core";

export const reminderSchedules = pgTable("reminder_schedules", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  documentTypeKey: varchar("document_type_key", { length: 128 }).notNull(),
  channel: varchar("channel", { length: 32 }).notNull().default("email"),
  recipientEmail: text("recipient_email").notNull(),
  intervalDays: integer("interval_days").notNull().default(3),
  maxSends: integer("max_sends"),
  customMessage: text("custom_message"),
  isActive: boolean("is_active").notNull().default(true),
  completedAt: timestamp("completed_at", { mode: "string" }),
  completedReason: varchar("completed_reason", { length: 64 }),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }),
});

export const reminderSendLog = pgTable("reminder_send_log", {
  id: serial("id").primaryKey(),
  scheduleId: integer("schedule_id").notNull().references(() => reminderSchedules.id, { onDelete: "cascade" }),
  channel: varchar("channel", { length: 32 }).notNull(),
  recipientEmail: text("recipient_email").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("sent"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { mode: "string" }).defaultNow().notNull(),
});
