import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPayments, accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { eq, and, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { syncInvoicePaymentStatus, crossSettlePolicyInvoices } from "@/lib/accounting-invoices";
import { createAgentCommissionPayable } from "@/lib/agent-commission";
import { resetPolicyItemsToActive } from "@/lib/statement-management";
import { removeAgentCommissionPayable } from "@/lib/agent-commission";
import { syncPolicyStatusFromPayments } from "@/lib/auto-advance-status";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);
    const body = await request.json();

    const {
      amountCents,
      currency = "HKD",
      paymentDate,
      paymentMethod,
      referenceNumber,
      notes,
      payer,
    } = body;

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

