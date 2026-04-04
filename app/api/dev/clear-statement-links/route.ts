import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices } from "@/db/schema/accounting";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST() {
  // Clear scheduleId and reset status to "pending" for all individual invoices
  // that are currently on a statement. Admin will manually re-add them if needed.
  const result = await db
    .update(accountingInvoices)
    .set({
      scheduleId: null,
      status: "pending",
      updatedAt: new Date().toISOString(),
    })
    .where(sql`${accountingInvoices.scheduleId} IS NOT NULL AND ${accountingInvoices.invoiceType} = 'individual'`)
    .returning({ id: accountingInvoices.id, invoiceNumber: accountingInvoices.invoiceNumber });

  return NextResponse.json({
    ok: true,
    cleared: result.length,
    invoices: result.map((r) => `#${r.id} (${r.invoiceNumber})`),
  });
}
