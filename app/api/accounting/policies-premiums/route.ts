import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { memberships } from "@/db/schema/core";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const flowFilter = url.searchParams.get("flow");
    const entityTypeFilter = url.searchParams.get("entityType");
    const entityPolicyIdFilter = url.searchParams.get("entityPolicyId");

    const conditions: any[] = [];

    if (!(user.userType === "admin" || user.userType === "internal_staff")) {
      const userMemberships = await db
        .select({ orgId: memberships.organisationId })
        .from(memberships)
        .where(eq(memberships.userId, Number(user.id)));
      const orgIds = userMemberships.map((m) => m.orgId);
      if (orgIds.length === 0) return NextResponse.json([], { status: 200 });
      conditions.push(inArray(policies.organisationId, orgIds));
    }

    if (flowFilter) {
      conditions.push(sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') = ${flowFilter}`);
    }

    let rows = await db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        organisationId: policies.organisationId,
        premiumId: policyPremiums.id,
        lineKey: policyPremiums.lineKey,
        lineLabel: policyPremiums.lineLabel,
        currency: policyPremiums.currency,
        grossPremiumCents: policyPremiums.grossPremiumCents,
        netPremiumCents: policyPremiums.netPremiumCents,
        clientPremiumCents: policyPremiums.clientPremiumCents,
        agentPremiumCents: policyPremiums.agentPremiumCents,
        agentCommissionCents: policyPremiums.agentCommissionCents,
        collaboratorId: policyPremiums.collaboratorId,
        insurerPolicyId: policyPremiums.insurerPolicyId,
        carExtra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .leftJoin(policyPremiums, eq(policyPremiums.policyId, policies.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(policies.createdAt));

    if (entityTypeFilter && entityPolicyIdFilter) {
      const entId = Number(entityPolicyIdFilter);
      rows = rows.filter((r: any) => {
        if (entityTypeFilter === "collaborator") return r.collaboratorId === entId;
        return true;
      });
    }

    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/accounting/policies-premiums error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
