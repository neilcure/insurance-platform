import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPayments, accountingInvoices } from "@/db/schema/accounting";
import { users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { sendPaymentStatusEmail } from "@/lib/accounting-notifications";
import { getBaseUrlFromRequestUrl } from "@/lib/email";
import { syncInvoicePaymentStatus, crossSettlePolicyInvoices } from "@/lib/accounting-invoices";
import { createAgentCommissionPayable } from "@/lib/agent-commission";
import { markAgentPolicyItemsPaidIndividually, markPolicyPaidOnAgentStatement } from "@/lib/statement-management";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();

    if (user.userType !== "admin" && user.userType !== "internal_staff" && user.userType !== "accounting") {
      return NextResponse.json({ error: "Only admin/accounting can verify payments" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const invoiceId = Number(id);
    const body = await request.json();
    const { paymentId, action, rejectionNote } = body;

    if (!paymentId || !action) {
      return NextResponse.json({ error: "paymentId and action required" }, { status: 400 });
    }

    if (action !== "verify" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'verify' or 'reject'" }, { status: 400 });
    }

    const [payment] = await db
      .select()
      .from(accountingPayments)
      .where(eq(accountingPayments.id, Number(paymentId)))
      .limit(1);

    if (!payment || payment.invoiceId !== invoiceId) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.status !== "submitted") {
      return NextResponse.json({ error: "Payment is not in submitted status" }, { status: 400 });
    }

    const now = new Date().toISOString();

    if (action === "verify") {
      await db
        .update(accountingPayments)
        .set({
          status: "verified",
          verifiedBy: Number(user.id),
          verifiedAt: now,
          updatedAt: now,
        })
        .where(eq(accountingPayments.id, Number(paymentId)));

      await syncInvoicePaymentStatus(invoiceId);
      await db
        .update(accountingInvoices)
        .set({
          verifiedBy: Number(user.id),
          verifiedAt: now,
          updatedAt: now,
        })
        .where(eq(accountingInvoices.id, invoiceId));

      const [inv] = await db
        .select({ entityPolicyId: accountingInvoices.entityPolicyId })
        .from(accountingInvoices)
        .where(eq(accountingInvoices.id, invoiceId))
        .limit(1);

      if (inv?.entityPolicyId) {
        if (!payment.payer || payment.payer === "client") {
          try {
            await createAgentCommissionPayable(inv.entityPolicyId, Number(user.id));
          } catch (commErr) {
            console.error("Agent commission creation on verify failed (non-fatal):", commErr);
          }
          try {
            await markAgentPolicyItemsPaidIndividually(inv.entityPolicyId);
          } catch {}
        }
        if (payment.payer === "agent") {
          try {
            await markPolicyPaidOnAgentStatement(inv.entityPolicyId);
          } catch {}
        }
        try {
          await crossSettlePolicyInvoices(inv.entityPolicyId, payment.payer || null);
        } catch {}
      }
    } else {
      await db
        .update(accountingPayments)
        .set({
          status: "rejected",
          verifiedBy: Number(user.id),
          verifiedAt: now,
          rejectionNote: rejectionNote || null,
          updatedAt: now,
        })
        .where(eq(accountingPayments.id, Number(paymentId)));
    }

    // Best-effort email notification to the payment submitter
    try {
      if (payment.submittedBy) {
        const [submitter] = await db
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, payment.submittedBy))
          .limit(1);

        const [inv] = await db
          .select({ invoiceNumber: accountingInvoices.invoiceNumber, currency: accountingInvoices.currency })
          .from(accountingInvoices)
          .where(eq(accountingInvoices.id, invoiceId))
          .limit(1);

        if (submitter?.email && inv) {
          const appUrl = getBaseUrlFromRequestUrl(request.url);
          void sendPaymentStatusEmail({
            recipientEmail: submitter.email,
            recipientName: submitter.name || undefined,
            invoiceNumber: inv.invoiceNumber,
            paymentAmount: (payment.amountCents / 100).toFixed(2),
            currency: inv.currency,
            action,
            rejectionNote: action === "reject" ? (rejectionNote || undefined) : undefined,
            appUrl,
          });
        }
      }
    } catch {}

    return NextResponse.json({ success: true, action });
  } catch (err) {
    console.error("POST /api/accounting/invoices/[id]/verify error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
