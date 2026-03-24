import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPaymentSchedules, accountingInvoices } from "@/db/schema/accounting";
import { eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

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
      entityName: true,
      frequency: true,
      billingDay: true,
      currency: true,
      isActive: true,
      notes: true,
    };

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields[key]) updates[key] = value;
    }

    const [updated] = await db
      .update(accountingPaymentSchedules)
      .set(updates as any)
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
