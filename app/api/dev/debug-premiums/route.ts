import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyPremiums } from "@/db/schema/premiums";
import { eq } from "drizzle-orm";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole, resolvePolicyPremiumSummary } from "@/lib/resolve-policy-agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const accountingFields = await loadAccountingFields();

  const results: Record<string, unknown>[] = [];
  for (const policyId of [343, 345]) {
    const premiums = await db.select().from(policyPremiums).where(eq(policyPremiums.policyId, policyId));
    const summary = await resolvePolicyPremiumSummary(policyId);

    const premiumDetails = premiums.map((p) => {
      const row = p as Record<string, unknown>;
      return {
        id: p.id,
        policyId: p.policyId,
        lineKey: p.lineKey,
        lineLabel: p.lineLabel,
        clientRole: resolvePremiumByRole(row, "client", accountingFields),
        agentRole: resolvePremiumByRole(row, "agent", accountingFields),
        netRole: resolvePremiumByRole(row, "net", accountingFields),
        allFields: Object.fromEntries(
          Object.entries(row).filter(([k, v]) => k.endsWith("Cents") && typeof v === "number" && v > 0),
        ),
      };
    });

    results.push({
      policyId,
      summary,
      premiumDetails,
      accountingFieldRoles: accountingFields.map((f) => ({
        key: f.key,
        label: f.label,
        premiumRole: f.premiumRole,
      })),
    });
  }

  return NextResponse.json(results);
}
