"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FileText, Printer, ChevronLeft, Stamp, Download, Loader2,
  Mail, MessageCircle, CheckCircle2, Send, XCircle, X, Paperclip, Upload, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocumentStatusMap, DocumentStatusEntry } from "@/lib/types/accounting";
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

function toTrackingKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function resolveFieldValue(
  snapshot: SnapshotData,
  detail: PolicyDetail,
  section: TemplateSection,
  fieldKey: string,
): unknown {
  if (section.source === "policy") {
    const extra = (detail.extraAttributes ?? {}) as Record<string, unknown>;
    const map: Record<string, unknown> = {
      policyNumber: detail.policyNumber,
      createdAt: detail.createdAt,
      policyId: detail.policyId,
      flowKey: extra.flowKey ?? "",
      status: extra.status ?? "",
      linkedPolicyId: extra.linkedPolicyId ?? "",
      linkedPolicyNumber: extra.linkedPolicyNumber ?? "",
      endorsementType: extra.endorsementType ?? "",
      endorsementReason: extra.endorsementReason ?? "",
      effectiveDate: extra.effectiveDate ?? "",
      expiryDate: extra.expiryDate ?? "",
    };
    return map[fieldKey] ?? extra[fieldKey] ?? snapshot[fieldKey] ?? "";
  }

  if (section.source === "agent") {
    return (detail.agent as Record<string, unknown> | undefined)?.[fieldKey] ?? "";
  }

  if (section.source === "insured" || section.source === "contactinfo") {
    const insured = snapshot.insuredSnapshot ?? {};
    const prefix = section.source;

    const stripPfx = (k: string): string =>
      k.replace(/^(insured|contactinfo)(__?|_)/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const robustGet = (pfx: string, key: string): string => {
      const direct = insured[key] ?? insured[`${pfx}__${key}`] ?? insured[`${pfx}_${key}`];
      if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
      const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      for (const [k, v] of Object.entries(insured)) {
        if (stripPfx(k) === norm && v !== undefined && v !== null && String(v).trim()) return String(v).trim();
      }
      return "";
    };

    if (section.source === "insured" && fieldKey === "displayName") {
      const iType = (robustGet("insured", "insuredType") || robustGet("insured", "category")).toLowerCase();
      if (iType === "personal") {
        const combined = [robustGet("insured", "lastName"), robustGet("insured", "firstName")].filter(Boolean).join(" ");
        return combined || robustGet("insured", "fullName");
      }
      if (iType === "company") return robustGet("insured", "companyName") || robustGet("insured", "organisationName");
      return robustGet("insured", "companyName") || robustGet("insured", "organisationName") || robustGet("insured", "fullName") ||
        [robustGet("insured", "lastName"), robustGet("insured", "firstName")].filter(Boolean).join(" ");
    }

    if (section.source === "insured" && fieldKey === "primaryId") {
      const iType = (robustGet("insured", "insuredType") || robustGet("insured", "category")).toLowerCase();
      if (iType === "personal") return robustGet("insured", "idNumber");
      if (iType === "company") return robustGet("insured", "brNumber");
      return robustGet("insured", "idNumber") || robustGet("insured", "brNumber");
    }

    if (section.source === "contactinfo" && fieldKey === "fullAddress") {
      const g = (k: string) => robustGet("contactinfo", k);
      const first = (...keys: string[]) => { for (const k of keys) { const v = g(k); if (v) return v; } return ""; };
      const tc = (s: string) => {
        if (!s) return s;
        const lo = s.toLowerCase();
        return (lo === s || s.toUpperCase() === s) ? lo.replace(/(?:^|\s|[-'/])\S/g, (ch) => ch.toUpperCase()) : s;
      };
      const parts: string[] = [];
      const flat = first("flatNumber", "flatNo", "flat");
      const floor = first("floorNumber", "floorNo", "floor", "foorNo");
      const block = first("blockNumber", "blockNo");
      const blockName = tc(first("blockName", "block"));
      const streetNum = first("streetNumber", "streetNo");
      const street = tc(first("streetName", "street"));
      const prop = tc(first("propertyName", "property"));
      const district = tc(first("districtName", "district"));
      const area = tc(first("area", "region"));
      if (flat) parts.push(`Flat ${flat}`);
      if (floor) parts.push(`${floor}/F`);
      if (block || blockName) parts.push([block, blockName].filter(Boolean).join(" "));
      if (streetNum || street) parts.push([streetNum, street].filter(Boolean).join(" "));
      if (prop) parts.push(prop);
      if (district) parts.push(district);
      if (area) parts.push(area);
      return parts.join(", ");
    }

    return robustGet(prefix, fieldKey) || "";
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

  if (format === "currency" || format === "negative_currency") {
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

function needsConfirmation(meta: DocumentTemplateMeta): boolean {
  if (meta.requiresConfirmation !== undefined) return meta.requiresConfirmation;
  return meta.type === "quotation";
}

function DocumentPreview({
  template,
  detail,
  snapshot,
  trackingEntry,
  audience,
  onConfirmDoc,
  onOpenEmailDialog,
}: {
  template: DocumentTemplateRow;
  detail: PolicyDetail;
  snapshot: SnapshotData;
  trackingEntry?: DocumentStatusEntry;
  audience?: "client" | "agent";
  onConfirmDoc?: (trackingKey: string) => void;
  onOpenEmailDialog?: (subject: string, htmlContent: string, plainText: string) => void;
}) {
  const meta = template.meta!;
  const printRef = React.useRef<HTMLDivElement>(null);

  const hasAudienceSections = meta.sections.some(
    (s) => s.audience === "client" || s.audience === "agent",
  );
  const viewAudience = audience ?? "client";

  const filteredSections = hasAudienceSections
    ? meta.sections.filter((s) => !s.audience || s.audience === "all" || s.audience === viewAudience)
    : meta.sections;

  const printStyles = `
    body { font-family: system-ui, -apple-system, sans-serif; padding: 40px; color: #1a1a1a; max-width: 800px; margin: 0 auto; font-size: 13px; }
    .border-b { border-bottom: 1px solid #f0f0f0; }
    .border-b-2 { border-bottom: 2px solid #333; }
    .border-t { border-top: 1px solid #ddd; }
    @media print { body { padding: 20px; } }
  `;

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
<style>${printStyles}</style></head><body>${content}</body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 300);
  }

  const dateStr = (() => {
    const d = new Date(detail.createdAt);
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  })();

  function generatePlainText(): string {
    const lines: string[] = [];
    lines.push(meta.header.title);
    if (meta.header.subtitle) lines.push(meta.header.subtitle);
    if (trackingEntry?.documentNumber) lines.push(`Doc No: ${trackingEntry.documentNumber}`);
    lines.push("─".repeat(30));
    if (meta.header.showPolicyNumber !== false) lines.push(`Ref: ${detail.policyNumber}`);
    if (meta.header.showDate !== false) lines.push(`Date: ${dateStr}`);
    lines.push("");

    for (const section of filteredSections) {
      const fields = section.fields
        .map((f) => ({
          ...f,
          resolved: resolveFieldValue(snapshot, detail, section, f.key),
        }))
        .filter((f) => f.resolved !== "" && f.resolved !== null && f.resolved !== undefined);

      if (fields.length === 0) continue;

      lines.push(`▸ ${section.title}`);
      const maxLabelLen = Math.max(...fields.map((f) => f.label.length));
      for (const f of fields) {
        const val = formatValue(f.resolved, f.format, f.currencyCode);
        lines.push(`  ${f.label.padEnd(maxLabelLen)}  ${val}`);
      }
      lines.push("");
    }

    if (meta.footer?.text) {
      lines.push("─".repeat(30));
      lines.push(meta.footer.text);
    }

    return lines.join("\n");
  }

  function handleCopyText() {
    const text = generatePlainText();
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied to clipboard"),
      () => toast.error("Failed to copy"),
    );
  }

  const trackingKey = hasAudienceSections && viewAudience === "agent"
    ? toTrackingKey(template.label) + "_agent"
    : toTrackingKey(template.label);

  function handleWhatsApp() {
    const insured = (detail.extraAttributes as Record<string, unknown> | undefined)?.insuredSnapshot as Record<string, unknown> | undefined;
    const phone = String(insured?.contactPhone ?? insured?.phone ?? insured?.contactinfo__mobile ?? insured?.mobile ?? "").replace(/[^0-9+]/g, "");
    const text = generatePlainText();
    const url = phone
      ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  }

  function handleEmail() {
    if (!printRef.current) return;
    const htmlContent = printRef.current.innerHTML;
    const plainText = generatePlainText();
    const subject = `${meta.header.title} - ${detail.policyNumber}`;
    onOpenEmailDialog?.(subject, htmlContent, plainText);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{template.label}</div>
        {hasAudienceSections && (
          <span className={cn(
            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
            viewAudience === "agent"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
          )}>
            {viewAudience === "agent" ? "Agent Copy" : "Client Copy"}
          </span>
        )}
      </div>

      <div
        ref={printRef}
        className="rounded-md border border-neutral-200 bg-white p-3 sm:p-6 text-neutral-900 dark:border-neutral-700 max-w-[800px]"
        style={{ fontFamily: "system-ui, -apple-system, sans-serif", color: "#1a1a1a" }}
      >
        {/* Header */}
        <div className="border-b-2 border-neutral-800 pb-2 sm:pb-3 mb-3 sm:mb-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-base sm:text-2xl font-bold leading-tight m-0">{meta.header.title}</h1>
              {meta.header.subtitle && (
                <div className="text-xs sm:text-[15px] text-neutral-500 mt-0.5">{meta.header.subtitle}</div>
              )}
            </div>
            {trackingEntry?.documentNumber && (
              <div className="text-right shrink-0 ml-4">
                <div className="text-[10px] sm:text-xs text-neutral-400 uppercase tracking-wider">Doc No.</div>
                <div className="text-sm sm:text-lg font-bold text-neutral-800">{trackingEntry.documentNumber}</div>
              </div>
            )}
          </div>
          <div className="flex justify-between mt-1 sm:mt-2 text-[11px] sm:text-[13px] text-neutral-500">
            {meta.header.showPolicyNumber !== false && (
              <span>Ref: <strong>{detail.policyNumber}</strong></span>
            )}
            {meta.header.showDate !== false && (
              <span>Date: <strong>{dateStr}</strong></span>
            )}
          </div>
        </div>

        {/* Sections */}
        {filteredSections.map((section) => {
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
            <div key={section.id} className="mb-3 sm:mb-5">
              <div className="text-[11px] sm:text-sm font-bold text-neutral-700 uppercase tracking-wide border-b border-neutral-300 pb-1 mb-1.5 sm:mb-2">
                {section.title}
              </div>
              <div>
                {fields.map((f, idx) => (
                  <div
                    key={f.key}
                    className={`flex flex-col sm:flex-row sm:justify-between sm:gap-3 print:flex-row print:justify-between py-1 sm:py-1.5 ${idx < fields.length - 1 ? "border-b border-neutral-100" : ""}`}
                  >
                    <span className="text-[11px] sm:text-[13px] text-neutral-500 font-medium sm:w-[40%] sm:shrink-0">
                      {f.label}
                    </span>
                    <span className="text-xs sm:text-[13px] font-semibold text-neutral-900 wrap-break-word sm:text-right">
                      {formatValue(f.resolved, f.format, f.currencyCode)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Footer */}
        {meta.footer?.text && (
          <div className="mt-6 sm:mt-8 pt-2 sm:pt-3 border-t border-neutral-300 text-[10px] sm:text-xs text-neutral-400">
            {meta.footer.text}
          </div>
        )}
        {meta.footer?.showSignature && (
          <div className="mt-10 sm:mt-16 flex justify-between">
            <div className="w-36 sm:w-[200px] border-t border-neutral-800 pt-1 text-[10px] sm:text-xs">Authorized Signature</div>
            <div className="w-36 sm:w-[200px] border-t border-neutral-800 pt-1 text-[10px] sm:text-xs">Client Signature</div>
          </div>
        )}
      </div>

      {/* Action buttons — 3-stage: icon / text / icon+text, 2 per row */}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={handleCopyText}>
          <FileText className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">Copy Text</span>
        </Button>
        <Button size="sm" variant="outline" onClick={handleEmail}>
          <Mail className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">Email</span>
        </Button>
        <Button size="sm" variant="outline" onClick={handleWhatsApp} className="text-green-600 hover:text-green-700 border-green-300 hover:border-green-400">
          <MessageCircle className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">WhatsApp</span>
        </Button>
        <Button size="sm" variant="outline" onClick={handlePrint}>
          <Printer className="h-4 w-4 sm:hidden lg:inline" />
          <span className="hidden sm:inline">Print / PDF</span>
        </Button>
      </div>

      {/* Tracking status */}
      {trackingEntry && (
        <div className="flex items-center justify-between rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            {(() => {
              const badge = trackingEntry.status ? STATUS_BADGE[trackingEntry.status] : null;
              if (!badge) return null;
              return (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", badge.bg, badge.text)}>
                  {trackingEntry.status === "confirmed" && <CheckCircle2 className="h-2.5 w-2.5" />}
                  {trackingEntry.status === "sent" && <Send className="h-2.5 w-2.5" />}
                  {badge.label}
                </span>
              );
            })()}
            {trackingEntry.sentAt && (
              <span className="text-[10px] text-neutral-400">
                {new Date(trackingEntry.sentAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {trackingEntry.status === "sent" && onConfirmDoc && needsConfirmation(meta) && (
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onConfirmDoc(trackingKey)}>
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Confirm Received
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Status badge for document tracking ---

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  sent:      { bg: "bg-orange-100 dark:bg-orange-900/50", text: "text-orange-700 dark:text-orange-300", label: "Sent" },
  confirmed: { bg: "bg-green-100 dark:bg-green-900/50",  text: "text-green-700 dark:text-green-300",   label: "Confirmed" },
  rejected:  { bg: "bg-red-100 dark:bg-red-900/50",      text: "text-red-700 dark:text-red-300",       label: "Rejected" },
  generated: { bg: "bg-blue-100 dark:bg-blue-900/50",    text: "text-blue-700 dark:text-blue-300",     label: "Generated" },
};

// --- PDF template row with embedded tracking + action slide-out ---

function PdfMergeButton({
  tpl,
  policyId,
  trackingKey,
  entry,
  updating,
  onEmailClick,
  onWhatsAppClick,
  onTrackingAction,
  onConfirmWithProof,
}: {
  tpl: PdfTemplateRow;
  policyId: number;
  trackingKey: string;
  entry?: DocumentStatusEntry;
  updating: boolean;
  onEmailClick: (tpl: PdfTemplateRow) => void;
  onWhatsAppClick: (tpl: PdfTemplateRow) => void;
  onTrackingAction: (key: string, action: "send" | "confirm" | "reject" | "reset" | "prepare", extra?: string, documentPrefix?: string, documentSuffix?: string, documentSetGroup?: string) => void;
  onConfirmWithProof: (key: string, method: "admin" | "upload", note?: string, file?: File) => Promise<void>;
}) {
  const [generating, setGenerating] = React.useState(false);
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmMethod, setConfirmMethod] = React.useState<"admin" | "upload">("admin");
  const [confirmNote, setConfirmNote] = React.useState("");
  const [confirmFile, setConfirmFile] = React.useState<File | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const meta = tpl.meta as unknown as PdfTemplateMeta | null;
  const status = entry?.status;
  const badge = status ? STATUS_BADGE[status] : null;

  React.useEffect(() => {
    if (!actionsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [actionsOpen]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const generateBody: Record<string, unknown> = { policyId };
      if (meta?.isAgentTemplate) generateBody.audience = "agent";
      const res = await fetch(`/api/pdf-templates/${tpl.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generateBody),
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

  const isDone = status === "confirmed";
  const pdfRequiresConfirm = meta?.requiresConfirmation !== undefined
    ? meta.requiresConfirmation
    : true;

  const actions: Array<{
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: "default" | "destructive";
    show: boolean;
  }> = [
    {
      label: "Mark Sent",
      icon: <Send className="h-3.5 w-3.5" />,
      onClick: () => {
        const sentTo = prompt("Sent to (email, optional):");
        onTrackingAction(trackingKey, "send", sentTo || undefined, meta?.documentPrefix || undefined, meta?.isAgentTemplate ? "(A)" : undefined, meta?.documentSetGroup || undefined);
        setActionsOpen(false);
      },
      show: !status || status === "rejected",
    },
    {
      label: "Confirm",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      onClick: () => { setConfirmOpen(true); setActionsOpen(false); },
      show: pdfRequiresConfirm && (!status || status === "sent"),
    },
    {
      label: "Reject",
      icon: <XCircle className="h-3.5 w-3.5" />,
      onClick: () => {
        const note = prompt("Rejection reason (optional):");
        onTrackingAction(trackingKey, "reject", note || undefined);
        setActionsOpen(false);
      },
      variant: "destructive" as const,
      show: pdfRequiresConfirm && status === "sent",
    },
    {
      label: "Reset",
      icon: <X className="h-3.5 w-3.5" />,
      onClick: () => { onTrackingAction(trackingKey, "reset"); setActionsOpen(false); },
      variant: "destructive" as const,
      show: isDone || status === "rejected",
    },
  ];

  const visibleActions = actions.filter((a) => a.show);

  return (
    <div
      ref={containerRef}
      className={cn(
        "rounded-md border p-3 transition-colors",
        isDone
          ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20"
          : status === "rejected"
            ? "border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/20"
            : "border-neutral-200 dark:border-neutral-800",
      )}
    >
      {/* Row 1: template info + send icons + download */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || (!meta?.fields?.length && !meta?.pages?.length)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left transition-colors hover:opacity-80 disabled:opacity-50"
        >
          <Stamp className="h-5 w-5 shrink-0 text-emerald-500 dark:text-emerald-400" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{tpl.label}</span>
              {badge && (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-medium", badge.bg, badge.text)}>
                  {status === "confirmed" && <CheckCircle2 className="h-2.5 w-2.5" />}
                  {status === "sent" && <Send className="h-2.5 w-2.5" />}
                  {status === "rejected" && <XCircle className="h-2.5 w-2.5" />}
                  {badge.label}
                </span>
              )}
            </div>
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

      {/* Row 2: Status button right-aligned, slide-out opens right-to-left */}
      <div className="mt-2 flex items-center justify-end gap-1">
        <div
          className={cn(
            "flex items-center overflow-hidden transition-all duration-500 ease-in-out",
            actionsOpen ? "max-w-[400px] opacity-100 mr-1" : "max-w-0 opacity-0 mr-0",
          )}
        >
          <div className="flex items-center gap-0 rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-800">
            {visibleActions.map((action, i) => (
              <button
                key={i}
                type="button"
                onClick={action.onClick}
                disabled={updating}
                className={cn(
                  "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                  "focus:outline-none disabled:pointer-events-none disabled:opacity-50",
                  action.variant === "destructive"
                    ? "text-red-600 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/50 dark:hover:text-red-300"
                    : "text-neutral-600 hover:bg-white hover:text-neutral-900 hover:shadow-sm dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100",
                )}
              >
                <span className="[&_svg]:h-3 [&_svg]:w-3">{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        <span
          onClick={() => !updating && setActionsOpen((v) => !v)}
          className={cn(
            "inline-flex items-center rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-600 shadow-sm select-none cursor-pointer",
            "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
            updating && "opacity-50 cursor-not-allowed",
          )}
        >
          Status
        </span>
      </div>

      {/* Tracking detail */}
      {entry?.documentNumber && (
        <div className="mt-1 pl-8 text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
          Doc No: {entry.documentNumber}
        </div>
      )}
      {entry?.sentTo && (
        <div className="mt-0.5 pl-8 text-[10px] text-neutral-400">
          Sent to: {entry.sentTo}
          {entry.sentAt && ` \u00b7 ${new Date(entry.sentAt).toLocaleDateString()}`}
        </div>
      )}
      {entry?.confirmedAt && (
        <div className="mt-0.5 pl-8 text-[10px] text-green-600 dark:text-green-400">
          Confirmed: {new Date(entry.confirmedAt).toLocaleDateString()}
          {entry.confirmedBy && ` by ${entry.confirmedBy}`}
          {entry.confirmMethod === "admin" && " (Admin)"}
          {entry.confirmMethod === "upload" && " (Proof uploaded)"}
        </div>
      )}
      {entry?.confirmNote && (
        <div className="mt-0.5 pl-8 text-[10px] text-neutral-500 dark:text-neutral-400 italic">
          Note: {entry.confirmNote}
        </div>
      )}
      {entry?.confirmProofName && (
        <a
          href={`/api/policies/${policyId}/document-tracking/proof?docType=${encodeURIComponent(trackingKey)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 pl-8 flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
        >
          <Paperclip className="h-2.5 w-2.5" />
          {entry.confirmProofName}
        </a>
      )}
      {status === "rejected" && entry?.rejectionNote && (
        <div className="mt-0.5 pl-8 text-[10px] text-red-500">
          Rejected: {entry.rejectionNote}
        </div>
      )}

      {/* Confirm Document Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              How would you like to confirm this document?
            </p>

            {/* Method selection */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={confirmMethod === "admin" ? "default" : "outline"}
                onClick={() => setConfirmMethod("admin")}
                className="flex-1"
              >
                <ShieldCheck className="mr-1 h-4 w-4" />
                Admin Confirm
              </Button>
              <Button
                size="sm"
                variant={confirmMethod === "upload" ? "default" : "outline"}
                onClick={() => setConfirmMethod("upload")}
                className="flex-1"
              >
                <Upload className="mr-1 h-4 w-4" />
                Upload Proof
              </Button>
            </div>

            {confirmMethod === "admin" && (
              <div>
                <Label>Admin Note (optional)</Label>
                <textarea
                  value={confirmNote}
                  onChange={(e) => setConfirmNote(e.target.value)}
                  rows={3}
                  placeholder="e.g. Client confirmed via phone call on 23/03/2026, spoke with Mr. Chan..."
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                />
              </div>
            )}

            {confirmMethod === "upload" && (
              <div>
                <Label>Upload signed/acknowledged document <span className="text-red-500">*</span></Label>
                <Input
                  type="file"
                  onChange={(e) => setConfirmFile(e.target.files?.[0] || null)}
                  className="mt-1"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
                />
                <div className="mt-1">
                  <Label>Note (optional)</Label>
                  <Input
                    value={confirmNote}
                    onChange={(e) => setConfirmNote(e.target.value)}
                    placeholder="Optional note about this proof..."
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              disabled={
                confirmSubmitting ||
                (confirmMethod === "upload" && !confirmFile)
              }
              onClick={async () => {
                setConfirmSubmitting(true);
                try {
                  await onConfirmWithProof(
                    trackingKey,
                    confirmMethod,
                    confirmNote.trim() || undefined,
                    confirmFile || undefined,
                  );
                  setConfirmOpen(false);
                  setConfirmNote("");
                  setConfirmFile(null);
                } finally {
                  setConfirmSubmitting(false);
                }
              }}
            >
              {confirmSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <CheckCircle2 className="mr-1 h-4 w-4" />
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  defaultEmail,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: number;
  policyNumber: string;
  pdfTemplates: PdfTemplateRow[];
  preSelectedId?: number;
  defaultEmail?: string;
  onSent?: (sentTemplateLabels: string[], email: string) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setEmail(defaultEmail ?? "");
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
      const sentLabels = pdfTemplates.filter((t) => selectedIds.has(t.id)).map((t) => t.label);
      onSent?.(sentLabels, email.trim());
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
  currentStatus,
  onStatusAutoAdvanced,
}: {
  detail: PolicyDetail;
  flowKey?: string;
  currentStatus?: string;
  onStatusAutoAdvanced?: () => void;
}) {
  const [templates, setTemplates] = React.useState<DocumentTemplateRow[]>([]);
  const [pdfTemplates, setPdfTemplates] = React.useState<PdfTemplateRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<DocumentTemplateRow | null>(null);
  const [selectedAudience, setSelectedAudience] = React.useState<"client" | "agent">("client");
  const [emailDialogOpen, setEmailDialogOpen] = React.useState(false);
  const [emailPreSelectedId, setEmailPreSelectedId] = React.useState<number | undefined>();

  // Document tracking state (shared across all template rows)
  const [tracking, setTracking] = React.useState<DocumentStatusMap>({});
  const [trackingUpdating, setTrackingUpdating] = React.useState(false);

  const snapshot = (detail.extraAttributes ?? {}) as SnapshotData;

  // Load tracking data
  React.useEffect(() => {
    fetch(`/api/policies/${detail.policyId}/document-tracking`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: DocumentStatusMap) => setTracking(data))
      .catch(() => {});
  }, [detail.policyId]);

  const handleTrackingAction = React.useCallback(async (
    docType: string,
    action: "send" | "confirm" | "reject" | "reset" | "prepare",
    extra?: string,
    documentPrefix?: string,
    documentSuffix?: string,
    documentSetGroup?: string,
  ) => {
    setTrackingUpdating(true);
    try {
      const body: Record<string, unknown> = { docType, action };
      if (action === "send" && extra) body.sentTo = extra;
      if (action === "reject" && extra) body.rejectionNote = extra;
      if ((action === "send" || action === "prepare") && documentPrefix) body.documentPrefix = documentPrefix;
      if ((action === "send" || action === "prepare") && documentSuffix) body.documentSuffix = documentSuffix;
      if ((action === "send" || action === "prepare") && documentSetGroup) {
        body.documentSetGroup = documentSetGroup;
        const siblingKeys: string[] = [];
        for (const t of templates) {
          if (t.meta?.documentSetGroup === documentSetGroup) {
            siblingKeys.push(toTrackingKey(t.label));
            siblingKeys.push(toTrackingKey(t.label) + "_agent");
          }
        }
        for (const t of pdfTemplates) {
          const m = t.meta as unknown as { documentSetGroup?: string } | null;
          if (m?.documentSetGroup === documentSetGroup) {
            siblingKeys.push(toTrackingKey(t.label));
          }
        }
        body.groupSiblingKeys = siblingKeys;
      }

      const res = await fetch(`/api/policies/${detail.policyId}/document-tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const data = await res.json();
      setTracking(data.documentTracking ?? {});
      const labels: Record<string, string> = { send: "marked as sent", confirm: "confirmed", reject: "rejected", reset: "reset", prepare: "prepared" };
      if (action !== "prepare") {
        toast.success(`${docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} ${labels[action]}`);
      }
      if (data.statusAdvanced) {
        toast.info(`Status auto-advanced to: ${data.statusAdvanced.replace(/_/g, " ")}`);
        onStatusAutoAdvanced?.();
      }
    } catch (err: any) {
      if (action !== "prepare") {
        toast.error(err.message || "Failed to update");
      }
    } finally {
      setTrackingUpdating(false);
    }
  }, [detail.policyId, onStatusAutoAdvanced]);

  const handleConfirmWithProof = React.useCallback(async (
    docType: string,
    method: "admin" | "upload",
    note?: string,
    file?: File,
  ) => {
    setTrackingUpdating(true);
    try {
      let res: Response;
      if (method === "upload" && file) {
        const formData = new FormData();
        formData.append("docType", docType);
        formData.append("action", "confirm");
        formData.append("confirmMethod", "upload");
        if (note) formData.append("confirmNote", note);
        formData.append("proofFile", file);
        res = await fetch(`/api/policies/${detail.policyId}/document-tracking`, {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch(`/api/policies/${detail.policyId}/document-tracking`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType,
            action: "confirm",
            confirmMethod: "admin",
            confirmNote: note,
          }),
        });
      }
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const data = await res.json();
      setTracking(data.documentTracking ?? {});
      toast.success(`${docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} confirmed`);
      if (data.statusAdvanced) {
        toast.info(`Status auto-advanced to: ${data.statusAdvanced.replace(/_/g, " ")}`);
        onStatusAutoAdvanced?.();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to confirm");
    } finally {
      setTrackingUpdating(false);
    }
  }, [detail.policyId, onStatusAutoAdvanced]);

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

  const [htmlConfirmKey, setHtmlConfirmKey] = React.useState<string | null>(null);
  const [htmlConfirmMethod, setHtmlConfirmMethod] = React.useState<"admin" | "upload">("admin");
  const [htmlConfirmNote, setHtmlConfirmNote] = React.useState("");
  const [htmlConfirmFile, setHtmlConfirmFile] = React.useState<File | null>(null);
  const [htmlConfirmSubmitting, setHtmlConfirmSubmitting] = React.useState(false);

  // HTML document email dialog state
  const [htmlEmailOpen, setHtmlEmailOpen] = React.useState(false);
  const [htmlEmailTo, setHtmlEmailTo] = React.useState("");
  const [htmlEmailSubject, setHtmlEmailSubject] = React.useState("");
  const [htmlEmailHtml, setHtmlEmailHtml] = React.useState("");
  const [htmlEmailPlain, setHtmlEmailPlain] = React.useState("");
  const [htmlEmailSending, setHtmlEmailSending] = React.useState(false);

  const handleOpenHtmlEmail = React.useCallback((subject: string, htmlContent: string, plainText: string) => {
    setHtmlEmailSubject(subject);
    setHtmlEmailHtml(htmlContent);
    setHtmlEmailPlain(plainText);

    const insured = (detail.extraAttributes as Record<string, unknown> | undefined)?.insuredSnapshot as Record<string, unknown> | undefined;
    if (selectedAudience === "agent" && detail.agent?.email) {
      setHtmlEmailTo(detail.agent.email);
    } else {
      const clientEmail = String(insured?.email ?? insured?.contactinfo__email ?? "");
      setHtmlEmailTo(clientEmail);
    }

    setHtmlEmailOpen(true);
  }, [detail.extraAttributes, detail.agent, selectedAudience]);

  const handleSendHtmlEmail = React.useCallback(async () => {
    if (!htmlEmailTo.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }
    setHtmlEmailSending(true);
    try {
      const res = await fetch(`/api/policies/${detail.policyId}/send-document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: htmlEmailTo.trim(),
          subject: htmlEmailSubject,
          htmlContent: htmlEmailHtml,
          plainText: htmlEmailPlain,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send");
      }
      toast.success(`Email sent to ${htmlEmailTo}`);
      setHtmlEmailOpen(false);

      // Mark as sent in tracking
      if (selected) {
        const hasAudienceSections = selected.meta?.sections?.some(
          (s) => s.audience === "client" || s.audience === "agent",
        );
        const isAgent = hasAudienceSections ? selectedAudience === "agent" : !!selected.meta?.isAgentTemplate;
        const trackKey = isAgent && hasAudienceSections
          ? toTrackingKey(selected.label) + "_agent"
          : toTrackingKey(selected.label);
        if (!tracking[trackKey] || tracking[trackKey]?.status !== "confirmed") {
          await handleTrackingAction(trackKey, "send", htmlEmailTo.trim(), selected.meta?.documentPrefix || undefined, isAgent ? "(A)" : undefined, selected.meta?.documentSetGroup || undefined);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to send email");
    } finally {
      setHtmlEmailSending(false);
    }
  }, [htmlEmailTo, htmlEmailSubject, htmlEmailHtml, htmlEmailPlain, detail.policyId, selected, tracking, handleTrackingAction]);

  const [policyInsurerIds, setPolicyInsurerIds] = React.useState<number[] | null>(null);

  React.useEffect(() => {
    fetch(`/api/policies/${detail.policyId}/linked-insurers`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { insurerPolicyIds: [] }))
      .then((data: { insurerPolicyIds?: number[] }) => {
        setPolicyInsurerIds(data.insurerPolicyIds ?? []);
      })
      .catch(() => setPolicyInsurerIds([]));
  }, [detail.policyId]);

  React.useEffect(() => {
    if (policyInsurerIds === null) return;
    let cancelled = false;
    setLoading(true);

    const status = currentStatus || "active";

    const matchingIds = [...new Set([detail.policyId, ...policyInsurerIds])];

    const matchesInsurer = (tplInsurerIds: number[] | undefined) => {
      if (!tplInsurerIds || tplInsurerIds.length === 0) return true;
      return matchingIds.some((pid) => tplInsurerIds.includes(pid));
    };

    // "showWhenStatus" means "show FROM the earliest listed status onwards".
    // We load the ordered status list to compare positions.
    const loadStatusOrder = fetch(`/api/form-options?groupKey=policy_statuses&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { value: string; sortOrder?: number }[]) =>
        rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((r) => r.value),
      )
      .catch(() => [] as string[]);

    const matchesStatus = (sws: string[] | undefined, statusOrder: string[]) => {
      if (!sws || sws.length === 0) return true;
      const currentIdx = statusOrder.indexOf(status);
      // Find the earliest status in the template's showWhenStatus list
      const earliestIdx = Math.min(
        ...sws.map((s) => statusOrder.indexOf(s)).filter((i) => i >= 0),
      );
      if (currentIdx < 0 || earliestIdx === Infinity) {
        // Fallback to exact match if status not found in the ordered list
        return sws.includes(status);
      }
      // Show if current status is at or past the earliest trigger status
      return currentIdx >= earliestIdx;
    };

    loadStatusOrder.then((statusOrder) => {
      const loadHtml = fetch(`/api/form-options?groupKey=document_templates&_t=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: DocumentTemplateRow[]) => {
          if (cancelled) return;
          const applicable = rows.filter((r) => {
            if (!r.meta) return false;
            const hasInsurerRestriction = r.meta.insurerPolicyIds && r.meta.insurerPolicyIds.length > 0;
            if (!hasInsurerRestriction) {
              const flows = r.meta.flows;
              if (flows && flows.length > 0) {
                if (!flowKey || !flows.includes(flowKey)) return false;
              }
            } else {
              if (!matchesInsurer(r.meta.insurerPolicyIds)) return false;
            }
            if (!matchesStatus(r.meta.showWhenStatus, statusOrder)) return false;
            return true;
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
            if (!meta) return false;
            if (!meta.fields?.length && !meta.pages?.length) return false;
            const hasInsurerRestriction = meta.insurerPolicyIds && meta.insurerPolicyIds.length > 0;
            if (!hasInsurerRestriction) {
              const flows = meta.flows;
              if (flows && flows.length > 0) {
                if (!flowKey || !flows.includes(flowKey)) return false;
              }
            } else {
              if (!matchesInsurer(meta.insurerPolicyIds)) return false;
            }
            if (!matchesStatus(meta.showWhenStatus, statusOrder)) return false;
            return true;
          });
          setPdfTemplates(applicable);
        })
        .catch(() => {});

      Promise.all([loadHtml, loadPdf]).finally(() => {
        if (!cancelled) setLoading(false);
      });
    });

    return () => { cancelled = true; };
  }, [flowKey, currentStatus, policyInsurerIds, detail.policyId]);

  // Auto-prepare: assign document numbers when templates become visible
  const [autoPrepared, setAutoPrepared] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (loading || templates.length === 0) return;

    const hasAgent = !!detail.agent;
    const hasAudienceTpls = templates.some((t) =>
      t.meta?.sections?.some((s) => s.audience === "client" || s.audience === "agent"),
    );
    const showBoth = hasAgent && hasAudienceTpls;

    const toProcess: { key: string; prefix: string; suffix?: string; group?: string }[] = [];

    for (const tpl of templates) {
      const prefix = tpl.meta?.documentPrefix;
      if (!prefix) continue;
      const group = tpl.meta?.documentSetGroup;

      const baseKey = toTrackingKey(tpl.label);
      if (!tracking[baseKey]?.documentNumber && !autoPrepared.has(baseKey)) {
        toProcess.push({ key: baseKey, prefix, group });
      }
      if (showBoth) {
        const agentKey = baseKey + "_agent";
        if (!tracking[agentKey]?.documentNumber && !autoPrepared.has(agentKey)) {
          toProcess.push({ key: agentKey, prefix, suffix: "(A)", group });
        }
      }
    }

    for (const tpl of pdfTemplates) {
      const meta = tpl.meta as unknown as { documentPrefix?: string; isAgentTemplate?: boolean; documentSetGroup?: string } | null;
      const prefix = meta?.documentPrefix;
      if (!prefix) continue;
      const key = toTrackingKey(tpl.label);
      if (!tracking[key]?.documentNumber && !autoPrepared.has(key)) {
        toProcess.push({ key, prefix, suffix: meta?.isAgentTemplate ? "(A)" : undefined, group: meta?.documentSetGroup });
      }
    }

    if (toProcess.length === 0) return;

    setAutoPrepared((prev) => {
      const next = new Set(prev);
      toProcess.forEach((p) => next.add(p.key));
      return next;
    });

    (async () => {
      for (const { key, prefix, suffix, group } of toProcess) {
        await handleTrackingAction(key, "prepare", undefined, prefix, suffix, group);
      }
    })();
  }, [loading, templates, pdfTemplates, tracking, detail.agent, autoPrepared, handleTrackingAction]);

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Loading templates...
      </div>
    );
  }

  if (selected) {
    const selHasAudienceSections = selected.meta?.sections?.some(
      (s) => s.audience === "client" || s.audience === "agent",
    );
    const selKey = selHasAudienceSections && selectedAudience === "agent"
      ? toTrackingKey(selected.label) + "_agent"
      : toTrackingKey(selected.label);
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
          trackingEntry={tracking[selKey]}
          audience={selectedAudience}
          onConfirmDoc={(key) => {
            setHtmlConfirmKey(key);
            setHtmlConfirmMethod("admin");
            setHtmlConfirmNote("");
            setHtmlConfirmFile(null);
          }}
          onOpenEmailDialog={handleOpenHtmlEmail}
        />

        {/* Confirm dialog for HTML documents */}
        <Dialog open={!!htmlConfirmKey} onOpenChange={(open) => { if (!open) setHtmlConfirmKey(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Confirm Document Received</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                How would you like to confirm this document?
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant={htmlConfirmMethod === "admin" ? "default" : "outline"} onClick={() => setHtmlConfirmMethod("admin")} className="flex-1">
                  <ShieldCheck className="mr-1 h-4 w-4" />
                  Admin Confirm
                </Button>
                <Button size="sm" variant={htmlConfirmMethod === "upload" ? "default" : "outline"} onClick={() => setHtmlConfirmMethod("upload")} className="flex-1">
                  <Upload className="mr-1 h-4 w-4" />
                  Upload Proof
                </Button>
              </div>
              {htmlConfirmMethod === "admin" && (
                <div>
                  <Label>Admin Note (optional)</Label>
                  <textarea
                    value={htmlConfirmNote}
                    onChange={(e) => setHtmlConfirmNote(e.target.value)}
                    rows={3}
                    placeholder="e.g. Client confirmed via phone call..."
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  />
                </div>
              )}
              {htmlConfirmMethod === "upload" && (
                <div>
                  <Label>Upload signed document <span className="text-red-500">*</span></Label>
                  <Input type="file" onChange={(e) => setHtmlConfirmFile(e.target.files?.[0] || null)} className="mt-1" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" />
                  <div className="mt-1">
                    <Label>Note (optional)</Label>
                    <Input value={htmlConfirmNote} onChange={(e) => setHtmlConfirmNote(e.target.value)} placeholder="Optional note..." className="mt-1" />
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHtmlConfirmKey(null)}>Cancel</Button>
              <Button
                disabled={
                  htmlConfirmSubmitting ||
                  (htmlConfirmMethod === "upload" && !htmlConfirmFile)
                }
                onClick={async () => {
                  if (!htmlConfirmKey) return;
                  setHtmlConfirmSubmitting(true);
                  try {
                    await handleConfirmWithProof(
                      htmlConfirmKey,
                      htmlConfirmMethod,
                      htmlConfirmNote.trim() || undefined,
                      htmlConfirmFile || undefined,
                    );
                    setHtmlConfirmKey(null);
                  } finally {
                    setHtmlConfirmSubmitting(false);
                  }
                }}
              >
                {htmlConfirmSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <CheckCircle2 className="mr-1 h-4 w-4" />
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Send Email dialog for HTML documents (uses Brevo) */}
        <Dialog open={htmlEmailOpen} onOpenChange={setHtmlEmailOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <span className="flex items-center gap-2">
                  Email Document
                  {selected?.meta?.sections?.some((s) => s.audience === "client" || s.audience === "agent") && (
                    <span className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      selectedAudience === "agent"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                        : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
                    )}>
                      {selectedAudience === "agent" ? "Agent Copy" : "Client Copy"}
                    </span>
                  )}
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="html-email-to">
                  {selectedAudience === "agent" ? "Agent Email" : "Recipient Email"}
                </Label>
                <Input
                  id="html-email-to"
                  type="email"
                  placeholder={selectedAudience === "agent" ? "agent@example.com" : "client@example.com"}
                  value={htmlEmailTo}
                  onChange={(e) => setHtmlEmailTo(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="html-email-subject">Subject</Label>
                <Input
                  id="html-email-subject"
                  value={htmlEmailSubject}
                  onChange={(e) => setHtmlEmailSubject(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setHtmlEmailOpen(false)} disabled={htmlEmailSending}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSendHtmlEmail} disabled={htmlEmailSending || !htmlEmailTo.trim()}>
                {htmlEmailSending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-1.5 h-3.5 w-3.5" />
                    Send via Brevo
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

  const policyHasAgent = !!detail.agent;
  const anyTemplateHasAudience = templates.some((tpl) =>
    tpl.meta?.sections?.some((s) => s.audience === "client" || s.audience === "agent"),
  );
  const showGrouped = policyHasAgent && anyTemplateHasAudience;

  function renderTemplateButton(tpl: DocumentTemplateRow, aud: "client" | "agent", showBadge: boolean) {
    const isAgent = aud === "agent";
    const tKey = isAgent ? toTrackingKey(tpl.label) + "_agent" : toTrackingKey(tpl.label);
    const tEntry = tracking[tKey];
    const tBadge = tEntry?.status ? STATUS_BADGE[tEntry.status] : null;

    return (
      <button
        key={`${tpl.id}_${aud}`}
        type="button"
        onClick={() => { setSelected(tpl); setSelectedAudience(aud); }}
        className={cn(
          "flex w-full items-center gap-3 rounded-md p-2.5 text-left transition-colors",
          tEntry?.status === "confirmed"
            ? "bg-green-50/70 dark:bg-green-950/20"
            : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
        )}
      >
        <FileText className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{tpl.label}</span>
            {tBadge && (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[9px] font-medium", tBadge.bg, tBadge.text)}>
                {tEntry?.status === "confirmed" && <CheckCircle2 className="h-2.5 w-2.5" />}
                {tEntry?.status === "sent" && <Send className="h-2.5 w-2.5" />}
                {tBadge.label}
              </span>
            )}
          </div>
          {tEntry?.documentNumber ? (
            <div className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
              {tEntry.documentNumber}
            </div>
          ) : (
            <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
              {tpl.meta?.type
                ? tpl.meta.type.charAt(0).toUpperCase() + tpl.meta.type.slice(1)
                : "Document"}
            </div>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {templates.length > 0 && showGrouped ? (
        <>
          {/* Client Documents Group */}
          <div className="rounded-lg border-2 border-blue-200 dark:border-blue-800 overflow-hidden">
            <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 dark:bg-blue-950/30">
              <FileText className="h-4 w-4 text-blue-500" />
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Client Documents</span>
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {templates.map((tpl) => renderTemplateButton(tpl, "client", false))}
            </div>
          </div>

          {/* Agent Documents Group */}
          <div className="rounded-lg border-2 border-amber-200 dark:border-amber-800 overflow-hidden">
            <div className="flex items-center gap-2 bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
              <FileText className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Agent Documents</span>
              {detail.agent?.name && (
                <span className="text-[10px] text-amber-500 dark:text-amber-400">({detail.agent.name})</span>
              )}
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {templates.map((tpl) => renderTemplateButton(tpl, "agent", false))}
            </div>
          </div>
        </>
      ) : templates.length > 0 ? (
        <>
          <div className="text-sm font-medium">Document Templates</div>
          {templates.map((tpl) => renderTemplateButton(tpl, "client", false))}
        </>
      ) : null}

      {pdfTemplates.length > 0 && (
        <>
          {templates.length > 0 && <div className="border-t border-neutral-200 dark:border-neutral-800 pt-1" />}
          {pdfTemplates.map((tpl) => {
            const key = toTrackingKey(tpl.label);
            return (
              <PdfMergeButton
                key={tpl.id}
                tpl={tpl}
                policyId={detail.policyId}
                trackingKey={key}
                entry={tracking[key]}
                updating={trackingUpdating}
                onEmailClick={handleEmailClick}
                onWhatsAppClick={handleWhatsAppClick}
                onTrackingAction={handleTrackingAction}
                onConfirmWithProof={handleConfirmWithProof}
              />
            );
          })}
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
        defaultEmail={(() => {
          if (emailPreSelectedId) {
            const tpl = pdfTemplates.find((t) => t.id === emailPreSelectedId);
            const m = tpl?.meta as unknown as { isAgentTemplate?: boolean } | null;
            if (m?.isAgentTemplate && detail.agent?.email) return detail.agent.email;
          }
          const ins = (detail.extraAttributes as Record<string, unknown> | undefined)?.insuredSnapshot as Record<string, unknown> | undefined;
          return String(ins?.email ?? ins?.contactinfo__email ?? "");
        })()}
        onSent={async (labels, sentEmail) => {
          for (const label of labels) {
            const key = toTrackingKey(label);
            if (!tracking[key] || tracking[key]?.status !== "confirmed") {
              const matchingTpl = pdfTemplates.find((t) => t.label === label);
              const tplMeta = matchingTpl?.meta as unknown as { documentPrefix?: string; isAgentTemplate?: boolean; documentSetGroup?: string } | null;
              await handleTrackingAction(key, "send", sentEmail, tplMeta?.documentPrefix || undefined, tplMeta?.isAgentTemplate ? "(A)" : undefined, tplMeta?.documentSetGroup || undefined);
            }
          }
        }}
      />
    </div>
  );
}
