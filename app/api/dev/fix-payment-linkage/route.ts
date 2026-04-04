import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingPayments, accountingInvoiceItems } from "@/db/schema/accounting";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { syncInvoicePaymentStatus } from "@/lib/accounting-invoices";
import { generateDocumentNumber } from "@/lib/document-number";

export const dynamic = "force-dynamic";

export async function POST() {
  const details: string[] = [];

  // 1. Find payments attached to statement-type invoices that should be on individual invoices
  const statementPayments = await db
    .select({
      paymentId: accountingPayments.id,
      invoiceId: accountingPayments.invoiceId,
      amountCents: accountingPayments.amountCents,
      payer: accountingPayments.payer,
      invoiceType: accountingInvoices.invoiceType,
    })
    .from(accountingPayments)
    .innerJoin(accountingInvoices, eq(accountingInvoices.id, accountingPayments.invoiceId))
    .where(sql`${accountingInvoices.invoiceType} = 'statement'`);

  let moved = 0;
  for (const sp of statementPayments) {
    const items = await db
      .select({ policyId: accountingInvoiceItems.policyId })
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.invoiceId, sp.invoiceId));

    if (items.length === 0) continue;

    const policyIds = [...new Set(items.map((i) => i.policyId))];
    const allItemsForPolicies = await db
      .select({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(inArray(accountingInvoiceItems.policyId, policyIds));

    const allInvoiceIds = [...new Set(allItemsForPolicies.map((i) => i.invoiceId))];

    const [individualInvoice] = await db
      .select({ id: accountingInvoices.id, invoiceNumber: accountingInvoices.invoiceNumber })
      .from(accountingInvoices)
      .where(and(
        inArray(accountingInvoices.id, allInvoiceIds),
        eq(accountingInvoices.direction, "receivable"),
        sql`${accountingInvoices.invoiceType} = 'individual'`,
        sql`${accountingInvoices.status} <> 'cancelled'`,
      ))
      .orderBy(desc(accountingInvoices.createdAt))
      .limit(1);

    if (individualInvoice) {
      await db
        .update(accountingPayments)
        .set({ invoiceId: individualInvoice.id })
        .where(eq(accountingPayments.id, sp.paymentId));

      await syncInvoicePaymentStatus(individualInvoice.id);
      await syncInvoicePaymentStatus(sp.invoiceId);
      moved++;
      details.push(`Payment #${sp.paymentId} ($${sp.amountCents / 100}): moved from statement invoice #${sp.invoiceId} → individual invoice #${individualInvoice.id} (${individualInvoice.invoiceNumber})`);
    }
  }

  // 2. Fix endorsement invoices that share the same number as their parent policy
  const allInvoices = await db
    .select({
      id: accountingInvoices.id,
      invoiceNumber: accountingInvoices.invoiceNumber,
      direction: accountingInvoices.direction,
      notes: accountingInvoices.notes,
    })
    .from(accountingInvoices)
    .where(and(
      eq(accountingInvoices.direction, "receivable"),
      sql`${accountingInvoices.invoiceType} = 'individual'`,
      sql`${accountingInvoices.status} <> 'cancelled'`,
    ));

  const numberCounts = new Map<string, typeof allInvoices>();
  for (const inv of allInvoices) {
    const arr = numberCounts.get(inv.invoiceNumber) ?? [];
    arr.push(inv);
    numberCounts.set(inv.invoiceNumber, arr);
  }

  let renumbered = 0;
  for (const [num, invs] of numberCounts) {
    if (invs.length <= 1) continue;
    // Keep the first one, renumber the rest
    for (let i = 1; i < invs.length; i++) {
      const newNumber = await generateDocumentNumber("ENDSINV");
      await db
        .update(accountingInvoices)
        .set({ invoiceNumber: newNumber, updatedAt: new Date().toISOString() })
        .where(eq(accountingInvoices.id, invs[i].id));
      renumbered++;
      details.push(`Invoice #${invs[i].id}: renumbered from "${num}" → "${newNumber}" (was duplicate)`);
    }
  }

  // 3. Re-sync all affected invoices
  const allInvIds = await db
    .select({ id: accountingInvoices.id })
    .from(accountingInvoices)
    .where(sql`${accountingInvoices.status} <> 'cancelled'`);

  let synced = 0;
  for (const inv of allInvIds) {
    try {
      const result = await syncInvoicePaymentStatus(inv.id);
      if (result && result.paidTotal > 0) synced++;
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, paymentsMoved: moved, invoicesRenumbered: renumbered, synced, details });
}
