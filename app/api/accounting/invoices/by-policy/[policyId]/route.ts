import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingInvoiceItems, accountingPayments } from "@/db/schema/accounting";
import { eq, sql, desc } from "drizzle-orm";
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

    const itemRows = await db
      .select({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.policyId, pid));

    const invoiceIds = [...new Set(itemRows.map((r) => r.invoiceId))];
    if (invoiceIds.length === 0) {
      return NextResponse.json([]);
    }

    const invoices = await db
      .select()
      .from(accountingInvoices)
      .where(sql`${accountingInvoices.id} = ANY(${invoiceIds})`)
      .orderBy(desc(accountingInvoices.createdAt));

    const payments = await db
      .select()
      .from(accountingPayments)
      .where(sql`${accountingPayments.invoiceId} = ANY(${invoiceIds})`);

    const paymentsByInvoice = new Map<number, typeof payments>();
    for (const p of payments) {
      const arr = paymentsByInvoice.get(p.invoiceId) ?? [];
      arr.push(p);
      paymentsByInvoice.set(p.invoiceId, arr);
    }

    const result = invoices.map((inv) => ({
      ...inv,
      payments: paymentsByInvoice.get(inv.id) ?? [],
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET invoices by-policy error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
