import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingInvoiceItems, accountingPayments } from "@/db/schema/accounting";
import { policyPremiums } from "@/db/schema/premiums";
import { policies } from "@/db/schema/insurance";
import { cars } from "@/db/schema/insurance";
import { clients } from "@/db/schema/core";
import { eq, inArray, desc, sql, and } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";

export const dynamic = "force-dynamic";

async function findClientPolicyIds(clientRecordOrClientId: number): Promise<number[]> {
  const seen = new Set<number>();

  // First check: is this a clients.id? Find policies by policies.client_id
  try {
    const byClientId = await db
      .select({ id: policies.id })
      .from(policies)
      .where(eq(policies.clientId, clientRecordOrClientId));
    for (const r of byClientId) seen.add(r.id);
  } catch { /* ignore */ }

  // Second check: is this a clientSet record's policyId? Resolve via policyNumber = clientNumber
  if (seen.size === 0) {
    try {
      const [clientRow] = await db
        .select({ pNum: policies.policyNumber, clientId: policies.clientId })
        .from(policies)
        .where(eq(policies.id, clientRecordOrClientId))
        .limit(1);
      if (clientRow) {
        const clientNumber = clientRow.pNum;
        let dbClientId = clientRow.clientId;

        if (!dbClientId) {
          const [c] = await db.select({ id: clients.id }).from(clients)
            .where(eq(clients.clientNumber, clientNumber)).limit(1);
          if (c) dbClientId = c.id;
        }

        if (dbClientId) {
          const byId = await db
            .select({ id: policies.id })
            .from(policies)
            .leftJoin(cars, eq(cars.policyId, policies.id))
            .where(and(
              eq(policies.clientId, dbClientId),
              sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') = 'policyset'`,
            ))
            .limit(50);
          for (const r of byId) seen.add(r.id);
        }

        // Fallback: search via snapshot
        const bySnapshot = await db
          .select({ id: policies.id })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .where(and(
            sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') = 'policyset'`,
            sql`(
              ((${cars.extraAttributes})::jsonb ->> 'clientNumber') = ${clientNumber}
              OR (((${cars.extraAttributes})::jsonb -> 'insuredSnapshot') ->> 'clientPolicyNumber') = ${clientNumber}
              OR ((${cars.extraAttributes})::text ILIKE ${"%" + '"clientNumber":"' + clientNumber + '"' + "%"})
            )`,
          ))
          .limit(50);
        for (const r of bySnapshot) seen.add(r.id);
      }
    } catch { /* ignore */ }
  }

  return [...seen];
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ clientId: string }> },
) {
  try {
    const me = await requireUser();
    const { clientId } = await ctx.params;
    const cid = Number(clientId);
    if (!Number.isFinite(cid) || cid <= 0) {
      return NextResponse.json({ error: "Invalid clientId" }, { status: 400 });
    }

    if (!(me.userType === "admin" || me.userType === "internal_staff")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const directPolicyIds = await findClientPolicyIds(cid);
    if (directPolicyIds.length === 0) {
      return NextResponse.json([]);
    }

    // Also find endorsements linked to these policies
    const endorsementRows = await db.execute(sql`
      SELECT DISTINCT c.policy_id
      FROM cars c
      WHERE (c.extra_attributes->>'linkedPolicyId')::int IN (${sql.join(directPolicyIds.map((id) => sql`${id}`), sql`,`)})
    `);
    const endorsementIds = (
      Array.isArray(endorsementRows)
        ? endorsementRows
        : (endorsementRows as { rows?: unknown[] }).rows ?? []
    ).map((r: unknown) => Number((r as { policy_id: number }).policy_id)).filter((id) => Number.isFinite(id) && id > 0);

    const policyIds = [...new Set([...directPolicyIds, ...endorsementIds])];

    const itemRows = await db
      .select({
        invoiceId: accountingInvoiceItems.invoiceId,
        policyPremiumId: accountingInvoiceItems.policyPremiumId,
        amountCents: accountingInvoiceItems.amountCents,
      })
      .from(accountingInvoiceItems)
      .where(inArray(accountingInvoiceItems.policyId, policyIds));

    const invoiceIds = [...new Set(itemRows.map((r) => r.invoiceId))];
    if (invoiceIds.length === 0) {
      return NextResponse.json([]);
    }

    const invoiceList = await db
      .select()
      .from(accountingInvoices)
      .where(
        and(
          inArray(accountingInvoices.id, invoiceIds),
          sql`${accountingInvoices.status} <> 'cancelled'`,
          sql`${accountingInvoices.direction} = 'receivable'`,
          sql`coalesce(${accountingInvoices.invoiceType}, '') <> 'statement'`,
        ),
      )
      .orderBy(desc(accountingInvoices.createdAt));

    const filteredIds = invoiceList.map((inv) => inv.id);
    if (filteredIds.length === 0) {
      return NextResponse.json([]);
    }

    const payments = await db
      .select()
      .from(accountingPayments)
      .where(inArray(accountingPayments.invoiceId, filteredIds));

    const paymentsByInvoice = new Map<number, typeof payments>();
    for (const p of payments) {
      const arr = paymentsByInvoice.get(p.invoiceId) ?? [];
      arr.push(p);
      paymentsByInvoice.set(p.invoiceId, arr);
    }

    const accountingFields = await loadAccountingFields();
    const premiumIdSet = new Set(
      itemRows.map((r) => r.policyPremiumId).filter((id): id is number => id != null && id > 0),
    );
    const premiumMap = new Map<number, number>();
    if (premiumIdSet.size > 0) {
      const premiumRows = await db
        .select()
        .from(policyPremiums)
        .where(inArray(policyPremiums.id, [...premiumIdSet]));
      for (const p of premiumRows) {
        const clientCents = resolvePremiumByRole(p as unknown as Record<string, unknown>, "client", accountingFields);
        premiumMap.set(p.id, clientCents);
      }
    }

    const clientTotalByInvoice = new Map<number, number>();
    for (const item of itemRows) {
      if (!filteredIds.includes(item.invoiceId)) continue;
      const clientCents = item.policyPremiumId && premiumMap.has(item.policyPremiumId)
        ? premiumMap.get(item.policyPremiumId)!
        : item.amountCents;
      clientTotalByInvoice.set(item.invoiceId, (clientTotalByInvoice.get(item.invoiceId) ?? 0) + clientCents);
    }

    const result = invoiceList.map((inv) => {
      const isAgentType = inv.entityType === "agent";
      const clientTotal = clientTotalByInvoice.get(inv.id);
      return {
        ...inv,
        totalAmountCents: isAgentType && clientTotal != null ? clientTotal : inv.totalAmountCents,
        notes: isAgentType
          ? (inv.notes ?? "").replace(/Agent (?:Settlement|Premium)/i, "Client Premium").replace(/Agent:/i, "Client:")
          : inv.notes,
        payments: paymentsByInvoice.get(inv.id) ?? [],
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET invoices by-client error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
