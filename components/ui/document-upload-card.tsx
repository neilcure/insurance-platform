"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Trash2,
  Loader2,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarClock,
} from "lucide-react";
import Image from "next/image";
import { Label } from "@/components/ui/label";
import type {
  DocumentStatus,
  PolicyDocumentRow,
  PolicyPaymentRecord,
  PremiumBreakdown,
  UploadDocumentTypeMeta,
} from "@/lib/types/upload-document";
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from "@/lib/types/accounting";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReminderScheduler } from "@/components/ui/reminder-scheduler";

const STATUS_CONFIG: Record<DocumentStatus, {
  label: string;
  variant: "outline" | "secondary" | "destructive" | "default";
  className: string;
  icon: typeof Clock;
}> = {
  outstanding: {
    label: "Outstanding",
    variant: "outline",
    className: "border-neutral-300 text-neutral-500 dark:border-neutral-600 dark:text-neutral-400",
    icon: Clock,
  },
  uploaded: {
    label: "Pending Verification",
    variant: "secondary",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    icon: Clock,
  },
  verified: {
    label: "Verified",
    variant: "default",
    className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Rejected",
    variant: "destructive",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    icon: XCircle,
  },
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Lightbox({
  docs,
  policyId,
  initialIndex,
  onClose,
}: {
  docs: PolicyDocumentRow[];
  policyId: number;
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = React.useState(initialIndex);
  const canPrev = index > 0;
  const canNext = index < docs.length - 1;

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && canPrev) setIndex((i) => i - 1);
      if (e.key === "ArrowRight" && canNext) setIndex((i) => i + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPrev, canNext, onClose]);

  const doc = docs[index];
  if (!doc) return null;

  const fileUrl = `/api/policies/${policyId}/documents/${doc.id}/file`;
  const isImage = doc.mimeType?.startsWith("image/") ?? false;
  const isPdf = doc.mimeType === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{doc.fileName}</div>
          <div className="text-xs text-white/60">
            {formatFileSize(doc.fileSize)}
            {docs.length > 1 && ` \u00b7 ${index + 1} / ${docs.length}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={fileUrl}
            download={doc.fileName}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </a>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
            title="Open in new tab"
          >
            <Eye className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Navigation arrows */}
      {docs.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => canPrev && setIndex((i) => i - 1)}
            disabled={!canPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-20 disabled:hover:bg-white/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => canNext && setIndex((i) => i + 1)}
            disabled={!canNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-20 disabled:hover:bg-white/10"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {/* Content */}
      <div className="mt-14 mb-4 flex max-h-[calc(100vh-120px)] max-w-[calc(100vw-80px)] items-center justify-center">
        {isImage ? (
          <Image
            src={fileUrl}
            alt={doc.fileName}
            width={0}
            height={0}
            sizes="100vw"
            unoptimized
            className="max-h-[calc(100vh-120px)] max-w-full rounded-lg object-contain shadow-2xl"
            style={{ width: "auto", height: "auto" }}
          />
        ) : isPdf ? (
          <iframe
            src={fileUrl}
            title={doc.fileName}
            className="h-[calc(100vh-140px)] w-[min(900px,calc(100vw-100px))] rounded-lg bg-white shadow-2xl"
          />
        ) : (
          <div className="rounded-lg bg-neutral-900 p-8 text-center text-white">
            <FileText className="mx-auto mb-3 h-12 w-12 text-neutral-400" />
            <div className="mb-1 text-sm font-medium">{doc.fileName}</div>
            <div className="mb-4 text-xs text-neutral-400">{formatFileSize(doc.fileSize)}</div>
            <a
              href={fileUrl}
              download={doc.fileName}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-4 py-2 text-sm transition-colors hover:bg-white/20"
            >
              <Download className="h-4 w-4" />
              Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

type ScheduleInfo = {
  id: number;
  entityType: string;
  entityName: string | null;
  frequency: string | null;
  billingDay: number | null;
};

type DocumentUploadCardProps = {
  typeKey: string;
  label: string;
  meta: UploadDocumentTypeMeta | null;
  displayStatus: DocumentStatus;
  uploads: PolicyDocumentRow[];
  payments?: PolicyPaymentRecord[];
  premiumBreakdown?: PremiumBreakdown;
  policyId: number;
  isAdmin: boolean;
  onRefresh: () => void;
  onStatementToggled?: () => void;
  clientSchedule?: ScheduleInfo | null;
  agentSchedule?: ScheduleInfo | null;
  hasStatementInvoices?: boolean;
};

function formatPaymentMethod(m: string | null): string {
  if (!m) return "";
  const opt = PAYMENT_METHOD_OPTIONS.find((o) => o.value === m);
  return opt?.label ?? m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-HK", { style: "currency", currency: "HKD", minimumFractionDigits: 2 }).format(cents / 100);
}

const paymentColorStyles = {
  emerald: {
    border: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20",
    text: "text-emerald-700 dark:text-emerald-400",
    bold: "text-emerald-800 dark:text-emerald-300",
    divider: "border-emerald-200 dark:border-emerald-800",
  },
  blue: {
    border: "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20",
    text: "text-blue-700 dark:text-blue-400",
    bold: "text-blue-800 dark:text-blue-300",
    divider: "border-blue-200 dark:border-blue-800",
  },
  yellow: {
    border: "border-yellow-200 bg-yellow-50/50 dark:border-yellow-800 dark:bg-yellow-950/20",
    text: "text-yellow-700 dark:text-yellow-400",
    bold: "text-yellow-800 dark:text-yellow-300",
    divider: "border-yellow-200 dark:border-yellow-800",
  },
};

function PaymentRecordSection({
  label,
  payments,
  paidCents,
  premiumCents,
  colorScheme,
  settled,
  statusLabel,
  statusColor,
  renderPayment,
}: {
  label: string;
  payments: PolicyPaymentRecord[] | null;
  paidCents: number;
  premiumCents: number;
  colorScheme: "emerald" | "blue" | "yellow";
  settled: boolean;
  statusLabel: string;
  statusColor: string;
  renderPayment: (p: PolicyPaymentRecord, i: number) => React.ReactNode;
}) {
  const cs = paymentColorStyles[colorScheme];

  return (
    <div className={`mb-2 rounded-md border p-2.5 ${cs.border}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-wider ${cs.text} mb-1.5`}>
        {label}
      </div>
      {payments && payments.length > 0 && (
        <div className="space-y-1.5">
          {payments.map((p, i) => renderPayment(p, i))}
        </div>
      )}
      <div className={`${payments && payments.length > 0 ? "mt-1.5 pt-1.5 border-t" : ""} ${cs.divider} flex items-center justify-between text-xs`}>
        <span className={`font-semibold ${cs.bold}`}>Total</span>
        <span className={`font-bold ${cs.bold}`}>
          {formatCurrency(paidCents)}{premiumCents > 0 && ` / ${formatCurrency(premiumCents)}`}
        </span>
      </div>
      {settled && (
        <div className={`mt-1 flex items-center gap-1 text-[10px] ${statusColor}`}>
          <CheckCircle2 className="h-3 w-3" />
          <span>{statusLabel}</span>
        </div>
      )}
    </div>
  );
}

export function DocumentUploadCard({
  typeKey,
  label,
  meta,
  displayStatus,
  uploads,
  payments,
  premiumBreakdown,
  policyId,
  isAdmin,
  onRefresh,
  onStatementToggled,
  clientSchedule,
  agentSchedule,
  hasStatementInvoices,
}: DocumentUploadCardProps) {
  const [uploading, setUploading] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectDocId, setRejectDocId] = React.useState<number | null>(null);
  const [rejectNote, setRejectNote] = React.useState("");
  const [actionBusy, setActionBusy] = React.useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const needsPayment = meta?.requirePaymentDetails === true;
  const hasAgent = needsPayment && premiumBreakdown && premiumBreakdown.agentPremiumCents > 0;
  const [paymentPayer, setPaymentPayer] = React.useState<"client" | "agent" | null>(hasAgent ? null : "client");
  const [paymentType, setPaymentType] = React.useState<"full" | "partial">("full");
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>("bank_transfer");
  const [paymentAmount, setPaymentAmount] = React.useState("");
  const [paymentDate, setPaymentDate] = React.useState(() => new Date().toISOString().split("T")[0]);
  const [paymentRef, setPaymentRef] = React.useState("");
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);
  const [payIndividually, setPayIndividually] = React.useState(!hasStatementInvoices);
  const [togglingStatement, setTogglingStatement] = React.useState(false);
  const allSettled = displayStatus === "verified";
  const [cardOpen, setCardOpen] = React.useState(!allSettled);

  React.useEffect(() => {
    setPayIndividually(!hasStatementInvoices);
  }, [hasStatementInvoices]);

  const statusCfg = STATUS_CONFIG[displayStatus];
  const StatusIcon = statusCfg.icon;

  const acceptAttr = meta?.acceptedTypes?.join(",") ?? undefined;
  const canUpload = displayStatus === "outstanding" || displayStatus === "rejected";

  function resetPaymentForm() {
    setPaymentPayer(hasAgent ? null : "client");
    setPaymentType("full");
    setPaymentMethod("bank_transfer");
    setPaymentAmount("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentRef("");
    setPendingFile(null);
  }

  async function handleStatementToggle(addToStatement: boolean) {
    // Premium billing should prefer the client-facing schedule.
    const schedule = clientSchedule || agentSchedule;
    if (!schedule) return;
    setTogglingStatement(true);
    try {
      const invRes = await fetch(`/api/accounting/invoices/by-policy/${policyId}?_t=${Date.now()}`, { cache: "no-store" });
      if (!invRes.ok) throw new Error("Failed to fetch invoices");
      const invoices: { id: number; direction: string; invoiceType: string; scheduleId: number | null }[] = await invRes.json();
      const receivables = invoices.filter((inv) => inv.direction === "receivable" && inv.invoiceType !== "statement");

      if (addToStatement) {
        let patched = 0;
        for (const inv of receivables) {
          if (!inv.scheduleId) {
            await fetch(`/api/accounting/invoices/${inv.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scheduleId: schedule.id, status: "statement_created" }),
            });
            patched++;
          }
        }
        toast.success(patched > 0 ? "Policy added to statement billing" : "Already on statement billing");
      } else {
        for (const inv of receivables) {
          if (inv.scheduleId) {
            await fetch(`/api/accounting/invoices/${inv.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scheduleId: null, status: "pending" }),
            });
          }
        }
        toast.success("Policy removed from statement billing");
      }
      setPayIndividually(!addToStatement);
      onStatementToggled?.();
    } catch (err) {
      toast.error((err as Error).message || "Failed to update statement");
    } finally {
      setTogglingStatement(false);
    }
  }

  React.useEffect(() => {
    if (needsPayment && !hasAgent && premiumBreakdown && !paymentAmount) {
      setPaymentAmount((premiumBreakdown.clientPremiumCents / 100).toFixed(2));
    }
  }, [needsPayment, hasAgent, premiumBreakdown]); // eslint-disable-line react-hooks/exhaustive-deps

  const fullAmount = React.useMemo(() => {
    if (!premiumBreakdown) return 0;
    if (!hasAgent) return premiumBreakdown.clientPremiumCents;
    if (paymentPayer === "client") return premiumBreakdown.clientPremiumCents;
    return premiumBreakdown.agentPremiumCents;
  }, [premiumBreakdown, hasAgent, paymentPayer]);

  const receivablePayments = React.useMemo(() => {
    if (!payments) return [];
    return payments.filter((p) => !p.direction || p.direction === "receivable");
  }, [payments]);

  const alreadyPaid = React.useMemo(() => {
    const counted = ["verified", "confirmed", "recorded"];
    const relevantPmts = receivablePayments.filter((p) => {
      if (!counted.includes(p.status)) return false;
      if (!paymentPayer || paymentPayer === "client") {
        return p.entityType === "client" || (!p.entityType && p.payer !== "agent");
      }
      return p.entityType === "agent" || (!p.entityType && p.payer === "agent");
    });
    return relevantPmts.reduce((sum, p) => sum + p.amountCents, 0);
  }, [receivablePayments, paymentPayer]);

  const remainingAmount = Math.max(fullAmount - alreadyPaid, 0);

  React.useEffect(() => {
    if (paymentPayer && paymentType === "full") {
      setPaymentAmount((remainingAmount / 100).toFixed(2));
    }
  }, [paymentPayer, remainingAmount]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxBytes = (meta?.maxSizeMB ?? 10) * 1024 * 1024;
    if (file.size > maxBytes) {
      toast.error(`File exceeds ${meta?.maxSizeMB ?? 10}MB limit`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (needsPayment) {
      setPendingFile(file);
    } else {
      void doUpload(file);
    }
  }

  async function doUpload(file: File, overrideAmountStr?: string) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentTypeKey", typeKey);

      if (needsPayment) {
        const amtStr = overrideAmountStr || paymentAmount;
        const cents = Math.round(Number(amtStr) * 100);
        if (!cents || cents <= 0) {
          toast.error("Please enter a valid payment amount");
          setUploading(false);
          return;
        }
        fd.append("paymentMethod", paymentMethod);
        fd.append("paymentAmountCents", String(cents));
        fd.append("paymentDate", paymentDate || "");
        fd.append("paymentRef", paymentRef.trim());
        if (paymentPayer) fd.append("paymentPayer", paymentPayer);
      }

      const res = await fetch(`/api/policies/${policyId}/documents`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      toast.success(needsPayment ? "Payment record uploaded" : "Document uploaded");
      resetPaymentForm();
      onRefresh();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    handleFileSelect(e);
  }

  async function handleVerify(docId: number) {
    setActionBusy(docId);
    try {
      const res = await fetch(`/api/policies/${policyId}/documents/${docId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "verified" }),
      });
      if (!res.ok) throw new Error("Verify failed");
      toast.success("Document verified");
      onRefresh();
    } catch {
      toast.error("Verify failed");
    } finally {
      setActionBusy(null);
    }
  }

  function openReject(docId: number) {
    setRejectDocId(docId);
    setRejectNote("");
    setRejectOpen(true);
  }

  async function handleReject() {
    if (!rejectDocId) return;
    setActionBusy(rejectDocId);
    try {
      const res = await fetch(`/api/policies/${policyId}/documents/${rejectDocId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "rejected", rejectionNote: rejectNote.trim() || "Rejected" }),
      });
      if (!res.ok) throw new Error("Reject failed");
      toast.success("Document rejected");
      setRejectOpen(false);
      onRefresh();
    } catch {
      toast.error("Reject failed");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDelete(docId: number) {
    if (!window.confirm("Delete this uploaded document?")) return;
    setActionBusy(docId);
    try {
      const res = await fetch(`/api/policies/${policyId}/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success("Document deleted");
      onRefresh();
    } catch {
      toast.error("Delete failed");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <>
      <div className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        <input ref={fileInputRef} type="file" accept={acceptAttr} onChange={handleUpload} className="hidden" />
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setCardOpen((v) => !v)}
          className="flex w-full items-center justify-between p-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/30 transition-colors"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
            <span className="text-sm font-medium truncate">{label}</span>
            <Badge variant="outline" className={`gap-1 border-0 text-[10px] shrink-0 ${statusCfg.className}`}>
              <StatusIcon className="h-3 w-3" />
              {statusCfg.label}
            </Badge>
            {meta?.required && displayStatus === "outstanding" && (
              <span className="text-[10px] text-red-500 dark:text-red-400 shrink-0">Required</span>
            )}
          </div>
          {cardOpen
            ? <ChevronDown className="h-4 w-4 shrink-0 text-neutral-400" />
            : <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
          }
        </button>

        {cardOpen && <div className="px-2.5 pb-2.5 space-y-1.5">
        {meta?.description && (
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 pl-[22px]">
            {meta.description}
          </div>
        )}

        {/* Uploaded files list */}
        {uploads.length > 0 && (
          <div className="mb-2 space-y-1.5">
            {uploads.map((doc) => {
              const docStatus = doc.status as DocumentStatus;
              const docCfg = STATUS_CONFIG[docStatus] ?? STATUS_CONFIG.outstanding;
              const showPerFileBadge = uploads.length > 1;
              return (
                <div
                  key={doc.id}
                  className="rounded border border-neutral-100 bg-neutral-50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/50"
                >
                  {/* Row 1: filename + per-file badge (only when multiple uploads) */}
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                      <span className="truncate font-medium">{doc.fileName}</span>
                    </div>
                    {showPerFileBadge && (
                      <Badge variant="outline" className={`shrink-0 border-0 text-[10px] ${docCfg.className}`}>
                        {docCfg.label}
                      </Badge>
                    )}
                  </div>

                  {/* Row 2: file metadata */}
                  <div className="pl-5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <span>&middot;</span>
                    <span>{formatDate(doc.createdAt)}</span>
                    {doc.uploadedByEmail && (
                      <>
                        <span>&middot;</span>
                        <span className="truncate max-w-[140px]">{doc.uploadedByEmail}</span>
                      </>
                    )}
                  </div>

                  {/* Verified/rejected detail */}
                  {docStatus === "rejected" && doc.rejectionNote && (
                    <div className="mt-1 pl-5 text-[10px] text-red-600 dark:text-red-400">
                      Reason: {doc.rejectionNote}
                    </div>
                  )}
                  {docStatus === "verified" && doc.verifiedByEmail && (
                    <div className="mt-1 pl-5 text-[10px] text-green-600 dark:text-green-400 wrap-break-word">
                      Verified by {doc.verifiedByEmail}{doc.verifiedAt && ` \u00b7 ${formatDate(doc.verifiedAt)}`}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center gap-1 pl-5 mt-1.5 pt-1 border-t border-neutral-100 dark:border-neutral-800">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-1.5 text-[10px]"
                      title="Preview"
                      onClick={() => {
                        const idx = uploads.findIndex((u) => u.id === doc.id);
                        setLightboxIndex(idx >= 0 ? idx : 0);
                      }}
                    >
                      <Eye className="h-3 w-3" />
                      Preview
                    </Button>
                    {isAdmin && docStatus === "uploaded" && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 gap-1 px-1.5 text-[10px] text-green-600 hover:text-green-700 dark:text-green-400"
                          onClick={() => handleVerify(doc.id)}
                          disabled={actionBusy === doc.id}
                        >
                          {actionBusy === doc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : (
                            <><CheckCircle2 className="h-3 w-3" />Verify</>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 gap-1 px-1.5 text-[10px] text-red-600 hover:text-red-700 dark:text-red-400"
                          onClick={() => openReject(doc.id)}
                          disabled={actionBusy === doc.id}
                        >
                          <XCircle className="h-3 w-3" />
                          Reject
                        </Button>
                      </>
                    )}
                    <div className="ml-auto">
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-neutral-400 hover:text-red-500"
                          onClick={() => handleDelete(doc.id)}
                          disabled={actionBusy === doc.id}
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Payment records summary — separate client and agent sections */}
        {needsPayment && receivablePayments.length > 0 && (() => {
          const isClientPayment = (p: PolicyPaymentRecord) =>
            p.payer === "client" || p.payer === "client_to_agent" || (!p.payer && p.entityType !== "agent");
          const isAgentPayment = (p: PolicyPaymentRecord) =>
            p.payer === "agent" || (!p.payer && p.entityType === "agent");

          const clientEntityPmts = receivablePayments.filter(isClientPayment);
          const agentEntityPmts = receivablePayments.filter(isAgentPayment);
          const untaggedPmts = receivablePayments.filter((p) => !isClientPayment(p) && !isAgentPayment(p));

          const renderPayment = (p: PolicyPaymentRecord, i: number) => (
            <div key={i} className="text-xs space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-emerald-800 dark:text-emerald-300">
                  {formatCurrency(p.amountCents)}
                </span>
                <div className="flex items-center gap-1">
                  {p.payer && (
                    <Badge
                      variant="outline"
                      className={`shrink-0 border-0 text-[9px] ${
                        p.payer === "agent"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      }`}
                    >
                      {p.payer === "agent" ? (premiumBreakdown?.agentName || "Agent") : "Client"}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={`shrink-0 border-0 text-[9px] ${
                      p.status === "verified"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                    }`}
                  >
                    {p.status === "verified" ? "Verified" : "Pending"}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
                {p.paymentMethod && (
                  <span>{formatPaymentMethod(p.paymentMethod)}</span>
                )}
                {p.paymentDate && (
                  <>
                    <span className="text-neutral-300 dark:text-neutral-600">&middot;</span>
                    <span>{p.paymentDate}</span>
                  </>
                )}
                {p.referenceNumber && (
                  <>
                    <span className="text-neutral-300 dark:text-neutral-600">&middot;</span>
                    <span className="truncate max-w-[120px]" title={p.referenceNumber}>Ref: {p.referenceNumber}</span>
                  </>
                )}
              </div>
            </div>
          );

          const clientPremium = premiumBreakdown?.clientPremiumCents ?? 0;
          const agentPremium = premiumBreakdown?.agentPremiumCents ?? 0;
          const commissionCents = clientPremium > 0 && agentPremium > 0
            ? Math.max(clientPremium - agentPremium, 0)
            : 0;

          const clientVerified = clientEntityPmts
            .concat(untaggedPmts)
            .filter((p) => p.status === "verified" || p.status === "confirmed" || p.status === "recorded")
            .reduce((s, p) => s + p.amountCents, 0);
          const clientFullyPaid = clientPremium > 0 && clientVerified >= clientPremium;

          const agentVerified = agentEntityPmts
            .filter((p) => p.status === "verified" || p.status === "confirmed" || p.status === "recorded")
            .reduce((s, p) => s + p.amountCents, 0);

          const clientPaidAdminDirectly = clientFullyPaid && agentVerified < agentPremium;

          const showClientSection = !isAdmin ? true : clientEntityPmts.length > 0 || untaggedPmts.length > 0;
          const showAgentSection = isAdmin && hasAgent;
          const showCommission = isAdmin && commissionCents > 0 && clientPaidAdminDirectly;

          if (!hasAgent || (clientEntityPmts.length === 0 && agentEntityPmts.length === 0 && untaggedPmts.length > 0)) {
            const allPmts = receivablePayments;
            const premium = clientPremium || agentPremium;
            const allVerified = allPmts
              .filter((p) => p.status === "verified" || p.status === "confirmed" || p.status === "recorded")
              .reduce((s, p) => s + p.amountCents, 0);
            const allSettled = premium > 0 && allVerified >= premium;
            return (
              <PaymentRecordSection
                label="Payment Records"
                payments={allPmts}
                paidCents={allVerified}
                premiumCents={premium}
                colorScheme="emerald"
                settled={allSettled}
                statusLabel="Payment settled"
                statusColor="text-green-700 dark:text-green-400"
                renderPayment={renderPayment}
              />
            );
          }

          const clientPmtsWithUntagged = [...clientEntityPmts, ...untaggedPmts];
          const effectiveAgentPaid = clientPaidAdminDirectly ? agentPremium : agentVerified;
          const clientSettled = clientPremium > 0 && clientVerified >= clientPremium;
          const agentSettled = clientPaidAdminDirectly || (agentPremium > 0 && agentVerified >= agentPremium);

          return (
            <>
              {showClientSection && (
                <PaymentRecordSection
                  label={isAdmin && hasAgent ? "Client Payment Records" : "Payment Records"}
                  payments={clientPmtsWithUntagged}
                  paidCents={clientVerified}
                  premiumCents={clientPremium}
                  colorScheme="emerald"
                  settled={clientSettled}
                  statusLabel="Client Payment settled"
                  statusColor="text-green-700 dark:text-green-400"
                  renderPayment={renderPayment}
                />
              )}
              {showAgentSection && (
                <PaymentRecordSection
                  label="Agent Payment Records"
                  payments={agentEntityPmts.length > 0 ? agentEntityPmts : null}
                  paidCents={effectiveAgentPaid}
                  premiumCents={agentPremium}
                  colorScheme="blue"
                  settled={agentSettled}
                  statusLabel="Agent Payment settled"
                  statusColor="text-green-700 dark:text-green-400"
                  renderPayment={renderPayment}
                />
              )}
              {showCommission && (
                <PaymentRecordSection
                  label="Commission"
                  payments={null}
                  paidCents={commissionCents}
                  premiumCents={commissionCents}
                  colorScheme="yellow"
                  settled={true}
                  statusLabel="On Statement"
                  statusColor="text-yellow-700 dark:text-yellow-400"
                  renderPayment={renderPayment}
                />
              )}
            </>
          );
        })()}

        {/* Payment form (shown upfront) + Upload */}
        {(canUpload || (displayStatus === "uploaded" && isAdmin)) && needsPayment && premiumBreakdown ? (
          <div className="space-y-2.5">
            {(() => {
              const billingSchedule = clientSchedule || agentSchedule;
              const onStatement = !!billingSchedule && !payIndividually;

              if (onStatement) {
                return (
                  <div className="space-y-2.5">
                    {billingSchedule && (
                      <div className="rounded-md border-2 border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40 p-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <CalendarClock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                          <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                            On Statement
                          </span>
                        </div>
                        <div className="text-[11px] text-indigo-700 dark:text-indigo-300 space-y-0.5">
                          <div>
                            <span className="font-semibold">Client</span> premium of{" "}
                            <span className="font-bold">{formatCurrency(premiumBreakdown.clientPremiumCents)}</span>{" "}
                            will be collected via periodic statement.
                          </div>
                          <div className="text-indigo-600 dark:text-indigo-400">
                            {billingSchedule.frequency?.charAt(0).toUpperCase()}{billingSchedule.frequency?.slice(1)} billing
                            {billingSchedule.billingDay ? ` · Day ${billingSchedule.billingDay}` : ""}
                          </div>
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={togglingStatement}
                      onClick={() => {
                        setPayIndividually(true);
                        if (!paymentPayer && hasAgent) setPaymentPayer(null);
                        void handleStatementToggle(false);
                      }}
                      className="w-full rounded-md border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60 transition-colors disabled:opacity-50"
                    >
                      {togglingStatement ? "Releasing..." : "Pay Individually Instead"}
                    </button>
                  </div>
                );
              }

              return (
                <>
                  {/* Back to statement option — shown when released */}
                  {billingSchedule && payIndividually && (
                    <button
                      type="button"
                      disabled={togglingStatement}
                      onClick={() => {
                        setPayIndividually(false);
                        setPaymentPayer(hasAgent ? null : "client");
                        void handleStatementToggle(true);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 rounded-md border-2 border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/50 transition-colors disabled:opacity-50"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      {togglingStatement ? "Adding..." : "Add to Statement"}
                    </button>
                  )}

                  {/* Payment source selection (when agent exists) */}
                  {hasAgent && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1.5">
                        Payment received from
                      </div>
                      <div className="mb-1.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                        Choose who remitted this amount to admin so settlement and commission can be recorded correctly.
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentPayer("client");
                            setPaymentType("full");
                          }}
                          className={`rounded-md border-2 p-2 text-left transition-colors ${
                            paymentPayer === "client"
                              ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/40"
                              : "border-neutral-200 hover:border-blue-300 dark:border-neutral-700 dark:hover:border-blue-700"
                          }`}
                        >
                          <div className="text-[10px] font-semibold text-blue-800 dark:text-blue-300">Client Direct Payment</div>
                          <div className="text-sm font-bold text-blue-900 dark:text-blue-200">
                            {formatCurrency(premiumBreakdown.clientPremiumCents)}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentPayer("agent");
                            setPaymentType("full");
                          }}
                          className={`rounded-md border-2 p-2 text-left transition-colors ${
                            paymentPayer === "agent"
                              ? "border-amber-500 bg-amber-50 dark:border-amber-400 dark:bg-amber-950/40"
                              : "border-neutral-200 hover:border-amber-300 dark:border-neutral-700 dark:hover:border-amber-700"
                          }`}
                        >
                          <div className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                            {premiumBreakdown.agentName || "Agent"} Remittance
                          </div>
                          <div className="text-sm font-bold text-amber-900 dark:text-amber-200">
                            {formatCurrency(premiumBreakdown.agentPremiumCents)}
                          </div>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Payment form (show when payer selected) */}
                  {paymentPayer && (
                    <>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 mb-1">
                          Payment Type
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentType("full");
                              setPaymentAmount((remainingAmount / 100).toFixed(2));
                            }}
                            className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors text-left ${
                              paymentType === "full"
                                ? "border-green-500 bg-green-50 text-green-800 dark:border-green-400 dark:bg-green-950/40 dark:text-green-300"
                                : "border-neutral-200 text-neutral-600 hover:border-green-300 dark:border-neutral-700 dark:text-neutral-400"
                            }`}
                          >
                            <div>Full Payment</div>
                            <div className="text-[10px] font-bold mt-0.5">{formatCurrency(remainingAmount)}</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentType("partial");
                              setPaymentAmount("");
                            }}
                            className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors text-left ${
                              paymentType === "partial"
                                ? "border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-300"
                                : "border-neutral-200 text-neutral-600 hover:border-blue-300 dark:border-neutral-700 dark:text-neutral-400"
                            }`}
                          >
                            <div>Partial Payment</div>
                            <div className="text-[10px] mt-0.5">Enter amount</div>
                          </button>
                        </div>
                        {alreadyPaid > 0 && (
                          <div className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                            Already paid: {formatCurrency(alreadyPaid)} · Remaining: {formatCurrency(remainingAmount)}
                          </div>
                        )}
                      </div>

                      {paymentType === "partial" && (
                        <div>
                          <Label className="text-[10px]">Amount (HKD)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0.01"
                            max={(remainingAmount / 100).toFixed(2)}
                            placeholder="0.00"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            className="mt-0.5 h-7 text-xs"
                          />
                          {paymentAmount && Number(paymentAmount) > 0 && (
                            <div className="mt-0.5 text-[10px] text-neutral-400">
                              After this: {formatCurrency(remainingAmount - Math.round(Number(paymentAmount) * 100))} remaining
                            </div>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">Payment Method</Label>
                          <select
                            className="mt-0.5 w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                            value={paymentMethod}
                            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                          >
                            {PAYMENT_METHOD_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Label className="text-[10px]">Date</Label>
                          <Input
                            type="date"
                            value={paymentDate}
                            onChange={(e) => setPaymentDate(e.target.value)}
                            className="mt-0.5 h-7 text-xs"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px]">{paymentMethod === "cheque" ? "Cheque No." : "Reference"}</Label>
                        <Input
                          type="text"
                          placeholder={paymentMethod === "cheque" ? "Cheque number" : "Reference"}
                          value={paymentRef}
                          onChange={(e) => setPaymentRef(e.target.value)}
                          className="mt-0.5 h-7 text-xs"
                        />
                      </div>

                      {pendingFile ? (
                        <div className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-700 dark:bg-neutral-800/30">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                          <span className="text-xs font-medium truncate flex-1">{pendingFile.name}</span>
                          <button type="button" onClick={() => setPendingFile(null)} className="text-neutral-400 hover:text-red-500">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-1.5 text-xs"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Attach Payment Proof
                        </Button>
                      )}

                      <div className="flex items-center gap-2 pt-0.5">
                        <Button
                          size="sm"
                          className="h-7 text-xs flex-1"
                          disabled={
                            uploading
                            || !pendingFile
                            || (paymentType === "full" ? remainingAmount <= 0 : !paymentAmount || Number(paymentAmount) <= 0)
                          }
                          onClick={() => {
                            const amt = paymentType === "full" ? (remainingAmount / 100).toFixed(2) : paymentAmount;
                            void doUpload(pendingFile!, amt);
                          }}
                        >
                          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          <span>{uploading ? "Uploading..." : "Submit Payment"}</span>
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetPaymentForm}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        ) : null}

        {/* Actions row: upload + reminder */}
        {(() => {
          const st = displayStatus as string;
          const showUpload = (canUpload || (st === "uploaded" && isAdmin)) && (!needsPayment || !premiumBreakdown);
          const showReminder = isAdmin && (st === "outstanding" || st === "rejected" || st === "uploaded");
          if (!showUpload && !showReminder) return null;
          return (
            <div className="flex items-center justify-end gap-1.5 pt-1">
              {showUpload && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-6 text-[11px] px-1.5 sm:px-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title={st === "rejected" ? "Re-upload" : "Upload"}
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 sm:hidden lg:inline" />
                  )}
                  <span className="hidden sm:inline">{st === "rejected" ? "Re-upload" : "Upload"}</span>
                </Button>
              )}
              {showReminder && (
                <ReminderScheduler
                  policyId={policyId}
                  documentTypeKey={typeKey}
                  documentLabel={label}
                  isAdmin={isAdmin}
                />
              )}
            </div>
          );
        })()}
        </div>}
      </div>

      {/* Lightbox preview — rendered via portal to escape drawer stacking context */}
      {lightboxIndex !== null && uploads.length > 0 && createPortal(
        <Lightbox
          docs={uploads}
          policyId={policyId}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />,
        document.body,
      )}

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Document</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="text-sm font-medium">Rejection reason</label>
            <Input
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Please upload a clearer image..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={actionBusy !== null}>
              {actionBusy !== null ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
