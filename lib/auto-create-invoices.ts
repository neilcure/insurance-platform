import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems, accountingPaymentSchedules } from "@/db/schema/accounting";
import { memberships, organisations, clients, users } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { syncPremiumSnapshotToTable } from "@/lib/sync-premiums";
import { generateDocumentNumber } from "@/lib/document-number";

export async function autoCreateAccountingInvoices(policyId: number, docType: string, userId: number) {
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

  const isReceipt = docType.includes("receipt");
  const accountingFields = await loadAccountingFields();

  function resolveRawPremium(
    p: typeof premiums[number],
    role: "client" | "agent" | "net",
  ): number {
    const row = p as Record<string, unknown>;
    for (const f of accountingFields) {
      if (!f.premiumColumn) continue;
      const label = f.label.toLowerCase();
      if (label.includes(role)) {
        return (row[f.premiumColumn] as number) ?? 0;
      }
    }
    if (role === "client") return p.grossPremiumCents ?? 0;
    return 0;
  }

  function computeGain(p: typeof premiums[number]): number {
    const client = resolveRawPremium(p, "client");
    const net = resolveRawPremium(p, "net");
    const agent = resolveRawPremium(p, "agent");
    return agent > 0 ? agent - net : client - net;
  }

  // Check if a receivable invoice already exists for this policy
  const existingInvoice = await db
    .select({ id: accountingInvoices.id })
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

  if (existingInvoice.length > 0) return;

  // Check if there's an active payment schedule for the client
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
    if (scheduleRows.length > 0) return;
  }

  // Total receivable = Client Premium
  // This is the total amount the company expects to receive for this policy.
  // Payment can come from client, agent, or both.
  const clientPremiumPremiums = premiums.filter((p) => resolveRawPremium(p, "client") > 0);
  if (clientPremiumPremiums.length === 0) return;

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
  if (policy.agentId) {
    const [a] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, policy.agentId))
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
    for (let i = 0; i < clientPremiumPremiums.length; i++) {
      const premium = clientPremiumPremiums[i];
      const suffix = String.fromCharCode(97 + i);
      const suffixedPolicyNo = `${policy.policyNumber}(${suffix})`;
      const amountCents = resolveRawPremium(premium, "client");
      const invoiceNumber = await generateDocumentNumber("AR");

      await db.transaction(async (tx) => {
        const [invoice] = await tx
          .insert(accountingInvoices)
          .values({
            organisationId,
            invoiceNumber,
            invoiceType: "individual",
            direction: "receivable",
            premiumType: "client_premium",
            entityPolicyId: policyId,
            entityType: "client",
            entityName,
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

  for (const premium of clientPremiumPremiums) {
    const amountCents = resolveRawPremium(premium, "client");
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

  const invoiceNumber = await generateDocumentNumber("AR");

  await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(accountingInvoices)
      .values({
        organisationId,
        invoiceNumber,
        invoiceType: "individual",
        direction: "receivable",
        premiumType: "client_premium",
        entityPolicyId: policyId,
        entityType: "client",
        entityName,
        totalAmountCents,
        paidAmountCents: 0,
        currency: premiums[0]?.currency ?? "HKD",
        invoiceDate: new Date().toISOString().split("T")[0],
        status: isReceipt ? "paid" : "pending",
        notes: policy.agentId
          ? `Client Premium · Agent: ${agentName || "—"}`
          : `Auto-created (${docType})`,
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
