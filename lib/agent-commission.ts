import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems, accountingPaymentSchedules } from "@/db/schema/accounting";
import { and, eq, sql } from "drizzle-orm";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { generateDocumentNumber } from "@/lib/document-number";
import { resolvePolicyAgent, resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import { resolveDocPrefix } from "@/lib/resolve-prefix";

/**
 * When a client pays the Client Premium directly, the agent earns a commission
 * of (Client Premium - Agent Premium). This function creates a PAYABLE invoice
 * to the agent for that commission amount.
 *
 * Only creates if:
 *  - Policy has an agent (or parent policy has an agent for endorsements)
 *  - Client Premium > Agent Premium (commission > 0)
 *  - No existing agent commission payable for this policy
 */
export async function createAgentCommissionPayable(
  policyId: number,
  userId: number,
): Promise<void> {
  const [policy] = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      organisationId: policies.organisationId,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!policy || !policy.organisationId) return;

  const { agentId, agentName } = await resolvePolicyAgent(policyId);
  if (!agentId) return;

  const [existing, premiums, accountingFields] = await Promise.all([
    db
      .select({ id: accountingInvoices.id })
      .from(accountingInvoices)
      .innerJoin(accountingInvoiceItems, eq(accountingInvoiceItems.invoiceId, accountingInvoices.id))
      .where(
        and(
          eq(accountingInvoiceItems.policyId, policyId),
          eq(accountingInvoices.direction, "payable"),
          eq(accountingInvoices.entityType, "agent"),
          eq(accountingInvoices.premiumType, "agent_premium"),
          sql`${accountingInvoices.status} <> 'cancelled'`,
          sql`coalesce(${accountingInvoiceItems.description}, '') ilike 'Commission:%'`,
        ),
      )
      .limit(1),
    db.select().from(policyPremiums).where(eq(policyPremiums.policyId, policyId)),
    loadAccountingFields(),
  ]);

  if (existing.length > 0) return;
  if (premiums.length === 0) return;

  let totalCommissionCents = 0;
  const items: Array<{
    policyPremiumId: number;
    lineKey: string;
    amountCents: number;
    description: string;
  }> = [];

  for (const p of premiums) {
    const row = p as Record<string, unknown>;
    const explicitCommission = resolvePremiumByRole(row, "commission", accountingFields);
    const clientAmt = resolvePremiumByRole(row, "client", accountingFields);
    const agentAmt = resolvePremiumByRole(row, "agent", accountingFields);
    const fromDiff =
      clientAmt > 0 && agentAmt > 0 ? Math.max(clientAmt - agentAmt, 0) : 0;
    const commission = explicitCommission > 0 ? explicitCommission : fromDiff;
    if (commission > 0) {
      totalCommissionCents += commission;
      items.push({
        policyPremiumId: p.id,
        lineKey: p.lineKey,
        amountCents: commission,
        description: `Commission: ${p.lineLabel || p.lineKey}`,
      });
    }
  }

  if (totalCommissionCents <= 0 || items.length === 0) return;

  const invoiceNumber = await generateDocumentNumber(await resolveDocPrefix("payable", "AP"));

  const [agentSchedule] = await db
    .select({ id: accountingPaymentSchedules.id })
    .from(accountingPaymentSchedules)
    .where(
      and(
        eq(accountingPaymentSchedules.organisationId, policy.organisationId!),
        eq(accountingPaymentSchedules.entityType, "agent"),
        eq(accountingPaymentSchedules.agentId, agentId),
        eq(accountingPaymentSchedules.isActive, true),
      ),
    )
    .limit(1);

  let createdInvoiceId: number | undefined;

  await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(accountingInvoices)
      .values({
        organisationId: policy.organisationId!,
        invoiceNumber,
        invoiceType: "individual",
        direction: "payable",
        premiumType: "agent_premium",
        entityPolicyId: policyId,
        entityType: "agent",
        entityName: agentName ?? null,
        scheduleId: agentSchedule?.id ?? null,
        totalAmountCents: totalCommissionCents,
        paidAmountCents: 0,
        currency: premiums[0]?.currency ?? "HKD",
        invoiceDate: new Date().toISOString().split("T")[0],
        status: agentSchedule ? "statement_created" : "pending",
        notes: `Agent commission · ${policy.policyNumber}`,
        createdBy: userId,
      })
      .returning();

    createdInvoiceId = invoice.id;

    await tx.insert(accountingInvoiceItems).values(
      items.map((item) => ({
        invoiceId: invoice.id,
        policyId,
        policyPremiumId: item.policyPremiumId,
        lineKey: item.lineKey,
        amountCents: item.amountCents,
        gainCents: 0,
        description: item.description,
      })),
    );
  });

  // Auto-add the commission payable to the agent's existing statement
  if (agentSchedule && createdInvoiceId) {
    try {
      const { addInvoiceToStatement, findOrCreateDraftStatement } = await import("@/lib/statement-management");
      const stmt = await findOrCreateDraftStatement(agentSchedule.id, userId);
      await addInvoiceToStatement(stmt.statementId, createdInvoiceId);
    } catch (stmtErr) {
      console.error("Auto-add commission to statement failed (non-fatal):", stmtErr);
    }

    // Also link the policy's receivable invoice to the same schedule so the
    // by-schedule API can include it as a "paid individually" line item.
    try {
      const receivableInvs = await db
        .select({ id: accountingInvoices.id })
        .from(accountingInvoices)
        .innerJoin(accountingInvoiceItems, eq(accountingInvoiceItems.invoiceId, accountingInvoices.id))
        .where(
          and(
            eq(accountingInvoiceItems.policyId, policyId),
            eq(accountingInvoices.invoiceType, "individual"),
            eq(accountingInvoices.direction, "receivable"),
            eq(accountingInvoices.entityType, "agent"),
            sql`${accountingInvoices.status} <> 'cancelled'`,
            sql`${accountingInvoices.scheduleId} IS NULL`,
          ),
        );
      for (const inv of receivableInvs) {
        await db
          .update(accountingInvoices)
          .set({ scheduleId: agentSchedule.id })
          .where(eq(accountingInvoices.id, inv.id));
      }
    } catch (linkErr) {
      console.error("Link receivable invoice to schedule failed (non-fatal):", linkErr);
    }
  }

  // Keep agent status track aligned with commission settlement lifecycle.
  try {
    const { advancePolicyStatus } = await import("@/lib/auto-advance-status");
    await advancePolicyStatus(
      policyId,
      agentSchedule ? "statement_created" : "commission_pending",
      `user:${userId}`,
      "Auto: agent commission payable created",
      "agent",
    );
  } catch {
    // non-fatal
  }
}

/**
 * Remove commission payable invoices for a policy.
 * Used when the payer changes from "client" to "agent" or when a
 * client-direct payment is rejected/removed — the commission is no
 * longer applicable.
 *
 * Also removes copied commission items from the agent's statement invoice
 * so they don't appear as stale data.
 */
export async function removeAgentCommissionPayable(
  policyId: number,
): Promise<number> {
  const commissionInvoices = await db
    .select({ id: accountingInvoices.id, scheduleId: accountingInvoices.scheduleId })
    .from(accountingInvoices)
    .innerJoin(accountingInvoiceItems, eq(accountingInvoiceItems.invoiceId, accountingInvoices.id))
    .where(
      and(
        eq(accountingInvoiceItems.policyId, policyId),
        eq(accountingInvoices.direction, "payable"),
        eq(accountingInvoices.entityType, "agent"),
        sql`${accountingInvoices.status} <> 'cancelled'`,
        sql`(
          coalesce(${accountingInvoiceItems.description}, '') ilike 'Commission:%'
          OR lower(coalesce(${accountingInvoices.notes}, '')) like 'agent commission%'
        )`,
      ),
    );

  if (commissionInvoices.length === 0) return 0;

  const invoiceIds = [...new Set(commissionInvoices.map((r) => r.id))];
  const scheduleIds = [...new Set(
    commissionInvoices.map((r) => r.scheduleId).filter((s): s is number => s != null),
  )];

  // Remove commission items copied to the statement invoice(s) for this policy
  if (scheduleIds.length > 0) {
    const stmtInvoices = await db
      .select({ id: accountingInvoices.id })
      .from(accountingInvoices)
      .where(
        and(
          sql`${accountingInvoices.scheduleId} IN (${sql.join(scheduleIds.map((s) => sql`${s}`), sql`,`)})`,
          eq(accountingInvoices.invoiceType, "statement"),
          sql`${accountingInvoices.status} <> 'cancelled'`,
        ),
      );

    for (const si of stmtInvoices) {
      await db.delete(accountingInvoiceItems).where(
        and(
          eq(accountingInvoiceItems.invoiceId, si.id),
          eq(accountingInvoiceItems.policyId, policyId),
          sql`(
            lower(coalesce(${accountingInvoiceItems.description}, '')) like 'commission:%'
            OR lower(coalesce(${accountingInvoiceItems.description}, '')) like 'credit:%'
          )`,
        ),
      );
    }
  }

  for (const invId of invoiceIds) {
    await db.delete(accountingInvoiceItems).where(eq(accountingInvoiceItems.invoiceId, invId));
    await db.delete(accountingInvoices).where(eq(accountingInvoices.id, invId));
  }

  return invoiceIds.length;
}
