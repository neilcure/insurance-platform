import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
  accountingPaymentSchedules,
} from "@/db/schema/accounting";
import { clients, users } from "@/db/schema/core";
import { cars, policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { generateDocumentNumber } from "@/lib/document-number";
import { and, desc, eq, notInArray, sql, type SQLWrapper } from "drizzle-orm";

type PaymentScheduleRow = typeof accountingPaymentSchedules.$inferSelect;

type StatementGenerationArgs = {
  scheduleId: number;
  userId?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  flowFilter?: string | null;
  markScheduleGenerated?: boolean;
};

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function clampMonthDay(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.max(1, Math.min(day, lastDay));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function normalizeWeekday(billingDay: number | null) {
  if (billingDay === null || billingDay === undefined) return 1;
  if (billingDay >= 0 && billingDay <= 6) return billingDay;
  if (billingDay >= 1 && billingDay <= 7) return billingDay % 7;
  return 1;
}

function mostRecentWeekday(today: Date, weekday: number) {
  const current = today.getUTCDay();
  const diff = (current - weekday + 7) % 7;
  return addUtcDays(today, -diff);
}

export function getDuePeriodForSchedule(schedule: PaymentScheduleRow, now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const frequency = schedule.frequency || "monthly";
  const lastPeriodEnd = schedule.lastPeriodEnd ? new Date(`${schedule.lastPeriodEnd}T00:00:00.000Z`) : null;

  if (frequency === "weekly") {
    const weekday = normalizeWeekday(schedule.billingDay);
    const targetEnd = mostRecentWeekday(today, weekday);
    if (lastPeriodEnd && formatDateOnly(lastPeriodEnd) >= formatDateOnly(targetEnd)) return null;

    const periodStart = lastPeriodEnd ? addUtcDays(lastPeriodEnd, 1) : addUtcDays(targetEnd, -6);
    return {
      periodStart: formatDateOnly(periodStart),
      periodEnd: formatDateOnly(targetEnd),
    };
  }

  const intervalMonths = frequency === "quarterly" ? 3 : frequency === "bimonthly" ? 2 : 1;
  const billingDay = Math.max(1, schedule.billingDay ?? 1);
  const currentMonthDueDay = clampMonthDay(today.getUTCFullYear(), today.getUTCMonth(), billingDay);
  const currentMonthDue = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), currentMonthDueDay));
  if (today < currentMonthDue) return null;
  if (lastPeriodEnd && formatDateOnly(lastPeriodEnd) >= formatDateOnly(currentMonthDue)) return null;

  if (intervalMonths > 1 && lastPeriodEnd) {
    const nextDue = addUtcMonths(lastPeriodEnd, intervalMonths);
    if (today < nextDue) return null;
  }

  const priorAnchor = addUtcMonths(currentMonthDue, -intervalMonths);
  const periodStart = lastPeriodEnd
    ? addUtcDays(lastPeriodEnd, 1)
    : addUtcDays(priorAnchor, 1);

  return {
    periodStart: formatDateOnly(periodStart),
    periodEnd: formatDateOnly(currentMonthDue),
  };
}

async function resolveScheduleTarget(schedule: PaymentScheduleRow) {
  let collaboratorPolicyId = schedule.entityPolicyId ?? null;
  let agentId = schedule.agentId ?? null;
  let clientId = schedule.clientId ?? null;
  let entityName = schedule.entityName ?? null;

  if ((schedule.entityType === "agent" || schedule.entityType === "client") && (agentId === null && clientId === null) && schedule.entityPolicyId) {
    const [policy] = await db
      .select({
        agentId: policies.agentId,
        clientId: policies.clientId,
      })
      .from(policies)
      .where(eq(policies.id, schedule.entityPolicyId))
      .limit(1);

    if (schedule.entityType === "agent") agentId = policy?.agentId ?? null;
    if (schedule.entityType === "client") clientId = policy?.clientId ?? null;
  }

  if (!entityName && schedule.entityType === "agent" && agentId) {
    const [agent] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, agentId))
      .limit(1);
    entityName = agent?.name || agent?.email || null;
  }

  if (!entityName && schedule.entityType === "client" && clientId) {
    const [client] = await db
      .select({ displayName: clients.displayName })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    entityName = client?.displayName ?? null;
  }

  if (schedule.entityType === "collaborator" && !collaboratorPolicyId) {
    collaboratorPolicyId = schedule.entityPolicyId ?? null;
  }

  return {
    collaboratorPolicyId,
    agentId,
    clientId,
    entityName,
  };
}

function buildPolicyDateExpr() {
  return sql`coalesce(
    nullif(((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy' -> 'values' ->> 'startDate'), ''),
    nullif(((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy' ->> 'startDate'), ''),
    nullif(((${cars.extraAttributes})::jsonb ->> 'startDate'), ''),
    (${policies.createdAt})::date::text
  )::date`;
}

async function nextStatementNumber(_organisationId: number) {
  return generateDocumentNumber("ST");
}

export async function generateStatementInvoice({
  scheduleId,
  userId = null,
  periodStart = null,
  periodEnd = null,
  flowFilter = null,
  markScheduleGenerated = true,
}: StatementGenerationArgs) {
  const [schedule] = await db
    .select()
    .from(accountingPaymentSchedules)
    .where(eq(accountingPaymentSchedules.id, scheduleId))
    .limit(1);

  if (!schedule) {
    throw new Error("Schedule not found");
  }

  const target = await resolveScheduleTarget(schedule);
  if (schedule.entityType === "agent" && !target.agentId) {
    throw new Error("Agent schedule must target an agent");
  }
  if (schedule.entityType === "client" && !target.clientId) {
    throw new Error("Client schedule must target a client");
  }
  if (schedule.entityType === "collaborator" && !target.collaboratorPolicyId) {
    throw new Error("Collaborator schedule must target a collaborator policy");
  }

  const premiumTypeMap: Record<string, string> = {
    collaborator: "net_premium",
    agent: "agent_premium",
    client: "client_premium",
  };
  const premiumType = premiumTypeMap[schedule.entityType] || "net_premium";

  const directionMap: Record<string, string> = {
    collaborator: "payable",
    agent: "receivable",
    client: "receivable",
  };
  const direction = directionMap[schedule.entityType] || "payable";

  const accountingFields = await loadAccountingFields();
  const roleToColumn: Record<string, string> = {};
  for (const field of accountingFields) {
    if (!field.premiumColumn) continue;
    const label = field.label.toLowerCase();
    if (label.includes("net") && !roleToColumn.net) roleToColumn.net = field.premiumColumn;
    else if (label.includes("agent") && !roleToColumn.agent) roleToColumn.agent = field.premiumColumn;
    else if (label.includes("client") && !roleToColumn.client) roleToColumn.client = field.premiumColumn;
  }

  const fieldRoleMap: Record<string, string> = {
    net_premium: "net",
    agent_premium: "agent",
    client_premium: "client",
  };
  const role = fieldRoleMap[premiumType] ?? "net";
  const premiumColumnName = roleToColumn[role] ?? "netPremiumCents";
  const premiumCols = policyPremiums as unknown as Record<string, unknown>;
  const amountCol = (premiumCols[premiumColumnName] ?? policyPremiums.netPremiumCents) as typeof policyPremiums.netPremiumCents;
  const policyDateExpr = buildPolicyDateExpr();

  const alreadyInvoicedRows = await db
    .select({ policyPremiumId: accountingInvoiceItems.policyPremiumId })
    .from(accountingInvoiceItems)
    .innerJoin(accountingInvoices, eq(accountingInvoices.id, accountingInvoiceItems.invoiceId))
    .where(
      and(
        eq(accountingInvoices.direction, direction),
        eq(accountingInvoices.premiumType, premiumType),
        sql`${accountingInvoices.status} <> 'cancelled'`,
      ),
    );

  const excludeIds = alreadyInvoicedRows
    .map((row) => row.policyPremiumId)
    .filter((id): id is number => id !== null);

  const conditions: SQLWrapper[] = [eq(policies.organisationId, schedule.organisationId)];

  if (schedule.entityType === "collaborator" && target.collaboratorPolicyId) {
    conditions.push(eq(policyPremiums.collaboratorId, target.collaboratorPolicyId));
  }
  if (schedule.entityType === "agent" && target.agentId) {
    conditions.push(eq(policies.agentId, target.agentId));
  }
  if (schedule.entityType === "client" && target.clientId) {
    conditions.push(eq(policies.clientId, target.clientId));
  }
  if (periodStart) {
    conditions.push(sql`${policyDateExpr} >= ${periodStart}`);
  }
  if (periodEnd) {
    conditions.push(sql`${policyDateExpr} <= ${periodEnd}`);
  }
  if (excludeIds.length > 0) {
    conditions.push(notInArray(policyPremiums.id, excludeIds));
  }

  let rows = await db
    .select({
      premiumId: policyPremiums.id,
      policyId: policyPremiums.policyId,
      policyNumber: policies.policyNumber,
      lineKey: policyPremiums.lineKey,
      lineLabel: policyPremiums.lineLabel,
      amountCents: amountCol,
      flowKey: sql<string | null>`(${cars.extraAttributes})::jsonb ->> 'flowKey'`,
      policyDate: policyDateExpr,
    })
    .from(policyPremiums)
    .innerJoin(policies, eq(policies.id, policyPremiums.policyId))
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(and(...conditions))
    .orderBy(desc(policies.createdAt));

  if (flowFilter) {
    rows = rows.filter((row) => row.flowKey === flowFilter);
  }

  rows = rows.filter((row) => (row.amountCents ?? 0) > 0);

  if (rows.length === 0) {
    return {
      statement: null,
      itemCount: 0,
      skipped: true,
      reason: "No outstanding premiums found for this schedule",
    };
  }

  const totalAmountCents = rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0);
  const invoiceNumber = await nextStatementNumber(schedule.organisationId);

  const result = await db.transaction(async (tx) => {
    const [statement] = await tx
      .insert(accountingInvoices)
      .values({
        organisationId: schedule.organisationId,
        invoiceNumber,
        invoiceType: "statement",
        direction,
        premiumType,
        entityPolicyId: schedule.entityType === "collaborator" ? target.collaboratorPolicyId : null,
        entityType: schedule.entityType,
        entityName: target.entityName ?? schedule.entityName,
        scheduleId: schedule.id,
        totalAmountCents,
        paidAmountCents: 0,
        currency: schedule.currency,
        invoiceDate: new Date().toISOString().slice(0, 10),
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        status: "pending",
        createdBy: userId ?? schedule.createdBy ?? null,
      })
      .returning();

    const itemValues = rows.map((row) => ({
      invoiceId: statement.id,
      policyId: row.policyId,
      policyPremiumId: row.premiumId,
      lineKey: row.lineKey ?? null,
      amountCents: row.amountCents || 0,
      description: `${row.policyNumber}${row.lineLabel ? ` - ${row.lineLabel}` : ""}`,
    }));

    await tx.insert(accountingInvoiceItems).values(itemValues);

    if (markScheduleGenerated) {
      await tx
        .update(accountingPaymentSchedules)
        .set({
          agentId: target.agentId,
          clientId: target.clientId,
          entityName: target.entityName ?? schedule.entityName,
          lastGeneratedAt: new Date().toISOString(),
          lastPeriodStart: periodStart || null,
          lastPeriodEnd: periodEnd || null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(accountingPaymentSchedules.id, schedule.id));
    }

    return { statement, itemCount: itemValues.length };
  });

  return { ...result, skipped: false };
}
