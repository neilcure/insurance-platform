/**
 * Single source of truth for the structured DB columns that admin
 * `premiumRecord` fields can map onto.
 *
 * The DB columns themselves live in `db/schema/premiums.ts` — they
 * cannot be admin-mutated without a Drizzle migration. What CAN be
 * configured is which columns are user-selectable / locale-scoped.
 *
 * USE THIS instead of re-typing `DB_COLUMN_OPTIONS = [...]` /
 * `COLUMN_TO_SUGGESTED_ROLE = {...}` in every editor component.
 */

export type AccountingColumnType = "cents" | "rate" | "string";

export type AccountingColumn = {
  /** Physical column name on `policy_premiums`. */
  value: string;
  label: string;
  type: AccountingColumnType;
  /** `"hk"` columns are Hong Kong-territory specific (Levy / Stamp Duty)
   *  and may not apply to other tenants. */
  locale: "global" | "hk";
  /** The `premiumRole` this column is the canonical home for. The
   *  admin UI auto-fills `premiumColumn` from `premiumRole` via
   *  `columnForRole`. */
  suggestedRole?: "client" | "agent" | "net" | "commission";
};

export const ACCOUNTING_COLUMNS: AccountingColumn[] = [
  { value: "grossPremiumCents", label: "Gross Premium", type: "cents", locale: "global", suggestedRole: "client" },
  { value: "netPremiumCents", label: "Net Premium", type: "cents", locale: "global", suggestedRole: "net" },
  { value: "clientPremiumCents", label: "Client Premium", type: "cents", locale: "global", suggestedRole: "client" },
  { value: "agentPremiumCents", label: "Agent Premium", type: "cents", locale: "global", suggestedRole: "agent" },
  { value: "agentCommissionCents", label: "Agent Commission", type: "cents", locale: "global", suggestedRole: "commission" },
  { value: "creditPremiumCents", label: "Credit Premium", type: "cents", locale: "global" },
  { value: "levyCents", label: "Levy", type: "cents", locale: "hk" },
  { value: "stampDutyCents", label: "Stamp Duty", type: "cents", locale: "hk" },
  { value: "discountCents", label: "Discount", type: "cents", locale: "global" },
  { value: "commissionRate", label: "Commission Rate", type: "rate", locale: "global" },
  { value: "currency", label: "Currency", type: "string", locale: "global" },
];

export const COLUMN_TO_SUGGESTED_ROLE: Record<string, string> =
  Object.fromEntries(
    ACCOUNTING_COLUMNS.filter((c) => c.suggestedRole).map(
      (c) => [c.value, c.suggestedRole as string] as const,
    ),
  );

export const ROLE_TO_COLUMN: Record<string, string> = Object.fromEntries(
  ACCOUNTING_COLUMNS.filter((c) => c.suggestedRole).map(
    (c) => [c.suggestedRole as string, c.value] as const,
  ),
);

/** Returns the physical column for a Premium Role, or undefined if the
 *  role has no canonical column (e.g. role is empty or non-standard). */
export function columnForRole(role: string | undefined | null): string | undefined {
  if (!role) return undefined;
  return ROLE_TO_COLUMN[role];
}

/** Friendly type label used in dropdowns ("cents" / "decimal" / "text"). */
export function describeColumnType(type: AccountingColumnType): string {
  if (type === "cents") return "cents";
  if (type === "rate") return "decimal";
  return "text";
}
