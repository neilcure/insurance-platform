import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { memberships, organisations } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import type { DocumentStatusMap, DocumentStatusEntry, DocLifecycleStatus } from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;

    const [policy] = await db
      .select({ documentTracking: policies.documentTracking })
      .from(policies)
      .where(eq(policies.id, Number(id)))
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    return NextResponse.json(policy.documentTracking ?? {});
  } catch (err) {
    console.error("GET document-tracking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const policyId = Number(id);
    const body = await request.json();

    const { docType, action, sentTo, rejectionNote } = body as {
      docType: string;
      action: "send" | "confirm" | "reject" | "reset";
      sentTo?: string;
      rejectionNote?: string;
    };

    if (!docType || typeof docType !== "string") {
      return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
    }

    const [policy] = await db
      .select({ documentTracking: policies.documentTracking })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const existing: DocumentStatusMap = (policy.documentTracking as DocumentStatusMap | null) ?? {};
    const entry: DocumentStatusEntry = existing[docType] ?? ({} as DocumentStatusEntry);
    const now = new Date().toISOString();

    let newStatus: DocLifecycleStatus;

    switch (action) {
      case "send":
        newStatus = "sent";
        break;
      case "confirm":
        newStatus = "confirmed";
        break;
      case "reject":
        newStatus = "rejected";
        break;
      case "reset": {
        const updated = { ...existing };
        delete updated[docType];
        await db.update(policies).set({ documentTracking: updated }).where(eq(policies.id, policyId));
        return NextResponse.json({ documentTracking: updated });
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const updatedEntry: DocumentStatusEntry = {
      ...entry,
      status: newStatus,
      ...(action === "send" && { sentAt: now, sentTo: sentTo || entry.sentTo }),
      ...(action === "confirm" && { confirmedAt: now }),
      ...(action === "reject" && { rejectedAt: now, rejectionNote: rejectionNote || undefined }),
    };

    const updatedMap: DocumentStatusMap = {
      ...existing,
      [docType]: updatedEntry,
    };

    await db
      .update(policies)
      .set({ documentTracking: updatedMap })
      .where(eq(policies.id, policyId));

    // Auto-create accounting invoice when an invoice-type document is confirmed
    const invoiceKeys = ["invoice", "quotation", "receipt", "statement_invoice"];
    const isInvoiceType = invoiceKeys.some((k) => docType.includes(k));

    if (action === "confirm" && isInvoiceType) {
      try {
        await autoCreateAccountingInvoice(policyId, docType, Number(user.id));
      } catch (err) {
        console.error("Auto-create accounting invoice error (non-fatal):", err);
      }
    }

    return NextResponse.json({ documentTracking: updatedMap });
  } catch (err) {
    console.error("POST document-tracking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function autoCreateAccountingInvoice(policyId: number, docType: string, userId: number) {
  // Skip if an invoice already exists for this policy to avoid duplicates
  const existing = await db
    .select({ id: accountingInvoiceItems.id })
    .from(accountingInvoiceItems)
    .where(eq(accountingInvoiceItems.policyId, policyId))
    .limit(1);
  if (existing.length > 0) return;

  const premiums = await db
    .select()
    .from(policyPremiums)
    .where(eq(policyPremiums.policyId, policyId));

  if (premiums.length === 0) return;

  const [policy] = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      organisationId: policies.organisationId,
      clientId: policies.clientId,
      agentId: policies.agentId,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!policy) return;

  let organisationId = policy.organisationId;
  if (!organisationId) {
    const [mem] = await db
      .select({ orgId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .limit(1);
    organisationId = mem?.orgId ?? null;
    if (!organisationId) {
      const [org] = await db.select({ id: organisations.id }).from(organisations).limit(1);
      organisationId = org?.id ?? null;
    }
  }
  if (!organisationId) return;

  const isReceipt = docType.includes("receipt");
  const direction = "receivable";
  const premiumType = "client_premium";
  const entityType = "client";

  const prefix = "AR";
  const year = new Date().getFullYear();
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accountingInvoices)
    .where(
      and(
        eq(accountingInvoices.organisationId, organisationId),
        sql`extract(year from ${accountingInvoices.createdAt}) = ${year}`,
      ),
    );
  const count = (countResult[0]?.count ?? 0) + 1;
  const invoiceNumber = `${prefix}-${year}-${String(count).padStart(4, "0")}`;

  let totalAmountCents = 0;
  const items: Array<{ policyId: number; policyPremiumId: number; lineKey: string; amountCents: number; description: string }> = [];

  for (const p of premiums) {
    const extra = (p.extraValues ?? {}) as Record<string, unknown>;
    let amt = p.clientPremiumCents ?? p.grossPremiumCents ?? 0;
    if (amt === 0) {
      // extra_values may use custom keys — try common patterns (values in whole dollars)
      const clientVal = Number(extra.clientPremium ?? extra.cpremium ?? extra.client_premium ?? 0);
      const grossVal = Number(extra.grossPremium ?? extra.gpremium ?? extra.gross_premium ?? 0);
      const displayVal = clientVal || grossVal;
      if (displayVal) amt = Math.round(displayVal * 100);
    }
    totalAmountCents += amt;
    items.push({
      policyId,
      policyPremiumId: p.id,
      lineKey: p.lineKey,
      amountCents: amt,
      description: p.lineLabel || p.lineKey,
    });
  }

  await db.transaction(async (tx) => {
    const [invoice] = await tx
      .insert(accountingInvoices)
      .values({
        organisationId,
        invoiceNumber,
        invoiceType: "individual",
        direction,
        premiumType,
        entityPolicyId: policyId,
        entityType,
        entityName: null,
        totalAmountCents,
        paidAmountCents: 0,
        currency: premiums[0]?.currency ?? "HKD",
        invoiceDate: new Date().toISOString().split("T")[0],
        status: isReceipt ? "paid" : "pending",
        notes: `Auto-created from document tracking (${docType} confirmed)`,
        createdBy: userId,
      })
      .returning();

    if (items.length > 0) {
      await tx.insert(accountingInvoiceItems).values(
        items.map((item) => ({
          invoiceId: invoice.id,
          policyId: item.policyId,
          policyPremiumId: item.policyPremiumId,
          lineKey: item.lineKey,
          amountCents: item.amountCents,
          description: item.description,
        })),
      );
    }
  });
}
