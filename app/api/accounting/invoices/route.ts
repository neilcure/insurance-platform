import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { policies, cars } from "@/db/schema/insurance";
import { memberships, organisations } from "@/db/schema/core";
import { policyPremiums } from "@/db/schema/premiums";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const directionFilter = url.searchParams.get("direction");
    const entityTypeFilter = url.searchParams.get("entityType");
    const premiumTypeFilter = url.searchParams.get("premiumType");
    const flowFilter = url.searchParams.get("flow");
    const qLimit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
    const qOffset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

    const conditions: ReturnType<typeof eq>[] = [];
    if (statusFilter) conditions.push(eq(accountingInvoices.status, statusFilter));
    if (directionFilter) conditions.push(eq(accountingInvoices.direction, directionFilter));
    if (entityTypeFilter) conditions.push(eq(accountingInvoices.entityType, entityTypeFilter));
    if (premiumTypeFilter) conditions.push(eq(accountingInvoices.premiumType, premiumTypeFilter));

    let orgIds: number[] | null = null;
    if (!(user.userType === "admin" || user.userType === "internal_staff")) {
      const userMemberships = await db
        .select({ orgId: memberships.organisationId })
        .from(memberships)
        .where(eq(memberships.userId, Number(user.id)));
      orgIds = userMemberships.map((m) => m.orgId);
      if (orgIds.length === 0) return NextResponse.json([], { status: 200 });
      conditions.push(inArray(accountingInvoices.organisationId, orgIds));
    }

    let query: any = db
      .select()
      .from(accountingInvoices)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(accountingInvoices.createdAt))
      .limit(qLimit)
      .offset(qOffset);

    const rows = await query;

    if (flowFilter && rows.length > 0) {
      const invoiceIds = rows.map((r: any) => r.id);
      const items = await db
        .select({
          invoiceId: accountingInvoiceItems.invoiceId,
          policyId: accountingInvoiceItems.policyId,
        })
        .from(accountingInvoiceItems)
        .where(inArray(accountingInvoiceItems.invoiceId, invoiceIds));

      const policyIds = [...new Set(items.map((i) => i.policyId))];
      if (policyIds.length > 0) {
        const policyFlows = await db
          .select({
            id: policies.id,
            flowKey: sql<string>`(${cars.extraAttributes})::jsonb ->> 'flowKey'`,
          })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .where(inArray(policies.id, policyIds));

        const flowPolicyIds = new Set(
          policyFlows.filter((p) => p.flowKey === flowFilter).map((p) => p.id)
        );

        const invoiceIdsWithFlow = new Set(
          items.filter((i) => flowPolicyIds.has(i.policyId)).map((i) => i.invoiceId)
        );

        const filtered = rows.filter((r: any) => invoiceIdsWithFlow.has(r.id));
        return NextResponse.json(filtered, { status: 200 });
      }
    }

    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error("GET /api/accounting/invoices error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();

    const {
      invoiceType = "individual",
      direction,
      premiumType,
      entityPolicyId,
      entityType,
      entityName,
      currency = "HKD",
      invoiceDate,
      dueDate,
      notes,
      items,
      parentInvoiceId,
      scheduleId,
    } = body;

    if (!direction || !premiumType || !entityType) {
      return NextResponse.json(
        { error: "direction, premiumType, and entityType are required" },
        { status: 400 },
      );
    }

    let organisationId: number;
    const [firstMembership] = await db
      .select({ orgId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, Number(user.id)))
      .limit(1);
    organisationId = firstMembership?.orgId ?? 0;
    if (!organisationId) {
      const [firstOrg] = await db.select({ id: organisations.id }).from(organisations).limit(1);
      organisationId = firstOrg?.id ?? 0;
    }
    if (!organisationId) {
      return NextResponse.json({ error: "No organisation found" }, { status: 400 });
    }

    const invoiceNumber = await generateInvoiceNumber(organisationId, direction, invoiceType);

    let totalAmountCents = 0;
    const parsedItems: Array<{ policyId: number; policyPremiumId?: number; lineKey?: string; amountCents: number; description?: string }> = [];

    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        const amt = Math.round(Number(item.amountCents) || 0);
        totalAmountCents += amt;
        parsedItems.push({
          policyId: Number(item.policyId),
          policyPremiumId: item.policyPremiumId ? Number(item.policyPremiumId) : undefined,
          lineKey: item.lineKey || undefined,
          amountCents: amt,
          description: item.description || undefined,
        });
      }
    }

    const result = await db.transaction(async (tx) => {
      const [invoice] = await tx
        .insert(accountingInvoices)
        .values({
          organisationId,
          invoiceNumber,
          invoiceType,
          direction,
          premiumType,
          entityPolicyId: entityPolicyId ? Number(entityPolicyId) : null,
          entityType,
          entityName: entityName || null,
          scheduleId: scheduleId ? Number(scheduleId) : null,
          parentInvoiceId: parentInvoiceId ? Number(parentInvoiceId) : null,
          totalAmountCents,
          paidAmountCents: 0,
          currency,
          invoiceDate: invoiceDate || null,
          dueDate: dueDate || null,
          status: "draft",
          notes: notes || null,
          createdBy: Number(user.id),
        })
        .returning();

      if (parsedItems.length > 0) {
        await tx.insert(accountingInvoiceItems).values(
          parsedItems.map((item) => ({
            invoiceId: invoice.id,
            policyId: item.policyId,
            policyPremiumId: item.policyPremiumId ?? null,
            lineKey: item.lineKey ?? null,
            amountCents: item.amountCents,
            description: item.description ?? null,
          })),
        );
      }

      return invoice;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/invoices error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function generateInvoiceNumber(
  orgId: number,
  direction: string,
  invoiceType: string,
): Promise<string> {
  const prefix = invoiceType === "statement" ? "ST" : direction === "payable" ? "AP" : "AR";
  const year = new Date().getFullYear();
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accountingInvoices)
    .where(
      and(
        eq(accountingInvoices.organisationId, orgId),
        sql`extract(year from ${accountingInvoices.createdAt}) = ${year}`,
      ),
    );
  const count = (countResult[0]?.count ?? 0) + 1;
  return `${prefix}-${year}-${String(count).padStart(4, "0")}`;
}
