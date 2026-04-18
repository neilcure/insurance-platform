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

  // After the sync, the premium rows and the policy row are independent reads — fan out.
  const [premiums, policyRows] = await Promise.all([
    db
      .select()
      .from(policyPremiums)
      .where(eq(policyPremiums.policyId, policyId)),
    db
      .select({
        id: policies.id,
        policyNumber: policies.policyNumber,
        organisationId: policies.organisationId,
        clientId: policies.clientId,
        agentId: policies.agentId,
      })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1),
  ]);

  if (premiums.length === 0) return;
  const policy = policyRows[0];
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

  const hasAgent = !!effectiveAgentId;

  // Client and agent schedule lookups are independent — fan out in parallel.
  // (Previously the client lookup was issued twice: once for the early-return
  // check below and once to populate `clientScheduleId`. We now do it once.)
  const [clientScheduleRow, agentScheduleRow] = await Promise.all([
    policy.clientId
      ? db
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
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    hasAgent
      ? db
          .select({ id: accountingPaymentSchedules.id })
          .from(accountingPaymentSchedules)
          .where(
            and(
              eq(accountingPaymentSchedules.organisationId, organisationId),
              eq(accountingPaymentSchedules.entityType, "agent"),
              eq(accountingPaymentSchedules.agentId, effectiveAgentId!),
              eq(accountingPaymentSchedules.isActive, true),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const clientScheduleId: number | null = clientScheduleRow?.id ?? null;
  const agentScheduleId: number | null = agentScheduleRow?.id ?? null;

  // When the client has an active payment schedule, invoices are created
  // through the document template flow (quotation → confirm → invoice) with
  // proper document numbers — not here with auto-generated numbers.
  if (policy.clientId && clientScheduleId && !documentNumber) return;

  // When line-specific rows exist (e.g. "tpo" + "own_vehicle_damage"),
  // ignore any phantom "main" row left over from snapshot sync.
  const nonMainPremiums = premiums.filter((p) => p.lineKey !== "main");
  const activePremiums = nonMainPremiums.length >= 2 ? nonMainPremiums : premiums;

  const clientEligiblePremiums = activePremiums.filter(
    (p) => resolvePremiumByRole(p as Record<string, unknown>, "client", accountingFields) > 0,
  );
  const agentEligiblePremiums = hasAgent
    ? activePremiums.filter((p) => resolvePremiumByRole(p as Record<string, unknown>, "agent", accountingFields) > 0)
    : [];
  const receivableRole: "client" | "agent" = clientEligiblePremiums.length > 0
    ? "client"
    : hasAgent && agentEligiblePremiums.length > 0
      ? "agent"
      : "client";
  const eligiblePremiums = receivableRole === "client" ? clientEligiblePremiums : agentEligiblePremiums;
  if (eligiblePremiums.length === 0) return;

  // Client display name and agent name are independent — fan out in parallel.
  const [clientNameRow, agentNameRow] = await Promise.all([
    policy.clientId
      ? db
          .select({ displayName: clients.displayName })
          .from(clients)
          .where(eq(clients.id, policy.clientId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    effectiveAgentId
      ? db
          .select({ name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, effectiveAgentId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const clientName: string | null = clientNameRow?.displayName ?? null;
  const agentName: string | null = agentNameRow?.name || agentNameRow?.email || null;

  const billingEntityType = receivableRole === "agent" ? "agent" : "client";
  const billingEntityName = billingEntityType === "agent"
    ? (agentName || clientName)
    : (clientName || agentName);
  const billingScheduleId = billingEntityType === "agent" ? agentScheduleId : clientScheduleId;
  const billingNote = billingEntityType === "agent"
    ? `Agent Settlement · Agent: ${agentName || "—"}`
    : "Client Premium";

  // Always ONE invoice per policy with all premium lines as items — quotation,
  // invoice, and receipt documents show both (a) and (b) in a single document,
  // the same way statements aggregate endorsements.
  let totalAmountCents = 0;
  const items: Array<{
    policyId: number;
    policyPremiumId: number;
    lineKey: string;
    amountCents: number;
    gainCents: number;
    description: string;
  }> = [];

  const hasMultipleLines = new Set(eligiblePremiums.map((p) => p.lineKey)).size >= 2;

  for (let i = 0; i < eligiblePremiums.length; i++) {
    const premium = eligiblePremiums[i];
    const amountCents = resolvePremiumByRole(premium as Record<string, unknown>, receivableRole, accountingFields);
    totalAmountCents += amountCents;

    const suffix = hasMultipleLines ? String.fromCharCode(97 + i) : "";
    const suffixedPolicyNo = suffix ? `${policy.policyNumber}(${suffix})` : policy.policyNumber;
    const lineDesc = premium.lineLabel || premium.lineKey;
    const desc = hasMultipleLines
      ? `${lineDesc} [${suffixedPolicyNo}]`
      : `${suffixedPolicyNo} · ${lineDesc}`;

    items.push({
      policyId,
      policyPremiumId: premium.id,
      lineKey: premium.lineKey,
      amountCents,
      gainCents: computeGain(premium),
      description: desc,
    });
  }

  const invoiceNumber = documentNumber ?? await generateDocumentNumber(await resolveDocPrefix("invoice", "INV"));

  await db.transaction(async (tx) => {
    // Advisory lock scoped to transaction prevents concurrent creation
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${policyId})`);

    const [existing] = await tx
      .select({
        id: accountingInvoices.id,
        invoiceNumber: accountingInvoices.invoiceNumber,
        scheduleId: accountingInvoices.scheduleId,
        status: accountingInvoices.status,
      })
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

      // Repair: remove orphaned items whose policyPremiumId no longer exists
      const validPremiumIds = new Set(premiums.map((p) => p.id));
      const existingItemRows = await tx
        .select({ id: accountingInvoiceItems.id, policyPremiumId: accountingInvoiceItems.policyPremiumId })
        .from(accountingInvoiceItems)
        .where(eq(accountingInvoiceItems.invoiceId, existing.id));

      const orphanIds = existingItemRows
        .filter((r) => r.policyPremiumId && !validPremiumIds.has(r.policyPremiumId))
        .map((r) => r.id);
      if (orphanIds.length > 0) {
        for (const oid of orphanIds) {
          await tx.delete(accountingInvoiceItems).where(eq(accountingInvoiceItems.id, oid));
        }
      }

      // Add missing premium line items
      const remainingItems = await tx
        .select({ policyPremiumId: accountingInvoiceItems.policyPremiumId })
        .from(accountingInvoiceItems)
        .where(eq(accountingInvoiceItems.invoiceId, existing.id));
      const coveredPremiumIds = new Set(remainingItems.map((r) => r.policyPremiumId));

      const missingItems = items.filter((it) => !coveredPremiumIds.has(it.policyPremiumId));
      if (missingItems.length > 0) {
        await tx.insert(accountingInvoiceItems).values(
          missingItems.map((item) => ({
            invoiceId: existing.id,
            policyId: item.policyId,
            policyPremiumId: item.policyPremiumId,
            lineKey: item.lineKey,
            amountCents: item.amountCents,
            gainCents: item.gainCents,
            description: item.description,
          })),
        );
      }

      // Always recalculate total and fix schedule linkage
      const correctTotal = items.reduce((s, it) => s + it.amountCents, 0);
      const updates: Record<string, unknown> = { totalAmountCents: correctTotal };
      updates.premiumType = billingEntityType === "agent" ? "agent_premium" : "client_premium";
      updates.entityType = billingEntityType;
      updates.entityName = billingEntityName;
      updates.scheduleId = billingScheduleId;
      updates.notes = hasMultipleLines
        ? items.map((it) => it.description).join(" + ")
        : billingNote;
      if (isReceipt) {
        updates.status = "paid";
      } else if (existing.status === "draft" || existing.status === "pending" || existing.status === "statement_created") {
        updates.status = billingScheduleId ? "statement_created" : "pending";
      }
      await tx.update(accountingInvoices)
        .set(updates)
        .where(eq(accountingInvoices.id, existing.id));

      return;
    }

    const [invoice] = await tx
      .insert(accountingInvoices)
      .values({
        organisationId,
        invoiceNumber,
        invoiceType: "individual",
        direction: "receivable",
        premiumType: billingEntityType === "agent" ? "agent_premium" : "client_premium",
        entityPolicyId: policyId,
        entityType: billingEntityType,
        entityName: billingEntityName,
        totalAmountCents,
        paidAmountCents: 0,
        currency: premiums[0]?.currency ?? "HKD",
        invoiceDate: new Date().toISOString().split("T")[0],
        status: isReceipt ? "paid" : (billingScheduleId ? "statement_created" : "pending"),
        scheduleId: billingScheduleId,
        notes: hasMultipleLines
          ? items.map((it) => it.description).join(" + ")
          : billingNote,
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
