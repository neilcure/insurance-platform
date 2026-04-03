import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices } from "@/db/schema/accounting";
import { policies } from "@/db/schema/insurance";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type TrackingEntry = { documentNumber?: string };
type TrackingData = Record<string, unknown>;

function pickInvoiceDocNumber(tracking: TrackingData | null | undefined): string | undefined {
  if (!tracking || typeof tracking !== "object") return undefined;

  // Priority: invoice → debit_note → quotation → receipt → any
  const priorities = ["invoice", "debit_note", "quotation", "receipt"];
  for (const keyword of priorities) {
    for (const [key, entry] of Object.entries(tracking)) {
      if (key.startsWith("_")) continue;
      if (!entry || typeof entry !== "object") continue;
      // Skip agent copies - use client-facing number
      if (key.endsWith("_agent")) continue;
      if (key.toLowerCase().includes(keyword)) {
        const docNum = (entry as TrackingEntry).documentNumber;
        if (docNum) return docNum;
      }
    }
  }
  // Fallback: any entry with a number
  for (const [key, entry] of Object.entries(tracking)) {
    if (key.startsWith("_")) continue;
    if (key.endsWith("_agent")) continue;
    if (!entry || typeof entry !== "object") continue;
    const docNum = (entry as TrackingEntry).documentNumber;
    if (docNum) return docNum;
  }
  return undefined;
}

export async function GET() {
  try {
    const invoices = await db
      .select({
        id: accountingInvoices.id,
        invoiceNumber: accountingInvoices.invoiceNumber,
        entityPolicyId: accountingInvoices.entityPolicyId,
        direction: accountingInvoices.direction,
        status: accountingInvoices.status,
      })
      .from(accountingInvoices);

    const policyIds = [...new Set(invoices.map((i) => i.entityPolicyId).filter(Boolean))] as number[];
    const policyRows = policyIds.length > 0
      ? await db.select({ id: policies.id, documentTracking: policies.documentTracking }).from(policies).where(sql`${policies.id} IN ${policyIds}`)
      : [];
    const trackingMap = Object.fromEntries(policyRows.map((p) => [p.id, p.documentTracking]));

    return NextResponse.json({ invoices, tracking: trackingMap });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    // Get ALL accounting invoices (fix any that don't match document tracking)
    const allInvoices = await db
      .select({
        id: accountingInvoices.id,
        invoiceNumber: accountingInvoices.invoiceNumber,
        entityPolicyId: accountingInvoices.entityPolicyId,
        direction: accountingInvoices.direction,
        notes: accountingInvoices.notes,
      })
      .from(accountingInvoices);

    const policyIds = [...new Set(allInvoices.map((i) => i.entityPolicyId).filter(Boolean))] as number[];
    const policyRows = policyIds.length > 0
      ? await db.select({ id: policies.id, documentTracking: policies.documentTracking }).from(policies).where(sql`${policies.id} IN ${policyIds}`)
      : [];
    const policyMap = new Map(policyRows.map((p) => [p.id, p.documentTracking as TrackingData | null]));

    const updates: { id: number; oldNumber: string; newNumber: string }[] = [];
    const skipped: { id: number; invoiceNumber: string; reason: string }[] = [];

    for (const inv of allInvoices) {
      if (!inv.entityPolicyId) {
        skipped.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, reason: "no entityPolicyId" });
        continue;
      }

      const tracking = policyMap.get(inv.entityPolicyId);
      let docNumber = pickInvoiceDocNumber(tracking);

      // For endorsements (notes contain "endorsement" or "Auto-created"), try parent policy
      if (!docNumber && inv.notes) {
        const isEndorsement = inv.notes.toLowerCase().includes("endorsement");
        if (isEndorsement) {
          // Look through all policies to find a parent that has tracking data
          for (const [pid, trackingData] of policyMap.entries()) {
            if (pid !== inv.entityPolicyId && trackingData) {
              const parentDoc = pickInvoiceDocNumber(trackingData);
              if (parentDoc) {
                docNumber = parentDoc;
                break;
              }
            }
          }
        }
      }

      if (!docNumber) {
        skipped.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, reason: "no document number in tracking" });
        continue;
      }

      // Skip if already correct
      if (inv.invoiceNumber === docNumber) {
        continue;
      }

      await db
        .update(accountingInvoices)
        .set({ invoiceNumber: docNumber, updatedAt: new Date().toISOString() })
        .where(eq(accountingInvoices.id, inv.id));

      updates.push({ id: inv.id, oldNumber: inv.invoiceNumber, newNumber: docNumber });
    }

    return NextResponse.json({
      message: `Updated ${updates.length} of ${allInvoices.length} invoices`,
      updated: updates.length,
      details: updates,
      skipped,
    });
  } catch (err) {
    console.error("fix-invoice-numbers error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
