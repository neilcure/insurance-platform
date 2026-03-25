import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingPaymentSchedules,
  accountingInvoices,
  accountingInvoiceItems,
} from "@/db/schema/accounting";
import { policies, cars } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { memberships, organisations } from "@/db/schema/core";
import { eq, and, sql, inArray, desc, notInArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields } from "@/lib/accounting-fields";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const scheduleId = Number(id);
    const body = await request.json();
    const { periodStart, periodEnd, flowFilter } = body;

    const [schedule] = await db
      .select()
      .from(accountingPaymentSchedules)
      .where(eq(accountingPaymentSchedules.id, scheduleId))
      .limit(1);

    if (!schedule) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
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

    const premiumField: Record<string, string> = {
      collaborator: "net_premium_cents",
      agent: "agent_commission_cents",
      client: "client_premium_cents",
    };
    const field = premiumField[schedule.entityType] || "net_premium_cents";

    const alreadyInvoicedQuery = db
      .select({ policyPremiumId: accountingInvoiceItems.policyPremiumId })
      .from(accountingInvoiceItems)
      .innerJoin(accountingInvoices, eq(accountingInvoices.id, accountingInvoiceItems.invoiceId))
      .where(
        and(
          eq(accountingInvoices.scheduleId, scheduleId),
          sql`${accountingInvoices.status} NOT IN ('cancelled')`,
        ),
      );

    const alreadyInvoiced = await alreadyInvoicedQuery;
    const excludeIds = alreadyInvoiced
      .map((r) => r.policyPremiumId)
      .filter((id): id is number => id !== null);

    let premiumRows: Array<{
      premiumId: number;
      policyId: number;
      policyNumber: string;
      lineKey: string | null;
      lineLabel: string | null;
      amountCents: number | null;
    }>;

    const baseConditions = [];

    if (schedule.entityType === "collaborator" && schedule.entityPolicyId) {
      baseConditions.push(eq(policyPremiums.collaboratorId, schedule.entityPolicyId));
    }

    if (excludeIds.length > 0) {
      baseConditions.push(notInArray(policyPremiums.id, excludeIds));
    }

    const accountingFields = await loadAccountingFields();
    const roleToColumn: Record<string, string> = {};
    for (const f of accountingFields) {
      if (!f.premiumColumn) continue;
      const lbl = f.label.toLowerCase();
      if (lbl.includes("net") && !roleToColumn.net) roleToColumn.net = f.premiumColumn;
      else if (lbl.includes("agent") && !roleToColumn.agent) roleToColumn.agent = f.premiumColumn;
      else if (lbl.includes("client") && !roleToColumn.client) roleToColumn.client = f.premiumColumn;
    }
    const fieldRoleMap: Record<string, string> = {
      net_premium_cents: "net",
      agent_commission_cents: "agent",
      client_premium_cents: "client",
    };
    const role = fieldRoleMap[field] ?? "net";
    const colName = roleToColumn[role] ?? "netPremiumCents";
    const cols = policyPremiums as unknown as Record<string, unknown>;
    const amountCol = (cols[colName] ?? policyPremiums.netPremiumCents) as typeof policyPremiums.netPremiumCents;

    let query: any = db
      .select({
        premiumId: policyPremiums.id,
        policyId: policyPremiums.policyId,
        policyNumber: policies.policyNumber,
        lineKey: policyPremiums.lineKey,
        lineLabel: policyPremiums.lineLabel,
        amountCents: amountCol,
        flowKey: sql<string | null>`(${cars.extraAttributes})::jsonb ->> 'flowKey'`,
      })
      .from(policyPremiums)
      .innerJoin(policies, eq(policies.id, policyPremiums.policyId))
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(baseConditions.length > 0 ? and(...baseConditions) : undefined);

    let rows = await query;

    if (flowFilter) {
      rows = rows.filter((r: any) => r.flowKey === flowFilter);
    }

    rows = rows.filter((r: any) => r.amountCents && r.amountCents > 0);

    if (rows.length === 0) {
      return NextResponse.json({
        error: "No outstanding premiums found for this schedule",
      }, { status: 400 });
    }

    const totalAmountCents = rows.reduce((s: number, r: any) => s + (r.amountCents || 0), 0);

    const year = new Date().getFullYear();
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accountingInvoices)
      .where(
        and(
          eq(accountingInvoices.organisationId, schedule.organisationId),
          sql`extract(year from ${accountingInvoices.createdAt}) = ${year}`,
        ),
      );
    const count = (countResult[0]?.count ?? 0) + 1;
    const invoiceNumber = `ST-${year}-${String(count).padStart(4, "0")}`;

    const result = await db.transaction(async (tx) => {
      const [statement] = await tx
        .insert(accountingInvoices)
        .values({
          organisationId: schedule.organisationId,
          invoiceNumber,
          invoiceType: "statement",
          direction,
          premiumType,
          entityPolicyId: schedule.entityPolicyId,
          entityType: schedule.entityType,
          entityName: schedule.entityName,
          scheduleId,
          totalAmountCents,
          paidAmountCents: 0,
          currency: schedule.currency,
          invoiceDate: new Date().toISOString().slice(0, 10),
          periodStart: periodStart || null,
          periodEnd: periodEnd || null,
          status: "pending",
          createdBy: Number(user.id),
        })
        .returning();

      const itemValues = rows.map((r: any) => ({
        invoiceId: statement.id,
        policyId: r.policyId,
        policyPremiumId: r.premiumId,
        lineKey: r.lineKey ?? null,
        amountCents: r.amountCents || 0,
        description: `${r.policyNumber}${r.lineLabel ? ` - ${r.lineLabel}` : ""}`,
      }));

      await tx.insert(accountingInvoiceItems).values(itemValues);

      return { statement, itemCount: itemValues.length };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/schedules/[id]/generate error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
