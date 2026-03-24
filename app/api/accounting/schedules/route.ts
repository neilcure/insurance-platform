import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPaymentSchedules } from "@/db/schema/accounting";
import { memberships, organisations } from "@/db/schema/core";
import { desc, eq, and, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const entityTypeFilter = url.searchParams.get("entityType");

    const conditions: ReturnType<typeof eq>[] = [];
    if (entityTypeFilter) conditions.push(eq(accountingPaymentSchedules.entityType, entityTypeFilter));

    if (!(user.userType === "admin" || user.userType === "internal_staff")) {
      const userMemberships = await db
        .select({ orgId: memberships.organisationId })
        .from(memberships)
        .where(eq(memberships.userId, Number(user.id)));
      const orgIds = userMemberships.map((m) => m.orgId);
      if (orgIds.length === 0) return NextResponse.json([], { status: 200 });
      conditions.push(inArray(accountingPaymentSchedules.organisationId, orgIds));
    }

    const rows = await db
      .select()
      .from(accountingPaymentSchedules)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(accountingPaymentSchedules.createdAt));

    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/accounting/schedules error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();

    const {
      entityPolicyId,
      entityType,
      entityName,
      frequency = "monthly",
      billingDay,
      currency = "HKD",
      notes,
    } = body;

    if (!entityType) {
      return NextResponse.json({ error: "entityType is required" }, { status: 400 });
    }

    let organisationId: number;
    const [firstMembership] = await db
      .select({ orgId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, Number(user.id)))
      .limit(1);
    organisationId = firstMembership?.orgId ?? 0;
    if (!organisationId) {
      const [firstOrg] = await db.select({ id: organisations.id }).from(organisations).limit(1);
      organisationId = firstOrg?.id ?? 0;
    }
    if (!organisationId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const [schedule] = await db
      .insert(accountingPaymentSchedules)
      .values({
        organisationId,
        entityPolicyId: entityPolicyId ? Number(entityPolicyId) : null,
        entityType,
        entityName: entityName || null,
        frequency,
        billingDay: billingDay ? Number(billingDay) : null,
        currency,
        isActive: true,
        notes: notes || null,
        createdBy: Number(user.id),
      })
      .returning();

    return NextResponse.json(schedule, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/schedules error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
