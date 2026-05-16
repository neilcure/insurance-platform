/**
 * GET /api/policies/bulk-task-list-open?ids=1,2,3,...
 *
 * Batch replacement for N parallel calls to /api/policies/[id]/task-list-open.
 * Fetches ALL data for up to 100 policy IDs in ~7 batched DB queries instead
 * of N×8 individual queries.
 *
 * Returns: { results: { [policyId: string]: TaskListPreviewItem[] } }
 */

import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { policyDocuments } from "@/db/schema/documents";
import { cars, policies } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { accountingPayments, accountingInvoices, accountingInvoiceItems } from "@/db/schema/accounting";
import { requireUser } from "@/lib/auth/require-user";
import { loadAccountingFields } from "@/lib/accounting-fields";
import { getFormOptionsGroupsServer } from "@/lib/server-form-options-cache";
import {
  incompleteTaskListPreviewItems,
  buildUploadStatusOrdinalMap,
  buildVisibleDocumentRequirements,
  deriveInsuredTypeFromSnapshot,
  packagesSnapshotHasNcbFlag,
  resolveUploadFlowKey,
  type TaskListPreviewItem,
} from "@/lib/policies/upload-requirement-build";
import { resolvePremiumByRole } from "@/lib/resolve-policy-agent";
import type { PolicyDocumentRow, PolicyPaymentRecord } from "@/lib/types/upload-document";

export const dynamic = "force-dynamic";

const MAX_IDS = 100;

export async function GET(req: Request) {
  try {
    const sessionUser = await requireUser();
    const viewerUserType = sessionUser.userType;
    const userId = Number(sessionUser.id);

    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get("ids") ?? "";
    const rawIds = idsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (rawIds.length === 0) {
      return NextResponse.json({ results: {} });
    }

    const ids = rawIds.slice(0, MAX_IDS);

    // ---------- RBAC: resolve which of the requested IDs this user can access ----------
    let accessibleIds: number[];

    if (viewerUserType === "admin" || viewerUserType === "internal_staff") {
      accessibleIds = ids;
    } else if (viewerUserType === "agent") {
      // Agents can see policies they own + policies whose parent they own.
      const agentRows = await db
        .select({ id: policies.id, agentId: policies.agentId })
        .from(policies)
        .where(inArray(policies.id, ids));

      const directIds = agentRows.filter((r) => r.agentId === userId).map((r) => r.id);
      // For policies without a matching agentId, check parent via cars.extraAttributes.linkedPolicyId
      const uncheckedIds = agentRows.filter((r) => r.agentId !== userId).map((r) => r.id);
      let parentGrantedIds: number[] = [];
      if (uncheckedIds.length > 0) {
        // JSONB projection: only pull the one key we need (`linkedPolicyId`)
        // rather than the entire `extra_attributes` blob (which can be tens of
        // kilobytes per policy).
        const carExtras = await db
          .select({
            policyId: cars.policyId,
            linkedPolicyId: sql<unknown>`${cars.extraAttributes} -> 'linkedPolicyId'`.as("linked_policy_id"),
          })
          .from(cars)
          .where(inArray(cars.policyId, uncheckedIds));

        const parentIds = carExtras
          .map((c) => Number(c.linkedPolicyId ?? 0))
          .filter((n) => n > 0);

        if (parentIds.length > 0) {
          const parentAgents = await db
            .select({ id: policies.id, agentId: policies.agentId })
            .from(policies)
            .where(inArray(policies.id, [...new Set(parentIds)]));

          const agentOwnedParents = new Set(
            parentAgents.filter((p) => p.agentId === userId).map((p) => p.id),
          );

          parentGrantedIds = carExtras
            .filter((c) => {
              const parentId = Number(c.linkedPolicyId ?? 0);
              return parentId > 0 && agentOwnedParents.has(parentId);
            })
            .map((c) => c.policyId!);
        }
      }
      accessibleIds = [...new Set([...directIds, ...parentGrantedIds])];
    } else {
      // Other user types: org membership gate
      const { memberships } = await import("@/db/schema/core");
      const orgRows = await db
        .select({ id: policies.id })
        .from(policies)
        .innerJoin(
          memberships,
          and(
            eq(memberships.organisationId, policies.organisationId),
            eq(memberships.userId, userId),
          ),
        )
        .where(inArray(policies.id, ids));
      accessibleIds = orgRows.map((r) => r.id);
    }

    if (accessibleIds.length === 0) {
      return NextResponse.json({ results: {} });
    }

    // ---------- Batch DB queries (all in parallel where possible) ----------

    const uploaderAlias = db
      .select({ id: users.id, email: users.email })
      .from(users)
      .as("uploader_bulk");
    const verifierAlias = db
      .select({ id: users.id, email: users.email })
      .from(users)
      .as("verifier_bulk");

    // Pre-built subquery: invoice IDs that belong to any accessible policy.
    // Used by the payments query so payments can be fetched in PARALLEL
    // with the invoice-items query instead of waiting for its result.
    const accessibleInvoiceIdsSubquery = db
      .select({ id: accountingInvoiceItems.invoiceId })
      .from(accountingInvoiceItems)
      .where(inArray(accountingInvoiceItems.policyId, accessibleIds));

    const [
      policyRows,
      carRows,
      docRows,
      invoiceItemRows,
      premiumRows,
      foRowsMap,
      accountingFields,
      allPayments,
    ] = await Promise.all([
      db
        .select({ id: policies.id, flowKey: policies.flowKey })
        .from(policies)
        .where(inArray(policies.id, accessibleIds)),

      // JSONB projection: only pull the six keys we actually read from
      // `cars.extraAttributes` rather than the entire (potentially tens of
      // kilobytes) blob per row. Result shape stays compatible with the
      // downstream `(c.extra ?? {}) as Record<string, unknown>` usage.
      db
        .select({
          policyId: cars.policyId,
          extra: sql<Record<string, unknown>>`jsonb_build_object(
            'insuredSnapshot', ${cars.extraAttributes} -> 'insuredSnapshot',
            'packagesSnapshot', ${cars.extraAttributes} -> 'packagesSnapshot',
            'entityLinkedPolicyIds', ${cars.extraAttributes} -> 'entityLinkedPolicyIds',
            'statusClient', ${cars.extraAttributes} -> 'statusClient',
            'flowKey', ${cars.extraAttributes} -> 'flowKey',
            'linkedPolicyId', ${cars.extraAttributes} -> 'linkedPolicyId'
          )`.as("extra"),
        })
        .from(cars)
        .where(inArray(cars.policyId, accessibleIds)),

      db
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
        .where(inArray(policyDocuments.policyId, accessibleIds))
        .orderBy(policyDocuments.createdAt),

      db
        .select({ invoiceId: accountingInvoiceItems.invoiceId, policyId: accountingInvoiceItems.policyId })
        .from(accountingInvoiceItems)
        .where(inArray(accountingInvoiceItems.policyId, accessibleIds)),

      db
        .select({
          policyId: policyPremiums.policyId,
          lineKey: policyPremiums.lineKey,
          insurerPolicyId: policyPremiums.insurerPolicyId,
          organisationId: policyPremiums.organisationId,
          grossPremiumCents: policyPremiums.grossPremiumCents,
          netPremiumCents: policyPremiums.netPremiumCents,
          extraValues: policyPremiums.extraValues,
        })
        .from(policyPremiums)
        .where(inArray(policyPremiums.policyId, accessibleIds)),

      // Server-side cached: avoids hitting `form_options` on every request.
      // Admin write paths invalidate the cache via
      // `invalidateServerFormOptionsGroup`.
      getFormOptionsGroupsServer(["upload_document_types", "policy_statuses"]),

      // Also cached.
      loadAccountingFields(),

      // Parallelized: previously this query waited for `invoiceItemRows`
      // to resolve so it could pass an `IN (...)` list. Using a subquery
      // lets it run in the same `Promise.all` batch as everything else.
      db
        .select({
          invoiceId: accountingPayments.invoiceId,
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
        .where(inArray(accountingPayments.invoiceId, accessibleInvoiceIdsSubquery)),
    ]);

    // Build invoiceId → policyId map from the already-resolved invoice items.
    const invoicePolicyMap = new Map<number, number>();
    for (const r of invoiceItemRows) {
      if (r.policyId != null) invoicePolicyMap.set(r.invoiceId, r.policyId);
    }

    // ---------- Build per-policy lookups ----------

    const policyFlowMap = new Map<number, string | null>();
    for (const p of policyRows) policyFlowMap.set(p.id, p.flowKey ?? null);

    const carExtraMap = new Map<number, Record<string, unknown>>();
    for (const c of carRows) {
      carExtraMap.set(c.policyId!, ((c.extra ?? {}) as Record<string, unknown>));
    }

    const docsByPolicy = new Map<number, PolicyDocumentRow[]>();
    for (const d of docRows) {
      const pid = d.policyId!;
      if (!docsByPolicy.has(pid)) docsByPolicy.set(pid, []);
      docsByPolicy.get(pid)!.push({
        ...d,
        uploadedByEmail: d.uploadedByEmail ?? undefined,
        verifiedByEmail: d.verifiedByEmail ?? undefined,
      });
    }

    // Map policyId → payment records
    const paymentsByPolicy = new Map<number, PolicyPaymentRecord[]>();
    for (const p of allPayments) {
      const pid = invoicePolicyMap.get(p.invoiceId);
      if (pid == null) continue;
      if (!paymentsByPolicy.has(pid)) paymentsByPolicy.set(pid, []);
      paymentsByPolicy.get(pid)!.push({
        amountCents: p.amountCents,
        paymentMethod: p.paymentMethod,
        paymentDate: p.paymentDate,
        referenceNumber: p.referenceNumber,
        status: p.status,
        createdAt: p.createdAt,
        payer: (p.payer as "client" | "agent") || null,
        direction: p.direction,
        entityType: p.entityType,
      });
    }

    // Map policyId → lineKeys set + insurerPolicyIds + premium rows
    const lineKeysByPolicy = new Map<number, Set<string>>();
    const insurerIdsByPolicy = new Map<number, Set<number>>();
    const premiumRowsByPolicy = new Map<number, typeof premiumRows>();
    for (const row of premiumRows) {
      const pid = row.policyId!;
      if (!lineKeysByPolicy.has(pid)) lineKeysByPolicy.set(pid, new Set());
      if (row.lineKey) lineKeysByPolicy.get(pid)!.add(row.lineKey);

      if (!insurerIdsByPolicy.has(pid)) insurerIdsByPolicy.set(pid, new Set());
      const iid = (row.insurerPolicyId as number | null) ?? (row.organisationId as number | null) ?? null;
      if (iid && Number.isFinite(iid) && iid > 0) insurerIdsByPolicy.get(pid)!.add(iid);

      if (!premiumRowsByPolicy.has(pid)) premiumRowsByPolicy.set(pid, []);
      premiumRowsByPolicy.get(pid)!.push(row);
    }

    // Derive insurer IDs from cars.extraAttributes.entityLinkedPolicyIds too
    for (const [pid, extra] of carExtraMap) {
      const saved = Array.isArray(extra.entityLinkedPolicyIds)
        ? (extra.entityLinkedPolicyIds as number[])
        : [];
      if (saved.length > 0) {
        if (!insurerIdsByPolicy.has(pid)) insurerIdsByPolicy.set(pid, new Set());
        for (const id of saved) {
          if (Number.isFinite(id) && id > 0) insurerIdsByPolicy.get(pid)!.add(id);
        }
      }
    }

    // ---------- Shared form-options data (cached) ----------

    const statusRows = (foRowsMap.get("policy_statuses") ?? []).map((r) => ({
      value: r.value,
      sortOrder: r.sortOrder,
    }));
    const statusOrdinalMap = buildUploadStatusOrdinalMap(statusRows);

    const uploadTypeRows = (foRowsMap.get("upload_document_types") ?? []).map((r) => ({
      id: r.id,
      groupKey: r.groupKey,
      label: r.label,
      value: r.value,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      meta: r.meta as import("@/lib/types/upload-document").UploadDocumentTypeMeta | null,
    }));

    // ---------- Per-policy requirement building ----------

    const results: Record<string, TaskListPreviewItem[]> = {};

    for (const pid of accessibleIds) {
      const carExtra = carExtraMap.get(pid) ?? {};
      const policyFlowKey = policyFlowMap.get(pid) ?? null;

      const uploads = docsByPolicy.get(pid) ?? [];
      const policyPayments = paymentsByPolicy.get(pid) ?? [];
      const policyLineKeys = lineKeysByPolicy.get(pid) ?? new Set<string>();
      const insurerPolicyIds = [...(insurerIdsByPolicy.get(pid) ?? [])];

      // Build a lightweight premium summary from already-fetched rows
      const pidPremiumRows = premiumRowsByPolicy.get(pid) ?? [];
      let premiumData: { clientPremiumCents: number; agentPremiumCents: number } | null = null;
      if (pidPremiumRows.length > 0) {
        let clientTotal = 0;
        let agentTotal = 0;
        for (const pr of pidPremiumRows) {
          clientTotal += resolvePremiumByRole(pr as Record<string, unknown>, "client", accountingFields);
          agentTotal += resolvePremiumByRole(pr as Record<string, unknown>, "agent", accountingFields);
        }
        premiumData = { clientPremiumCents: clientTotal, agentPremiumCents: agentTotal };
      }

      const insured = (carExtra.insuredSnapshot ?? {}) as Record<string, unknown>;
      const pkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;

      const currentStatus =
        typeof carExtra.statusClient === "string" && carExtra.statusClient.trim()
          ? carExtra.statusClient.trim()
          : "quotation_prepared";

      const flowKeyResolved = resolveUploadFlowKey(carExtra, policyFlowKey);

      const requirements = buildVisibleDocumentRequirements({
        types: uploadTypeRows,
        uploads,
        policyPayments,
        premiumData,
        insurerPolicyIds,
        policyLineKeys,
        policyNumericId: pid,
        flowKey: flowKeyResolved,
        currentStatus,
        insuredType: deriveInsuredTypeFromSnapshot(insured),
        hasNcb: packagesSnapshotHasNcbFlag(pkgs),
        viewerUserType,
        filter: "documents",
        documentSubset: "task-list",
        statusOrdinalMap,
      });

      results[String(pid)] = incompleteTaskListPreviewItems(requirements);
    }

    return NextResponse.json(
      { results },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
