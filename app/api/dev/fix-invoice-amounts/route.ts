import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { users } from "@/db/schema/core";
import { eq, and, sql, inArray } from "drizzle-orm";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import { syncInvoicePaymentStatus } from "@/lib/accounting-invoices";

export const dynamic = "force-dynamic";

async function resolveEffectiveAgentId(policyId: number, directAgentId: number | null): Promise<number | null> {
  if (directAgentId) return directAgentId;
  try {
    const [carRow] = await db
      .select({ extraAttributes: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, policyId))
      .limit(1);
    const linkedPolicyId = (carRow?.extraAttributes as Record<string, unknown> | null)?.linkedPolicyId;
    if (linkedPolicyId && Number(linkedPolicyId) > 0) {
      const [parent] = await db
        .select({ agentId: policies.agentId })
        .from(policies)
        .where(eq(policies.id, Number(linkedPolicyId)))
        .limit(1);
      if (parent?.agentId) return parent.agentId;
    }
  } catch { /* non-fatal */ }
  return null;
}

export async function POST() {
  const accountingFields = await loadAccountingFields();
  const details: string[] = [];
  let fixed = 0;

  const allItems = await db
    .select({
      invoiceId: accountingInvoiceItems.invoiceId,
      policyId: accountingInvoiceItems.policyId,
      policyPremiumId: accountingInvoiceItems.policyPremiumId,
    })
    .from(accountingInvoiceItems);

  const invoiceIds = [...new Set(allItems.map((r) => r.invoiceId))];
  if (invoiceIds.length === 0) return NextResponse.json({ ok: true, fixed: 0, details });

  const invoiceRows = await db
    .select()
    .from(accountingInvoices)
    .where(and(
      inArray(accountingInvoices.id, invoiceIds),
      eq(accountingInvoices.direction, "receivable"),
      sql`${accountingInvoices.invoiceType} = 'individual'`,
      sql`${accountingInvoices.status} <> 'cancelled'`,
    ));

  for (const inv of invoiceRows) {
    const items = allItems.filter((i) => i.invoiceId === inv.id);
    if (items.length === 0) continue;

    const policyId = items[0].policyId;
    const [policy] = await db
      .select({ agentId: policies.agentId, policyNumber: policies.policyNumber })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);
    if (!policy) continue;

    const effectiveAgentId = await resolveEffectiveAgentId(policyId, policy.agentId);
    const hasAgent = !!effectiveAgentId;
    const receivableRole = hasAgent ? "agent" : "client";

    const premiums = await db
      .select()
      .from(policyPremiums)
      .where(eq(policyPremiums.policyId, policyId));

    let correctTotal = 0;
    for (const item of items) {
      const premium = premiums.find((p) => p.id === item.policyPremiumId);
      if (!premium) continue;
      correctTotal += resolvePremiumByRole(premium as Record<string, unknown>, receivableRole, accountingFields);
    }

    const changes: string[] = [];

    if (inv.totalAmountCents !== correctTotal && correctTotal > 0) {
      changes.push(`amount: ${inv.totalAmountCents / 100} → ${correctTotal / 100}`);
    }

    const correctPremiumType = hasAgent ? "agent_premium" : "client_premium";
    if (inv.premiumType !== correctPremiumType) {
      changes.push(`premiumType: ${inv.premiumType} → ${correctPremiumType}`);
    }

    const correctEntityType = hasAgent ? "agent" : "client";
    if (inv.entityType !== correctEntityType) {
      changes.push(`entityType: ${inv.entityType} → ${correctEntityType}`);
    }

    let agentName: string | null = null;
    if (effectiveAgentId) {
      const [a] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, effectiveAgentId))
        .limit(1);
      agentName = a?.name || a?.email || null;
    }

    const correctNotes = hasAgent
      ? `Agent Premium · Agent: ${agentName || "—"}`
      : `Client Premium`;
    if (inv.notes !== correctNotes) {
      changes.push(`notes: "${inv.notes}" → "${correctNotes}"`);
    }

    if (changes.length > 0) {
      await db
        .update(accountingInvoices)
        .set({
          totalAmountCents: correctTotal > 0 ? correctTotal : inv.totalAmountCents,
          premiumType: correctPremiumType,
          entityType: correctEntityType,
          notes: correctNotes,
          ...(hasAgent && agentName ? { entityName: agentName } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(accountingInvoices.id, inv.id));

      await syncInvoicePaymentStatus(inv.id);
      fixed++;
      details.push(`Invoice #${inv.id} (${inv.invoiceNumber}) for policy ${policyId}: ${changes.join(", ")}`);
    }
  }

  return NextResponse.json({ ok: true, fixed, details });
}
