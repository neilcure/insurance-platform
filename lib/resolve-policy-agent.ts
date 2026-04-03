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
    const linkedPolicyId = (car?.extraAttributes as Record<string, unknown> | null)?.linkedPolicyId;
    if (typeof linkedPolicyId === "number" && linkedPolicyId > 0) {
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
 * accounting fields. Falls back to grossPremiumCents for "client".
 */
export function resolvePremiumByRole(
  premiumRow: Record<string, unknown>,
  role: "client" | "agent" | "net",
  accountingFields: AccountingFieldDef[],
): number {
  for (const f of accountingFields) {
    if (!f.premiumColumn) continue;
    if (f.label.toLowerCase().includes(role)) {
      return (premiumRow[f.premiumColumn] as number) ?? 0;
    }
  }
  if (role === "client") return (premiumRow.grossPremiumCents as number) ?? 0;
  return 0;
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
