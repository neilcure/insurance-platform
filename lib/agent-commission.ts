import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { users } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { generateDocumentNumber } from "@/lib/document-number";

/**
 * When a client pays the Client Premium directly, the agent earns a commission
 * of (Client Premium - Agent Premium). This function creates a PAYABLE invoice
 * to the agent for that commission amount.
 *
 * Only creates if:
 *  - Policy has an agent
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
      agentId: policies.agentId,
      policyNumber: policies.policyNumber,
      organisationId: policies.organisationId,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!policy?.agentId || !policy.organisationId) return;

  // Check if commission payable already exists
  const existing = await db
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
      ),
    )
    .limit(1);

  if (existing.length > 0) return;

  const premiums = await db
    .select()
    .from(policyPremiums)
    .where(eq(policyPremiums.policyId, policyId));

  if (premiums.length === 0) return;

  const accountingFields = await loadAccountingFields();

  function resolveRaw(p: typeof premiums[number], role: "client" | "agent"): number {
    const row = p as Record<string, unknown>;
    for (const f of accountingFields) {
      if (!f.premiumColumn) continue;
      if (f.label.toLowerCase().includes(role)) {
        return (row[f.premiumColumn] as number) ?? 0;
      }
    }
    if (role === "client") return p.grossPremiumCents ?? 0;
    return 0;
  }

  let totalCommissionCents = 0;
  const items: Array<{
    policyPremiumId: number;
    lineKey: string;
    amountCents: number;
    description: string;
  }> = [];

  for (const p of premiums) {
    const clientAmt = resolveRaw(p, "client");
    const agentAmt = resolveRaw(p, "agent");
    const commission = clientAmt - agentAmt;
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

  const [agent] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, policy.agentId))
    .limit(1);

  const agentName = agent?.name || agent?.email || null;
  const invoiceNumber = await generateDocumentNumber("AP");

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
        entityName: agentName,
        totalAmountCents: totalCommissionCents,
        paidAmountCents: 0,
        currency: premiums[0]?.currency ?? "HKD",
        invoiceDate: new Date().toISOString().split("T")[0],
        status: "pending",
        notes: `Agent commission · ${policy.policyNumber}`,
        createdBy: userId,
      })
      .returning();

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
}
