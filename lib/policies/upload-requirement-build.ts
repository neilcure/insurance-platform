/**
 * Pure builders for policy upload document requirements — shared by
 * `UploadDocumentsTab` and `GET /api/policies/[id]/task-list-open` so the
 * dashboard calendar matches Workflow task-list semantics.
 */

import type {
  DocumentRequirement,
  DocumentStatus,
  PolicyDocumentRow,
  PolicyPaymentRecord,
  PremiumBreakdown,
  UploadDocumentTypeMeta,
  UploadDocumentTypeRow,
} from "@/lib/types/upload-document";

const FALLBACK_POLICY_STATUS_ORDER = [
  "quotation_prepared",
  "quotation_sent",
  "quotation_confirmed",
  "invoice_prepared",
  "invoice_sent",
  "pending_payment",
  "payment_received",
  "confirmed",
  "bound",
  "active",
  "completed",
] as const;

export function buildUploadStatusOrdinalMap(
  hooks: Array<{ value: string; sortOrder: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  const sorted = [...hooks].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value),
  );
  let ord = 0;
  for (const o of sorted) {
    if (!map.has(o.value)) map.set(o.value, ord++);
  }
  for (const fb of FALLBACK_POLICY_STATUS_ORDER) {
    if (!map.has(fb)) map.set(fb, ord++);
  }
  return map;
}

export function statusAllowsWorkspaceUpload(
  sws: string[] | undefined,
  currentRaw: string,
  ordinalMap: Map<string, number>,
): boolean {
  if (!sws || sws.length === 0) return true;
  const current = currentRaw.trim() ? currentRaw : "quotation_prepared";

  const thrOrdinals = sws
    .map((s) => ordinalMap.get(s))
    .filter((n): n is number => typeof n === "number");
  const curOrd = ordinalMap.get(current);

  if (thrOrdinals.length === 0) return sws.includes(current);

  const minThr = Math.min(...thrOrdinals);

  if (curOrd === undefined) {
    return sws.includes(current);
  }

  return curOrd >= minThr;
}

export function computeUploadRequirementDisplayStatus(
  uploads: PolicyDocumentRow[],
  payments?: PolicyPaymentRecord[],
  meta?: UploadDocumentTypeMeta | null,
): DocumentStatus {
  if (uploads.some((u) => u.status === "verified")) return "verified";
  if (payments && payments.length > 0) {
    const hasVerified = payments.some(
      (p) =>
        (!p.direction || p.direction === "receivable") &&
        (p.status === "verified" || p.status === "confirmed" || p.status === "recorded"),
    );
    if (hasVerified) return "verified";
  }
  const isOfficeProvided = meta?.uploadSource === "admin";

  if (uploads.length === 0) {
    if (isOfficeProvided) return "awaiting_office";
    return "outstanding";
  }
  if (uploads.some((u) => u.status === "uploaded")) return "uploaded";
  if (uploads.every((u) => u.status === "rejected")) return "rejected";
  return "outstanding";
}

export function isOfficeProvidedReq(r: DocumentRequirement): boolean {
  return r.meta?.uploadSource === "admin";
}

export type UploadRequirementBuildOpts = {
  types: UploadDocumentTypeRow[];
  uploads: PolicyDocumentRow[];
  policyPayments: PolicyPaymentRecord[];
  premiumData: PremiumBreakdown | null;
  insurerPolicyIds: number[];
  policyLineKeys: Set<string>;
  flowKey?: string;
  currentStatus?: string;
  insuredType?: string;
  hasNcb: boolean;
  viewerUserType?: string | null;
  filter: "all" | "documents" | "payments";
  documentSubset: "all" | "task-list" | "final-documents";
  statusOrdinalMap: Map<string, number>;
  policyNumericId?: number;
};

/**
 * Mirrors `UploadDocumentsTab` requirement assembly (filtered + orphaned uploads).
 */
export function buildVisibleDocumentRequirements(opts: UploadRequirementBuildOpts): DocumentRequirement[] {
  const policyNumericId = opts.policyNumericId ?? 0;
  const matchingIds = [...new Set([policyNumericId, ...opts.insurerPolicyIds])].filter(
    (id) => Number.isFinite(id) && id > 0,
  );
  const matchesInsurer = (tplInsurerIds: number[] | undefined) => {
    if (!tplInsurerIds || tplInsurerIds.length === 0) return true;
    return matchingIds.some((pid) => tplInsurerIds.includes(pid));
  };

  const applicable = opts.types.filter((t) => {
    const flows = t.meta?.flows;
    if (flows && flows.length > 0) {
      if (!opts.flowKey || !flows.includes(opts.flowKey)) return false;
    }
    if (!matchesInsurer(t.meta?.insurerPolicyIds)) return false;

    const viewerRaw = opts.viewerUserType != null ? String(opts.viewerUserType).trim() : "";
    const vut = t.meta?.visibleToUserTypes;
    if (vut && vut.length > 0 && viewerRaw) {
      if (!vut.includes(viewerRaw)) return false;
    }

    const sws = t.meta?.showWhenStatus;
    if (sws && sws.length > 0) {
      const status = opts.currentStatus || "quotation_prepared";
      const hasUploadsForType = opts.uploads.some((u) => u.documentTypeKey === t.value);
      if (!hasUploadsForType) {
        if (!statusAllowsWorkspaceUpload(sws, status, opts.statusOrdinalMap)) return false;
      }
    }

    const its = t.meta?.insuredTypes;
    if (its && its.length > 0 && opts.insuredType) {
      if (!its.includes(opts.insuredType)) return false;
    }

    const alk = t.meta?.accountingLineKey;
    if (alk && opts.policyLineKeys.size > 0 && !opts.policyLineKeys.has(alk)) return false;
    if (t.meta?.requireNcb && !opts.hasNcb) return false;
    return true;
  });

  const reqs: DocumentRequirement[] = applicable.map((t) => {
    const typeUploads = opts.uploads.filter((u) => u.documentTypeKey === t.value);
    const isPaymentType = t.meta?.requirePaymentDetails === true;
    return {
      typeKey: t.value,
      label: t.label,
      meta: t.meta,
      displayStatus: computeUploadRequirementDisplayStatus(
        typeUploads,
        isPaymentType ? opts.policyPayments : undefined,
        t.meta,
      ),
      uploads: typeUploads,
      ...(isPaymentType
        ? { payments: opts.policyPayments, premiumBreakdown: opts.premiumData ?? undefined }
        : {}),
    };
  });

  const knownKeys = new Set(applicable.map((t) => t.value));
  const orphanedUploads = opts.uploads.filter((u) => !knownKeys.has(u.documentTypeKey));
  const orphanedGroups = new Map<string, PolicyDocumentRow[]>();
  for (const u of orphanedUploads) {
    const arr = orphanedGroups.get(u.documentTypeKey) ?? [];
    arr.push(u);
    orphanedGroups.set(u.documentTypeKey, arr);
  }
  for (const [key, docs] of orphanedGroups) {
    reqs.push({
      typeKey: key,
      label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      meta: null,
      displayStatus: computeUploadRequirementDisplayStatus(docs, undefined, null),
      uploads: docs,
    });
  }

  const filtered =
    opts.filter === "all"
      ? reqs
      : opts.filter === "payments"
        ? reqs.filter((r) => r.meta?.requirePaymentDetails)
        : reqs.filter((r) => !r.meta?.requirePaymentDetails);

  const subsetAllows = opts.filter === "documents" || opts.filter === "all";
  if (!subsetAllows || opts.documentSubset === "all") return filtered;
  if (opts.documentSubset === "task-list") return filtered.filter((r) => !isOfficeProvidedReq(r));
  return filtered.filter((r) => isOfficeProvidedReq(r));
}

export type TaskListPreviewItem = {
  typeKey: string;
  label: string;
  displayStatus: DocumentStatus;
  required?: boolean;
};

/** Incomplete client/agent task slots (verified / completed slots omitted). */
export function incompleteTaskListPreviewItems(requirements: DocumentRequirement[]): TaskListPreviewItem[] {
  return requirements
    .filter((r) => r.displayStatus !== "verified")
    .filter(
      (r) =>
        r.displayStatus === "outstanding"
        || r.displayStatus === "uploaded"
        || r.displayStatus === "rejected",
    )
    .map((r) => ({
      typeKey: r.typeKey,
      label: r.label,
      displayStatus: r.displayStatus,
      required: r.meta?.required === true,
    }));
}

export function deriveInsuredTypeFromSnapshot(
  insured: Record<string, unknown>,
): "personal" | "company" | undefined {
  const rawType = String(
    insured.insuredType ?? insured.insured__category ?? insured.category ?? "",
  ).trim().toLowerCase();
  return rawType === "personal" || rawType === "company" ? rawType : undefined;
}

const NCB_PATTERN = /^(ncb|ncd|ncbpercent|ncdpercent|no.?claim.?(bonus|discount))/i;

export function packagesSnapshotHasNcbFlag(pkgs: Record<string, unknown>): boolean {
  let found = false;
  const scan = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      if (NCB_PATTERN.test(k) && v != null && v !== "" && v !== 0 && v !== "0") {
        found = true;
        return;
      }
    }
  };
  for (const [, pkgVal] of Object.entries(pkgs)) {
    if (!pkgVal || typeof pkgVal !== "object") continue;
    const pkg = pkgVal as Record<string, unknown>;
    if (pkg.values && typeof pkg.values === "object") scan(pkg.values as Record<string, unknown>);
    else scan(pkg);
    if (found) break;
  }
  return found;
}

export function resolveUploadFlowKey(carExtra: Record<string, unknown>, policyFlowKey: string | null | undefined): string {
  const fromProp = typeof policyFlowKey === "string" ? policyFlowKey.trim() : "";
  if (fromProp) return fromProp;
  const fromSnap = String(carExtra.flowKey ?? "").trim();
  if (fromSnap) return fromSnap;
  return "policyset";
}
