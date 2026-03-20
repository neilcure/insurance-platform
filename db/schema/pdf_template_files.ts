import { pgTable, serial, varchar, timestamp, customType } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (val) => val,
  fromDriver: (val) => Buffer.from(val),
});

export const pdfTemplateFiles = pgTable("pdf_template_files", {
  id: serial("id").primaryKey(),
  storedName: varchar("stored_name", { length: 512 }).notNull().unique(),
  content: bytea("content").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});
