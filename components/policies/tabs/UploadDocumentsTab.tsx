"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { DocumentUploadCard } from "@/components/ui/document-upload-card";
import type {
  DocumentStatus,
  PolicyDocumentRow,
  UploadDocumentTypeRow,
  DocumentRequirement,
} from "@/lib/types/upload-document";

function computeDisplayStatus(uploads: PolicyDocumentRow[]): DocumentStatus {
  if (uploads.length === 0) return "outstanding";
  if (uploads.some((u) => u.status === "verified")) return "verified";
  if (uploads.some((u) => u.status === "uploaded")) return "uploaded";
  if (uploads.every((u) => u.status === "rejected")) return "rejected";
  return "outstanding";
}

export function UploadDocumentsTab({
  policyId,
  flowKey,
  isAdmin,
  currentStatus,
}: {
  policyId: number;
  flowKey?: string;
  isAdmin: boolean;
  currentStatus?: string;
}) {
  const [requirements, setRequirements] = React.useState<DocumentRequirement[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch(`/api/form-options?groupKey=upload_document_types&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`/api/policies/${policyId}/documents?_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ]).then(([types, uploads]: [UploadDocumentTypeRow[], PolicyDocumentRow[]]) => {
      if (cancelled) return;

      const applicable = types.filter((t) => {
        const flows = t.meta?.flows;
        if (flows && flows.length > 0) {
          if (!flowKey || !flows.includes(flowKey)) return false;
        }
        const sws = (t.meta as any)?.showWhenStatus as string[] | undefined;
        if (sws && sws.length > 0) {
          const status = currentStatus || "active";
          if (!sws.includes(status)) return false;
        }
        return true;
      });

      const reqs: DocumentRequirement[] = applicable.map((t) => {
        const typeUploads = uploads.filter((u) => u.documentTypeKey === t.value);
        return {
          typeKey: t.value,
          label: t.label,
          meta: t.meta,
          displayStatus: computeDisplayStatus(typeUploads),
          uploads: typeUploads,
        };
      });

      // Include orphaned uploads (uploaded for types no longer in config)
      const knownKeys = new Set(applicable.map((t) => t.value));
      const orphanedUploads = uploads.filter((u) => !knownKeys.has(u.documentTypeKey));
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
          displayStatus: computeDisplayStatus(docs),
          uploads: docs,
        });
      }

      setRequirements(reqs);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [policyId, flowKey, currentStatus, refreshKey]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Loading documents...
      </div>
    );
  }

  if (requirements.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <Upload className="mx-auto mb-2 h-8 w-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
          No upload requirements
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          Go to Admin &rarr; Policy Settings &rarr; Upload Documents to configure
          document types that need to be collected.
        </p>
      </div>
    );
  }

  const verified = requirements.filter((r) => r.displayStatus === "verified").length;
  const total = requirements.length;
  const pending = requirements.filter((r) => r.displayStatus === "uploaded").length;
  const outstanding = requirements.filter((r) => r.displayStatus === "outstanding").length;
  const rejected = requirements.filter((r) => r.displayStatus === "rejected").length;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{verified}/{total} verified</span>
        {pending > 0 && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            {pending} pending
          </span>
        )}
        {outstanding > 0 && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            {outstanding} outstanding
          </span>
        )}
        {rejected > 0 && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-600 dark:bg-red-900/40 dark:text-red-400">
            {rejected} rejected
          </span>
        )}
      </div>

      {/* Document cards */}
      {requirements.map((req) => (
        <DocumentUploadCard
          key={req.typeKey}
          typeKey={req.typeKey}
          label={req.label}
          meta={req.meta}
          displayStatus={req.displayStatus}
          uploads={req.uploads}
          policyId={policyId}
          isAdmin={isAdmin}
          onRefresh={refresh}
        />
      ))}
    </div>
  );
}
