import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingInvoiceItems, accountingPayments } from "@/db/schema/accounting";
import { policies } from "@/db/schema/insurance";
import { eq, inArray, desc, sql, and } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ agentId: string }> },
) {
  try {
    const me = await requireUser();
    const { agentId } = await ctx.params;
    const aid = Number(agentId);
    if (!Number.isFinite(aid) || aid <= 0) {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }

    if (!(me.userType === "admin" || me.userType === "internal_staff" || (me.userType === "agent" && Number(me.id) === aid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const agentPolicies = await db
      .select({ id: policies.id })
      .from(policies)
      .where(eq(policies.agentId, aid));

    const directPolicyIds = agentPolicies.map((p) => p.id);
    if (directPolicyIds.length === 0) {
      return NextResponse.json([]);
    }

    // Include endorsement policies linked to the agent's policies
    // (endorsements inherit agentId from parent via linkedPolicyId)
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
    if (policyIds.length === 0) {
      return NextResponse.json([]);
    }

    const itemRows = await db
      .select({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(inArray(accountingInvoiceItems.policyId, policyIds));

    const invoiceIds = [...new Set(itemRows.map((r) => r.invoiceId))];
    if (invoiceIds.length === 0) {
      return NextResponse.json([]);
    }

    const invoices = await db
      .select()
      .from(accountingInvoices)
      .where(
        and(
          inArray(accountingInvoices.id, invoiceIds),
          sql`${accountingInvoices.status} <> 'cancelled'`,
        ),
      )
      .orderBy(desc(accountingInvoices.createdAt));

    const payments = await db
      .select()
      .from(accountingPayments)
      .where(inArray(accountingPayments.invoiceId, invoiceIds));

    const paymentsByInvoice = new Map<number, typeof payments>();
    for (const p of payments) {
      const arr = paymentsByInvoice.get(p.invoiceId) ?? [];
      arr.push(p);
      paymentsByInvoice.set(p.invoiceId, arr);
    }

    const result = invoices.map((inv) => ({
      ...inv,
      payments: paymentsByInvoice.get(inv.id) ?? [],
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("GET invoices by-agent error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
