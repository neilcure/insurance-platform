import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPayments, accountingInvoices, accountingInvoiceItems, accountingDocuments } from "@/db/schema/accounting";
import { policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { clients, memberships, organisations } from "@/db/schema/core";
import { eq, and, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { syncInvoicePaymentStatus, crossSettlePolicyInvoices } from "@/lib/accounting-invoices";
import { createAgentCommissionPayable } from "@/lib/agent-commission";
import { resetPolicyItemsToActive } from "@/lib/statement-management";
import { removeAgentCommissionPayable } from "@/lib/agent-commission";
import { syncPolicyStatusFromPayments } from "@/lib/auto-advance-status";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import { generateDocumentNumber } from "@/lib/document-number";
import { resolveDocPrefix } from "@/lib/resolve-prefix";
import { validateFile, saveFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  Parse body — supports both JSON and FormData (when proof attached) */
/* ------------------------------------------------------------------ */
interface PaymentBody {
  amountCents: number;
  currency: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  notes: string | null;
  payer: string | null;
  proofFile: File | null;
}

async function parseBody(request: Request): Promise<PaymentBody> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const fd = await request.formData();
    return {
      amountCents: Number(fd.get("amountCents") || 0),
      currency: (fd.get("currency") as string) || "HKD",
      paymentDate: (fd.get("paymentDate") as string) || null,
      paymentMethod: (fd.get("paymentMethod") as string) || null,
      referenceNumber: (fd.get("referenceNumber") as string) || null,
      notes: (fd.get("notes") as string) || null,
      payer: (fd.get("payer") as string) || null,
      proofFile: (fd.get("proofFile") as File | null) ?? null,
    };
  }
  const json = await request.json();
  return {
    amountCents: json.amountCents ?? 0,
    currency: json.currency ?? "HKD",
    paymentDate: json.paymentDate ?? null,
    paymentMethod: json.paymentMethod ?? null,
    referenceNumber: json.referenceNumber ?? null,
    notes: json.notes ?? null,
    payer: json.payer ?? null,
    proofFile: null,
  };
}

async function saveProofFile(
  proofFile: File,
  paymentId: number,
  invoiceId: number,
  policyId: number | null,
  userId: number,
): Promise<void> {
  const validation = validateFile(proofFile.name, proofFile.type, proofFile.size);
  if (!validation.valid) return;

  const buffer = Buffer.from(await proofFile.arrayBuffer());
  const storePolicyId = policyId ?? 0;
  const { storedPath } = await saveFile(storePolicyId, proofFile.name, buffer);

  await db.insert(accountingDocuments).values({
    invoiceId,
    paymentId,
    docType: "payment_proof",
    fileName: proofFile.name,
    storedPath,
    fileSize: proofFile.size,
    mimeType: proofFile.type,
    uploadedBy: userId,
  });
}

/**
 * Find or create a client receivable invoice for a policy.
 * Used when agent records "Client Paid Agent" — the payment goes onto
 * the CLIENT's invoice, not the agent's statement.
 */
async function findOrCreateClientInvoice(
  policyId: number,
  agentInvoice: typeof accountingInvoices.$inferSelect,
  userId: number,
): Promise<number> {
  const existingRows = await db
    .select({ id: accountingInvoices.id })
    .from(accountingInvoices)
    .where(
      and(
        eq(accountingInvoices.entityPolicyId, policyId),
        eq(accountingInvoices.entityType, "client"),
        eq(accountingInvoices.direction, "receivable"),
        sql`${accountingInvoices.status} <> 'cancelled'`,
      ),
    )
    .limit(1);

  if (existingRows.length > 0) return existingRows[0].id;

  const [policy] = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      clientId: policies.clientId,
      organisationId: policies.organisationId,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  let clientName = "Client";
  if (policy?.clientId) {
    const [c] = await db.select({ dn: clients.displayName }).from(clients)
      .where(eq(clients.id, policy.clientId)).limit(1);
    if (c?.dn) clientName = c.dn;
  }

  let orgId = policy?.organisationId;
  if (!orgId) {
    const [mem] = await db.select({ orgId: memberships.organisationId }).from(memberships)
      .where(eq(memberships.userId, userId)).limit(1);
    orgId = mem?.orgId ?? null;
    if (!orgId) {
      const [org] = await db.select({ id: organisations.id }).from(organisations).limit(1);
      orgId = org?.id ?? null;
    }
  }
  if (!orgId) throw new Error("Cannot determine organisation");

  const acctFields = await loadAccountingFields();
  const premiums = await db.select().from(policyPremiums).where(eq(policyPremiums.policyId, policyId));

  let totalCents = 0;
  const items: { policyPremiumId: number; lineKey: string; amountCents: number; description: string }[] = [];
  for (const p of premiums) {
    const clientCents = resolvePremiumByRole(p as unknown as Record<string, unknown>, "client", acctFields);
    totalCents += clientCents;
    items.push({
      policyPremiumId: p.id,
      lineKey: p.lineKey,
      amountCents: clientCents,
      description: `Client Premium – ${p.lineKey}`,
    });
  }

  if (totalCents === 0 && agentInvoice.totalAmountCents > 0) {
    totalCents = agentInvoice.totalAmountCents;
  }

  const prefix = await resolveDocPrefix("debit_note", "DN");
  const invoiceNumber = await generateDocumentNumber(prefix);

  const [inv] = await db.insert(accountingInvoices).values({
    organisationId: orgId,
    invoiceNumber,
    invoiceType: "individual",
    direction: "receivable",
    premiumType: "client_premium",
    entityPolicyId: policyId,
    entityType: "client",
    entityName: clientName,
    totalAmountCents: totalCents,
    paidAmountCents: 0,
    currency: agentInvoice.currency,
    invoiceDate: new Date().toISOString().split("T")[0],
    status: "pending",
    notes: `Client Premium – ${policy?.policyNumber ?? policyId}`,
    createdBy: userId,
  }).returning();

  if (items.length > 0) {
    await db.insert(accountingInvoiceItems).values(
      items.map((it) => ({
        invoiceId: inv.id,
        policyId,
        policyPremiumId: it.policyPremiumId,
        lineKey: it.lineKey,
        amountCents: it.amountCents,
        description: it.description,
      })),
    );
  }

  return inv.id;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);
    const body = await parseBody(request);

    const { amountCents, currency, paymentDate, paymentMethod, referenceNumber, notes, payer, proofFile } = body;

    if (!amountCents || amountCents <= 0) {
      return NextResponse.json({ error: "amountCents must be positive" }, { status: 400 });
    }

    const [invoice] = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // --- "Client Paid Agent" flow ---
    if (payer === "client_to_agent" && invoice.entityPolicyId) {
      const clientInvoiceId = await findOrCreateClientInvoice(
        invoice.entityPolicyId,
        invoice,
        Number(user.id),
      );

      const [payment] = await db
        .insert(accountingPayments)
        .values({
          invoiceId: clientInvoiceId,
          amountCents: Math.round(Number(amountCents)),
          currency,
          paymentDate: paymentDate || null,
          paymentMethod: paymentMethod || null,
          referenceNumber: referenceNumber || null,
          payer: "client_to_agent",
          status: "verified",
          notes: notes?.trim() ? notes.trim() : "Client paid agent",
          submittedBy: Number(user.id),
        })
        .returning();

      if (proofFile) {
        try { await saveProofFile(proofFile, payment.id, clientInvoiceId, invoice.entityPolicyId, Number(user.id)); } catch {}
      }

      await syncInvoicePaymentStatus(clientInvoiceId);

      try {
        await syncPolicyStatusFromPayments(invoice.entityPolicyId, `user:${user.id}`);
      } catch {}

      return NextResponse.json(payment, { status: 201 });
    }

    // --- Normal payment flow ---
    const isReceivable = invoice.direction === "receivable";

    const [payment] = await db
      .insert(accountingPayments)
      .values({
        invoiceId,
        amountCents: Math.round(Number(amountCents)),
        currency,
        paymentDate: paymentDate || null,
        paymentMethod: paymentMethod || null,
        referenceNumber: referenceNumber || null,
        payer: payer || null,
        status: isReceivable ? "submitted" : "recorded",
        notes: notes || null,
        submittedBy: Number(user.id),
      })
      .returning();

    if (proofFile) {
      try { await saveProofFile(proofFile, payment.id, invoiceId, invoice.entityPolicyId, Number(user.id)); } catch {}
    }

    if (!isReceivable) {
      await syncInvoicePaymentStatus(invoiceId);
    }

    if (isReceivable && invoice.entityPolicyId) {
      if (!payer || payer === "client") {
        try {
          await createAgentCommissionPayable(invoice.entityPolicyId, Number(user.id));
        } catch (err) {
          console.error("Agent commission creation failed (non-fatal):", err);
        }
      }

      await syncInvoicePaymentStatus(invoiceId);

      try {
        await crossSettlePolicyInvoices(invoice.entityPolicyId, payer || null);
      } catch (err) {
        console.error("Cross-settlement failed (non-fatal):", err);
      }

      try {
        await syncPolicyStatusFromPayments(invoice.entityPolicyId, `user:${user.id}`);
      } catch (err) {
        console.error("Status sync on payment failed (non-fatal):", err);
      }
    }

    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/invoices/[id]/payments error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const invoiceId = Number(id);
    const url = new URL(request.url);
    const paymentId = Number(url.searchParams.get("paymentId"));

    if (!Number.isFinite(paymentId) || paymentId <= 0) {
      return NextResponse.json({ error: "paymentId required" }, { status: 400 });
    }

    const [payment] = await db
      .select()
      .from(accountingPayments)
      .where(and(eq(accountingPayments.id, paymentId), eq(accountingPayments.invoiceId, invoiceId)))
      .limit(1);

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    await db.delete(accountingPayments).where(eq(accountingPayments.id, paymentId));
    await syncInvoicePaymentStatus(invoiceId);

    const remainingPayments = await db
      .select({ id: accountingPayments.id })
      .from(accountingPayments)
      .where(eq(accountingPayments.invoiceId, invoiceId))
      .limit(1);
    const noPaymentsLeft = remainingPayments.length === 0;

    const affectedPolicyIds = new Set<number>();
    const [inv] = await db
      .select({ entityPolicyId: accountingInvoices.entityPolicyId })
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);
    if (inv?.entityPolicyId) affectedPolicyIds.add(inv.entityPolicyId);

    const itemRows = await db
      .select({ policyId: accountingInvoiceItems.policyId })
      .from(accountingInvoiceItems)
      .where(and(
        eq(accountingInvoiceItems.invoiceId, invoiceId),
        sql`${accountingInvoiceItems.policyId} > 0`,
      ));
    for (const r of itemRows) affectedPolicyIds.add(r.policyId);

    if (noPaymentsLeft) {
      for (const pid of affectedPolicyIds) {
        try { await resetPolicyItemsToActive(pid); } catch {}
        try { await removeAgentCommissionPayable(pid); } catch {}
      }
    }

    for (const pid of affectedPolicyIds) {
      try { await syncPolicyStatusFromPayments(pid, `user:${user.id}`); } catch {}
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/accounting/invoices/[id]/payments error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

