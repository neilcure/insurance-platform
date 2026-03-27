import { pgEnum, pgTable, primaryKey, serial, text, integer, timestamp, boolean, varchar, jsonb, index } from "drizzle-orm/pg-core";

export const userTypeEnum = pgEnum("user_type", [
  "admin",
  "agent",
  // Legacy (still in DB but hidden in UI)
  "direct_client",
  "service_provider",
  // Renamed from insurer_staff -> internal_staff
  "internal_staff",
  // New
  "accounting",
]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  timezone: text("timezone"),
  userType: userTypeEnum("user_type").default("agent").notNull(),
  userNumber: text("user_number"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }),
}, (t) => ({
  userTypeIdx: index("users_user_type_idx").on(t.userType),
}));

export const organisations = pgTable("organisations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Optional contact details for the organisation
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  // HK-style structured address fields (all optional)
  flatNumber: text("flat_number"),
  floorNumber: text("floor_number"),
  blockNumber: text("block_number"),
  blockName: text("block_name"),
  streetNumber: text("street_number"),
  streetName: text("street_name"),
  propertyName: text("property_name"),
  districtName: text("district_name"),
  area: text("area"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organisationId: integer("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ name: "memberships_pk", columns: [t.userId, t.organisationId] }),
  })
);

export const userInvites = pgTable("user_invites", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 256 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  usedAt: timestamp("used_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 256 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  usedAt: timestamp("used_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  clientNumber: text("client_number").notNull().unique(),
  category: text("category").notNull(),
  displayName: text("display_name").notNull(),
  primaryId: text("primary_id").notNull(),
  contactPhone: text("contact_phone"),
  extraAttributes: jsonb("extra_attributes").$type<Record<string, unknown> | null>().default(null),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  categoryPrimaryIdIdx: index("clients_category_primary_id_idx").on(t.category, t.primaryId),
}));

// Generic app settings as key-value (JSON) for admin-configurable options
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown | null>().default(null),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
});

// Atomic counters used to generate sequential numbers per organisation and user type
export const userCounters = pgTable(
  "user_counters",
  {
    orgId: integer("org_id").notNull().default(0),
    userType: userTypeEnum("user_type").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: "user_counters_pk", columns: [t.orgId, t.userType] }),
  })
);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  userType: text("user_type"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  changes: jsonb("changes").$type<Record<string, unknown> | null>().default(null),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  entityIdx: index("audit_log_entity_idx").on(t.entityType, t.entityId),
  createdIdx: index("audit_log_created_idx").on(t.createdAt),
  userIdIdx: index("audit_log_user_id_idx").on(t.userId),
}));

// Track which agent is currently assigned to a client, with history
export const clientAgentAssignments = pgTable("client_agent_assignments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  agentId: integer("agent_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at", { mode: "string" }).defaultNow().notNull(),
  unassignedAt: timestamp("unassigned_at", { mode: "string" }),
  assignedBy: integer("assigned_by").references(() => users.id, { onDelete: "set null" }),
});


