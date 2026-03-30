import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPaymentSchedules, accountingInvoices } from "@/db/schema/accounting";
import { eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

type ScheduleUpdateInput = Partial<typeof accountingPaymentSchedules.$inferInsert>;

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;

    const [schedule] = await db
      .select()
      .from(accountingPaymentSchedules)
      .where(eq(accountingPaymentSchedules.id, Number(id)))
      .limit(1);

    if (!schedule) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }

    const statements = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.scheduleId, Number(id)))
      .orderBy(desc(accountingInvoices.createdAt));

    return NextResponse.json({ ...schedule, statements });
  } catch (err) {
    console.error("GET /api/accounting/schedules/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const body = await request.json();

    const allowedFields: Record<string, boolean> = {
      entityPolicyId: true,
      agentId: true,
      clientId: true,
      entityName: true,
      frequency: true,
      billingDay: true,
      currency: true,
      isActive: true,
      notes: true,
    };

    const updates: ScheduleUpdateInput = { updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(body)) {
      if (!allowedFields[key]) continue;

      if (key === "entityPolicyId") {
        updates.entityPolicyId = value === null || value === undefined || value === "" ? null : Number(value);
        continue;
      }
      if (key === "agentId") {
        updates.agentId = value === null || value === undefined || value === "" ? null : Number(value);
        continue;
      }
      if (key === "clientId") {
        updates.clientId = value === null || value === undefined || value === "" ? null : Number(value);
        continue;
      }
      if (key === "billingDay") {
        updates.billingDay = value === null || value === undefined || value === "" ? null : Number(value);
        continue;
      }
      if (key === "entityName") {
        updates.entityName = value as string | null;
        continue;
      }
      if (key === "frequency") {
        updates.frequency = value as string;
        continue;
      }
      if (key === "currency") {
        updates.currency = value as string;
        continue;
      }
      if (key === "isActive") {
        updates.isActive = Boolean(value);
        continue;
      }
      if (key === "notes") {
        updates.notes = value as string | null;
      }
    }

    const [updated] = await db
      .update(accountingPaymentSchedules)
      .set(updates)
      .where(eq(accountingPaymentSchedules.id, Number(id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/accounting/schedules/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    await db.delete(accountingPaymentSchedules).where(eq(accountingPaymentSchedules.id, Number(id)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/accounting/schedules/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
