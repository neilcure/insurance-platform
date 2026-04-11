import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function resolveStatementDocNumber(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const tracking = raw as Record<string, unknown>;
  const withDocNumber = Object.entries(tracking)
    .map(([key, value]) => {
      if (!value || typeof value !== "object") return null;
      const docNumber = String((value as Record<string, unknown>).documentNumber ?? "").trim();
      if (!docNumber) return null;
      return { key: String(key), docNumber };
    })
    .filter((v): v is { key: string; docNumber: string } => !!v);
  if (withDocNumber.length === 0) return "";

  const ranked = [...withDocNumber].sort((a, b) => {
    const score = (key: string) => {
      const lower = key.toLowerCase();
      if (lower.includes("statement") && lower.endsWith("_agent")) return 0;
      if (lower.includes("statement")) return 1;
      if (lower.endsWith("_agent")) return 2;
      return 3;
    };
    return score(a.key) - score(b.key);
  });
  return ranked[0]?.docNumber ?? "";
}

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

    // Load agent's active payment schedules so the panel can look up statements
    const scheduleResult = await db.execute(sql`
      select aps.id
      from accounting_payment_schedules aps
      where aps.entity_type = 'agent'
        and aps.agent_id = ${agentId}
        and aps.is_active = true
    `);
    const scheduleRows = Array.isArray(scheduleResult) ? scheduleResult : (scheduleResult as unknown as { rows?: unknown[] })?.rows ?? [];
    const agentScheduleIds = (scheduleRows as { id: number }[]).map((r) => r.id);

    const result = await db.execute(sql`
      select
        ai.id,
        ai.schedule_id as "scheduleId",
        coalesce(max(ai.entity_policy_id), min(p.id)) as "policyId",
        coalesce(max(p.flow_key), '') as "flowKey",
        ai.invoice_number as "invoiceNumber",
        ai.invoice_type as "invoiceType",
        ai.direction,
        ai.status,
        ai.total_amount_cents as "totalAmountCents",
        ai.paid_amount_cents as "paidAmountCents",
        ai.currency,
        ai.invoice_date as "invoiceDate",
        ai.period_start as "periodStart",
        ai.period_end as "periodEnd",
        ai.document_status as "documentStatus",
        coalesce(
          string_agg(distinct p.policy_number, ', ') filter (where p.policy_number is not null),
          ''
        ) as "policyNumbers"
      from accounting_invoices ai
      left join accounting_invoice_items aii on aii.invoice_id = ai.id
      left join policies p on p.id = aii.policy_id
      left join accounting_payment_schedules aps on aps.id = ai.schedule_id
      where ai.entity_type = 'agent'
        and ai.status <> 'cancelled'
        and (
          ai.invoice_type = 'statement'
          or ai.status in ('statement_created', 'statement_sent', 'statement_confirmed')
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
    const mapped = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        ...r,
        docNumber: resolveStatementDocNumber(r.documentStatus),
      };
    });
    return NextResponse.json({ rows: mapped, agentScheduleIds }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

