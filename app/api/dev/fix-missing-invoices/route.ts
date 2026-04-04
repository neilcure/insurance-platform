import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { accountingInvoices, accountingInvoiceItems, accountingPaymentSchedules, accountingPayments } from "@/db/schema/accounting";
import { policyDocuments } from "@/db/schema/documents";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { autoCreateAccountingInvoices } from "@/lib/auto-create-invoices";
import { syncInvoicePaymentStatus } from "@/lib/accounting-invoices";

export const dynamic = "force-dynamic";

type TrackingEntry = { documentNumber?: string; status?: string };
type TrackingData = Record<string, unknown>;

export async function GET() {
  const allPolicies = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      clientId: policies.clientId,
      agentId: policies.agentId,
      organisationId: policies.organisationId,
      documentTracking: policies.documentTracking,
    })
    .from(policies)
    .where(sql`${policies.documentTracking} IS NOT NULL`);

  const debug: Record<string, unknown>[] = [];

  for (const policy of allPolicies) {
    const tracking = policy.documentTracking as TrackingData | null;

    const itemRows = await db
      .select({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.policyId, policy.id));

    const invoiceIds = [...new Set(itemRows.map((r) => r.invoiceId))];
    let invoiceData: { id: number; invoiceNumber: string; direction: string; status: string; scheduleId: number | null; totalAmountCents: number }[] = [];

    if (invoiceIds.length > 0) {
      invoiceData = await db
        .select({
          id: accountingInvoices.id,
          invoiceNumber: accountingInvoices.invoiceNumber,
          direction: accountingInvoices.direction,
          status: accountingInvoices.status,
          scheduleId: accountingInvoices.scheduleId,
          totalAmountCents: accountingInvoices.totalAmountCents,
        })
        .from(accountingInvoices)
        .where(inArray(accountingInvoices.id, invoiceIds));
    }

    const scheduleRows = policy.organisationId
      ? await db
          .select({
            id: accountingPaymentSchedules.id,
            entityType: accountingPaymentSchedules.entityType,
            isActive: accountingPaymentSchedules.isActive,
          })
          .from(accountingPaymentSchedules)
          .where(eq(accountingPaymentSchedules.organisationId, policy.organisationId))
      : [];

    const trackingEntries: Record<string, { status?: string; documentNumber?: string }> = {};
    if (tracking && typeof tracking === "object") {
      for (const [key, raw] of Object.entries(tracking)) {
        if (key.startsWith("_")) continue;
        const entry = raw as TrackingEntry | null;
        trackingEntries[key] = {
          status: entry?.status,
          documentNumber: entry?.documentNumber,
        };
      }
    }

    debug.push({
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      clientId: policy.clientId,
      agentId: policy.agentId,
      trackingEntries,
      accountingInvoices: invoiceData,
      schedules: scheduleRows,
    });
  }

  return NextResponse.json({ policies: debug });
}

export async function POST() {
  const allPolicies = await db
    .select({
      id: policies.id,
      documentTracking: policies.documentTracking,
    })
    .from(policies)
    .where(sql`${policies.documentTracking} IS NOT NULL`);

  const invoiceKeywords = ["invoice", "debit_note", "receipt"];
  let created = 0;
  const details: string[] = [];

  for (const policy of allPolicies) {
    const tracking = policy.documentTracking as TrackingData | null;
    if (!tracking || typeof tracking !== "object") continue;

    const [existing] = await db
      .select({ id: accountingInvoices.id })
      .from(accountingInvoices)
      .innerJoin(accountingInvoiceItems, eq(accountingInvoiceItems.invoiceId, accountingInvoices.id))
      .where(
        and(
          eq(accountingInvoiceItems.policyId, policy.id),
          eq(accountingInvoices.direction, "receivable"),
          sql`${accountingInvoices.status} <> 'cancelled'`,
        ),
      )
      .limit(1);

    if (existing) {
      details.push(`Policy ${policy.id}: SKIPPED — already has receivable invoice #${existing.id}`);
      continue;
    }

    let bestDocNumber: string | undefined;
    let bestDocType: string | undefined;

    for (const [key, raw] of Object.entries(tracking)) {
      if (key.startsWith("_")) continue;
      if (key.endsWith("_agent")) continue;
      const entry = raw as TrackingEntry | null;
      if (!entry || typeof entry !== "object") continue;

      const keyLower = key.toLowerCase();
      if (invoiceKeywords.some((kw) => keyLower.includes(kw))) {
        bestDocNumber = entry.documentNumber;
        bestDocType = key;
        details.push(`Policy ${policy.id}: found doc "${key}" status="${entry.status}" docNum="${entry.documentNumber}"`);
        break;
      }
    }

    if (!bestDocNumber || !bestDocType) {
      details.push(`Policy ${policy.id}: no invoice-type document found`);
      continue;
    }

    try {
      await autoCreateAccountingInvoices(policy.id, bestDocType, 1, bestDocNumber);
      created++;
      details.push(`Policy ${policy.id}: CREATED invoice ${bestDocNumber}`);
    } catch (err) {
      details.push(`Policy ${policy.id}: ERROR - ${(err as Error).message}`);
    }
  }

  // Sync payment status on all invoices (fixes paidAmountCents that weren't synced
  // because the `payer` column was missing from the database)
  const allInvoices = await db
    .select({ id: accountingInvoices.id })
    .from(accountingInvoices)
    .where(sql`${accountingInvoices.status} <> 'cancelled'`);

  let synced = 0;
  for (const inv of allInvoices) {
    try {
      const result = await syncInvoicePaymentStatus(inv.id);
      if (result && result.paidTotal > 0) synced++;
    } catch (err) {
      details.push(`Sync invoice #${inv.id}: ERROR - ${(err as Error).message}`);
    }
  }

  // Recreate missing accounting_payments from policyDocuments.paymentMeta
  // (payments that failed to INSERT because the payer column was missing)
  const docsWithPayment = await db
    .select({
      id: policyDocuments.id,
      policyId: policyDocuments.policyId,
      paymentMeta: policyDocuments.paymentMeta,
      status: policyDocuments.status,
      uploadedBy: policyDocuments.uploadedBy,
      createdAt: policyDocuments.createdAt,
    })
    .from(policyDocuments)
    .where(sql`${policyDocuments.paymentMeta} IS NOT NULL`);

  let paymentsCreated = 0;
  for (const doc of docsWithPayment) {
    const meta = doc.paymentMeta as { amountCents?: number; method?: string; date?: string | null; ref?: string | null; payer?: string } | null;
    if (!meta?.amountCents || !meta?.method) continue;

    const itemRows = await db
      .select({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.policyId, doc.policyId));
    const invoiceIds = [...new Set(itemRows.map((r) => r.invoiceId))];
    if (invoiceIds.length === 0) continue;

    const [invoice] = await db
      .select()
      .from(accountingInvoices)
      .where(and(
        eq(accountingInvoices.direction, "receivable"),
        inArray(accountingInvoices.id, invoiceIds),
        sql`${accountingInvoices.invoiceType} != 'statement'`,
      ))
      .orderBy(desc(accountingInvoices.createdAt))
      .limit(1);
    if (!invoice) continue;

    const existingPayments = await db
      .select({ id: accountingPayments.id })
      .from(accountingPayments)
      .where(and(
        eq(accountingPayments.invoiceId, invoice.id),
        eq(accountingPayments.amountCents, meta.amountCents),
      ))
      .limit(1);
    if (existingPayments.length > 0) continue;

    const isVerified = doc.status === "verified";
    await db.insert(accountingPayments).values({
      invoiceId: invoice.id,
      amountCents: meta.amountCents,
      currency: invoice.currency,
      paymentDate: meta.date ?? null,
      paymentMethod: meta.method,
      referenceNumber: meta.ref ?? null,
      payer: (meta.payer as "client" | "agent") || "client",
      status: isVerified ? "verified" : "submitted",
      submittedBy: doc.uploadedBy,
      ...(isVerified ? { verifiedBy: doc.uploadedBy, verifiedAt: doc.createdAt } : {}),
    });
    paymentsCreated++;
    details.push(`Doc #${doc.id} → invoice #${invoice.id}: created payment ${meta.amountCents / 100} (${meta.payer || "client"})`);
  }

  // Re-sync all invoices after payment recreation
  if (paymentsCreated > 0) {
    synced = 0;
    for (const inv of allInvoices) {
      try {
        const result = await syncInvoicePaymentStatus(inv.id);
        if (result && result.paidTotal > 0) synced++;
      } catch { /* ignore */ }
    }
  }

  return NextResponse.json({ ok: true, created, synced, paymentsCreated, details });
}
