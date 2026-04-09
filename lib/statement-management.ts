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

  if (invItems.length > 0) {
    const alreadyOnStatement = await db
      .select({ id: accountingInvoiceItems.id })
      .from(accountingInvoiceItems)
      .where(
        and(
          eq(accountingInvoiceItems.invoiceId, statementId),
          sql`${accountingInvoiceItems.policyId} IN (${sql.join(
            invItems.map((it) => sql`${it.policyId}`),
            sql`,`,
          )})`,
          sql`coalesce(${accountingInvoiceItems.policyPremiumId}, 0) IN (${sql.join(
            invItems.map((it) => sql`${it.policyPremiumId ?? 0}`),
            sql`,`,
          )})`,
          sql`"status" = 'active'`,
        ),
      )
      .limit(1);

    if (alreadyOnStatement.length > 0) {
      return { itemId: alreadyOnStatement[0].id };
    }
  }

  const premiumRoleMap: Record<string, "client" | "agent" | "net"> = {
    client_premium: "client",
    agent_premium: "agent",
    net_premium: "net",
  };
  const stmtRole = premiumRoleMap[stmt?.premiumType ?? ""] ?? null;
  const accountingFields = stmtRole ? await loadAccountingFields() : null;

  async function resolveAmount(it: { policyPremiumId: number | null; amountCents: number }): Promise<number> {
    if (stmt?.direction === "payable" || inv.direction === "payable") return it.amountCents;
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

  let itemId = 0;
  if (invItems.length > 0) {
    for (const it of invItems) {
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
  const result = await db.execute(sql`
    SELECT coalesce(sum("amount_cents"), 0)::int AS total
    FROM "accounting_invoice_items"
    WHERE "invoice_id" = ${statementId}
      AND coalesce("status", 'active') = 'active'
  `);

  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  const total = ((rows[0] as { total: number } | undefined)?.total) ?? 0;

  await db
    .update(accountingInvoices)
    .set({
      totalAmountCents: total,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(accountingInvoices.id, statementId));

  const allItems = await db.execute(sql`
    SELECT coalesce("status", 'active') AS status
    FROM "accounting_invoice_items"
    WHERE "invoice_id" = ${statementId}
  `);
  const allRows = Array.isArray(allItems) ? allItems : (allItems as { rows?: unknown[] }).rows ?? [];
  const statuses = (allRows as { status: string }[]).map((r) => r.status);
  if (statuses.length > 0 && statuses.every((s) => s === "paid_individually")) {
    await db
      .update(accountingInvoices)
      .set({ status: "settled", updatedAt: new Date().toISOString() })
      .where(eq(accountingInvoices.id, statementId));
  }

  return total;
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
        inArray(accountingInvoices.status, ["draft", "pending", "partial", "settled"]),
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
