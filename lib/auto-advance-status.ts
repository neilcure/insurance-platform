import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { policyDocuments } from "@/db/schema/documents";
import { eq, and, sql } from "drizzle-orm";

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
export type PolicyStatusTrack = "client" | "agent";

function extractCount(result: unknown): number {
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  return (rows[0] as { cnt?: number })?.cnt ?? 0;
}

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
  track: PolicyStatusTrack = "client",
): Promise<string | null> {
  const [carRow] = await db
    .select({ id: cars.id, extraAttributes: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.policyId, policyId))
    .limit(1);
  if (!carRow) return null;

  const existing = (carRow.extraAttributes ?? {}) as Record<string, unknown>;
  const statusKey = track === "agent" ? "statusAgent" : "statusClient";
  const historyKey = track === "agent" ? "statusHistoryAgent" : "statusHistoryClient";
  const currentStatus = String(existing[statusKey] ?? existing.statusClient ?? existing.status ?? "quotation_prepared");

  const currentIdx = STATUS_ORDER.indexOf(currentStatus as PolicyStatusKey);
  const targetIdx = STATUS_ORDER.indexOf(targetStatus as PolicyStatusKey);

  if (targetIdx >= 0 && currentIdx >= targetIdx) return null;

  let finalStatus = targetStatus;
  const historyArr = Array.isArray(existing[historyKey])
    ? [...(existing[historyKey] as unknown[])]
    : Array.isArray(existing.statusHistory)
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
    [statusKey]: finalStatus,
    [historyKey]: historyArr,
    _lastEditedAt: new Date().toISOString(),
  };
  if (track === "client") {
    updated.status = finalStatus;
    updated.statusHistory = historyArr;
  }

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
  track: PolicyStatusTrack = "client",
): Promise<string | null> {
  const [[carRow], [policyRow]] = await Promise.all([
    db.select({ id: cars.id, extraAttributes: cars.extraAttributes })
      .from(cars).where(eq(cars.policyId, policyId)).limit(1),
    db.select({ documentTracking: policies.documentTracking })
      .from(policies).where(eq(policies.id, policyId)).limit(1),
  ]);
  if (!carRow) return null;

  const existing = (carRow.extraAttributes ?? {}) as Record<string, unknown>;
  const statusKey = track === "agent" ? "statusAgent" : "statusClient";
  const historyKey = track === "agent" ? "statusHistoryAgent" : "statusHistoryClient";
  const currentStatus = String(existing[statusKey] ?? existing.statusClient ?? existing.status ?? "quotation_prepared");

  if (currentStatus === "completed") return null;

  const tracking = (policyRow?.documentTracking ?? {}) as Record<string, { status?: string } | undefined>;

  const hasTrackingMatch = (keyword: string, docStatus: string): boolean => {
    for (const [key, entry] of Object.entries(tracking)) {
      if (key.startsWith("_")) continue;
      if (key.toLowerCase().includes(keyword) && entry?.status === docStatus) return true;
    }
    return false;
  };

  const [verifiedPaymentDocs, accountingPaymentsResult] = await Promise.all([
    db
      .select({ paymentMeta: policyDocuments.paymentMeta })
      .from(policyDocuments)
      .where(and(
        eq(policyDocuments.policyId, policyId),
        eq(policyDocuments.status, "verified"),
      ))
      .limit(50),
    db.execute(sql`
      SELECT count(DISTINCT ap.id)::int AS cnt
      FROM accounting_payments ap
      JOIN accounting_invoices ai ON ai.id = ap.invoice_id
      JOIN accounting_invoice_items aii ON aii.invoice_id = ai.id
      WHERE aii.policy_id = ${policyId}
        AND ai.direction = 'receivable'
        AND coalesce(ap.payer, 'client') <> 'agent'
        AND ap.status IN ('recorded', 'verified', 'confirmed', 'submitted')
    `),
  ]);

  const hasVerifiedPaymentProof = verifiedPaymentDocs.some((d) => {
    const meta = d.paymentMeta as { amountCents?: number } | null;
    return meta && meta.amountCents && meta.amountCents > 0;
  });

  const hasAccountingPayments = extractCount(accountingPaymentsResult) > 0;

  const hasReceiptSent = hasTrackingMatch("receipt", "sent");
  const hasInvoiceSent = hasTrackingMatch("invoice", "sent") || hasTrackingMatch("debit", "sent");
  const hasQuotationConfirmed = hasTrackingMatch("quotation", "confirmed");
  const hasQuotationSent = hasTrackingMatch("quotation", "sent");

  let correctStatus: PolicyStatusKey = "quotation_prepared";
  if (hasVerifiedPaymentProof || hasReceiptSent || hasAccountingPayments) {
    correctStatus = "payment_received";
  } else if (hasInvoiceSent) {
    correctStatus = "invoice_sent";
  } else if (hasQuotationConfirmed) {
    correctStatus = "invoice_prepared"; // auto-chain: confirmed → invoice_prepared
  } else if (hasQuotationSent) {
    correctStatus = "quotation_sent";
  }

  if (correctStatus === currentStatus) return null;

  const historyArr = Array.isArray(existing[historyKey])
    ? [...(existing[historyKey] as unknown[])]
    : Array.isArray(existing.statusHistory)
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
    [statusKey]: correctStatus,
    [historyKey]: historyArr,
    _lastEditedAt: new Date().toISOString(),
  };
  if (track === "client") {
    updated.status = correctStatus;
    updated.statusHistory = historyArr;
  }

  await db.update(cars).set({ extraAttributes: updated }).where(eq(cars.id, carRow.id));
  return correctStatus;
}

/**
 * Agent-track status progression (separate from STATUS_ORDER which is client-track).
 * These are not enforced as strictly as STATUS_ORDER; they flow freely
 * based on commission/payment state.
 */
const AGENT_COMMISSION_STATUSES = [
  "commission_pending",
  "statement_created",
  "statement_sent",
  "statement_confirmed",
  "commission_settled",
] as const;

/**
 * Sync BOTH client and agent status tracks based on actual payment state.
 * Called after recording, verifying, rejecting, or deleting a payment.
 *
 * Client track:
 *   - Has active client payments → advance to `payment_received`
 *   - No active client payments  → recalculate from document tracking
 *
 * Agent track:
 *   - Verified/confirmed agent payment → advance to `commission_settled`
 *   - Commission payable exists but not paid → keep at commission_pending/statement_created
 *   - No commission payable, no payments  → recalculate from document tracking
 */
export async function syncPolicyStatusFromPayments(
  policyId: number,
  changedBy: string,
): Promise<{ client: string | null; agent: string | null }> {
  // --- Client track ---
  const clientPayments = await db.execute(sql`
    SELECT count(DISTINCT ap.id)::int AS cnt
    FROM accounting_payments ap
    JOIN accounting_invoices ai ON ai.id = ap.invoice_id
    JOIN accounting_invoice_items aii ON aii.invoice_id = ai.id
    WHERE aii.policy_id = ${policyId}
      AND ai.direction = 'receivable'
      AND coalesce(ap.payer, 'client') <> 'agent'
      AND ap.status IN ('recorded', 'verified', 'confirmed', 'submitted')
  `);
  const clientPaymentCount = extractCount(clientPayments);

  let clientResult: string | null = null;
  if (clientPaymentCount > 0) {
    clientResult = await advancePolicyStatus(
      policyId, "payment_received", changedBy,
      "Auto: client payment recorded", "client",
    );
  } else {
    clientResult = await recalculatePolicyStatus(
      policyId, changedBy, "payment removed", "client",
    );
  }

  // --- Agent track ---
  const agentVerified = await db.execute(sql`
    SELECT count(DISTINCT ap.id)::int AS cnt
    FROM accounting_payments ap
    JOIN accounting_invoices ai ON ai.id = ap.invoice_id
    JOIN accounting_invoice_items aii ON aii.invoice_id = ai.id
    WHERE aii.policy_id = ${policyId}
      AND ap.payer = 'agent'
      AND ap.status IN ('verified', 'confirmed')
  `);
  const agentVerifiedCount = extractCount(agentVerified);

  let agentResult: string | null = null;
  if (agentVerifiedCount > 0) {
    agentResult = await advancePolicyStatus(
      policyId, "commission_settled", changedBy,
      "Auto: agent payment verified", "agent",
    );
  } else {
    const commPayable = await db.execute(sql`
      SELECT ai.schedule_id
      FROM accounting_invoices ai
      JOIN accounting_invoice_items aii ON aii.invoice_id = ai.id
      WHERE aii.policy_id = ${policyId}
        AND ai.direction = 'payable'
        AND ai.entity_type = 'agent'
        AND ai.status <> 'cancelled'
        AND (
          coalesce(aii.description, '') ILIKE 'Commission:%'
          OR lower(coalesce(ai.notes, '')) LIKE 'agent commission%'
        )
      LIMIT 1
    `);
    const commRows = Array.isArray(commPayable)
      ? commPayable
      : (commPayable as { rows?: unknown[] }).rows ?? [];

    if (commRows.length > 0) {
      // Commission payable still exists — don't rollback, keep current agent status
      // (createAgentCommissionPayable already set commission_pending/statement_created)
    } else {
      // No commission payable and no agent payments → rollback agent track
      agentResult = await recalculatePolicyStatus(
        policyId, changedBy, "commission removed", "agent",
      );
    }
  }

  return { client: clientResult, agent: agentResult };
}

export { STATUS_ORDER, AGENT_COMMISSION_STATUSES };

// ─────────────────────────────────────────────────────────────────
// Shared "auto-advance from a tracking action" helper.
//
// Originally lived inside `app/api/policies/[id]/document-tracking/
// route.ts` as a private function. Lifted out here so the same
// rules apply when the policy status changes via OTHER paths too —
// notably `/api/sign/[token]/submit` which flips a tracking row to
// `confirmed` when the recipient signs online.
//
// Keep this in lock-step with the route's behaviour: anything that
// "confirms" / "sends" a quotation/invoice/receipt should drive
// the same status transitions, regardless of whether it came from
// admin-confirm, upload-confirm, or online-signature confirm.
// ─────────────────────────────────────────────────────────────────

const DOC_ACTION_TO_STATUS: Record<string, Record<string, string>> = {
  quotation: { prepare: "quotation_prepared", send: "quotation_sent", confirm: "quotation_confirmed" },
  invoice: { prepare: "invoice_prepared", send: "invoice_sent" },
  receipt: { send: "payment_received" },
};

const ACTION_NOTE_LABELS: Record<string, string> = {
  prepare: "prepared",
  send: "sent",
  confirm: "confirmed",
};

/**
 * Resolve which `STATUS_ORDER` entry a given (docType, action,
 * templateType) should advance the policy to, then call
 * `advancePolicyStatus` with it. Returns the new status, or null
 * if no advance was needed (action irrelevant, or current status
 * already past the target).
 *
 * `templateType` takes priority over the docType keyword scan so
 * a custom template named e.g. "client_quote" can still map onto
 * the quotation status chain by setting templateType = "quotation".
 */
export async function autoAdvanceFromTrackingAction(input: {
  policyId: number;
  docType: string;
  action: "prepare" | "send" | "confirm" | string;
  changedBy: string;
  templateType?: string;
  track?: PolicyStatusTrack;
}): Promise<string | null> {
  const { policyId, docType, action, changedBy, templateType, track = "client" } = input;
  if (action !== "send" && action !== "confirm" && action !== "prepare") return null;

  let targetStatus: string | null = null;
  if (templateType && DOC_ACTION_TO_STATUS[templateType]?.[action]) {
    targetStatus = DOC_ACTION_TO_STATUS[templateType][action];
  } else {
    const docLower = docType.toLowerCase();
    for (const [keyword, mapping] of Object.entries(DOC_ACTION_TO_STATUS)) {
      if (docLower.includes(keyword) && mapping[action]) {
        targetStatus = mapping[action];
        break;
      }
    }
  }
  if (!targetStatus) return null;

  const noteLabel = ACTION_NOTE_LABELS[action] ?? action;
  return advancePolicyStatus(
    policyId,
    targetStatus,
    changedBy,
    `Auto: ${docType.replace(/_/g, " ")} ${noteLabel}`,
    track,
  );
}

/**
 * Quick check used by callers that need to know whether a tracking
 * key targets the agent track (e.g. `motor_insurance_quotation_agent`)
 * vs the client track. Centralised here so the logic doesn't drift
 * across the tracking route, sign route, and any future caller.
 */
export function isAgentTrackingDocType(docType: string): boolean {
  return docType.toLowerCase().endsWith("_agent");
}
