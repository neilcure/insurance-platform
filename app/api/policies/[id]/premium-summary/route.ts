import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyPremiums } from "@/db/schema/premiums";
import { policies } from "@/db/schema/insurance";
import { users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields } from "@/lib/accounting-fields";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const policyId = Number(id);

    const [policy] = await db
      .select({ agentId: policies.agentId })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);

    if (!policy) {
      return NextResponse.json(null, { status: 404 });
    }

    const premiums = await db
      .select()
      .from(policyPremiums)
      .where(eq(policyPremiums.policyId, policyId));

    if (premiums.length === 0) {
      return NextResponse.json(null);
    }

    const accountingFields = await loadAccountingFields();

    function resolveRaw(p: typeof premiums[number], role: "client" | "agent"): number {
      const row = p as Record<string, unknown>;
      for (const f of accountingFields) {
        if (!f.premiumColumn) continue;
        if (f.label.toLowerCase().includes(role)) {
          return (row[f.premiumColumn] as number) ?? 0;
        }
      }
      if (role === "client") return p.grossPremiumCents ?? 0;
      return 0;
    }

    let clientTotal = 0;
    let agentTotal = 0;
    for (const p of premiums) {
      clientTotal += resolveRaw(p, "client");
      agentTotal += resolveRaw(p, "agent");
    }

    let agentName: string | undefined;
    if (policy.agentId) {
      const [agent] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, policy.agentId))
        .limit(1);
      agentName = agent?.name || agent?.email || undefined;
    }

    return NextResponse.json({
      clientPremiumCents: clientTotal,
      agentPremiumCents: policy.agentId ? agentTotal : 0,
      agentName,
    });
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
}
