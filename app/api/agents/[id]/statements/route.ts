import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await context.params;
    const agentId = Number(id);
    if (!Number.isFinite(agentId) || agentId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Access: admin/internal_staff can view any; agent can only view self
    if (!(me.userType === "admin" || me.userType === "internal_staff" || (me.userType === "agent" && Number(me.id) === agentId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [agent] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, agentId))
      .limit(1);
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const result = await db.execute(sql`
      select
        ai.id,
        coalesce(max(ai.entity_policy_id), min(p.id)) as "policyId",
        coalesce(max(p.flow_key), '') as "flowKey",
        ai.invoice_number as "invoiceNumber",
        ai.invoice_type as "invoiceType",
        ai.status,
        ai.total_amount_cents as "totalAmountCents",
        ai.paid_amount_cents as "paidAmountCents",
        ai.currency,
        ai.invoice_date as "invoiceDate",
        ai.period_start as "periodStart",
        ai.period_end as "periodEnd",
        coalesce(
          string_agg(distinct p.policy_number, ', ') filter (where p.policy_number is not null),
          ''
        ) as "policyNumbers"
      from accounting_invoices ai
      left join accounting_invoice_items aii on aii.invoice_id = ai.id
      left join policies p on p.id = aii.policy_id
      left join accounting_payment_schedules aps on aps.id = ai.schedule_id
      where ai.entity_type = 'agent'
        and ai.direction = 'payable'
        and ai.status <> 'cancelled'
        and (
          ai.invoice_type = 'statement'
          or ai.status = 'statement_created'
          or ai.schedule_id is not null
        )
        and (
          p.agent_id = ${agentId}
          or (ai.entity_policy_id is not null and exists (
            select 1 from policies ep where ep.id = ai.entity_policy_id and ep.agent_id = ${agentId}
          ))
          or (
            aps.entity_type = 'agent'
            and aps.agent_id = ${agentId}
          )
        )
      group by ai.id
      order by ai.created_at desc
      limit 100
    `);

    const rows = Array.isArray(result) ? result : (result as unknown as { rows?: unknown[] })?.rows ?? [];
    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

