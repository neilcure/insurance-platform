import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
  accountingPaymentSchedules,
} from "@/db/schema/accounting";
import { policyPremiums } from "@/db/schema/premiums";
import { policies } from "@/db/schema/insurance";
import { users, clients } from "@/db/schema/core";
import { generateDocumentNumber } from "@/lib/document-number";
import { resolveDocPrefix } from "@/lib/resolve-prefix";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import { and, eq, sql, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Schema migration: ensure status column exists on accounting_invoice_items
// ---------------------------------------------------------------------------
let migrated = false;
async function ensureItemStatusColumn() {
  if (migrated) return;
  await db.execute(sql`
    ALTER TABLE "accounting_invoice_items"
    ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active'
  `);
  migrated = true;
}

// ---------------------------------------------------------------------------
// Look up the statement document template prefix from form_options
// ---------------------------------------------------------------------------
async function getStatementPrefix(): Promise<string> {
  return resolveDocPrefix("statement", "ST");
}

// ---------------------------------------------------------------------------
// Resolve entity name from schedule
// ---------------------------------------------------------------------------
async function resolveEntityName(schedule: {
  entityType: string;
  entityName: string | null;
  agentId: number | null;
  clientId: number | null;
  entityPolicyId: number | null;
}): Promise<string | null> {
  if (schedule.entityName) return schedule.entityName;

  if (schedule.entityType === "agent") {
    let agentId = schedule.agentId;
    if (!agentId && schedule.entityPolicyId) {
      const [pol] = await db
        .select({ agentId: policies.agentId })
        .from(policies)
        .where(eq(policies.id, schedule.entityPolicyId))
        .limit(1);
      agentId = pol?.agentId ?? null;
    }
    if (agentId) {
      const [agent] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, agentId))
        .limit(1);
      return agent?.name ?? null;
    }
  }

  if (schedule.entityType === "client") {
    let clientId = schedule.clientId;
    if (!clientId && schedule.entityPolicyId) {
      const [pol] = await db
        .select({ clientId: policies.clientId })
        .from(policies)
        .where(eq(policies.id, schedule.entityPolicyId))
        .limit(1);
      clientId = pol?.clientId ?? null;
    }
    if (clientId) {
      const [client] = await db
        .select({ displayName: clients.displayName })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      return client?.displayName ?? null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Find existing draft/pending statement for a schedule, or create a new one
// ---------------------------------------------------------------------------
export async function findOrCreateDraftStatement(
  scheduleId: number,
  userId?: number | null,
): Promise<{
  statementId: number;
  statementNumber: string;
  created: boolean;
}> {
  await ensureItemStatusColumn();

  const [schedule] = await db
    .select()
    .from(accountingPaymentSchedules)
    .where(eq(accountingPaymentSchedules.id, scheduleId))
    .limit(1);

  if (!schedule) throw new Error("Schedule not found");

  const [existing] = await db
    .select({
      id: accountingInvoices.id,
      invoiceNumber: accountingInvoices.invoiceNumber,
    })
    .from(accountingInvoices)
    .where(
      and(
        eq(accountingInvoices.scheduleId, scheduleId),
        eq(accountingInvoices.invoiceType, "statement"),
        inArray(accountingInvoices.status, ["draft", "pending"]),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      statementId: existing.id,
      statementNumber: existing.invoiceNumber,
      created: false,
    };
  }

  const prefix = await getStatementPrefix();
  const statementNumber = await generateDocumentNumber(prefix);
  const entityName = await resolveEntityName(schedule);

  const directionMap: Record<string, string> = {
    collaborator: "payable",
    agent: "payable",
    client: "receivable",
  };
  const premiumTypeMap: Record<string, string> = {
    collaborator: "net_premium",
    agent: "agent_premium",
    client: "client_premium",
  };

  const [statement] = await db
    .insert(accountingInvoices)
    .values({
      organisationId: schedule.organisationId,
      invoiceNumber: statementNumber,
      invoiceType: "statement",
      direction: directionMap[schedule.entityType] ?? "receivable",
      premiumType: premiumTypeMap[schedule.entityType] ?? "agent_premium",
      entityType: schedule.entityType,
      entityName: entityName ?? schedule.entityName,
      scheduleId: schedule.id,
      totalAmountCents: 0,
      paidAmountCents: 0,
      currency: schedule.currency,
      invoiceDate: new Date().toISOString().slice(0, 10),
      status: "draft",
      createdBy: userId ?? schedule.createdBy ?? null,
    })
    .returning({ id: accountingInvoices.id, invoiceNumber: accountingInvoices.invoiceNumber });

  return {
    statementId: statement.id,
    statementNumber: statement.invoiceNumber,
    created: true,
  };
}

// ---------------------------------------------------------------------------
// Add an individual invoice to a statement
// ---------------------------------------------------------------------------
export async function addInvoiceToStatement(
  statementId: number,
  individualInvoiceId: number,
): Promise<{ itemId: number }> {
  await ensureItemStatusColumn();

  const [stmt] = await db
    .select({
      premiumType: accountingInvoices.premiumType,
      direction: accountingInvoices.direction,
    })
    .from(accountingInvoices)
    .where(eq(accountingInvoices.id, statementId))
    .limit(1);

  const [inv] = await db
    .select({
      id: accountingInvoices.id,
      direction: accountingInvoices.direction,
      totalAmountCents: accountingInvoices.totalAmountCents,
      paidAmountCents: accountingInvoices.paidAmountCents,
      notes: accountingInvoices.notes,
      invoiceNumber: accountingInvoices.invoiceNumber,
      entityPolicyId: accountingInvoices.entityPolicyId,
    })
    .from(accountingInvoices)
    .where(eq(accountingInvoices.id, individualInvoiceId))
    .limit(1);

  if (!inv) throw new Error("Invoice not found");

  const invItems = await db
    .select()
    .from(accountingInvoiceItems)
    .where(eq(accountingInvoiceItems.invoiceId, individualInvoiceId));

  function isCommissionOrCreditDesc(desc: string | null | undefined): boolean {
    const d = String(desc ?? "").toLowerCase();
    return d.includes("commission:") || d.includes("credit:");
  }

  if (invItems.length > 0) {
    const existingStmtItems = await db
      .select({
        id: accountingInvoiceItems.id,
        policyId: accountingInvoiceItems.policyId,
        policyPremiumId: accountingInvoiceItems.policyPremiumId,
        description: accountingInvoiceItems.description,
      })
      .from(accountingInvoiceItems)
      .where(
        and(
          eq(accountingInvoiceItems.invoiceId, statementId),
          sql`"status" IN ('active', 'paid_individually')`,
        ),
      );

    const allExist = invItems.every((newItem) => {
      const newIsComm = isCommissionOrCreditDesc(newItem.description);
      return existingStmtItems.some((existing) => {
        if (existing.policyId !== newItem.policyId) return false;
        if ((existing.policyPremiumId ?? 0) !== (newItem.policyPremiumId ?? 0)) return false;
        const existingIsComm = isCommissionOrCreditDesc(existing.description);
        return newIsComm === existingIsComm;
      });
    });

    if (allExist) {
      return { itemId: existingStmtItems[0].id };
    }
  }

  const premiumRoleMap: Record<string, "client" | "agent" | "net"> = {
    client_premium: "client",
    agent_premium: "agent",
    net_premium: "net",
  };
  const stmtRole = premiumRoleMap[stmt?.premiumType ?? ""] ?? null;
  const accountingFields = stmtRole ? await loadAccountingFields() : null;

  function isCommissionOrCredit(desc: string | null | undefined): boolean {
    const d = String(desc ?? "").toLowerCase();
    return d.includes("commission:") || d.includes("credit:");
  }

  async function resolveAmount(it: { policyPremiumId: number | null; amountCents: number; description?: string | null }): Promise<number> {
    if (isCommissionOrCredit(it.description)) return it.amountCents;
    if (!stmtRole || !accountingFields || !it.policyPremiumId) return it.amountCents;
    const [premium] = await db
      .select()
      .from(policyPremiums)
      .where(eq(policyPremiums.id, it.policyPremiumId))
      .limit(1);
    if (!premium) return it.amountCents;
    const resolved = Math.abs(resolvePremiumByRole(premium as Record<string, unknown>, stmtRole, accountingFields));
    return resolved > 0 ? resolved : it.amountCents;
  }

  const existingForDedup = await db
    .select({
      policyId: accountingInvoiceItems.policyId,
      policyPremiumId: accountingInvoiceItems.policyPremiumId,
      description: accountingInvoiceItems.description,
    })
    .from(accountingInvoiceItems)
    .where(
      and(
        eq(accountingInvoiceItems.invoiceId, statementId),
        sql`"status" IN ('active', 'paid_individually')`,
      ),
    );

  let itemId = 0;
  if (invItems.length > 0) {
    for (const it of invItems) {
      const itIsComm = isCommissionOrCredit(it.description);
      const alreadyExists = existingForDedup.some((e) =>
        e.policyId === it.policyId
        && (e.policyPremiumId ?? 0) === (it.policyPremiumId ?? 0)
        && isCommissionOrCreditDesc(e.description) === itIsComm,
      );
      if (alreadyExists) continue;

      const amountCents = await resolveAmount(it);
      const [inserted] = await db
        .insert(accountingInvoiceItems)
        .values({
          invoiceId: statementId,
          policyId: it.policyId,
          policyPremiumId: it.policyPremiumId,
          lineKey: it.lineKey,
          amountCents,
          description: `${inv.invoiceNumber} · ${it.description ?? "Premium"}`,
        })
        .returning({ id: accountingInvoiceItems.id });
      if (!itemId) itemId = inserted.id;
    }
  } else {
    const [inserted] = await db
      .insert(accountingInvoiceItems)
      .values({
        invoiceId: statementId,
        policyId: inv.entityPolicyId || 0,
        amountCents: inv.totalAmountCents,
        description: `${inv.invoiceNumber} · ${inv.notes ?? "Premium"}`,
      })
      .returning({ id: accountingInvoiceItems.id });
    itemId = inserted.id;
  }

  await recalcStatementTotal(statementId);

  return { itemId };
}

// ---------------------------------------------------------------------------
// Mark a statement item as paid individually (keeps item on statement, marked)
// ---------------------------------------------------------------------------
export async function markItemPaidIndividually(
  statementId: number,
  itemId: number,
): Promise<void> {
  await ensureItemStatusColumn();

  await db.execute(sql`
    UPDATE "accounting_invoice_items"
    SET "status" = 'paid_individually'
    WHERE "id" = ${itemId} AND "invoice_id" = ${statementId}
  `);

  await recalcStatementTotal(statementId);
}

export async function markAgentPolicyItemsPaidIndividually(
  policyId: number,
): Promise<void> {
  await ensureItemStatusColumn();

  const touched = await db
    .select({
      invoiceId: accountingInvoiceItems.invoiceId,
      invoiceType: accountingInvoices.invoiceType,
    })
    .from(accountingInvoiceItems)
    .innerJoin(accountingInvoices, eq(accountingInvoices.id, accountingInvoiceItems.invoiceId))
    .where(
      and(
        eq(accountingInvoiceItems.policyId, policyId),
        eq(accountingInvoices.direction, "payable"),
        eq(accountingInvoices.entityType, "agent"),
        sql`${accountingInvoices.status} <> 'cancelled'`,
        sql`coalesce("accounting_invoice_items"."status", 'active') = 'active'`,
        sql`lower(coalesce("accounting_invoice_items"."description", '')) not like 'commission:%'`,
        sql`lower(coalesce("accounting_invoice_items"."description", '')) not like 'credit:%'`,
      ),
    );

  if (touched.length === 0) return;

  await db.execute(sql`
    UPDATE "accounting_invoice_items" ii
    SET "status" = 'paid_individually'
    FROM "accounting_invoices" ai
    WHERE ii."invoice_id" = ai."id"
      AND ii."policy_id" = ${policyId}
      AND ai."direction" = 'payable'
      AND ai."entity_type" = 'agent'
      AND ai."status" <> 'cancelled'
      AND coalesce(ii."status", 'active') = 'active'
      AND lower(coalesce(ii."description", '')) NOT LIKE 'commission:%'
      AND lower(coalesce(ii."description", '')) NOT LIKE 'credit:%'
  `);

  const statementIds = [...new Set(
    touched
      .filter((row) => row.invoiceType === "statement")
      .map((row) => row.invoiceId),
  )];

  for (const statementId of statementIds) {
    await recalcStatementTotal(statementId);
  }
}

// ---------------------------------------------------------------------------
// When an agent pays a receivable invoice, mark the corresponding items
// on the agent's schedule statement(s) as paid_individually.
// This complements markAgentPolicyItemsPaidIndividually (which handles
// client-pays → agent payable direction) by covering agent-pays → any
// statement direction on agent-type schedules.
// ---------------------------------------------------------------------------
export async function markPolicyPaidOnAgentStatement(
  policyId: number,
): Promise<void> {
  await ensureItemStatusColumn();

  const touched = await db
    .select({
      invoiceId: accountingInvoiceItems.invoiceId,
      invoiceType: accountingInvoices.invoiceType,
    })
    .from(accountingInvoiceItems)
    .innerJoin(accountingInvoices, eq(accountingInvoices.id, accountingInvoiceItems.invoiceId))
    .where(
      and(
        eq(accountingInvoiceItems.policyId, policyId),
        eq(accountingInvoices.invoiceType, "statement"),
        sql`${accountingInvoices.status} <> 'cancelled'`,
        sql`coalesce("accounting_invoice_items"."status", 'active') = 'active'`,
      ),
    );

  if (touched.length === 0) return;

  const statementIds = [...new Set(touched.map((row) => row.invoiceId))];

  await db.execute(sql`
    UPDATE "accounting_invoice_items" ii
    SET "status" = 'paid_individually'
    FROM "accounting_invoices" ai
    WHERE ii."invoice_id" = ai."id"
      AND ii."policy_id" = ${policyId}
      AND ai."invoice_type" = 'statement'
      AND ai."status" <> 'cancelled'
      AND coalesce(ii."status", 'active') = 'active'
  `);

  for (const statementId of statementIds) {
    await recalcStatementTotal(statementId);
  }
}

// ---------------------------------------------------------------------------
// Reactivate a previously paid-individually item back to active
// ---------------------------------------------------------------------------
export async function reactivateItem(
  statementId: number,
  itemId: number,
): Promise<void> {
  await ensureItemStatusColumn();

  await db.execute(sql`
    UPDATE "accounting_invoice_items"
    SET "status" = 'active'
    WHERE "id" = ${itemId} AND "invoice_id" = ${statementId}
  `);

  await recalcStatementTotal(statementId);
}

// ---------------------------------------------------------------------------
// Remove an item from a statement entirely
// ---------------------------------------------------------------------------
export async function removeItemFromStatement(
  statementId: number,
  itemId: number,
): Promise<void> {
  await ensureItemStatusColumn();

  await db
    .delete(accountingInvoiceItems)
    .where(
      and(
        eq(accountingInvoiceItems.id, itemId),
        eq(accountingInvoiceItems.invoiceId, statementId),
      ),
    );

  await recalcStatementTotal(statementId);

  const remaining = await db
    .select({ id: accountingInvoiceItems.id })
    .from(accountingInvoiceItems)
    .where(eq(accountingInvoiceItems.invoiceId, statementId))
    .limit(1);

  if (remaining.length === 0) {
    await db
      .update(accountingInvoices)
      .set({
        status: "cancelled",
        totalAmountCents: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(accountingInvoices.id, statementId));
  }
}

// ---------------------------------------------------------------------------
// Recalculate statement total from active items only
// ---------------------------------------------------------------------------
export async function recalcStatementTotal(statementId: number): Promise<number> {
  const [stmt] = await db
    .select({ status: accountingInvoices.status })
    .from(accountingInvoices)
    .where(eq(accountingInvoices.id, statementId))
    .limit(1);

  const allItems = await db.execute(sql`
    SELECT coalesce("status", 'active') AS status, "amount_cents"
    FROM "accounting_invoice_items"
    WHERE "invoice_id" = ${statementId}
  `);
  const allRows = Array.isArray(allItems) ? allItems : (allItems as { rows?: unknown[] }).rows ?? [];
  const items = allRows as { status: string; amount_cents: number }[];

  const activeTotal = items
    .filter((row) => row.status === "active")
    .reduce((sum, row) => sum + (row.amount_cents ?? 0), 0);
  const paidIndividuallyTotal = items
    .filter((row) => row.status === "paid_individually")
    .reduce((sum, row) => sum + (row.amount_cents ?? 0), 0);
  const statuses = items.map((row) => row.status);

  const nextStatus = (() => {
    if (statuses.length > 0 && statuses.every((status) => status === "paid_individually")) {
      return "settled";
    }
    if (paidIndividuallyTotal > 0 && activeTotal > 0) {
      return "partial";
    }
    if ((stmt?.status === "settled" || stmt?.status === "partial") && activeTotal > 0) {
      return "pending";
    }
    return stmt?.status;
  })();

  await db
    .update(accountingInvoices)
    .set({
      totalAmountCents: activeTotal,
      paidAmountCents: paidIndividuallyTotal,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(accountingInvoices.id, statementId));

  return activeTotal;
}

// ---------------------------------------------------------------------------
// Get statement details with items for display
// ---------------------------------------------------------------------------
export type StatementItem = {
  id: number;
  policyId: number;
  policyPremiumId: number | null;
  amountCents: number;
  description: string | null;
  status: string;
};

export type StatementDetail = {
  id: number;
  statementNumber: string;
  status: string;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  entityType: string;
  entityName: string | null;
  invoiceDate: string | null;
  items: StatementItem[];
  activeTotal: number;
  paidIndividuallyTotal: number;
};

export async function getStatementForSchedule(
  scheduleId: number,
): Promise<StatementDetail | null> {
  await ensureItemStatusColumn();

  const [stmt] = await db
    .select({
      id: accountingInvoices.id,
      statementNumber: accountingInvoices.invoiceNumber,
      status: accountingInvoices.status,
      totalAmountCents: accountingInvoices.totalAmountCents,
      paidAmountCents: accountingInvoices.paidAmountCents,
      currency: accountingInvoices.currency,
      entityType: accountingInvoices.entityType,
      entityName: accountingInvoices.entityName,
      invoiceDate: accountingInvoices.invoiceDate,
    })
    .from(accountingInvoices)
    .where(
      and(
        eq(accountingInvoices.scheduleId, scheduleId),
        eq(accountingInvoices.invoiceType, "statement"),
        inArray(accountingInvoices.status, [
          "draft", "pending", "partial", "settled", "active",
          "statement_created", "statement_sent", "statement_confirmed",
        ]),
      ),
    )
    .limit(1);

  if (!stmt) return null;

  const rawItems = await db.execute(sql`
    SELECT "id", "policy_id", "policy_premium_id", "amount_cents",
           "description", coalesce("status", 'active') AS "status"
    FROM "accounting_invoice_items"
    WHERE "invoice_id" = ${stmt.id}
    ORDER BY "id"
  `);

  const rawRows = Array.isArray(rawItems) ? rawItems : (rawItems as { rows?: unknown[] }).rows ?? [];
  const items: StatementItem[] = (rawRows as {
    id: number;
    policy_id: number;
    policy_premium_id: number | null;
    amount_cents: number;
    description: string | null;
    status: string;
  }[]).map((r) => ({
    id: r.id,
    policyId: r.policy_id,
    policyPremiumId: r.policy_premium_id,
    amountCents: r.amount_cents,
    description: r.description,
    status: r.status,
  }));

  const activeTotal = items
    .filter((it) => it.status === "active")
    .reduce((sum, it) => sum + it.amountCents, 0);
  const paidIndividuallyTotal = items
    .filter((it) => it.status === "paid_individually")
    .reduce((sum, it) => sum + it.amountCents, 0);

  return {
    ...stmt,
    items,
    activeTotal,
    paidIndividuallyTotal,
  };
}
