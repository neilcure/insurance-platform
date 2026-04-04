import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { users } from "@/db/schema/core";
import { eq, and, sql, inArray } from "drizzle-orm";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole, resolvePolicyPremiumSummary } from "@/lib/resolve-policy-agent";
import { syncInvoicePaymentStatus } from "@/lib/accounting-invoices";

export const dynamic = "force-dynamic";

export async function POST() {
  const results: string[] = [];

  // Step 1: Add agentPremiumCents column if it doesn't exist
  await db.execute(sql`
    ALTER TABLE "policy_premiums"
    ADD COLUMN IF NOT EXISTS "agent_premium_cents" integer
  `);
  results.push("Step 1: ensured agent_premium_cents column exists");

  // Step 2: Move data — rows where agentCommissionCents has data but agentPremiumCents doesn't
  // The "Agent Premium" field was mapped to agentCommissionCents by mistake
  const moveResult = await db.execute(sql`
    UPDATE "policy_premiums"
    SET "agent_premium_cents" = "agent_commission_cents",
        "agent_commission_cents" = NULL
    WHERE "agent_commission_cents" IS NOT NULL
      AND ("agent_premium_cents" IS NULL OR "agent_premium_cents" = 0)
  `);
  results.push(`Step 2: moved agent premium data from agent_commission_cents → agent_premium_cents`);

  // Step 3: Fix the field mapping — change "Agent Premium" field from agentCommissionCents → agentPremiumCents
  const fields = await db
    .select({ id: formOptions.id, label: formOptions.label, value: formOptions.value, meta: formOptions.meta })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, "premiumRecord_fields"), eq(formOptions.isActive, true)));

  let fieldFixed = 0;
  for (const f of fields) {
    const meta = (f.meta ?? {}) as Record<string, unknown>;
    const col = typeof meta.premiumColumn === "string"
      ? meta.premiumColumn.replace(/^"|"$/g, "")
      : undefined;

    // Fix: field mapped to agentCommissionCents → remap to agentPremiumCents with role "agent"
    if (col === "agentCommissionCents") {
      await db
        .update(formOptions)
        .set({ meta: { ...meta, premiumColumn: "agentPremiumCents", premiumRole: "agent" } })
        .where(eq(formOptions.id, f.id));
      results.push(`Field "${f.label}" (${f.value}): premiumColumn agentCommissionCents → agentPremiumCents, premiumRole → "agent"`);
      fieldFixed++;
    }

    // Fix: grossPremiumCents should not duplicate "client" role if clientPremiumCents field exists
    if (col === "grossPremiumCents" && meta.premiumRole === "client") {
      const hasClientField = fields.some((other) => {
        const otherMeta = (other.meta ?? {}) as Record<string, unknown>;
        const otherCol = typeof otherMeta.premiumColumn === "string" ? otherMeta.premiumColumn.replace(/^"|"$/g, "") : undefined;
        return otherCol === "clientPremiumCents" && other.id !== f.id;
      });
      if (hasClientField) {
        await db
          .update(formOptions)
          .set({ meta: { ...meta, premiumRole: undefined } })
          .where(eq(formOptions.id, f.id));
        results.push(`Field "${f.label}": removed "client" role (clientPremiumCents field exists separately)`);
        fieldFixed++;
      }
    }

    // Ensure clientPremiumCents has role "client"
    if (col === "clientPremiumCents" && meta.premiumRole !== "client") {
      await db
        .update(formOptions)
        .set({ meta: { ...meta, premiumRole: "client" } })
        .where(eq(formOptions.id, f.id));
      results.push(`Field "${f.label}": set premiumRole → "client"`);
      fieldFixed++;
    }

    // Ensure netPremiumCents has role "net"
    if (col === "netPremiumCents" && meta.premiumRole !== "net") {
      await db
        .update(formOptions)
        .set({ meta: { ...meta, premiumRole: "net" } })
        .where(eq(formOptions.id, f.id));
      results.push(`Field "${f.label}": set premiumRole → "net"`);
      fieldFixed++;
    }
  }
  results.push(`Step 3: fixed ${fieldFixed} field mappings`);

  // Step 4: Re-sync all receivable invoices with correct amounts
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
      const summary = await resolvePolicyPremiumSummary(policyId);
      if (!summary) continue;

      const hasAgent = !!summary.agentId;
      const correctTotal = hasAgent ? summary.agentPremiumCents : summary.clientPremiumCents;
      const correctPremiumType = hasAgent ? "agent_premium" : "client_premium";
      const correctEntityType = hasAgent ? "agent" : "client";
      const correctNotes = hasAgent
        ? `Agent Premium · Agent: ${summary.agentName || "—"}`
        : `Client Premium`;

      const changes: string[] = [];
      if (inv.totalAmountCents !== correctTotal && correctTotal > 0) changes.push(`amount: ${inv.totalAmountCents / 100} → ${correctTotal / 100}`);
      if (inv.premiumType !== correctPremiumType) changes.push(`premiumType → ${correctPremiumType}`);
      if (inv.entityType !== correctEntityType) changes.push(`entityType → ${correctEntityType}`);

      await db
        .update(accountingInvoices)
        .set({
          totalAmountCents: correctTotal > 0 ? correctTotal : inv.totalAmountCents,
          premiumType: correctPremiumType,
          entityType: correctEntityType,
          notes: correctNotes,
          ...(hasAgent && summary.agentName ? { entityName: summary.agentName } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(accountingInvoices.id, inv.id));

      await syncInvoicePaymentStatus(inv.id);

      if (changes.length > 0) {
        invoiceFixed++;
        results.push(`Invoice #${inv.id} (${inv.invoiceNumber}): ${changes.join(", ")}`);
      }
    }
  }
  results.push(`Step 4: fixed ${invoiceFixed} invoices`);

  // Step 5: Sync ALL invoice statuses
  let statusFixed = 0;
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
        statusFixed++;
      }
    }
  }
  results.push(`Step 5: fixed status on ${statusFixed} invoices`);

  // Verify: show current premium summary
  const verifySummaries: Record<string, unknown>[] = [];
  for (const policyId of [343, 345]) {
    const s = await resolvePolicyPremiumSummary(policyId);
    if (s) {
      verifySummaries.push({
        policyId,
        clientPremiumCents: s.clientPremiumCents,
        agentPremiumCents: s.agentPremiumCents,
        commissionCents: s.commissionCents,
      });
    }
  }

  return NextResponse.json({ ok: true, fieldFixed, invoiceFixed, statusFixed, results, verify: verifySummaries });
}
