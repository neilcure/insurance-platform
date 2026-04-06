import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems, accountingPaymentSchedules } from "@/db/schema/accounting";
import { memberships, organisations, clients, users } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { syncPremiumSnapshotToTable } from "@/lib/sync-premiums";
import { generateDocumentNumber } from "@/lib/document-number";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import { resolveDocPrefix } from "@/lib/resolve-prefix";

export async function autoCreateAccountingInvoices(policyId: number, docType: string, userId: number, documentNumber?: string, templateType?: string) {
  try {
    await syncPremiumSnapshotToTable(policyId, userId);
  } catch { /* non-fatal */ }

  const premiums = await db
    .select()
    .from(policyPremiums)
    .where(eq(policyPremiums.policyId, policyId));

  if (premiums.length === 0) return;

  const [policy] = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      organisationId: policies.organisationId,
      clientId: policies.clientId,
      agentId: policies.agentId,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!policy) return;

  // Endorsements may not have their own agentId — inherit from parent policy
  let effectiveAgentId = policy.agentId;
  if (!effectiveAgentId) {
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
        if (parent?.agentId) effectiveAgentId = parent.agentId;
      }
    } catch { /* non-fatal */ }
  }

  let organisationId = policy.organisationId;
  if (!organisationId) {
    const [mem] = await db
      .select({ orgId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1);
    organisationId = mem?.orgId ?? null;
    if (!organisationId) {
      const [org] = await db.select({ id: organisations.id }).from(organisations).limit(1);
      organisationId = org?.id ?? null;
    }
  }
  if (!organisationId) return;

  const isReceipt = templateType ? templateType === "receipt" : docType.includes("receipt");
  const accountingFields = await loadAccountingFields();

  function computeGain(p: typeof premiums[number]): number {
    const row = p as Record<string, unknown>;
    const client = resolvePremiumByRole(row, "client", accountingFields);
    const net = resolvePremiumByRole(row, "net", accountingFields);
    const agent = resolvePremiumByRole(row, "agent", accountingFields);
    return agent > 0 ? agent - net : client - net;
  }

  // When the client has an active payment schedule, invoices are created
  // through the document template flow (quotation → confirm → invoice) with
  // proper document numbers — not here with auto-generated numbers.
  if (policy.clientId) {
    const scheduleRows = await db
      .select({ id: accountingPaymentSchedules.id })
      .from(accountingPaymentSchedules)
      .where(
        and(
          eq(accountingPaymentSchedules.organisationId, organisationId),
          eq(accountingPaymentSchedules.entityType, "client"),
          eq(accountingPaymentSchedules.clientId, policy.clientId),
          eq(accountingPaymentSchedules.isActive, true),
        ),
      )
      .limit(1);
    if (scheduleRows.length > 0 && !documentNumber) return;
  }

  const hasAgent = !!effectiveAgentId;
  // With agent: admin collects agentPremium (net) from agent; agent keeps commission
  // Without agent: admin collects clientPremium directly from client
  const receivableRole = hasAgent ? "agent" : "client";

  const eligiblePremiums = premiums.filter((p) => resolvePremiumByRole(p as Record<string, unknown>, receivableRole, accountingFields) > 0);
  if (eligiblePremiums.length === 0) return;

  let clientName: string | null = null;
  if (policy.clientId) {
    const [c] = await db
      .select({ displayName: clients.displayName })
      .from(clients)
      .where(eq(clients.id, policy.clientId))
      .limit(1);
    clientName = c?.displayName ?? null;
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

  const isTpoWithOd =
    premiums.length >= 2 &&
    premiums.some((p) => p.lineKey.toLowerCase() === "tpo") &&
    premiums.some((p) => {
      const k = p.lineKey.toLowerCase();
      return k.includes("own_vehicle") || k.includes("owndamage");
    });

  const entityName = clientName || agentName;

  if (isTpoWithOd) {
    for (let i = 0; i < eligiblePremiums.length; i++) {
      const premium = eligiblePremiums[i];
      const suffix = String.fromCharCode(97 + i);
      const suffixedPolicyNo = `${policy.policyNumber}(${suffix})`;
      const amountCents = resolvePremiumByRole(premium as Record<string, unknown>, receivableRole, accountingFields);
      const invPrefix = documentNumber ? null : await resolveDocPrefix("invoice", "INV");
      const invoiceNumber = documentNumber
        ? `${documentNumber}(${suffix})`
        : await generateDocumentNumber(invPrefix!);

      await db.transaction(async (tx) => {
        // Advisory lock scoped to transaction prevents concurrent creation
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${policyId})`);

        const [existing] = await tx
          .select({ id: accountingInvoices.id, invoiceNumber: accountingInvoices.invoiceNumber })
          .from(accountingInvoices)
          .innerJoin(accountingInvoiceItems, eq(accountingInvoiceItems.invoiceId, accountingInvoices.id))
          .where(
            and(
              eq(accountingInvoiceItems.policyId, policyId),
              eq(accountingInvoices.direction, "receivable"),
              sql`${accountingInvoices.status} <> 'cancelled'`,
            ),
          )
          .limit(1);
        if (existing) {
          if (documentNumber && existing.invoiceNumber !== invoiceNumber) {
            await tx.update(accountingInvoices)
              .set({ invoiceNumber })
              .where(eq(accountingInvoices.id, existing.id));
          }
          return;
        }

        const [invoice] = await tx
          .insert(accountingInvoices)
          .values({
            organisationId,
            invoiceNumber,
            invoiceType: "individual",
            direction: "receivable",
            premiumType: hasAgent ? "agent_premium" : "client_premium",
            entityPolicyId: policyId,
            entityType: hasAgent ? "agent" : "client",
            entityName: hasAgent ? (agentName || entityName) : entityName,
            totalAmountCents: amountCents,
            paidAmountCents: 0,
            currency: premium.currency ?? "HKD",
            invoiceDate: new Date().toISOString().split("T")[0],
            status: isReceipt ? "paid" : "pending",
            notes: `Policy ${suffixedPolicyNo} – ${premium.lineLabel || premium.lineKey}`,
            createdBy: userId,
          })
          .returning();

        await tx.insert(accountingInvoiceItems).values({
          invoiceId: invoice.id,
          policyId,
          policyPremiumId: premium.id,
          lineKey: premium.lineKey,
          amountCents,
          gainCents: computeGain(premium),
          description: `${premium.lineLabel || premium.lineKey} [${suffixedPolicyNo}]`,
        });
      });
    }
    return;
  }

  // Standard case: one invoice for total Client Premium
  let totalAmountCents = 0;
  const items: Array<{
    policyId: number;
    policyPremiumId: number;
    lineKey: string;
    amountCents: number;
    gainCents: number;
    description: string;
  }> = [];

  for (const premium of eligiblePremiums) {
    const amountCents = resolvePremiumByRole(premium as Record<string, unknown>, receivableRole, accountingFields);
    totalAmountCents += amountCents;
    items.push({
      policyId,
      policyPremiumId: premium.id,
      lineKey: premium.lineKey,
      amountCents,
      gainCents: computeGain(premium),
      description: premium.lineLabel || premium.lineKey,
    });
  }

  const invoiceNumber = documentNumber ?? await generateDocumentNumber(await resolveDocPrefix("invoice", "INV"));

  await db.transaction(async (tx) => {
    // Advisory lock scoped to transaction prevents concurrent creation
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${policyId})`);

    const [existing] = await tx
      .select({ id: accountingInvoices.id, invoiceNumber: accountingInvoices.invoiceNumber })
      .from(accountingInvoices)
      .innerJoin(accountingInvoiceItems, eq(accountingInvoiceItems.invoiceId, accountingInvoices.id))
      .where(
        and(
          eq(accountingInvoiceItems.policyId, policyId),
          eq(accountingInvoices.direction, "receivable"),
          sql`${accountingInvoices.status} <> 'cancelled'`,
        ),
      )
      .limit(1);
    if (existing) {
      if (documentNumber && existing.invoiceNumber !== invoiceNumber) {
        await tx.update(accountingInvoices)
          .set({ invoiceNumber })
          .where(eq(accountingInvoices.id, existing.id));
      }
      return;
    }

    const [invoice] = await tx
      .insert(accountingInvoices)
      .values({
        organisationId,
        invoiceNumber,
        invoiceType: "individual",
        direction: "receivable",
        premiumType: hasAgent ? "agent_premium" : "client_premium",
        entityPolicyId: policyId,
        entityType: hasAgent ? "agent" : "client",
        entityName: hasAgent ? (agentName || entityName) : entityName,
        totalAmountCents,
        paidAmountCents: 0,
        currency: premiums[0]?.currency ?? "HKD",
        invoiceDate: new Date().toISOString().split("T")[0],
        status: isReceipt ? "paid" : "pending",
        notes: hasAgent
          ? `Agent Premium · Agent: ${agentName || "—"}`
          : `Client Premium`,
        createdBy: userId,
      })
      .returning();

    await tx.insert(accountingInvoiceItems).values(
      items.map((item) => ({
        invoiceId: invoice.id,
        policyId: item.policyId,
        policyPremiumId: item.policyPremiumId,
        lineKey: item.lineKey,
        amountCents: item.amountCents,
        gainCents: item.gainCents,
        description: item.description,
      })),
    );
  });
}
