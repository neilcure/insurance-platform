import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
} from "@/db/schema/accounting";
import { policyPremiums } from "@/db/schema/premiums";
import { policies } from "@/db/schema/insurance";
import { cars } from "@/db/schema/insurance";
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import { generateDocumentNumber } from "@/lib/document-number";
import { resolveDocPrefix } from "@/lib/resolve-prefix";

export const dynamic = "force-dynamic";

let statusColReady = false;
async function ensureStatusCol() {
  if (statusColReady) return;
  await db.execute(sql`
    ALTER TABLE "accounting_invoice_items"
    ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active'
  `);
  statusColReady = true;
}

async function findRelatedPolicyIds(mainPolicyId: number): Promise<number[]> {
  const ids = [mainPolicyId];

  const endorsements = await db.execute(sql`
    SELECT "policy_id" FROM "cars"
    WHERE ((extra_attributes)::jsonb ->> 'linkedPolicyId')::int = ${mainPolicyId}
  `);
  const eRows = Array.isArray(endorsements)
    ? endorsements
    : (endorsements as { rows?: unknown[] }).rows ?? [];
  for (const r of eRows as { policy_id: number }[]) {
    if (r.policy_id && !ids.includes(r.policy_id)) ids.push(r.policy_id);
  }

  const [carRow] = await db
    .select({ extra: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.policyId, mainPolicyId))
    .limit(1);

  if (carRow) {
    const extra = (carRow.extra ?? {}) as Record<string, unknown>;
    const parentId = extra.linkedPolicyId ? Number(extra.linkedPolicyId) : null;
    if (parentId && !ids.includes(parentId)) {
      ids.push(parentId);
      const siblings = await db.execute(sql`
        SELECT "policy_id" FROM "cars"
        WHERE ((extra_attributes)::jsonb ->> 'linkedPolicyId')::int = ${parentId}
          AND "policy_id" != ${mainPolicyId}
      `);
      const sRows = Array.isArray(siblings)
        ? siblings
        : (siblings as { rows?: unknown[] }).rows ?? [];
      for (const r of sRows as { policy_id: number }[]) {
        if (r.policy_id && !ids.includes(r.policy_id)) ids.push(r.policy_id);
      }
    }
  }

  return ids;
}

const PREMIUM_ROLE_MAP: Record<string, "client" | "agent" | "net"> = {
  client_premium: "client",
  agent_premium: "agent",
  net_premium: "net",
};

type ItemResult = {
  id: number;
  policyId: number;
  policyPremiumId: number | null;
  amountCents: number;
  description: string | null;
  status: string;
};

export async function GET(
  request: Request,
  ctx: { params: Promise<{ policyId: string }> },
) {
  try {
    await requireUser();
    const { policyId } = await ctx.params;
    const pid = Number(policyId);
    const url = new URL(request.url);
    const audience = url.searchParams.get("audience");

    await ensureStatusCol();

    const allPolicyIds = await findRelatedPolicyIds(pid);

    const policyItemRows = await db
      .selectDistinct({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(inArray(accountingInvoiceItems.policyId, allPolicyIds));

    if (policyItemRows.length === 0) {
      return NextResponse.json({ statement: null });
    }

    const invoiceIds = policyItemRows.map((r) => r.invoiceId);

    const invoiceRows = await db
      .select({
        id: accountingInvoices.id,
        scheduleId: accountingInvoices.scheduleId,
        invoiceType: accountingInvoices.invoiceType,
        entityType: accountingInvoices.entityType,
      })
      .from(accountingInvoices)
      .where(inArray(accountingInvoices.id, invoiceIds));

    const scheduleIds = [
      ...new Set(
        invoiceRows
          .filter((r) => r.scheduleId != null)
          .map((r) => r.scheduleId as number),
      ),
    ];

    let stmt: {
      id: number;
      invoiceNumber: string;
      status: string;
      totalAmountCents: number;
      paidAmountCents: number;
      currency: string;
      entityType: string;
      entityName: string | null;
      invoiceDate: string | null;
      premiumType: string;
    } | null = null;

    if (scheduleIds.length > 0) {
      const conditions = [
        inArray(accountingInvoices.scheduleId, scheduleIds),
        eq(accountingInvoices.invoiceType, "statement"),
        inArray(accountingInvoices.status, [
          "draft", "pending", "partial", "settled", "active", "statement_created",
        ]),
      ];

      if (audience === "agent") {
        conditions.push(eq(accountingInvoices.entityType, "agent"));
      } else if (audience === "client") {
        conditions.push(eq(accountingInvoices.entityType, "client"));
      }

      const [found] = await db
        .select({
          id: accountingInvoices.id,
          invoiceNumber: accountingInvoices.invoiceNumber,
          status: accountingInvoices.status,
          totalAmountCents: accountingInvoices.totalAmountCents,
          paidAmountCents: accountingInvoices.paidAmountCents,
          currency: accountingInvoices.currency,
          entityType: accountingInvoices.entityType,
          entityName: accountingInvoices.entityName,
          invoiceDate: accountingInvoices.invoiceDate,
          premiumType: accountingInvoices.premiumType,
        })
        .from(accountingInvoices)
        .where(and(...conditions))
        .limit(1);

      if (found) stmt = found;
    }

    if (!stmt) {
      const directStmt = invoiceRows.find(
        (r) =>
          r.invoiceType === "statement" &&
          (!audience || r.entityType === audience),
      );
      if (directStmt) {
        const [found] = await db
          .select({
            id: accountingInvoices.id,
            invoiceNumber: accountingInvoices.invoiceNumber,
            status: accountingInvoices.status,
            totalAmountCents: accountingInvoices.totalAmountCents,
            paidAmountCents: accountingInvoices.paidAmountCents,
            currency: accountingInvoices.currency,
            entityType: accountingInvoices.entityType,
            entityName: accountingInvoices.entityName,
            invoiceDate: accountingInvoices.invoiceDate,
            premiumType: accountingInvoices.premiumType,
          })
          .from(accountingInvoices)
          .where(eq(accountingInvoices.id, directStmt.id))
          .limit(1);
        if (found) stmt = found;
      }
    }

    if (!stmt) {
      return NextResponse.json({ statement: null });
    }

    // Fix statement number if it uses old hardcoded "ST-" prefix instead of template prefix
    if (stmt.invoiceNumber.startsWith("ST-")) {
      try {
        const tplPrefix = await resolveDocPrefix("statement", "ST");
        if (tplPrefix !== "ST") {
          const newNumber = await generateDocumentNumber(tplPrefix);
          await db.update(accountingInvoices).set({ invoiceNumber: newNumber }).where(eq(accountingInvoices.id, stmt.id));
          stmt.invoiceNumber = newNumber;
        }
      } catch { /* non-fatal */ }
    }

    // Get ALL items on the statement
    const rawItems = await db.execute(sql`
      SELECT "id", "policy_id", "policy_premium_id", "amount_cents",
             "description", coalesce("status", 'active') AS "status"
      FROM "accounting_invoice_items"
      WHERE "invoice_id" = ${stmt.id}
      ORDER BY "id"
    `);

    const rawRows = Array.isArray(rawItems)
      ? rawItems
      : (rawItems as { rows?: unknown[] }).rows ?? [];

    const items: ItemResult[] = (
      rawRows as {
        id: number;
        policy_id: number;
        policy_premium_id: number | null;
        amount_cents: number;
        description: string | null;
        status: string;
      }[]
    ).map((r) => ({
      id: r.id,
      policyId: r.policy_id,
      policyPremiumId: r.policy_premium_id,
      amountCents: r.amount_cents,
      description: r.description,
      status: r.status,
    }));

    // Find endorsement items not yet on the statement
    const stmtScheduleId = await db
      .select({ scheduleId: accountingInvoices.scheduleId })
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, stmt.id))
      .limit(1)
      .then((r) => r[0]?.scheduleId ?? null);

    if (stmtScheduleId) {
      const existingPolicyIds = new Set(items.map((it) => it.policyId));
      const missingPolicyIds = allPolicyIds.filter((id) => !existingPolicyIds.has(id));

      if (missingPolicyIds.length > 0) {
        const role = PREMIUM_ROLE_MAP[stmt.premiumType] ?? null;
        const accountingFields = role ? await loadAccountingFields() : null;

        // Get policy numbers for the missing policies
        const policyNumberMap = new Map<number, string>();
        const policyRows = await db
          .select({ id: policies.id, policyNumber: policies.policyNumber })
          .from(policies)
          .where(inArray(policies.id, missingPolicyIds));
        for (const p of policyRows) policyNumberMap.set(p.id, p.policyNumber);

        // Find individual invoices on the same schedule for missing policies
        const missingInvoices = await db
          .select({ id: accountingInvoices.id })
          .from(accountingInvoices)
          .where(
            and(
              eq(accountingInvoices.scheduleId, stmtScheduleId),
              eq(accountingInvoices.invoiceType, "individual"),
              inArray(accountingInvoices.status, [
                "draft", "pending", "partial", "settled", "active", "statement_created",
              ]),
            ),
          );

        if (missingInvoices.length > 0) {
          const missingInvIds = missingInvoices.map((r) => r.id);
          const missingItemsRes = await db.execute(sql`
            SELECT "id", "policy_id", "policy_premium_id", "amount_cents",
                   "description", coalesce("status", 'active') AS "status"
            FROM "accounting_invoice_items"
            WHERE "invoice_id" IN (${sql.join(missingInvIds.map((id) => sql`${id}`), sql`,`)})
              AND "policy_id" IN (${sql.join(missingPolicyIds.map((id) => sql`${id}`), sql`,`)})
            ORDER BY "id"
          `);

          const missingRows = Array.isArray(missingItemsRes)
            ? missingItemsRes
            : (missingItemsRes as { rows?: unknown[] }).rows ?? [];

          for (const r of missingRows as {
            id: number;
            policy_id: number;
            policy_premium_id: number | null;
            amount_cents: number;
            description: string | null;
            status: string;
          }[]) {
            let resolvedAmount = r.amount_cents;

            // Resolve correct premium amount based on statement's premiumType
            if (role && accountingFields && r.policy_premium_id) {
              const [premRow] = await db
                .select()
                .from(policyPremiums)
                .where(eq(policyPremiums.id, r.policy_premium_id))
                .limit(1);
              if (premRow) {
                const resolved = Math.abs(
                  resolvePremiumByRole(
                    premRow as Record<string, unknown>,
                    role,
                    accountingFields,
                  ),
                );
                if (resolved > 0) resolvedAmount = resolved;
              }
            }

            // Include policy number in description
            const polNum = policyNumberMap.get(r.policy_id) ?? "";
            const desc = polNum
              ? `${polNum} · ${r.description ?? "Premium"}`
              : r.description;

            items.push({
              id: r.id,
              policyId: r.policy_id,
              policyPremiumId: r.policy_premium_id,
              amountCents: resolvedAmount,
              description: desc,
              status: r.status,
            });
          }
        }
      }
    }

    const activeTotal = items
      .filter((it) => it.status === "active")
      .reduce((sum, it) => sum + it.amountCents, 0);
    const paidIndividuallyTotal = items
      .filter((it) => it.status === "paid_individually")
      .reduce((sum, it) => sum + it.amountCents, 0);

    // Build premium totals + per-item breakdowns from the actual policy_premiums rows
    const premiumTotals: Record<string, number> = {};
    const itemPremiumMap = new Map<number, Record<string, number>>();
    const premiumIds = [...new Set(items.map((it) => it.policyPremiumId).filter(Boolean))] as number[];
    if (premiumIds.length > 0) {
      try {
        const premRows = await db.select().from(policyPremiums).where(inArray(policyPremiums.id, premiumIds));
        const accountingFields = await loadAccountingFields();
        const { buildFieldColumnMap, getColumnType } = await import("@/lib/accounting-fields");
        const colMap = buildFieldColumnMap(accountingFields);
        for (const row of premRows) {
          const rowValues: Record<string, number> = {};
          for (const f of accountingFields) {
            const mappedCol = colMap[f.key];
            let val: number | null = null;
            if (mappedCol) {
              const rawVal = (row as Record<string, unknown>)[mappedCol];
              if (rawVal != null) {
                val = getColumnType(mappedCol) === "cents" ? Number(rawVal) / 100 : Number(rawVal);
              }
            } else {
              const extra = (row.extraValues ?? {}) as Record<string, unknown>;
              if (extra[f.key] != null) val = Number(extra[f.key]);
            }
            if (val != null && Number.isFinite(val)) {
              premiumTotals[f.key] = (premiumTotals[f.key] ?? 0) + val;
              rowValues[f.key] = val;
            }
          }
          itemPremiumMap.set(row.id, rowValues);
        }
      } catch { /* non-fatal */ }
    }

    const enrichedItems = items.map((it) => ({
      ...it,
      premiums: it.policyPremiumId ? (itemPremiumMap.get(it.policyPremiumId) ?? {}) : {},
    }));

    return NextResponse.json({
      statement: {
        statementNumber: stmt.invoiceNumber,
        statementDate: stmt.invoiceDate,
        statementStatus: stmt.status,
        totalAmountCents: stmt.totalAmountCents,
        paidAmountCents: stmt.paidAmountCents,
        currency: stmt.currency,
        entityType: stmt.entityType,
        entityName: stmt.entityName,
        items: enrichedItems,
        activeTotal,
        paidIndividuallyTotal,
        premiumTotals,
      },
    });
  } catch (err) {
    console.error("GET statements by-policy error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
