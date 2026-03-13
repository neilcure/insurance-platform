"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { FileText, Printer, ChevronLeft, Stamp, Download, Loader2, Mail, MessageCircle } from "lucide-react";
import type { PdfTemplateRow, PdfTemplateMeta } from "@/lib/types/pdf-template";
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

function PdfMergeButton({
  tpl,
  policyId,
  onEmailClick,
  onWhatsAppClick,
}: {
  tpl: PdfTemplateRow;
  policyId: number;
  onEmailClick: (tpl: PdfTemplateRow) => void;
  onWhatsAppClick: (tpl: PdfTemplateRow) => void;
}) {
  const [generating, setGenerating] = React.useState(false);
  const meta = tpl.meta as unknown as PdfTemplateMeta | null;

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/pdf-templates/${tpl.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PDF");
    }
    setGenerating(false);
  }

  return (
    <div className="flex w-full items-center gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating || !meta?.fields?.length}
        className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80 disabled:opacity-50"
      >
        <Stamp className="h-5 w-5 shrink-0 text-emerald-500 dark:text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{tpl.label}</div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
            PDF Mail Merge
            {meta?.fields ? ` \u00b7 ${meta.fields.length} field${meta.fields.length !== 1 ? "s" : ""}` : ""}
            {meta?.description ? ` \u00b7 ${meta.description}` : ""}
          </div>
        </div>
        <div className="shrink-0">
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
          ) : (
            <Download className="h-4 w-4 text-neutral-400" />
          )}
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1 border-l border-neutral-200 pl-2 dark:border-neutral-700">
        <button
          type="button"
          title="Send via Email"
          onClick={() => onEmailClick(tpl)}
          className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Mail className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Send via WhatsApp"
          onClick={() => onWhatsAppClick(tpl)}
          className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-green-600 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-green-400"
        >
          <MessageCircle className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function SendEmailDialog({
  open,
  onOpenChange,
  policyId,
  policyNumber,
  pdfTemplates,
  preSelectedId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: number;
  policyNumber: string;
  pdfTemplates: PdfTemplateRow[];
  preSelectedId?: number;
}) {
  const [email, setEmail] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setSubject(`Policy ${policyNumber} - Documents`);
      if (preSelectedId) {
        setSelectedIds(new Set([preSelectedId]));
      } else {
        setSelectedIds(new Set(pdfTemplates.map((t) => t.id)));
      }
    }
  }, [open, policyNumber, preSelectedId, pdfTemplates]);

  function toggleId(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (!email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (selectedIds.size === 0) {
      toast.error("Please select at least one document");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/pdf-templates/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId,
          templateIds: Array.from(selectedIds),
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send");
      }
      const data = await res.json();
      toast.success(`Email sent with ${data.sent} document${data.sent !== 1 ? "s" : ""} to ${email}`);
      onOpenChange(false);
      setEmail("");
      setMessage("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    }
    setSending(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email Documents</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="send-email-to">Recipient Email</Label>
            <Input
              id="send-email-to"
              type="email"
              placeholder="client@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="send-email-subject">Subject</Label>
            <Input
              id="send-email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="send-email-msg">Message (optional)</Label>
            <textarea
              id="send-email-msg"
              rows={3}
              placeholder="Add a personal note..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700"
            />
          </div>
          {pdfTemplates.length > 1 && (
            <div>
              <Label>Attach Documents</Label>
              <div className="mt-1 space-y-1.5">
                {pdfTemplates.map((tpl) => (
                  <label key={tpl.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selectedIds.has(tpl.id)}
                      onChange={() => toggleId(tpl.id)}
                    />
                    <span>{tpl.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSend} disabled={sending || !email.trim()}>
            {sending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="mr-1.5 h-3.5 w-3.5" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [pdfTemplates, setPdfTemplates] = React.useState<PdfTemplateRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<DocumentTemplateRow | null>(
    null,
  );
  const [emailDialogOpen, setEmailDialogOpen] = React.useState(false);
  const [emailPreSelectedId, setEmailPreSelectedId] = React.useState<number | undefined>();

  const snapshot = (detail.extraAttributes ?? {}) as SnapshotData;

  function handleEmailClick(tpl: PdfTemplateRow) {
    setEmailPreSelectedId(tpl.id);
    setEmailDialogOpen(true);
  }

  function handleWhatsAppClick(tpl: PdfTemplateRow) {
    const phone = (detail.extraAttributes?.insuredSnapshot as Record<string, unknown> | undefined)?.contactPhone
      ?? (detail.extraAttributes?.insuredSnapshot as Record<string, unknown> | undefined)?.phone
      ?? "";
    const phoneStr = String(phone).replace(/[^0-9+]/g, "");
    const text = encodeURIComponent(`Hi, please find the document "${tpl.label}" for Policy ${detail.policyNumber}.`);
    const url = phoneStr
      ? `https://wa.me/${phoneStr.replace(/^\+/, "")}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
  }

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const loadHtml = fetch(`/api/form-options?groupKey=document_templates&_t=${Date.now()}`, { cache: "no-store" })
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
      .catch(() => {});

    const loadPdf = fetch(`/api/form-options?groupKey=pdf_merge_templates&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PdfTemplateRow[]) => {
        if (cancelled) return;
        const applicable = rows.filter((r) => {
          const meta = r.meta as unknown as PdfTemplateMeta | null;
          if (!meta?.fields?.length) return false;
          const flows = meta.flows;
          if (!flows || flows.length === 0) return true;
          if (!flowKey) return false;
          return flows.includes(flowKey);
        });
        setPdfTemplates(applicable);
      })
      .catch(() => {});

    Promise.all([loadHtml, loadPdf]).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
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

  const hasAny = templates.length > 0 || pdfTemplates.length > 0;

  if (!hasAny) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <FileText className="mx-auto mb-2 h-8 w-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
          No document templates
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          Go to Admin &rarr; Policy Settings &rarr; Document Templates or PDF Mail Merge
          to create templates.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {templates.length > 0 && (
        <>
          <div className="text-sm font-medium">Document Templates</div>
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
        </>
      )}

      {pdfTemplates.length > 0 && (
        <>
          {templates.length > 0 && <div className="border-t border-neutral-200 dark:border-neutral-800 mt-3 pt-3" />}
          {pdfTemplates.map((tpl) => (
            <PdfMergeButton
              key={tpl.id}
              tpl={tpl}
              policyId={detail.policyId}
              onEmailClick={handleEmailClick}
              onWhatsAppClick={handleWhatsAppClick}
            />
          ))}
          {pdfTemplates.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => { setEmailPreSelectedId(undefined); setEmailDialogOpen(true); }}
            >
              <Mail className="h-3.5 w-3.5" />
              Email All Documents ({pdfTemplates.length})
            </Button>
          )}
        </>
      )}

      <SendEmailDialog
        open={emailDialogOpen}
        onOpenChange={setEmailDialogOpen}
        policyId={detail.policyId}
        policyNumber={detail.policyNumber}
        pdfTemplates={pdfTemplates}
        preSelectedId={emailPreSelectedId}
      />
    </div>
  );
}
