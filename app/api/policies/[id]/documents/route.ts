import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policyDocuments } from "@/db/schema/documents";
import { policies } from "@/db/schema/insurance";
import { users, memberships } from "@/db/schema/core";
import { accountingPayments, accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { and, eq, sql, desc, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import { validateFile, saveFile } from "@/lib/storage";
import { appendPolicyAudit } from "@/lib/audit";
import { syncInvoicePaymentStatus, crossSettlePolicyInvoices } from "@/lib/accounting-invoices";
import { createAgentCommissionPayable } from "@/lib/agent-commission";
import { markAgentPolicyItemsPaidIndividually } from "@/lib/statement-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function canAccessPolicy(userId: number, userType: string, policyId: number): Promise<boolean> {
  if (userType === "admin" || userType === "internal_staff") return true;

  const polCols = await getPolicyColumns();
  if (userType === "agent") {
    if (!polCols.hasAgentId) return false;
    const rows = await db
      .select({ id: policies.id })
      .from(policies)
      .where(and(eq(policies.id, policyId), eq(policies.agentId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  const rows = await db
    .select({ id: policies.id })
    .from(policies)
    .innerJoin(memberships, and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, userId)))
    .where(eq(policies.id, policyId))
    .limit(1);
  return rows.length > 0;
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const hasAccess = await canAccessPolicy(Number(user.id), user.userType, policyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const uploaderAlias = db
      .select({ id: users.id, email: users.email })
      .from(users)
      .as("uploader");

    const verifierAlias = db
      .select({ id: users.id, email: users.email })
      .from(users)
      .as("verifier");

    const rows = await db
      .select({
        id: policyDocuments.id,
        policyId: policyDocuments.policyId,
        documentTypeKey: policyDocuments.documentTypeKey,
        fileName: policyDocuments.fileName,
        storedPath: policyDocuments.storedPath,
        fileSize: policyDocuments.fileSize,
        mimeType: policyDocuments.mimeType,
        status: policyDocuments.status,
        uploadedBy: policyDocuments.uploadedBy,
        uploadedByRole: policyDocuments.uploadedByRole,
        verifiedBy: policyDocuments.verifiedBy,
        verifiedAt: policyDocuments.verifiedAt,
        rejectionNote: policyDocuments.rejectionNote,
        createdAt: policyDocuments.createdAt,
        uploadedByEmail: uploaderAlias.email,
        verifiedByEmail: verifierAlias.email,
      })
      .from(policyDocuments)
      .leftJoin(uploaderAlias, eq(uploaderAlias.id, policyDocuments.uploadedBy))
      .leftJoin(verifierAlias, eq(verifierAlias.id, policyDocuments.verifiedBy))
      .where(eq(policyDocuments.policyId, policyId))
      .orderBy(policyDocuments.createdAt);

    // Enrich payment-type uploads with their accounting_payments data
    const invoiceItemRows = await db
      .select({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.policyId, policyId));
    const invoiceIds = [...new Set(invoiceItemRows.map((r) => r.invoiceId))];

    let paymentsByInvoice: { amountCents: number; paymentMethod: string | null; paymentDate: string | null; referenceNumber: string | null; status: string; createdAt: string; payer: "client" | "agent" | null; direction: string; entityType: string | null }[] = [];
    if (invoiceIds.length > 0) {
      const rawPayments = await db
        .select({
          amountCents: accountingPayments.amountCents,
          paymentMethod: accountingPayments.paymentMethod,
          paymentDate: accountingPayments.paymentDate,
          referenceNumber: accountingPayments.referenceNumber,
          status: accountingPayments.status,
          createdAt: accountingPayments.createdAt,
          payer: accountingPayments.payer,
          direction: accountingInvoices.direction,
          entityType: accountingInvoices.entityType,
        })
        .from(accountingPayments)
        .innerJoin(accountingInvoices, eq(accountingInvoices.id, accountingPayments.invoiceId))
        .where(inArray(accountingPayments.invoiceId, invoiceIds))
        .orderBy(desc(accountingPayments.createdAt));

      paymentsByInvoice = rawPayments.map((p) => ({
        amountCents: p.amountCents,
        paymentMethod: p.paymentMethod,
        paymentDate: p.paymentDate,
        referenceNumber: p.referenceNumber,
        status: p.status,
        createdAt: p.createdAt,
        payer: (p.payer as "client" | "agent") || null,
        direction: p.direction,
        entityType: p.entityType,
      }));
    }

    return NextResponse.json({ documents: rows, payments: paymentsByInvoice }, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const hasAccess = await canAccessPolicy(Number(user.id), user.userType, policyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const documentTypeKey = formData.get("documentTypeKey") as string | null;

    if (!file || !documentTypeKey) {
      return NextResponse.json({ error: "file and documentTypeKey are required" }, { status: 400 });
    }

    const validation = validateFile(file.name, file.type, file.size);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { storedPath } = await saveFile(policyId, file.name, buffer);

    const isAdmin = user.userType === "admin" || user.userType === "internal_staff";
    const status = isAdmin ? "verified" : "uploaded";
    const role = user.userType === "admin" || user.userType === "internal_staff"
      ? "admin"
      : user.userType;

    const paymentAmountCents = Number(formData.get("paymentAmountCents") || 0);
    const paymentMethod = formData.get("paymentMethod") as string | null;
    const paymentDate = (formData.get("paymentDate") as string) || null;
    const paymentRefNum = (formData.get("paymentRef") as string) || null;
    const paymentPayer = (formData.get("paymentPayer") as string) || "client";

    const paymentMeta = paymentAmountCents > 0 && paymentMethod
      ? { amountCents: paymentAmountCents, method: paymentMethod, date: paymentDate, ref: paymentRefNum, payer: paymentPayer }
      : undefined;

    const [row] = await db
      .insert(policyDocuments)
      .values({
        policyId,
        documentTypeKey: documentTypeKey.trim(),
        fileName: file.name,
        storedPath,
        fileSize: file.size,
        mimeType: file.type,
        status,
        uploadedBy: Number(user.id),
        uploadedByRole: role,
        ...(isAdmin ? { verifiedBy: Number(user.id), verifiedAt: new Date().toISOString() } : {}),
        ...(paymentMeta ? { paymentMeta } : {}),
      })
      .returning();

    const userEmail = (user as { email?: string }).email ?? "";
    await appendPolicyAudit(policyId, { id: Number(user.id), email: userEmail }, [
      { key: "document_upload", from: null, to: `${file.name} (${documentTypeKey.trim()})` },
      ...(isAdmin ? [{ key: "document_status", from: null, to: "verified (auto)" }] : []),
    ]);

    if (isAdmin) {
      const { checkAndAutoComplete } = await import("@/lib/reminder-sender");
      await checkAndAutoComplete(policyId, documentTypeKey.trim());
    }

    // Opt-in: notify admin when agent/client uploads a document
    if (!isAdmin) {
      try {
        const { notifyAdminOfUpload } = await import("@/lib/upload-notification");
        await notifyAdminOfUpload(policyId, documentTypeKey.trim(), file.name, userEmail || role);
      } catch (notifErr) {
        console.error("Upload notification failed (non-fatal):", notifErr);
      }
    }

    if (paymentAmountCents > 0 && paymentMethod) {
      if (isAdmin) {
        try {
          const { advancePolicyStatus } = await import("@/lib/auto-advance-status");
          await advancePolicyStatus(
            policyId,
            "payment_received",
            userEmail || `user:${user.id}`,
            `Auto: payment proof uploaded and verified (${documentTypeKey.trim()})`,
          );
        } catch (statusErr) {
          console.error("Auto-advance status on payment upload failed (non-fatal):", statusErr);
        }
      }

      try {
        let invoiceItemRows = await db
          .select({ invoiceId: accountingInvoiceItems.invoiceId })
          .from(accountingInvoiceItems)
          .where(eq(accountingInvoiceItems.policyId, policyId));

        if (invoiceItemRows.length === 0) {
          const { autoCreateAccountingInvoices } = await import("@/lib/auto-create-invoices");
          await autoCreateAccountingInvoices(policyId, "policy", Number(user.id));
          invoiceItemRows = await db
            .select({ invoiceId: accountingInvoiceItems.invoiceId })
            .from(accountingInvoiceItems)
            .where(eq(accountingInvoiceItems.policyId, policyId));
        }

        const invoiceIds = [...new Set(invoiceItemRows.map((r) => r.invoiceId))];

        if (invoiceIds.length > 0) {
          // Prefer individual invoices — statement invoices are filtered out in GET
          // so payments on them would be invisible in the payment records display
          let [invoice] = await db
            .select()
            .from(accountingInvoices)
            .where(and(
              eq(accountingInvoices.direction, "receivable"),
              inArray(accountingInvoices.id, invoiceIds),
              sql`${accountingInvoices.invoiceType} != 'statement'`,
            ))
            .orderBy(desc(accountingInvoices.createdAt))
            .limit(1);

          // Fallback to statement invoice if no individual exists
          if (!invoice) {
            [invoice] = await db
              .select()
              .from(accountingInvoices)
              .where(and(
                eq(accountingInvoices.direction, "receivable"),
                inArray(accountingInvoices.id, invoiceIds),
              ))
              .orderBy(desc(accountingInvoices.createdAt))
              .limit(1);
          }

          if (invoice) {
            await db.insert(accountingPayments).values({
              invoiceId: invoice.id,
              amountCents: paymentAmountCents,
              currency: invoice.currency,
              paymentDate: paymentDate ?? null,
              paymentMethod,
              referenceNumber: paymentRefNum ?? null,
              payer: paymentPayer || "client",
              status: isAdmin ? "verified" : "submitted",
              submittedBy: Number(user.id),
              ...(isAdmin ? { verifiedBy: Number(user.id), verifiedAt: new Date().toISOString() } : {}),
            });

            if (isAdmin) {
              await syncInvoicePaymentStatus(invoice.id);
            }

            if (paymentPayer === "client") {
              try {
                await createAgentCommissionPayable(policyId, Number(user.id));
              } catch (commErr) {
                console.error("Agent commission creation failed (non-fatal):", commErr);
              }

              if (isAdmin) {
                try {
                  await markAgentPolicyItemsPaidIndividually(policyId);
                } catch (stmtErr) {
                  console.error("Mark paid individually failed (non-fatal):", stmtErr);
                }
              }
            }

            try {
              await crossSettlePolicyInvoices(policyId, paymentPayer);
            } catch (crossErr) {
              console.error("Cross-settlement failed (non-fatal):", crossErr);
            }
          }
        }
      } catch (payErr) {
        console.error("Payment record creation failed (non-fatal):", payErr);
      }
    }

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
