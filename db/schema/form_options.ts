import { boolean, index, integer, jsonb, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const formOptionGroups = pgTable("form_option_groups", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  label: varchar("label", { length: 256 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const formOptions = pgTable(
  "form_options",
  {
    id: serial("id").primaryKey(),
    groupKey: varchar("group_key", { length: 128 }).notNull(), // references by key for easier seed/import
    label: varchar("label", { length: 256 }).notNull(),
    value: varchar("value", { length: 128 }).notNull(), // key used on the form
    valueType: varchar("value_type", { length: 64 }).notNull().default("boolean"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    meta: jsonb("meta").$type<Record<string, unknown> | null>().default(null),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    groupKeyIdx: index("form_options_group_key_idx").on(t.groupKey),
    groupValueUnique: uniqueIndex("form_options_group_value_unique").on(t.groupKey, t.value),
  }),
);
















