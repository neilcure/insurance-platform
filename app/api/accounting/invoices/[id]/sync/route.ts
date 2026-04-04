import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
} from "@/db/schema/accounting";
import { policyPremiums } from "@/db/schema/premiums";
import { eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields, resolvePremiumTypeColumn, type AccountingFieldDef } from "@/lib/accounting-fields";

const CENTS_COLUMNS = [
  "grossPremiumCents", "netPremiumCents", "clientPremiumCents",
  "agentPremiumCents", "agentCommissionCents", "creditPremiumCents",
  "levyCents", "stampDutyCents", "discountCents",
];

function computeGainFromFields(colVals: Record<string, number>, fields: AccountingFieldDef[]): number {
  let client = 0, net = 0, agent = 0;
  for (const f of fields) {
    if (!f.premiumColumn) continue;
    const val = colVals[f.premiumColumn] ?? 0;
    const role = f.premiumRole;
    const lbl = role ? "" : f.label.toLowerCase();
    if (role === "client" || (!role && lbl.includes("client"))) client = val;
    else if (role === "net" || (!role && lbl.includes("net"))) net = val;
    else if (role === "agent" || (!role && lbl.includes("agent"))) agent = val;
  }
  return agent > 0 ? agent - net : client - net;
}

export const dynamic = "force-dynamic";

/**
 * POST /api/accounting/invoices/[id]/sync
 *
 * Re-syncs invoice item amounts from current policy_premiums data.
 * Only allowed for draft/pending invoices (unless force=true for admin).
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);

    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    const [invoice] = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const safeStatuses = ["draft", "pending"];
    if (!safeStatuses.includes(invoice.status) && !force) {
      return NextResponse.json(
        { error: `Cannot sync a ${invoice.status} invoice. Use force=true to override.` },
        { status: 400 },
      );
    }

    if (invoice.invoiceType === "credit_note") {
      return NextResponse.json(
        { error: "Cannot sync credit notes — they are fixed records" },
        { status: 400 },
      );
    }

    const items = await db
      .select()
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.invoiceId, invoiceId));

    const premiumIds = items
      .map((i) => i.policyPremiumId)
      .filter((id): id is number => id != null);

    if (premiumIds.length === 0) {
      return NextResponse.json({
        synced: 0,
        totalAmountCents: invoice.totalAmountCents,
        debug: { premiumType: invoice.premiumType, reason: "No items have policyPremiumId" },
      });
    }

    const premiums = await db
      .select()
      .from(policyPremiums)
      .where(inArray(policyPremiums.id, premiumIds));

    const centsColumns = CENTS_COLUMNS;

    const resolvedMap = new Map(premiums.map((p) => {
      const row = p as Record<string, unknown>;
      const vals: Record<string, number> = {};
      for (const col of centsColumns) {
        vals[col] = (row[col] as number) ?? 0;
      }
      return [p.id, vals];
    }));

    const accountingFields = await loadAccountingFields();
    const resolved = resolvePremiumTypeColumn(invoice.premiumType, accountingFields);
    const syncColumn = resolved.column;
    const colLabel = resolved.label;

    let newTotalCents = 0;
    let syncedCount = 0;
    const itemDetails: Array<{
      itemId: number;
      lineKey: string | null;
      oldCents: number;
      newCents: number;
      allColumns: Record<string, number>;
    }> = [];

    await db.transaction(async (tx) => {
      for (const item of items) {
        if (!item.policyPremiumId) {
          newTotalCents += item.amountCents;
          continue;
        }

        const colVals = resolvedMap.get(item.policyPremiumId);
        if (!colVals) {
          newTotalCents += item.amountCents;
          continue;
        }

        const currentCents = Math.abs(colVals[syncColumn] ?? 0);
        const liveGain = computeGainFromFields(colVals, accountingFields);

        itemDetails.push({
          itemId: item.id,
          lineKey: item.lineKey,
          oldCents: item.amountCents,
          newCents: currentCents,
          allColumns: { ...colVals },
        });

        const updates: Record<string, unknown> = {};
        if (currentCents !== item.amountCents) {
          updates.amountCents = currentCents;
          syncedCount++;
        }
        if (liveGain !== (item.gainCents ?? 0)) {
          updates.gainCents = liveGain;
          if (!updates.amountCents) syncedCount++;
        }

        if (Object.keys(updates).length > 0) {
          await tx
            .update(accountingInvoiceItems)
            .set(updates)
            .where(eq(accountingInvoiceItems.id, item.id));
        }

        newTotalCents += currentCents;
      }

      if (newTotalCents !== invoice.totalAmountCents) {
        await tx
          .update(accountingInvoices)
          .set({
            totalAmountCents: newTotalCents,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(accountingInvoices.id, invoiceId));
      }
    });

    return NextResponse.json({
      synced: syncedCount,
      totalAmountCents: newTotalCents,
      previousTotalCents: invoice.totalAmountCents,
      debug: {
        premiumType: invoice.premiumType,
        columnRead: syncColumn,
        columnLabel: colLabel,
        items: itemDetails,
      },
    });
  } catch (err) {
    console.error("POST /api/accounting/invoices/[id]/sync error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
