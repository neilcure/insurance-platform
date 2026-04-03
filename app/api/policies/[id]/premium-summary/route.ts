import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { resolvePolicyPremiumSummary } from "@/lib/resolve-policy-agent";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const policyId = Number(id);

    const summary = await resolvePolicyPremiumSummary(policyId);
    if (!summary) return NextResponse.json(null);

    return NextResponse.json({
      clientPremiumCents: summary.clientPremiumCents,
      agentPremiumCents: summary.agentPremiumCents,
      agentName: summary.agentName,
    });
  } catch {
    return NextResponse.json(null, { status: 500 });
  }
}
