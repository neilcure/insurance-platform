/**
 * Accounting field management.
 * Reads field definitions from the admin-configured "premiumRecord" package in form_options.
 * No hardcoded field names — everything comes from the package config.
 */
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";

const ACCOUNTING_PKG = "premiumRecord";

export type ColumnType = "cents" | "rate" | "string";

export type PremiumContext = "policy" | "collaborator" | "insurer" | "client" | "agent" | "self";

export type AccountingFieldDef = {
  key: string;
  label: string;
  inputType: string;
  sortOrder: number;
  groupOrder?: number;
  groupName?: string;
  options?: Array<{ value: string; label: string }>;
  premiumColumn?: string;
  premiumContexts?: PremiumContext[];
};

/**
 * Derives column type from the column name convention.
 */
export function getColumnType(column: string): ColumnType {
  if (column.endsWith("Cents")) return "cents";
  if (column === "commissionRate") return "rate";
  return "string";
}

/**
 * Loads all active accounting fields from the admin-configured package.
 * Each field may have `premiumColumn` in its meta, which maps it to a
 * structured DB column on policy_premiums.
 */
export async function loadAccountingFields(): Promise<AccountingFieldDef[]> {
  const groupKey = `${ACCOUNTING_PKG}_fields`;
  const rows = await db
    .select()
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.isActive, true)))
    .orderBy(formOptions.sortOrder);

  return rows
    .map((r) => {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      const opts = Array.isArray(m?.options)
        ? (m.options as Array<{ value?: unknown; label?: unknown }>).map((o) => ({
            value: String(o?.value ?? o?.label ?? ""),
            label: String(o?.label ?? o?.value ?? ""),
          }))
        : [];
      return {
        key: String(r.value ?? ""),
        label: String(r.label ?? r.value ?? ""),
        inputType: String(m?.inputType ?? "text"),
        sortOrder: Number(r.sortOrder ?? 0),
        groupOrder: Number(m?.groupOrder ?? 0),
        groupName: typeof m?.group === "string" ? m.group : "",
        options: opts.length > 0 ? opts : undefined,
        premiumColumn: typeof m?.premiumColumn === "string"
          ? m.premiumColumn.replace(/^"|"$/g, "")
          : undefined,
        premiumContexts: Array.isArray(m?.premiumContexts)
          ? (m.premiumContexts as PremiumContext[])
          : undefined,
      };
    })
    .filter((f) => f.key);
}

/**
 * Builds a dynamic field-key → DB-column mapping from the loaded fields.
 * Example: { gpremium: "grossPremiumCents", loading: "commissionRate" }
 */
export function buildFieldColumnMap(fields: AccountingFieldDef[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of fields) {
    if (f.premiumColumn) {
      map[f.key] = f.premiumColumn;
    }
  }
  return map;
}

/**
 * Builds a reverse mapping: premiumColumn → field definition.
 * Example: { grossPremiumCents: { key: "gpremium", label: "Gross Premium", ... } }
 */
export function buildColumnFieldMap(fields: AccountingFieldDef[]): Record<string, AccountingFieldDef> {
  const map: Record<string, AccountingFieldDef> = {};
  for (const f of fields) {
    if (f.premiumColumn) {
      map[f.premiumColumn] = f;
    }
  }
  return map;
}

/**
 * Resolves a premiumType slug (e.g. "net_premium") to its DB column
 * by looking through admin-configured fields.
 */
export function resolvePremiumTypeColumn(
  premiumType: string,
  fields: AccountingFieldDef[],
): { column: string; label: string } {
  const typeToColumn: Record<string, string> = {};
  for (const f of fields) {
    if (!f.premiumColumn) continue;
    const slug = f.label.toLowerCase().replace(/\s+/g, "_");
    typeToColumn[slug] = f.premiumColumn;
  }

  const normalizedType = premiumType.replace(/_/g, " ").toLowerCase().trim();

  for (const f of fields) {
    if (!f.premiumColumn) continue;
    const normalizedLabel = f.label.toLowerCase().trim();
    if (
      normalizedLabel.includes(normalizedType) ||
      normalizedType.includes(normalizedLabel.replace(" premium", ""))
    ) {
      return { column: f.premiumColumn, label: f.label };
    }
  }

  const firstCentsField = fields.find((f) => f.premiumColumn && getColumnType(f.premiumColumn) === "cents");
  return {
    column: firstCentsField?.premiumColumn ?? "netPremiumCents",
    label: firstCentsField?.label ?? "Premium",
  };
}

/**
 * Filters fields to only those visible in a given premium context.
 * "policy" context always returns all fields (master view).
 * Fields with no `premiumContexts` set are visible everywhere.
 */
export function filterFieldsByContext(
  fields: AccountingFieldDef[],
  context: PremiumContext,
): AccountingFieldDef[] {
  if (context === "policy" || context === "self") return fields;
  return fields.filter((f) => {
    if (!f.premiumContexts || f.premiumContexts.length === 0) return true;
    return f.premiumContexts.includes(context);
  });
}
