import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { policyDocuments } from "@/db/schema/documents";
import { eq, and } from "drizzle-orm";

const STATUS_ORDER = [
  "quotation_prepared",
  "quotation_sent",
  "quotation_confirmed",
  "invoice_prepared",
  "invoice_sent",
  "payment_received",
  "completed",
] as const;

export type PolicyStatusKey = (typeof STATUS_ORDER)[number];

/**
 * When a status is reached, automatically chain to the next status.
 * e.g. quotation_confirmed → invoice_prepared (invoice template already exists)
 */
const AUTO_CHAIN: Record<string, { next: string; note: string }> = {
  quotation_confirmed: { next: "invoice_prepared", note: "Auto: invoice template ready" },
};

/**
 * Advance a policy's workflow status forward to `targetStatus`,
 * only if the current status is before the target in STATUS_ORDER.
 * If the target has an auto-chain, continues advancing to the chained status.
 * Returns the final status string on success, null if no change.
 */
export async function advancePolicyStatus(
  policyId: number,
  targetStatus: string,
  changedBy: string,
  note: string,
): Promise<string | null> {
  const [carRow] = await db
    .select({ id: cars.id, extraAttributes: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.policyId, policyId))
    .limit(1);
  if (!carRow) return null;

  const existing = (carRow.extraAttributes ?? {}) as Record<string, unknown>;
  const currentStatus = (existing.status as string) ?? "quotation_prepared";

  const currentIdx = STATUS_ORDER.indexOf(currentStatus as PolicyStatusKey);
  const targetIdx = STATUS_ORDER.indexOf(targetStatus as PolicyStatusKey);

  if (targetIdx >= 0 && currentIdx >= targetIdx) return null;

  let finalStatus = targetStatus;
  const historyArr = Array.isArray(existing.statusHistory)
    ? [...(existing.statusHistory as unknown[])]
    : [];

  historyArr.push({
    status: targetStatus,
    changedAt: new Date().toISOString(),
    changedBy,
    note,
  });

  const chain = AUTO_CHAIN[targetStatus];
  if (chain) {
    const chainIdx = STATUS_ORDER.indexOf(chain.next as PolicyStatusKey);
    if (chainIdx > targetIdx) {
      finalStatus = chain.next;
      historyArr.push({
        status: chain.next,
        changedAt: new Date().toISOString(),
        changedBy,
        note: chain.note,
      });
    }
  }

  const updated: Record<string, unknown> = {
    ...existing,
    status: finalStatus,
    statusHistory: historyArr,
    _lastEditedAt: new Date().toISOString(),
  };

  await db.update(cars).set({ extraAttributes: updated }).where(eq(cars.id, carRow.id));
  return finalStatus;
}

/**
 * Recalculate the correct policy status by checking actual document tracking
 * and payment verification state. Used when admin rejects/resets a document
 * that previously caused a status advance.
 *
 * Returns the recalculated status, or null if no change was needed.
 */
export async function recalculatePolicyStatus(
  policyId: number,
  changedBy: string,
  reason: string,
): Promise<string | null> {
  const [[carRow], [policyRow]] = await Promise.all([
    db.select({ id: cars.id, extraAttributes: cars.extraAttributes })
      .from(cars).where(eq(cars.policyId, policyId)).limit(1),
    db.select({ documentTracking: policies.documentTracking })
      .from(policies).where(eq(policies.id, policyId)).limit(1),
  ]);
  if (!carRow) return null;

  const existing = (carRow.extraAttributes ?? {}) as Record<string, unknown>;
  const currentStatus = (existing.status as string) ?? "quotation_prepared";

  if (currentStatus === "completed") return null;

  const tracking = (policyRow?.documentTracking ?? {}) as Record<string, { status?: string } | undefined>;

  const hasTrackingMatch = (keyword: string, docStatus: string): boolean => {
    for (const [key, entry] of Object.entries(tracking)) {
      if (key.startsWith("_")) continue;
      if (key.toLowerCase().includes(keyword) && entry?.status === docStatus) return true;
    }
    return false;
  };

  const verifiedPaymentDocs = await db
    .select({ paymentMeta: policyDocuments.paymentMeta })
    .from(policyDocuments)
    .where(and(
      eq(policyDocuments.policyId, policyId),
      eq(policyDocuments.status, "verified"),
    ))
    .limit(50);

  const hasVerifiedPaymentProof = verifiedPaymentDocs.some((d) => {
    const meta = d.paymentMeta as { amountCents?: number } | null;
    return meta && meta.amountCents && meta.amountCents > 0;
  });

  const hasReceiptSent = hasTrackingMatch("receipt", "sent");
  const hasInvoiceSent = hasTrackingMatch("invoice", "sent") || hasTrackingMatch("debit", "sent");
  const hasQuotationConfirmed = hasTrackingMatch("quotation", "confirmed");
  const hasQuotationSent = hasTrackingMatch("quotation", "sent");

  let correctStatus: PolicyStatusKey = "quotation_prepared";
  if (hasVerifiedPaymentProof || hasReceiptSent) {
    correctStatus = "payment_received";
  } else if (hasInvoiceSent) {
    correctStatus = "invoice_sent";
  } else if (hasQuotationConfirmed) {
    correctStatus = "invoice_prepared"; // auto-chain: confirmed → invoice_prepared
  } else if (hasQuotationSent) {
    correctStatus = "quotation_sent";
  }

  if (correctStatus === currentStatus) return null;

  const historyArr = Array.isArray(existing.statusHistory)
    ? [...(existing.statusHistory as unknown[])]
    : [];
  historyArr.push({
    status: correctStatus,
    changedAt: new Date().toISOString(),
    changedBy,
    note: `Auto rollback: ${reason}`,
  });

  const updated: Record<string, unknown> = {
    ...existing,
    status: correctStatus,
    statusHistory: historyArr,
    _lastEditedAt: new Date().toISOString(),
  };

  await db.update(cars).set({ extraAttributes: updated }).where(eq(cars.id, carRow.id));
  return correctStatus;
}

export { STATUS_ORDER };
