/**
 * Single source of truth for premium-tab admin contexts and premium
 * roles — used by every admin field editor.
 *
 * Today these are seeded constants. Long-term they should move to
 * `form_options` group_keys `premium_contexts` and `premium_roles`
 * so admins can rename / reorder / scope-per-tenant.
 *
 * USE THIS instead of re-typing `PREMIUM_CONTEXT_OPTIONS = [...]` /
 * `PREMIUM_ROLE_OPTIONS = [...]` in every editor component.
 */

export type PremiumContextOption = { value: string; label: string };

/**
 * Tabs / contexts where a premium field can be displayed in the admin
 * Premium-tab UI. End-user role visibility is a SEPARATE axis — see
 * `meta.visibleToUserTypes` in `AccountingFieldDef`.
 */
export const PREMIUM_CONTEXT_OPTIONS: PremiumContextOption[] = [
  { value: "policy", label: "Policy" },
  { value: "collaborator", label: "Collaborator (Premium Payable)" },
  { value: "insurer", label: "Insurance Company (Insurer Premium)" },
  { value: "client", label: "Client (Client Premium)" },
  { value: "agent", label: "Agent (Agent Premium)" },
];

export type PremiumRoleOption = { value: string; label: string };

/**
 * Semantic premium roles. Used for invoicing, commission, and
 * cross-settlement logic — NOT for visibility (visibility lives on
 * `meta.visibleToUserTypes`).
 */
export const PREMIUM_ROLE_OPTIONS: PremiumRoleOption[] = [
  { value: "", label: "— None —" },
  { value: "client", label: "Client Premium (what client pays)" },
  { value: "agent", label: "Agent Premium (what agent remits — usually auto-computed: client − commission)" },
  { value: "net", label: "Net Premium (base insurer cost)" },
  { value: "commission", label: "Commission (what agent keeps)" },
];

/**
 * Returns true if the given package key represents an accounting /
 * premium-record package.
 */
export function isPremiumPkg(pkg: string): boolean {
  return pkg === "premiumRecord" || pkg === "accounting";
}
