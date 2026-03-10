"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText, Printer, ChevronLeft } from "lucide-react";
import type {
  DocumentTemplateMeta,
  DocumentTemplateRow,
  TemplateSection,
} from "@/lib/types/document-template";
import type { PolicyDetail } from "@/lib/types/policy";

type SnapshotData = {
  insuredSnapshot?: Record<string, unknown> | null;
  packagesSnapshot?: Record<string, unknown> | null;
  [key: string]: unknown;
};

function resolveFieldValue(
  snapshot: SnapshotData,
  detail: PolicyDetail,
  section: TemplateSection,
  fieldKey: string,
): unknown {
  if (section.source === "policy") {
    const map: Record<string, unknown> = {
      policyNumber: detail.policyNumber,
      createdAt: detail.createdAt,
      policyId: detail.policyId,
    };
    return map[fieldKey] ?? snapshot[fieldKey] ?? "";
  }

  if (section.source === "agent") {
    return (detail.agent as Record<string, unknown> | undefined)?.[fieldKey] ?? "";
  }

  if (section.source === "insured" || section.source === "contactinfo") {
    const insured = snapshot.insuredSnapshot ?? {};
    const prefix = section.source;
    return (
      insured[fieldKey] ??
      insured[`${prefix}__${fieldKey}`] ??
      insured[`${prefix}_${fieldKey}`] ??
      ""
    );
  }

  if (section.source === "package" && section.packageName) {
    const pkgs = (snapshot.packagesSnapshot ?? {}) as Record<string, unknown>;
    const pkg = pkgs[section.packageName];
    if (!pkg || typeof pkg !== "object") return "";
    const vals =
      "values" in (pkg as Record<string, unknown>)
        ? ((pkg as { values?: Record<string, unknown> }).values ?? {})
        : (pkg as Record<string, unknown>);
    return (
      vals[fieldKey] ??
      vals[`${section.packageName}__${fieldKey}`] ??
      vals[`${section.packageName}_${fieldKey}`] ??
      ""
    );
  }

  return "";
}

function formatValue(
  raw: unknown,
  format?: string,
  currencyCode?: string,
): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";

  if (format === "currency") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return s;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: (currencyCode || "HKD").toUpperCase(),
      }).format(n);
    } catch {
      return n.toFixed(2);
    }
  }

  if (format === "date") {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  }

  if (format === "boolean") {
    return raw === true || raw === "true" ? "Yes" : "No";
  }

  if (format === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n.toLocaleString() : s;
  }

  return s;
}

function DocumentPreview({
  template,
  detail,
  snapshot,
}: {
  template: DocumentTemplateRow;
  detail: PolicyDetail;
  snapshot: SnapshotData;
}) {
  const meta = template.meta!;
  const printRef = React.useRef<HTMLDivElement>(null);

  function handlePrint() {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) {
      toast.error("Please allow popups to print");
      return;
    }
    win.document.write(`<!DOCTYPE html>
<html><head><title>${meta.header.title}</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 40px; color: #1a1a1a; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 16px; color: #666; margin-top: 0; font-weight: normal; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 14px; font-weight: 600; border-bottom: 1px solid #e5e5e5; padding-bottom: 4px; margin-bottom: 8px; }
  .field-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; }
  .field-label { color: #666; }
  .field-value { font-family: monospace; text-align: right; max-width: 60%; word-break: break-word; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888; }
  .signature-line { margin-top: 60px; display: flex; justify-content: space-between; }
  .signature-line div { width: 200px; border-top: 1px solid #333; padding-top: 4px; font-size: 12px; }
  @media print { body { padding: 20px; } }
</style></head><body>${content}</body></html>`);
    win.document.close();
    setTimeout(() => {
      win.print();
    }, 300);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{template.label}</div>
        <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5">
          <Printer className="h-3.5 w-3.5" />
          Print / PDF
        </Button>
      </div>

      <div
        ref={printRef}
        className="rounded-md border border-neutral-200 bg-white p-4 text-neutral-900 dark:border-neutral-700"
      >
        <h1>{meta.header.title}</h1>
        {meta.header.subtitle && <h2>{meta.header.subtitle}</h2>}
        <div className="meta">
          {meta.header.showPolicyNumber !== false && (
            <div>Ref: {detail.policyNumber}</div>
          )}
          {meta.header.showDate !== false && (
            <div>
              Date:{" "}
              {(() => {
                const d = new Date(detail.createdAt);
                return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
              })()}
            </div>
          )}
        </div>

        {meta.sections.map((section) => {
          const fields = section.fields
            .map((f) => ({
              ...f,
              resolved: resolveFieldValue(snapshot, detail, section, f.key),
            }))
            .filter(
              (f) =>
                f.resolved !== "" &&
                f.resolved !== null &&
                f.resolved !== undefined,
            );

          if (fields.length === 0) return null;

          return (
            <div key={section.id} className="section">
              <div className="section-title">{section.title}</div>
              {fields.map((f) => (
                <div key={f.key} className="field-row">
                  <span className="field-label">{f.label}</span>
                  <span className="field-value">
                    {formatValue(f.resolved, f.format, f.currencyCode)}
                  </span>
                </div>
              ))}
            </div>
          );
        })}

        {meta.footer?.text && (
          <div className="footer">{meta.footer.text}</div>
        )}
        {meta.footer?.showSignature && (
          <div className="signature-line">
            <div>Authorized Signature</div>
            <div>Client Signature</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DocumentsTab({
  detail,
  flowKey,
}: {
  detail: PolicyDetail;
  flowKey?: string;
}) {
  const [templates, setTemplates] = React.useState<DocumentTemplateRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<DocumentTemplateRow | null>(
    null,
  );

  const snapshot = (detail.extraAttributes ?? {}) as SnapshotData;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/form-options?groupKey=document_templates&_t=${Date.now()}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: DocumentTemplateRow[]) => {
        if (cancelled) return;
        const applicable = rows.filter((r) => {
          if (!r.meta) return false;
          const flows = r.meta.flows;
          if (!flows || flows.length === 0) return true;
          if (!flowKey) return false;
          return flows.includes(flowKey);
        });
        setTemplates(applicable);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowKey]);

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Loading templates...
      </div>
    );
  }

  if (selected) {
    return (
      <div className="space-y-3">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1 text-xs"
          onClick={() => setSelected(null)}
        >
          <ChevronLeft className="h-3 w-3" />
          Back to templates
        </Button>
        <DocumentPreview
          template={selected}
          detail={detail}
          snapshot={snapshot}
        />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <FileText className="mx-auto mb-2 h-8 w-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
          No document templates
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          Go to Admin &rarr; Policy Settings &rarr; Document Templates to create
          templates like quotations, invoices, or certificates.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Available Templates</div>
      {templates.map((tpl) => (
        <button
          key={tpl.id}
          type="button"
          onClick={() => setSelected(tpl)}
          className="flex w-full items-center gap-3 rounded-md border border-neutral-200 p-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
        >
          <FileText className="h-5 w-5 shrink-0 text-neutral-400 dark:text-neutral-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{tpl.label}</div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {tpl.meta?.type
                ? tpl.meta.type.charAt(0).toUpperCase() + tpl.meta.type.slice(1)
                : "Document"}
              {tpl.meta?.sections
                ? ` \u00b7 ${tpl.meta.sections.length} section${tpl.meta.sections.length !== 1 ? "s" : ""}`
                : ""}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
