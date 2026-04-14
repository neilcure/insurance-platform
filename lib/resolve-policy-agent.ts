import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { loadAccountingFields, type AccountingFieldDef } from "@/lib/accounting-fields";

/**
 * Resolves the agent for a policy, including endorsements that inherit
 * the agent from their parent policy via linkedPolicyId.
 */
export async function resolvePolicyAgent(policyId: number): Promise<{
  agentId: number | null;
  agentName: string | undefined;
}> {
  const [policy] = await db
    .select({ agentId: policies.agentId })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  let agentId = policy?.agentId ?? null;

  if (!agentId) {
    const [car] = await db
      .select({ extraAttributes: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, policyId))
      .limit(1);
    const linkedPolicyIdRaw = (car?.extraAttributes as Record<string, unknown> | null)?.linkedPolicyId;
    const linkedPolicyId = Number(linkedPolicyIdRaw);
    if (linkedPolicyId > 0) {
      const [parent] = await db
        .select({ agentId: policies.agentId })
        .from(policies)
        .where(eq(policies.id, linkedPolicyId))
        .limit(1);
      agentId = parent?.agentId ?? null;
    }
  }

  if (!agentId) return { agentId: null, agentName: undefined };

  const [agent] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, agentId))
    .limit(1);

  return {
    agentId,
    agentName: agent?.name || agent?.email || undefined,
  };
}

/**
 * Resolves a premium amount for a given role by scanning admin-configured
 * accounting fields.
 * Priority: explicit `premiumRole` meta → label substring fallback → grossPremiumCents for "client".
 */
export function resolvePremiumByRole(
  premiumRow: Record<string, unknown>,
  role: "client" | "agent" | "net" | "commission",
  accountingFields: AccountingFieldDef[],
): number {
  const extra = (premiumRow.extraValues ?? {}) as Record<string, unknown>;

  // Read field value: structured column (cents) or extraValues (display → cents)
  const readVal = (f: AccountingFieldDef): number => {
    if (f.premiumColumn) {
      return (premiumRow[f.premiumColumn] as number) ?? 0;
    }
    const ev = extra[f.key];
    if (ev == null) return 0;
    const n = Number(ev);
    // extraValues stores display values; convert to cents
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };

  // Pass 1: explicit premiumRole match — sum ALL matching fields so that
  // multi-line rows (e.g. TPO+OD) where values live in different columns
  // or in extraValues are resolved correctly.
  let total = 0;
  let found = false;
  for (const f of accountingFields) {
    if (!f.premiumColumn && !(f.key in extra)) continue;
    if (f.premiumRole === role) {
      const val = readVal(f);
      if (val) { total += val; found = true; }
    }
  }
  if (found) return total;

  // Pass 2: label substring fallback — sum ALL matching, but EXCLUDE
  // commission fields for "agent" role.
  const commissionExclusions = ["commission", "comm."];
  for (const f of accountingFields) {
    if (!f.premiumColumn && !(f.key in extra)) continue;
    const lbl = f.label.toLowerCase();
    if (!lbl.includes(role)) continue;
    if (role === "agent" && f.premiumRole === "commission") continue;
    if (role === "agent" && commissionExclusions.some((ex) => lbl.includes(ex))) continue;
    const val = readVal(f);
    if (val) { total += val; found = true; }
  }
  if (found) return total;

  // Pass 3: "commission" is computed = client − agent (if no explicit commission field)
  if (role === "commission") {
    const client = resolvePremiumByRole(premiumRow, "client", accountingFields);
    const agent = resolvePremiumByRole(premiumRow, "agent", accountingFields);
    if (client > 0 && agent > 0) return Math.max(client - agent, 0);
  }

  // Pass 4: gross premium as client total when no client-tagged field matched (common legacy data)
  if (role === "client") {
    const gross = Number(premiumRow.grossPremiumCents) || 0;
    if (gross > 0) return gross;
  }

  return 0;
}

/**
 * Resolves premium column for a given role from accounting fields.
 * Used by inline matchers that need the column name, not just the value.
 */
export function resolveRoleColumn(
  role: "client" | "agent" | "net",
  accountingFields: AccountingFieldDef[],
): string | undefined {
  for (const f of accountingFields) {
    if (!f.premiumColumn) continue;
    if (f.premiumRole === role) return f.premiumColumn;
  }
  for (const f of accountingFields) {
    if (!f.premiumColumn) continue;
    if (f.label.toLowerCase().includes(role)) return f.premiumColumn;
  }
  return undefined;
}

export type PremiumSummaryResult = {
  agentId: number | null;
  agentName: string | undefined;
  clientPremiumCents: number;
  agentPremiumCents: number;
  commissionCents: number;
};

/**
 * Full premium summary for a policy: agent info + client/agent totals + commission.
 * Shared by premium-summary API, agent-commission, and anywhere else that needs this.
 */
export async function resolvePolicyPremiumSummary(policyId: number): Promise<PremiumSummaryResult | null> {
  const [agentInfo, premiums, accountingFields] = await Promise.all([
    resolvePolicyAgent(policyId),
    db.select().from(policyPremiums).where(eq(policyPremiums.policyId, policyId)),
    loadAccountingFields(),
  ]);

  if (premiums.length === 0) return null;

  let clientTotal = 0;
  let agentTotal = 0;
  for (const p of premiums) {
    const row = p as Record<string, unknown>;
    clientTotal += resolvePremiumByRole(row, "client", accountingFields);
    agentTotal += resolvePremiumByRole(row, "agent", accountingFields);
  }

  return {
    ...agentInfo,
    clientPremiumCents: clientTotal,
    agentPremiumCents: agentInfo.agentId ? agentTotal : 0,
    commissionCents: Math.max(clientTotal - agentTotal, 0),
  };
}
