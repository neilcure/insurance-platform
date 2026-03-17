import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyPremiums } from "@/db/schema/premiums";
import { policies } from "@/db/schema/insurance";
import { memberships } from "@/db/schema/core";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const ACCOUNTING_PKG = "accounting";

const CENTS_FIELD_MAP: Record<string, string> = {
  grossPremium: "grossPremiumCents",
  netPremium: "netPremiumCents",
  clientPremium: "clientPremiumCents",
  agentCommission: "agentCommissionCents",
};
const RATE_KEY = "commissionRate";
const CURRENCY_KEY = "currency";

type Ctx = { params: Promise<{ id: string }> };

type FieldDef = {
  key: string;
  label: string;
  inputType: string;
  sortOrder: number;
  groupOrder?: number;
  groupName?: string;
  options?: Array<{ value: string; label: string }>;
};

type LineTemplate = { key: string; label: string };

type CoverTypeOption = {
  value: string;
  label: string;
  accountingLines?: LineTemplate[];
};

type LineData = {
  lineKey: string;
  lineLabel: string;
  values: Record<string, unknown>;
  margin: number | null;
  updatedAt: string | null;
};

async function loadAccountingFields(): Promise<FieldDef[]> {
  const groupKey = `${ACCOUNTING_PKG}_fields`;
  const rows = await db
    .select()
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.isActive, true)))
    .orderBy(formOptions.sortOrder);

  return rows
    .map((r) => {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      const opts = Array.isArray(m?.options)
        ? (m.options as Array<{ value?: unknown; label?: unknown }>).map((o) => ({
            value: String(o?.value ?? o?.label ?? ""),
            label: String(o?.label ?? o?.value ?? ""),
          }))
        : [];
      return {
        key: String(r.value ?? ""),
        label: String(r.label ?? r.value ?? ""),
        inputType: String(m?.inputType ?? "text"),
        sortOrder: Number(r.sortOrder ?? 0),
        groupOrder: Number(m?.groupOrder ?? 0),
        groupName: typeof m?.group === "string" ? m.group : "",
        options: opts.length > 0 ? opts : undefined,
      };
    })
    .filter((f) => f.key);
}

async function loadCoverTypeOptions(): Promise<CoverTypeOption[]> {
  try {
    const rows = await db
      .select()
      .from(formOptions)
      .where(and(eq(formOptions.groupKey, "policy_category"), eq(formOptions.isActive, true)))
      .orderBy(formOptions.sortOrder);

    return rows.map((r) => {
      const m = (r.meta ?? {}) as Record<string, unknown>;
      return {
        value: String(r.value ?? ""),
        label: String(r.label ?? r.value ?? ""),
        accountingLines: Array.isArray(m?.accountingLines) ? (m.accountingLines as LineTemplate[]) : undefined,
      };
    });
  } catch {
    return [];
  }
}

async function verifyPolicyAccess(
  policyId: number,
  user: Awaited<ReturnType<typeof requireUser>>,
) {
  const polCols = await getPolicyColumns();
  if (user.userType === "admin" || user.userType === "internal_staff" || user.userType === "accounting") {
    const [row] = await db.select({ id: policies.id }).from(policies).where(eq(policies.id, policyId)).limit(1);
    return !!row;
  }
  if (user.userType === "agent") {
    if (!polCols.hasAgentId) return false;
    const result = await db.execute(
      sql`select 1 from "policies" where "id" = ${policyId} and "agent_id" = ${Number(user.id)} limit 1`,
    );
    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    return rows.length > 0;
  }
  const rows = await db
    .select({ id: policies.id })
    .from(policies)
    .innerJoin(memberships, and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id))))
    .where(eq(policies.id, policyId))
    .limit(1);
  return rows.length > 0;
}

function canEditPremiums(userType: string): boolean {
  return ["admin", "internal_staff", "accounting"].includes(userType);
}

function centsToDisplay(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

function displayToCents(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function rowToLineData(row: typeof policyPremiums.$inferSelect, fields: FieldDef[]): LineData {
  const extra = (row.extraValues ?? {}) as Record<string, unknown>;
  const vals: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.key in CENTS_FIELD_MAP) {
      const col = CENTS_FIELD_MAP[f.key] as keyof typeof row;
      vals[f.key] = centsToDisplay(row[col] as number | null);
    } else if (f.key === RATE_KEY) {
      vals[f.key] = row.commissionRate !== null ? Number(row.commissionRate) : null;
    } else if (f.key === CURRENCY_KEY) {
      vals[f.key] = row.currency;
    } else {
      vals[f.key] = extra[f.key] ?? null;
    }
  }
  const client = Number(vals.clientPremium) || 0;
  const net = Number(vals.netPremium) || 0;
  const agent = Number(vals.agentCommission) || 0;
  const margin = client === 0 && net === 0 && agent === 0 ? null : client - net - agent;
  return { lineKey: row.lineKey, lineLabel: row.lineLabel ?? row.lineKey, values: vals, margin, updatedAt: row.updatedAt };
}

export async function GET(_: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const hasAccess = await verifyPolicyAccess(policyId, user);
    if (!hasAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [fields, coverTypeOptions] = await Promise.all([loadAccountingFields(), loadCoverTypeOptions()]);

    let rows: (typeof policyPremiums.$inferSelect)[] = [];
    try {
      rows = await db.select().from(policyPremiums).where(eq(policyPremiums.policyId, policyId)).orderBy(policyPremiums.createdAt);
    } catch { /* table may not exist */ }

    const lines: LineData[] = rows.map((r) => rowToLineData(r, fields));

    return NextResponse.json({ policyId, fields, lines, coverTypeOptions });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    if (!canEditPremiums(user.userType)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const hasAccess = await verifyPolicyAccess(policyId, user);
    if (!hasAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const lineKey = typeof body.lineKey === "string" && body.lineKey.trim() ? body.lineKey.trim() : "main";
    const lineLabel = typeof body.lineLabel === "string" && body.lineLabel.trim() ? body.lineLabel.trim() : null;
    const incomingValues = (body.values ?? {}) as Record<string, unknown>;
    const fields = await loadAccountingFields();

    let currencyVal = "HKD";
    let rateVal: string | null = null;
    const structuredCents: Record<string, number | null> = {};
    const extraValues: Record<string, unknown> = {};

    for (const f of fields) {
      const val = incomingValues[f.key];
      if (f.key in CENTS_FIELD_MAP) {
        structuredCents[CENTS_FIELD_MAP[f.key]] = displayToCents(val);
      } else if (f.key === RATE_KEY) {
        const n = Number(val);
        rateVal = Number.isFinite(n) ? n.toFixed(2) : null;
      } else if (f.key === CURRENCY_KEY) {
        currencyVal = typeof val === "string" && val.trim() ? val.trim().toUpperCase() : "HKD";
      } else {
        extraValues[f.key] = val === "" ? null : (val ?? null);
      }
    }

    const dbPayload = {
      lineLabel,
      currency: currencyVal,
      grossPremiumCents: structuredCents.grossPremiumCents ?? null,
      netPremiumCents: structuredCents.netPremiumCents ?? null,
      clientPremiumCents: structuredCents.clientPremiumCents ?? null,
      agentCommissionCents: structuredCents.agentCommissionCents ?? null,
      commissionRate: rateVal,
      extraValues: Object.keys(extraValues).length > 0 ? extraValues : null,
      updatedBy: Number(user.id),
      updatedAt: new Date().toISOString(),
    };

    const [existing] = await db
      .select({ id: policyPremiums.id })
      .from(policyPremiums)
      .where(and(eq(policyPremiums.policyId, policyId), eq(policyPremiums.lineKey, lineKey)))
      .limit(1);

    let row;
    if (existing) {
      [row] = await db.update(policyPremiums).set(dbPayload).where(and(eq(policyPremiums.policyId, policyId), eq(policyPremiums.lineKey, lineKey))).returning();
    } else {
      [row] = await db.insert(policyPremiums).values({ policyId, lineKey, ...dbPayload }).returning();
    }

    return NextResponse.json({ policyId, line: rowToLineData(row, fields) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    if (!canEditPremiums(user.userType)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    const url = new URL(request.url);
    const lineKey = url.searchParams.get("lineKey") ?? "";
    if (!lineKey) return NextResponse.json({ error: "lineKey is required" }, { status: 400 });

    const hasAccess = await verifyPolicyAccess(policyId, user);
    if (!hasAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(policyPremiums).where(and(eq(policyPremiums.policyId, policyId), eq(policyPremiums.lineKey, lineKey)));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
