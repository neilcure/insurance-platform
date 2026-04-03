import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingPaymentSchedules } from "@/db/schema/accounting";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const scheduleId = Number(id);
    const body = await request.json();
    const { addInvoiceIds, removeInvoiceIds } = body as {
      addInvoiceIds?: number[];
      removeInvoiceIds?: number[];
    };

    const [schedule] = await db
      .select()
      .from(accountingPaymentSchedules)
      .where(eq(accountingPaymentSchedules.id, scheduleId))
      .limit(1);

    if (!schedule) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }

    if (addInvoiceIds?.length) {
      await db
        .update(accountingInvoices)
        .set({ scheduleId, updatedAt: new Date().toISOString() })
        .where(
          and(
            inArray(accountingInvoices.id, addInvoiceIds),
            isNull(accountingInvoices.scheduleId),
          ),
        );
    }

    if (removeInvoiceIds?.length) {
      await db
        .update(accountingInvoices)
        .set({ scheduleId: null, updatedAt: new Date().toISOString() })
        .where(
          and(
            inArray(accountingInvoices.id, removeInvoiceIds),
            eq(accountingInvoices.scheduleId, scheduleId),
          ),
        );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/accounting/schedules/[id]/link-invoices error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
