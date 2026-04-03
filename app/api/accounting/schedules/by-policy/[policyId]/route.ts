import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPaymentSchedules } from "@/db/schema/accounting";
import { policies } from "@/db/schema/insurance";
import { and, eq, or } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ policyId: string }> },
) {
  try {
    await requireUser();
    const { policyId } = await ctx.params;
    const pid = Number(policyId);

    const [policy] = await db
      .select({
        clientId: policies.clientId,
        agentId: policies.agentId,
        organisationId: policies.organisationId,
      })
      .from(policies)
      .where(eq(policies.id, pid))
      .limit(1);

    if (!policy || !policy.organisationId) {
      return NextResponse.json({ schedules: [] });
    }

    const entityConditions = [];

    if (policy.clientId) {
      entityConditions.push(
        and(
          eq(accountingPaymentSchedules.entityType, "client"),
          eq(accountingPaymentSchedules.clientId, policy.clientId),
        ),
      );
    }
    if (policy.agentId) {
      entityConditions.push(
        and(
          eq(accountingPaymentSchedules.entityType, "agent"),
          eq(accountingPaymentSchedules.agentId, policy.agentId),
        ),
      );
    }

    if (entityConditions.length === 0) {
      return NextResponse.json({ schedules: [] });
    }

    const rows = await db
      .select()
      .from(accountingPaymentSchedules)
      .where(
        and(
          eq(accountingPaymentSchedules.organisationId, policy.organisationId),
          eq(accountingPaymentSchedules.isActive, true),
          entityConditions.length === 1
            ? entityConditions[0]
            : or(...entityConditions),
        ),
      );

    return NextResponse.json({ schedules: rows });
  } catch (err) {
    console.error("GET schedule by-policy error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
