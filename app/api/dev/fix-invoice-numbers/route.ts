import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { cars } from "@/db/schema/insurance";
import { eq, and, sql } from "drizzle-orm";
import { generateDocumentNumber } from "@/lib/document-number";

export const dynamic = "force-dynamic";

export async function POST() {
  const details: string[] = [];

  // Find invoice #8 (main policy 343) and restore its correct number
  const [inv8] = await db
    .select({ id: accountingInvoices.id, invoiceNumber: accountingInvoices.invoiceNumber })
    .from(accountingInvoices)
    .where(eq(accountingInvoices.id, 8))
    .limit(1);

  if (inv8 && inv8.invoiceNumber !== "HIDIINV-2026-4795") {
    await db.update(accountingInvoices)
      .set({ invoiceNumber: "HIDIINV-2026-4795", updatedAt: new Date().toISOString() })
      .where(eq(accountingInvoices.id, 8));
    details.push(`Invoice #8: restored to HIDIINV-2026-4795 (was ${inv8.invoiceNumber})`);
  }

  // Find invoice #14 (endorsement policy 345) — give it a unique endorsement number
  const [inv14] = await db
    .select({ id: accountingInvoices.id, invoiceNumber: accountingInvoices.invoiceNumber })
    .from(accountingInvoices)
    .where(eq(accountingInvoices.id, 14))
    .limit(1);

  if (inv14) {
    // Check the endorsement policy's document tracking for endorsement_invoice prefix
    const items14 = await db
      .select({ policyId: accountingInvoiceItems.policyId })
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.invoiceId, 14))
      .limit(1);

    const endorsePolicyId = items14[0]?.policyId;
    let newNumber: string;

    if (endorsePolicyId) {
      // Try to get tracking from endorsement policy
      const [carRow] = await db
        .select({ extraAttributes: cars.extraAttributes })
        .from(cars)
        .where(eq(cars.policyId, endorsePolicyId))
        .limit(1);

      const extra = carRow?.extraAttributes as Record<string, unknown> | null;
      const linkedPolicyId = extra?.linkedPolicyId;
      details.push(`Endorsement policy ${endorsePolicyId}, linkedPolicyId=${linkedPolicyId}`);
    }

    // Use HIDIENS prefix (from endorsement invoice template)
    newNumber = await generateDocumentNumber("HIDIENS");
    await db.update(accountingInvoices)
      .set({ invoiceNumber: newNumber, updatedAt: new Date().toISOString() })
      .where(eq(accountingInvoices.id, 14));
    details.push(`Invoice #14: renumbered from "${inv14.invoiceNumber}" → "${newNumber}"`);
  }

  return NextResponse.json({ ok: true, details });
}
