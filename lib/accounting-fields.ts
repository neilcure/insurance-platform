/**
 * Accounting field management.
 *
 * Reads field definitions from the admin-configured "premiumRecord" package in
 * form_options. No hardcoded field names — everything comes from the package
 * config. Provides two filters consumers compose in order:
 *
 *  1. `filterFieldsByContext` — admin's "Show in Premium Tabs" config (which
 *     tab does this field belong on?).
 *  2. `filterFieldsByUserType` — admin's "Visible to user types" config (which
 *     logged-in user can see this field?). Admin-like users always bypass.
 *
 * Client-safe helpers (`mapFormOptionRowToAccountingFieldDef`, `filterFieldsByUserType`)
 * live in `accounting-fields-shared.ts` so UI bundles never import `db/client`.
 */
import {
  mapFormOptionRowToAccountingFieldDef,
  type AccountingFieldDef,
  type ColumnType,
  type PremiumContext,
  type PremiumRole,
} from "@/lib/accounting-fields-shared";
import { getFormOptionsGroupServer } from "@/lib/server-form-options-cache";

export type { ColumnType, PremiumContext, PremiumRole, AccountingFieldDef };
export { mapFormOptionRowToAccountingFieldDef, filterFieldsByUserType } from "@/lib/accounting-fields-shared";

const ACCOUNTING_PKG = "premiumRecord";

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
 *
 * Cached for 30s per process via `getFormOptionsGroupServer` — admins
 * rarely change this config, but several hot routes call this on every
 * request. Cache is invalidated from the admin form-options write paths
 * (see `lib/server-form-options-cache.ts`).
 */
export async function loadAccountingFields(): Promise<AccountingFieldDef[]> {
  const groupKey = `${ACCOUNTING_PKG}_fields`;
  const rows = await getFormOptionsGroupServer(groupKey);
  return rows
    .map((r) => mapFormOptionRowToAccountingFieldDef(r))
    .filter((f): f is AccountingFieldDef => f !== null);
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
  const roleMap: Record<string, PremiumRole> = {
    client_premium: "client", client: "client",
    agent_premium: "agent", agent: "agent",
    net_premium: "net", net: "net",
    commission: "commission", agent_commission: "commission",
  };
  const normalizedType = premiumType.replace(/_/g, " ").toLowerCase().trim();
  const role = roleMap[premiumType.toLowerCase()] ?? roleMap[normalizedType.replace(/\s+premium$/, "")];

  if (role) {
    for (const f of fields) {
      if (!f.premiumColumn) continue;
      if (f.premiumRole === role) return { column: f.premiumColumn, label: f.label };
    }
  }

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
 *
 * Rules:
 *  - Fields with no `premiumContexts` (or an empty array) are visible
 *    everywhere — preserves backwards compatibility for fields that were
 *    configured before the "Show in Premium Tabs" filter existed, and
 *    matches the admin UI hint "Empty = show everywhere".
 *  - Fields with explicit `premiumContexts` are filtered by the admin's
 *    checkboxes — including "Policy". Previously the "policy" context
 *    short-circuited and returned every field regardless of the admin's
 *    setting, which made the "Policy" checkbox in the field editor a
 *    no-op (and surprised admins who had explicitly unchecked it).
 *  - "self" is the record's own overview page (e.g. an endorsement's own
 *    Premium tab). It is NOT exposed as a checkbox in the admin UI
 *    (`PREMIUM_CONTEXT_OPTIONS` has no "self" entry), so we keep treating
 *    it as a master view that always shows every field.
 */
export function filterFieldsByContext(
  fields: AccountingFieldDef[],
  context: PremiumContext,
): AccountingFieldDef[] {
  if (context === "self") return fields;
  return fields.filter((f) => {
    if (!f.premiumContexts || f.premiumContexts.length === 0) return true;
    return f.premiumContexts.includes(context);
  });
}
