import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingInvoiceItems, accountingPayments } from "@/db/schema/accounting";
import { memberships, organisations, clients, users } from "@/db/schema/core";
import { policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { and, desc, eq, sql, inArray, type SQL } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { resolveInvoicePrefix } from "@/lib/resolve-prefix";
import { parsePaginationParams } from "@/lib/pagination/types";
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
    const excludeStatementType = url.searchParams.get("excludeStatementType") === "1";
    const { limit: qLimit, offset: qOffset } = parsePaginationParams(url.searchParams, {
      defaultLimit: 50,
      maxLimit: 500,
    });

    const conditions: SQL[] = [];
    if (statusFilter && statusFilter !== "all")
      conditions.push(eq(accountingInvoices.status, statusFilter));
    if (directionFilter) conditions.push(eq(accountingInvoices.direction, directionFilter));
    if (entityTypeFilter) conditions.push(eq(accountingInvoices.entityType, entityTypeFilter));
    if (premiumTypeFilter) conditions.push(eq(accountingInvoices.premiumType, premiumTypeFilter));
    // Caller can ask the API to drop statement-type rows so client-side
    // doesn't have to filter them out (which would corrupt pagination
    // counts). Used by /dashboard/accounting which only shows individual
    // invoices.
    if (excludeStatementType)
      conditions.push(sql`${accountingInvoices.invoiceType} <> 'statement'`);

    let orgIds: number[] | null = null;
    if (!(user.userType === "admin" || user.userType === "internal_staff")) {
      const userMemberships = await db
        .select({ orgId: memberships.organisationId })
        .from(memberships)
        .where(eq(memberships.userId, Number(user.id)));
      orgIds = userMemberships.map((m) => m.orgId);
      if (orgIds.length === 0) {
        return NextResponse.json(
          { rows: [], total: 0, limit: qLimit, offset: qOffset },
          { status: 200 },
        );
      }
      conditions.push(inArray(accountingInvoices.organisationId, orgIds));
    }

    // Apply flow filter as a SQL subquery so pagination works correctly
    if (flowFilter) {
      conditions.push(
        sql`${accountingInvoices.id} IN (
          SELECT ii.invoice_id FROM accounting_invoice_items ii
          INNER JOIN policies p ON p.id = ii.policy_id
          LEFT JOIN cars c ON c.policy_id = p.id
          WHERE (c.extra_attributes)::jsonb ->> 'flowKey' = ${flowFilter}
        )`
      );
    }

    const includePayments = url.searchParams.get("includePayments") === "1";

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const [rawRows, totalRow] = await Promise.all([
      db
        .select()
        .from(accountingInvoices)
        .where(whereExpr)
        .orderBy(desc(accountingInvoices.createdAt))
        .limit(qLimit)
        .offset(qOffset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(accountingInvoices)
        .where(whereExpr),
    ]);
    const total = totalRow[0]?.count ?? 0;

    let rows: any[] = rawRows;

    if (rawRows.length > 0) {
      const ids = rawRows.map((r: any) => r.id as number);

      // Stage 1: premium aggregates, item→policy mapping, and (optional) payments
      // all key off the same invoice-id list. Fan them out in parallel.
      const [premiumRows, itemRows, paymentsRows] = await Promise.all([
        db
          .select({
            invoiceId: accountingInvoiceItems.invoiceId,
            totalNet: sql<number>`coalesce(sum(coalesce(${policyPremiums.netPremiumCents}, 0)), 0)::int`,
            totalAgent: sql<number>`coalesce(sum(coalesce(${policyPremiums.agentPremiumCents}, 0)), 0)::int`,
            totalClient: sql<number>`coalesce(sum(coalesce(${policyPremiums.clientPremiumCents}, 0)), 0)::int`,
          })
          .from(accountingInvoiceItems)
          .leftJoin(policyPremiums, eq(policyPremiums.id, accountingInvoiceItems.policyPremiumId))
          .where(inArray(accountingInvoiceItems.invoiceId, ids))
          .groupBy(accountingInvoiceItems.invoiceId),
        db
          .select({
            invoiceId: accountingInvoiceItems.invoiceId,
            policyId: accountingInvoiceItems.policyId,
          })
          .from(accountingInvoiceItems)
          .where(inArray(accountingInvoiceItems.invoiceId, ids)),
        includePayments
          ? db
              .select()
              .from(accountingPayments)
              .where(inArray(accountingPayments.invoiceId, ids))
          : Promise.resolve([] as (typeof accountingPayments.$inferSelect)[]),
      ]);

      // Apply premium aggregates
      const premiumMap = new Map(premiumRows.map((r) => [r.invoiceId, r]));
      rows = rawRows.map((r: any) => {
        const pm = premiumMap.get(r.id);
        const net = pm?.totalNet ?? 0;
        const agent = pm?.totalAgent ?? 0;
        const client = pm?.totalClient ?? 0;
        const gain = agent > 0 ? agent - net : client - net;
        return {
          ...r,
          totalGainCents: gain,
          totalNetPremiumCents: net,
        };
      });

      // Resolve all policy ids referenced by items and entityPolicyId fields.
      const policyIdSet = new Set(itemRows.map((r) => r.policyId));
      for (const r of rows) {
        if (r.entityPolicyId) policyIdSet.add(r.entityPolicyId as number);
      }
      const allPolicyIds = Array.from(policyIdSet);

      if (allPolicyIds.length > 0) {
        // Stage 2: policy rows are needed before we know which clients/agents to fetch.
        const policyRows = await db
          .select({
            id: policies.id,
            policyNumber: policies.policyNumber,
            clientId: policies.clientId,
            agentId: policies.agentId,
            documentTracking: policies.documentTracking,
          })
          .from(policies)
          .where(inArray(policies.id, allPolicyIds));

        const clientIds = policyRows.map((p) => p.clientId).filter((id): id is number => id !== null);
        const agentIds = policyRows.map((p) => p.agentId).filter((id): id is number => id !== null);

        // Stage 3: clients + agents are independent — fan out in parallel.
        const [clientRows, agentRows] = await Promise.all([
          clientIds.length > 0
            ? db
                .select({ id: clients.id, displayName: clients.displayName })
                .from(clients)
                .where(inArray(clients.id, clientIds))
            : Promise.resolve([] as { id: number; displayName: string }[]),
          agentIds.length > 0
            ? db
                .select({ id: users.id, name: users.name, email: users.email })
                .from(users)
                .where(inArray(users.id, agentIds))
            : Promise.resolve([] as { id: number; name: string | null; email: string | null }[]),
        ]);

        const clientMap = new Map<number, string>();
        for (const c of clientRows) clientMap.set(c.id, c.displayName);
        const agentMap = new Map<number, string>();
        for (const a of agentRows) agentMap.set(a.id, a.name || a.email || "");

        const policyMap = new Map(policyRows.map((p) => [p.id, p]));

        const invoicePolicyMap = new Map<number, number>();
        for (const item of itemRows) {
          if (!invoicePolicyMap.has(item.invoiceId)) {
            invoicePolicyMap.set(item.invoiceId, item.policyId);
          }
        }

        rows = rows.map((r) => {
          const policyId = invoicePolicyMap.get(r.id) ?? r.entityPolicyId;
          const policy = policyId ? policyMap.get(policyId) : undefined;
          const tracking = (policy?.documentTracking ?? {}) as Record<string, { documentNumber?: string }>;

          const docNumbers: Record<string, string> = {};
          for (const [key, entry] of Object.entries(tracking)) {
            if (key.startsWith("_")) continue;
            if (entry?.documentNumber) {
              docNumbers[key] = entry.documentNumber;
            }
          }

          return {
            ...r,
            policyNumber: policy?.policyNumber ?? null,
            clientName: policy?.clientId ? (clientMap.get(policy.clientId) ?? null) : null,
            agentName: policy?.agentId ? (agentMap.get(policy.agentId) ?? null) : null,
            documentNumbers: Object.keys(docNumbers).length > 0 ? docNumbers : null,
          };
        });
      }

      // Apply payments (already pre-fetched in Stage 1 when includePayments was set).
      if (includePayments) {
        const paymentsByInvoice = new Map<number, (typeof paymentsRows)[number][]>();
        for (const p of paymentsRows) {
          const arr = paymentsByInvoice.get(p.invoiceId) ?? [];
          arr.push(p);
          paymentsByInvoice.set(p.invoiceId, arr);
        }
        rows = rows.map((r) => ({
          ...r,
          payments: paymentsByInvoice.get(r.id) ?? [],
        }));
      }
    }

    return NextResponse.json(
      { rows, total, limit: qLimit, offset: qOffset },
      { status: 200 },
    );
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
  const prefix = await resolveInvoicePrefix(invoiceType, direction);
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
