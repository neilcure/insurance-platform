import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPaymentSchedules } from "@/db/schema/accounting";
import { policies } from "@/db/schema/insurance";
import { clients, users } from "@/db/schema/core";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import type { ScheduleFrequency } from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

const VALID_FREQUENCIES: ScheduleFrequency[] = ["weekly", "monthly", "bimonthly", "quarterly"];

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const { policyId, frequency = "monthly", billingDay, entityType: requestedEntityType } = body;

    if (!policyId) {
      return NextResponse.json({ error: "policyId is required" }, { status: 400 });
    }
    if (!VALID_FREQUENCIES.includes(frequency)) {
      return NextResponse.json({ error: `Invalid frequency: ${frequency}` }, { status: 400 });
    }

    const [policy] = await db
      .select({
        id: policies.id,
        clientId: policies.clientId,
        agentId: policies.agentId,
        organisationId: policies.organisationId,
      })
      .from(policies)
      .where(eq(policies.id, Number(policyId)))
      .limit(1);

    if (!policy || !policy.organisationId) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const entityType: string | null =
      requestedEntityType === "agent" && policy.agentId ? "agent" :
      requestedEntityType === "client" && policy.clientId ? "client" :
      !requestedEntityType ? (policy.clientId ? "client" : policy.agentId ? "agent" : null) :
      null;

    if (!entityType) {
      return NextResponse.json({ error: "Policy has no matching client or agent" }, { status: 400 });
    }

    const entityId = entityType === "client" ? policy.clientId! : policy.agentId!;

    const existingConditions = [
      eq(accountingPaymentSchedules.organisationId, policy.organisationId),
      eq(accountingPaymentSchedules.entityType, entityType),
      eq(accountingPaymentSchedules.isActive, true),
    ];
    if (entityType === "client") {
      existingConditions.push(eq(accountingPaymentSchedules.clientId, entityId));
    } else {
      existingConditions.push(eq(accountingPaymentSchedules.agentId, entityId));
    }

    const [existing] = await db
      .select()
      .from(accountingPaymentSchedules)
      .where(and(...existingConditions))
      .limit(1);

    if (existing) {
      return NextResponse.json({ schedule: existing, created: false });
    }

    let entityName: string | null = null;
    if (entityType === "client") {
      const [c] = await db
        .select({ displayName: clients.displayName })
        .from(clients)
        .where(eq(clients.id, entityId))
        .limit(1);
      entityName = c?.displayName ?? null;
    } else {
      const [a] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, entityId))
        .limit(1);
      entityName = a?.name || a?.email || null;
    }

    const [schedule] = await db
      .insert(accountingPaymentSchedules)
      .values({
        organisationId: policy.organisationId,
        entityType,
        ...(entityType === "client" ? { clientId: entityId } : { agentId: entityId }),
        entityName,
        frequency,
        billingDay: billingDay ? Number(billingDay) : null,
        currency: "HKD",
        isActive: true,
        createdBy: Number(user.id),
      })
      .returning();

    return NextResponse.json({ schedule, created: true }, { status: 201 });
  } catch (err) {
    console.error("POST add-policy to schedule error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
