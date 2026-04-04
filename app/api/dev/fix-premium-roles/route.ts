import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { cars, policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { users } from "@/db/schema/core";
import { eq, and, sql, inArray } from "drizzle-orm";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import { syncInvoicePaymentStatus } from "@/lib/accounting-invoices";

export const dynamic = "force-dynamic";

const CORRECT_COLUMN_ROLES: Record<string, string> = {
  clientPremiumCents: "client",
  netPremiumCents: "net",
  agentPremiumCents: "agent",
  agentCommissionCents: "commission",
};

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
  const results: string[] = [];

  // ── Step 1: Fix premiumRole on accounting fields ──
  const fields = await db
    .select({ id: formOptions.id, label: formOptions.label, meta: formOptions.meta })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, "premiumRecord_fields"), eq(formOptions.isActive, true)));

  let roleFixed = 0;
  for (const f of fields) {
    const meta = (f.meta ?? {}) as Record<string, unknown>;
    const col = typeof meta.premiumColumn === "string"
      ? meta.premiumColumn.replace(/^"|"$/g, "")
      : undefined;
    if (!col) continue;

    const correctRole = CORRECT_COLUMN_ROLES[col];
    if (!correctRole) continue;

    const currentRole = meta.premiumRole as string | undefined;
    if (currentRole === correctRole) continue;

    await db
      .update(formOptions)
      .set({ meta: { ...meta, premiumRole: correctRole } })
      .where(eq(formOptions.id, f.id));
    results.push(`Field "${f.label}" (col=${col}): premiumRole "${currentRole || "(none)"}" → "${correctRole}"`);
    roleFixed++;
  }
  results.push(`--- Step 1: Fixed premiumRole on ${roleFixed} fields ---`);

  // ── Step 2: Re-sync invoice amounts using corrected roles ──
  const accountingFields = await loadAccountingFields();

  const allItems = await db
    .select({
      invoiceId: accountingInvoiceItems.invoiceId,
      policyId: accountingInvoiceItems.policyId,
      policyPremiumId: accountingInvoiceItems.policyPremiumId,
    })
    .from(accountingInvoiceItems);

  const invoiceIds = [...new Set(allItems.map((r) => r.invoiceId))];
  let invoiceFixed = 0;

  if (invoiceIds.length > 0) {
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

      const correctPremiumType = hasAgent ? "agent_premium" : "client_premium";
      const correctEntityType = hasAgent ? "agent" : "client";

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

      const changes: string[] = [];
      if (inv.totalAmountCents !== correctTotal && correctTotal > 0) {
        changes.push(`amount: ${inv.totalAmountCents / 100} → ${correctTotal / 100}`);
      }
      if (inv.premiumType !== correctPremiumType) changes.push(`premiumType: ${inv.premiumType} → ${correctPremiumType}`);
      if (inv.entityType !== correctEntityType) changes.push(`entityType: ${inv.entityType} → ${correctEntityType}`);
      if (inv.notes !== correctNotes) changes.push(`notes updated`);

      if (changes.length > 0 || true) {
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

        if (changes.length > 0) {
          invoiceFixed++;
          results.push(`Invoice #${inv.id} (${inv.invoiceNumber}): ${changes.join(", ")}`);
        }
      }
    }
  }
  results.push(`--- Step 2: Fixed ${invoiceFixed} invoices ---`);

  // ── Step 3: Re-sync all invoice statuses ──
  let statusSynced = 0;
  if (invoiceIds.length > 0) {
    const allInvoices = await db
      .select({ id: accountingInvoices.id, invoiceNumber: accountingInvoices.invoiceNumber, status: accountingInvoices.status })
      .from(accountingInvoices)
      .where(and(
        inArray(accountingInvoices.id, invoiceIds),
        sql`${accountingInvoices.status} <> 'cancelled'`,
      ));

    for (const inv of allInvoices) {
      const result = await syncInvoicePaymentStatus(inv.id);
      if (result && result.status !== inv.status) {
        results.push(`Invoice #${inv.id} (${inv.invoiceNumber}): status "${inv.status}" → "${result.status}"`);
        statusSynced++;
      }
    }
  }
  results.push(`--- Step 3: Synced status on ${statusSynced} invoices ---`);

  return NextResponse.json({ ok: true, roleFixed, invoiceFixed, statusSynced, results });
}
