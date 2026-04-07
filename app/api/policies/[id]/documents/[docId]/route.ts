import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyDocuments } from "@/db/schema/documents";
import { accountingPayments, accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { deleteFile } from "@/lib/storage";
import { appendPolicyAudit } from "@/lib/audit";
import { syncInvoicePaymentStatus, crossSettlePolicyInvoices } from "@/lib/accounting-invoices";
import { createAgentCommissionPayable } from "@/lib/agent-commission";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Only admins can verify/reject documents" }, { status: 403 });
    }

    const { docId: docIdParam } = await ctx.params;
    const docId = Number(docIdParam);
    if (!Number.isFinite(docId) || docId <= 0) {
      return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
    }

    const body = (await request.json()) as {
      status?: "verified" | "rejected";
      rejectionNote?: string;
    };

    if (!body.status || !["verified", "rejected"].includes(body.status)) {
      return NextResponse.json({ error: "status must be 'verified' or 'rejected'" }, { status: 400 });
    }

    const [existing] = await db
      .select({
        id: policyDocuments.id,
        policyId: policyDocuments.policyId,
        fileName: policyDocuments.fileName,
        documentTypeKey: policyDocuments.documentTypeKey,
        status: policyDocuments.status,
        paymentMeta: policyDocuments.paymentMeta,
        uploadedBy: policyDocuments.uploadedBy,
      })
      .from(policyDocuments)
      .where(eq(policyDocuments.id, docId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {
      status: body.status,
    };

    if (body.status === "verified") {
      updateData.verifiedBy = Number(user.id);
      updateData.verifiedAt = new Date().toISOString();
      updateData.rejectionNote = null;
    } else {
      updateData.rejectionNote = body.rejectionNote || "Rejected by admin";
      updateData.verifiedBy = null;
      updateData.verifiedAt = null;
    }

    const [updated] = await db
      .update(policyDocuments)
      .set(updateData)
      .where(eq(policyDocuments.id, docId))
      .returning();

    const userEmail = (user as { email?: string }).email ?? "";
    const auditChanges: { key: string; from: string | null; to: string | null }[] = [
      { key: "document_status", from: existing.status, to: body.status },
    ];
    if (body.status === "rejected" && body.rejectionNote) {
      auditChanges.push({ key: "document_rejection_note", from: null, to: body.rejectionNote });
    }
    await appendPolicyAudit(existing.policyId, { id: Number(user.id), email: userEmail }, [
      { key: `document_${body.status}`, from: existing.fileName, to: `${existing.fileName} (${existing.documentTypeKey})` },
      ...auditChanges,
    ]);

    if (body.status === "verified") {
      const { checkAndAutoComplete } = await import("@/lib/reminder-sender");
      await checkAndAutoComplete(existing.policyId, existing.documentTypeKey);

      const meta = existing.paymentMeta as { amountCents?: number; method?: string; date?: string | null; ref?: string | null; payer?: string } | null;
      if (meta?.amountCents && meta.method) {
        try {
          const { advancePolicyStatus } = await import("@/lib/auto-advance-status");
          await advancePolicyStatus(
            existing.policyId,
            "payment_received",
            userEmail || `user:${user.id}`,
            `Auto: payment proof verified (${existing.documentTypeKey})`,
          );
        } catch (statusErr) {
          console.error("Auto-advance status on payment verify failed (non-fatal):", statusErr);
        }
        try {
          let invoiceItemRows = await db
            .select({ invoiceId: accountingInvoiceItems.invoiceId })
            .from(accountingInvoiceItems)
            .where(eq(accountingInvoiceItems.policyId, existing.policyId));

          if (invoiceItemRows.length === 0) {
            const { autoCreateAccountingInvoices } = await import("@/lib/auto-create-invoices");
            await autoCreateAccountingInvoices(existing.policyId, "policy", Number(user.id));
            invoiceItemRows = await db
              .select({ invoiceId: accountingInvoiceItems.invoiceId })
              .from(accountingInvoiceItems)
              .where(eq(accountingInvoiceItems.policyId, existing.policyId));
          }

          const invoiceIds = [...new Set(invoiceItemRows.map((r) => r.invoiceId))];
          if (invoiceIds.length > 0) {
            const [invoice] = await db
              .select()
              .from(accountingInvoices)
              .where(and(eq(accountingInvoices.direction, "receivable"), inArray(accountingInvoices.id, invoiceIds)))
              .orderBy(desc(accountingInvoices.createdAt))
              .limit(1);

            if (invoice) {
              const existingPayments = await db
                .select({ id: accountingPayments.id })
                .from(accountingPayments)
                .where(eq(accountingPayments.invoiceId, invoice.id))
                .limit(1);

              if (existingPayments.length === 0) {
                await db.insert(accountingPayments).values({
                  invoiceId: invoice.id,
                  amountCents: meta.amountCents,
                  currency: invoice.currency,
                  paymentDate: meta.date ?? null,
                  paymentMethod: meta.method,
                  referenceNumber: meta.ref ?? null,
                  payer: (meta.payer as "client" | "agent") || "client",
                  status: "verified",
                  submittedBy: existing.uploadedBy ?? Number(user.id),
                  verifiedBy: Number(user.id),
                  verifiedAt: new Date().toISOString(),
                });
                await syncInvoicePaymentStatus(invoice.id);

                if (!meta.payer || meta.payer === "client") {
                  try {
                    await createAgentCommissionPayable(existing.policyId, Number(user.id));
                  } catch {}
                }

                try {
                  await crossSettlePolicyInvoices(existing.policyId, meta.payer || "client");
                } catch {}
              }
            }
          }
        } catch (payErr) {
          console.error("Payment reconciliation on document verify failed (non-fatal):", payErr);
        }
      }
    }

    // Recalculate status when rejecting a previously verified document
    if (body.status === "rejected" && existing.status === "verified") {
      try {
        const { recalculatePolicyStatus } = await import("@/lib/auto-advance-status");
        const rolledBack = await recalculatePolicyStatus(
          existing.policyId,
          userEmail || `user:${user.id}`,
          `${existing.documentTypeKey} verification rejected`,
        );
        if (rolledBack) {
          return NextResponse.json({ ...updated, statusRolledBack: rolledBack }, { status: 200 });
        }
      } catch (statusErr) {
        console.error("Status recalculate on reject failed (non-fatal):", statusErr);
      }
    }

    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Only admins can delete documents" }, { status: 403 });
    }

    const { docId: docIdParam } = await ctx.params;
    const docId = Number(docIdParam);
    if (!Number.isFinite(docId) || docId <= 0) {
      return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
    }

    const [doc] = await db
      .select({
        id: policyDocuments.id,
        policyId: policyDocuments.policyId,
        storedPath: policyDocuments.storedPath,
        fileName: policyDocuments.fileName,
        documentTypeKey: policyDocuments.documentTypeKey,
        paymentMeta: policyDocuments.paymentMeta,
      })
      .from(policyDocuments)
      .where(eq(policyDocuments.id, docId))
      .limit(1);

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await deleteFile(doc.storedPath);
    await db.delete(policyDocuments).where(eq(policyDocuments.id, docId));

    const isPaymentDoc = !!doc.paymentMeta || await (async () => {
      const { formOptions } = await import("@/db/schema/form_options");
      const [typeRow] = await db
        .select({ meta: formOptions.meta })
        .from(formOptions)
        .where(and(eq(formOptions.groupKey, "upload_document_types"), eq(formOptions.value, doc.documentTypeKey)))
        .limit(1);
      return !!(typeRow?.meta as Record<string, unknown> | null)?.requirePaymentDetails;
    })();

    if (isPaymentDoc) {
      try {
        const invoiceItemRows = await db
          .select({ invoiceId: accountingInvoiceItems.invoiceId })
          .from(accountingInvoiceItems)
          .where(eq(accountingInvoiceItems.policyId, doc.policyId));
        const invoiceIds = [...new Set(invoiceItemRows.map((r) => r.invoiceId))];

        if (invoiceIds.length > 0) {
          const receivableInvoices = await db
            .select({ id: accountingInvoices.id })
            .from(accountingInvoices)
            .where(and(eq(accountingInvoices.direction, "receivable"), inArray(accountingInvoices.id, invoiceIds)));

          for (const inv of receivableInvoices) {
            await db.delete(accountingPayments).where(eq(accountingPayments.invoiceId, inv.id));
            await syncInvoicePaymentStatus(inv.id);
          }

          const payableInvoices = await db
            .select({ id: accountingInvoices.id })
            .from(accountingInvoices)
            .where(and(
              eq(accountingInvoices.direction, "payable"),
              eq(accountingInvoices.entityType, "agent"),
              eq(accountingInvoices.entityPolicyId, doc.policyId),
            ));
          for (const inv of payableInvoices) {
            await db.delete(accountingInvoiceItems).where(eq(accountingInvoiceItems.invoiceId, inv.id));
            await db.delete(accountingInvoices).where(eq(accountingInvoices.id, inv.id));
          }
        }
      } catch (cleanupErr) {
        console.error("Payment cleanup on document delete failed (non-fatal):", cleanupErr);
      }
    }

    const userEmail = (user as { email?: string }).email ?? "";
    await appendPolicyAudit(doc.policyId, { id: Number(user.id), email: userEmail }, [
      { key: "document_delete", from: `${doc.fileName} (${doc.documentTypeKey})`, to: null },
    ]);

    // Recalculate status after deleting a verified document (payment proof deletion may roll back status)
    let statusRolledBack: string | null = null;
    try {
      const { recalculatePolicyStatus } = await import("@/lib/auto-advance-status");
      statusRolledBack = await recalculatePolicyStatus(
        doc.policyId,
        userEmail || `user:${user.id}`,
        `${doc.documentTypeKey} document deleted`,
      );
    } catch (statusErr) {
      console.error("Status recalculate on document delete failed (non-fatal):", statusErr);
    }

    return NextResponse.json({
      success: true,
      ...(statusRolledBack ? { statusRolledBack } : {}),
    }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
