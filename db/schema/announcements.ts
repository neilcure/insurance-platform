import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { organisations, users } from "./core";

export type AnnouncementTargeting =
  | { mode: "all" }
  | { mode: "user_types"; userTypes: string[] }
  /**
   * Specific people. `userIds` are direct `users.id` matches. `clientIds`
   * are followed via `clients.user_id` at delivery time, so an admin can
   * target a client now and the announcement starts showing as soon as
   * that client gets invited / linked to a real `users` row.
   */
  | { mode: "users"; userIds: number[]; clientIds?: number[] };

export const announcements = pgTable(
  "announcements",
  {
    id: serial("id").primaryKey(),
    organisationId: integer("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    bodyHtml: text("body_html").notNull().default(""),
    /** none | image | pdf */
    mediaKind: text("media_kind").notNull().default("none"),
    mediaStoredName: text("media_stored_name"),
    linkUrl: text("link_url"),
    startsAt: timestamp("starts_at", { mode: "string" }).notNull(),
    endsAt: timestamp("ends_at", { mode: "string" }).notNull(),
    autoCloseSeconds: integer("auto_close_seconds"),
    isActive: boolean("is_active").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    targeting: jsonb("targeting").$type<AnnouncementTargeting>().notNull().default({ mode: "all" }),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }),
  },
  (t) => ({
    orgIdx: index("announcements_org_idx").on(t.organisationId),
  }),
);

export const announcementDismissals = pgTable(
  "announcement_dismissals",
  {
    announcementId: integer("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.announcementId, t.userId], name: "announcement_dismissals_pk" }),
  }),
);
