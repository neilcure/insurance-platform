import { NextResponse } from "next/server";
import { db } from "@/db/client";
import {
  accountingInvoices,
  accountingInvoiceItems,
  accountingPayments,
  accountingDocuments,
} from "@/db/schema/accounting";
import { policies } from "@/db/schema/insurance";
import { users } from "@/db/schema/core";
import { and, eq, desc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);

    const [invoice] = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const items = await db
      .select({
        id: accountingInvoiceItems.id,
        invoiceId: accountingInvoiceItems.invoiceId,
        policyId: accountingInvoiceItems.policyId,
        policyPremiumId: accountingInvoiceItems.policyPremiumId,
        lineKey: accountingInvoiceItems.lineKey,
        amountCents: accountingInvoiceItems.amountCents,
        description: accountingInvoiceItems.description,
        createdAt: accountingInvoiceItems.createdAt,
        policyNumber: policies.policyNumber,
      })
      .from(accountingInvoiceItems)
      .leftJoin(policies, eq(policies.id, accountingInvoiceItems.policyId))
      .where(eq(accountingInvoiceItems.invoiceId, invoiceId));

    const payments = await db
      .select({
        id: accountingPayments.id,
        invoiceId: accountingPayments.invoiceId,
        amountCents: accountingPayments.amountCents,
        currency: accountingPayments.currency,
        paymentDate: accountingPayments.paymentDate,
        paymentMethod: accountingPayments.paymentMethod,
        referenceNumber: accountingPayments.referenceNumber,
        status: accountingPayments.status,
        notes: accountingPayments.notes,
        submittedBy: accountingPayments.submittedBy,
        verifiedBy: accountingPayments.verifiedBy,
        verifiedAt: accountingPayments.verifiedAt,
        rejectionNote: accountingPayments.rejectionNote,
        createdAt: accountingPayments.createdAt,
        updatedAt: accountingPayments.updatedAt,
      })
      .from(accountingPayments)
      .where(eq(accountingPayments.invoiceId, invoiceId))
      .orderBy(desc(accountingPayments.createdAt));

    const paymentIds = payments.map((p) => p.id);
    let paymentDocs: any[] = [];
    if (paymentIds.length > 0) {
      paymentDocs = await db
        .select()
        .from(accountingDocuments)
        .where(eq(accountingDocuments.invoiceId, invoiceId));
    }

    const documents = await db
      .select()
      .from(accountingDocuments)
      .where(eq(accountingDocuments.invoiceId, invoiceId));

    const childInvoices = await db
      .select()
      .from(accountingInvoices)
      .where(eq(accountingInvoices.parentInvoiceId, invoiceId))
      .orderBy(desc(accountingInvoices.createdAt));

    const paymentsWithDocs = payments.map((p) => ({
      ...p,
      documents: paymentDocs.filter((d: any) => d.paymentId === p.id),
    }));

    return NextResponse.json({
      ...invoice,
      items,
      payments: paymentsWithDocs,
      documents,
      childInvoices,
    });
  } catch (err) {
    console.error("GET /api/accounting/invoices/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const invoiceId = Number(id);
    const body = await request.json();

    const allowedFields: Record<string, boolean> = {
      status: true,
      invoiceDate: true,
      dueDate: true,
      notes: true,
      entityName: true,
      periodStart: true,
      periodEnd: true,
      documentStatus: true,
    };

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields[key]) {
        updates[key] = value;
      }
    }

    const [updated] = await db
      .update(accountingInvoices)
      .set(updates as any)
      .where(eq(accountingInvoices.id, invoiceId))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/accounting/invoices/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const invoiceId = Number(id);

    await db.delete(accountingInvoices).where(eq(accountingInvoices.id, invoiceId));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/accounting/invoices/[id] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
