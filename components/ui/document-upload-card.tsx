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
} from "lucide-react";
import { Label } from "@/components/ui/label";
import type {
  DocumentStatus,
  PolicyDocumentRow,
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

function isPreviewable(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
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
  const doc = docs[index];
  if (!doc) return null;

  const fileUrl = `/api/policies/${policyId}/documents/${doc.id}/file`;
  const isImage = doc.mimeType?.startsWith("image/") ?? false;
  const isPdf = doc.mimeType === "application/pdf";
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
          <img
            src={fileUrl}
            alt={doc.fileName}
            className="max-h-[calc(100vh-120px)] max-w-full rounded-lg object-contain shadow-2xl"
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

type DocumentUploadCardProps = {
  typeKey: string;
  label: string;
  meta: UploadDocumentTypeMeta | null;
  displayStatus: DocumentStatus;
  uploads: PolicyDocumentRow[];
  policyId: number;
  isAdmin: boolean;
  onRefresh: () => void;
};

export function DocumentUploadCard({
  typeKey,
  label,
  meta,
  displayStatus,
  uploads,
  policyId,
  isAdmin,
  onRefresh,
}: DocumentUploadCardProps) {
  const [uploading, setUploading] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejectDocId, setRejectDocId] = React.useState<number | null>(null);
  const [rejectNote, setRejectNote] = React.useState("");
  const [actionBusy, setActionBusy] = React.useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const needsPayment = meta?.requirePaymentDetails === true;
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>("bank_transfer");
  const [paymentAmount, setPaymentAmount] = React.useState("");
  const [paymentDate, setPaymentDate] = React.useState(() => new Date().toISOString().split("T")[0]);
  const [paymentRef, setPaymentRef] = React.useState("");
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);

  const statusCfg = STATUS_CONFIG[displayStatus];
  const StatusIcon = statusCfg.icon;

  const acceptAttr = meta?.acceptedTypes?.join(",") ?? undefined;
  const canUpload = displayStatus === "outstanding" || displayStatus === "rejected";

  function resetPaymentForm() {
    setPaymentMethod("bank_transfer");
    setPaymentAmount("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setPaymentRef("");
    setPendingFile(null);
  }

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

  async function doUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentTypeKey", typeKey);

      if (needsPayment) {
        const cents = Math.round(Number(paymentAmount) * 100);
        if (!cents || cents <= 0) {
          toast.error("Please enter a valid payment amount");
          setUploading(false);
          return;
        }
        fd.append("paymentMethod", paymentMethod);
        fd.append("paymentAmountCents", String(cents));
        fd.append("paymentDate", paymentDate || "");
        fd.append("paymentRef", paymentRef.trim());
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
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
            <div>
              <div className="text-sm font-medium">{label}</div>
              {meta?.description && (
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  {meta.description}
                </div>
              )}
            </div>
          </div>
          <Badge variant="outline" className={`shrink-0 gap-1 border-0 ${statusCfg.className}`}>
            <StatusIcon className="h-3 w-3" />
            {statusCfg.label}
          </Badge>
        </div>

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
                    <div className="mt-1 pl-5 text-[10px] text-green-600 dark:text-green-400">
                      Verified by {doc.verifiedByEmail}{doc.verifiedAt && ` \u00b7 ${formatDate(doc.verifiedAt)}`}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 pl-5 mt-1.5 pt-1 border-t border-neutral-100 dark:border-neutral-800">
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

        {/* Upload button + payment details form */}
        {(canUpload || (displayStatus === "uploaded" && isAdmin)) && (
          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptAttr}
              onChange={handleUpload}
              className="hidden"
            />

            {needsPayment && pendingFile ? (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2.5 dark:border-neutral-700 dark:bg-neutral-800/30 space-y-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5 text-neutral-400" />
                  <span className="font-medium truncate">{pendingFile.name}</span>
                </div>
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
                    <Label className="text-[10px]">Amount (HKD)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="mt-0.5 h-7 text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px]">Date</Label>
                    <Input
                      type="date"
                      value={paymentDate}
                      onChange={(e) => setPaymentDate(e.target.value)}
                      className="mt-0.5 h-7 text-xs"
                    />
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
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={uploading || !paymentAmount || Number(paymentAmount) <= 0}
                    onClick={() => void doUpload(pendingFile)}
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    <span>{uploading ? "Uploading..." : "Submit Payment"}</span>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={resetPaymentForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {displayStatus === "rejected" ? "Re-upload" : "Upload"}
                </Button>
                {meta?.required && displayStatus === "outstanding" && (
                  <span className="text-[10px] text-red-500 dark:text-red-400">Required</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Reminder scheduler for outstanding/rejected docs */}
        {isAdmin && (displayStatus === "outstanding" || displayStatus === "rejected" || displayStatus === "uploaded") && (
          <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
            <ReminderScheduler
              policyId={policyId}
              documentTypeKey={typeKey}
              documentLabel={label}
              isAdmin={isAdmin}
            />
          </div>
        )}
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
