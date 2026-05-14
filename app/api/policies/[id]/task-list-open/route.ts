import { NextResponse } from "next/server";
import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { policyDocuments } from "@/db/schema/documents";
import { formOptions } from "@/db/schema/form_options";
import { cars, policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingPayments, accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { requireUser } from "@/lib/auth/require-user";
import { canAccessPolicy } from "@/lib/policy-access";
import {
  incompleteTaskListPreviewItems,
  buildUploadStatusOrdinalMap,
  buildVisibleDocumentRequirements,
  deriveInsuredTypeFromSnapshot,
  packagesSnapshotHasNcbFlag,
  resolveUploadFlowKey,
  type TaskListPreviewItem,
} from "@/lib/policies/upload-requirement-build";
import { resolveLinkedInsurerPolicyIds } from "@/lib/policies/resolve-linked-insurer-policy-ids";
import { resolvePolicyPremiumSummary } from "@/lib/resolve-policy-agent";
import type { PolicyDocumentRow, PolicyPaymentRecord } from "@/lib/types/upload-document";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, ctx: Ctx) {
  try {
    const sessionUser = await requireUser();
    const viewerUserType = sessionUser.userType;

    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const access = await canAccessPolicy({ id: sessionUser.id, userType: viewerUserType }, policyId);
    if (!access) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [policyRow] = await db
      .select({ flowKey: policies.flowKey })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);

    const [carRow] = await db
      .select({ extra: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, policyId))
      .limit(1);

    const carExtra = ((carRow?.extra ?? {}) as Record<string, unknown>) ?? {};

    const uploaderAlias = db
      .select({ id: users.id, email: users.email })
      .from(users)
      .as("uploader_tl");
    const verifierAlias = db
      .select({ id: users.id, email: users.email })
      .from(users)
      .as("verifier_tl");

    const docRows = await db
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

    const uploads: PolicyDocumentRow[] = docRows.map((row) => ({
      ...row,
      uploadedByEmail: row.uploadedByEmail ?? undefined,
      verifiedByEmail: row.verifiedByEmail ?? undefined,
    }));

    const invoiceItemRows = await db
      .select({ invoiceId: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(eq(accountingInvoiceItems.policyId, policyId));
    const invoiceIds = [...new Set(invoiceItemRows.map((r) => r.invoiceId))];

    let paymentsByInvoice: PolicyPaymentRecord[] = [];
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

    const [foRows, lineRows] = await Promise.all([
      db
        .select({
          groupKey: formOptions.groupKey,
          id: formOptions.id,
          label: formOptions.label,
          value: formOptions.value,
          sortOrder: formOptions.sortOrder,
          isActive: formOptions.isActive,
          meta: formOptions.meta,
        })
        .from(formOptions)
        .where(and(inArray(formOptions.groupKey, ["upload_document_types", "policy_statuses"]), eq(formOptions.isActive, true)))
        .orderBy(formOptions.sortOrder),
      db.select({ lineKey: policyPremiums.lineKey }).from(policyPremiums).where(eq(policyPremiums.policyId, policyId)),
    ]);

    const statusRows = foRows.filter((r) => r.groupKey === "policy_statuses").map((r) => ({ value: r.value, sortOrder: r.sortOrder }));
    const statusOrdinalMap = buildUploadStatusOrdinalMap(statusRows);

    const uploadTypeRows = foRows.filter((r) => r.groupKey === "upload_document_types").map((r) => ({
      id: r.id,
      groupKey: r.groupKey,
      label: r.label,
      value: r.value,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      meta: r.meta as import("@/lib/types/upload-document").UploadDocumentTypeMeta | null,
    }));

    const policyLineKeys = new Set(lineRows.map((l) => l.lineKey ?? "").filter(Boolean));

    const [insurerIds, premiumSummary] = await Promise.all([
      resolveLinkedInsurerPolicyIds(policyId),
      resolvePolicyPremiumSummary(policyId),
    ]);

    const premiumData = premiumSummary
      ? {
          clientPremiumCents: premiumSummary.clientPremiumCents,
          agentPremiumCents: premiumSummary.agentPremiumCents,
          agentName: premiumSummary.agentName,
        }
      : null;

    const insured = (carExtra.insuredSnapshot ?? {}) as Record<string, unknown>;
    const pkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;

    const currentStatus =
      typeof carExtra.statusClient === "string" && carExtra.statusClient.trim()
        ? carExtra.statusClient.trim()
        : "quotation_prepared";

    const flowKeyResolved = resolveUploadFlowKey(carExtra, policyRow?.flowKey ?? null);

    const requirements = buildVisibleDocumentRequirements({
      types: uploadTypeRows,
      uploads,
      policyPayments: paymentsByInvoice,
      premiumData,
      insurerPolicyIds: insurerIds,
      policyLineKeys,
      policyNumericId: policyId,
      flowKey: flowKeyResolved,
      currentStatus,
      insuredType: deriveInsuredTypeFromSnapshot(insured),
      hasNcb: packagesSnapshotHasNcbFlag(pkgs),
      viewerUserType,
      filter: "documents",
      documentSubset: "task-list",
      statusOrdinalMap,
    });

    const items: TaskListPreviewItem[] = incompleteTaskListPreviewItems(requirements);

    return NextResponse.json(
      { policyId, items },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
