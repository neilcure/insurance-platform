"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  Upload,
  CheckCircle2,
  XCircle,
  FileText,
  DollarSign,
  Download,
  Printer,
  Send,
  ThumbsUp,
  ThumbsDown,
  FileCheck,
  Clock,
} from "lucide-react";
import type {
  InvoiceWithItems,
  AccountingPaymentRow,
  InvoiceStatus,
  PaymentStatus,
  DocumentStatusMap,
  DocumentStatusEntry,
  DocLifecycleStatus,
} from "@/lib/types/accounting";
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_OPTIONS,
  PREMIUM_TYPE_LABELS,
  DOC_LIFECYCLE_LABELS,
} from "@/lib/types/accounting";

type Props = {
  invoiceId: number;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
};

type PdfTemplate = {
  id: number;
  label: string;
  value: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  partial: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  submitted: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  recorded: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  cancelled: "bg-neutral-300 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-500",
};

function fmtCurrency(cents: number, currency = "HKD"): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[status] || ""}`}>
      {labels[status] || status}
    </span>
  );
}

export function InvoiceDetailDrawer({ invoiceId, open, onClose, onUpdated }: Props) {
  const [invoice, setInvoice] = React.useState<InvoiceWithItems | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [showPaymentDialog, setShowPaymentDialog] = React.useState(false);
  const [showUploadDialog, setShowUploadDialog] = React.useState(false);
  const [showGeneratePdf, setShowGeneratePdf] = React.useState(false);
  const [templates, setTemplates] = React.useState<PdfTemplate[]>([]);
  const [showSendDialog, setShowSendDialog] = React.useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = React.useState(false);

  const loadInvoice = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setInvoice(await res.json());
    } catch {
      toast.error("Failed to load invoice details");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  React.useEffect(() => {
    if (open) void loadInvoice();
  }, [open, loadInvoice]);

  const loadTemplates = React.useCallback(async () => {
    try {
      const res = await fetch("/api/form-options?groupKey=pdf_merge_templates", { cache: "no-store" });
      if (res.ok) setTemplates(await res.json());
    } catch {}
  }, []);

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Status updated to ${INVOICE_STATUS_LABELS[newStatus as InvoiceStatus] || newStatus}`);
      void loadInvoice();
      onUpdated();
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleVerifyPayment = async (paymentId: number, action: "verify" | "reject", rejectionNote?: string) => {
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, action, rejectionNote }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast.success(action === "verify" ? "Payment verified" : "Payment rejected");
      void loadInvoice();
      onUpdated();
    } catch (err: any) {
      toast.error(err.message || "Failed to verify payment");
    }
  };

  const handleGeneratePdf = async (templateId: number) => {
    setGeneratingPdf(true);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setShowGeneratePdf(false);
      void loadInvoice();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate PDF");
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDocStatusAction = async (docType: string, action: "send" | "confirm" | "reject", sentTo?: string, rejectionNote?: string) => {
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/document-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, action, sentTo, rejectionNote }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      const actionLabels = { send: "Sent", confirm: "Confirmed", reject: "Rejected" };
      toast.success(`${docType.charAt(0).toUpperCase() + docType.slice(1)} ${actionLabels[action]}`);
      void loadInvoice();
      onUpdated();
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} document`);
    }
  };

  const remainingCents = invoice ? invoice.totalAmountCents - invoice.paidAmountCents : 0;

  return (
    <SlideDrawer
      open={open}
      onClose={onClose}
      title={invoice ? `Invoice ${invoice.invoiceNumber}` : "Invoice Details"}
      side="right"
      widthClass="w-[340px] sm:w-[440px] md:w-[520px]"
    >
      <div className="overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          </div>
        ) : !invoice ? (
          <div className="py-12 text-center text-sm text-neutral-500">Invoice not found</div>
        ) : (
          <div className="space-y-5">
            {/* Header */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{invoice.invoiceNumber}</h3>
                <StatusBadge status={invoice.status} labels={INVOICE_STATUS_LABELS} />
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Direction</span>
                  <p className={invoice.direction === "payable" ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-green-600 dark:text-green-400"}>
                    {invoice.direction === "payable" ? "Payable" : "Receivable"}
                  </p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Premium Type</span>
                  <p className="font-medium">{PREMIUM_TYPE_LABELS[invoice.premiumType as keyof typeof PREMIUM_TYPE_LABELS] || invoice.premiumType}</p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Entity</span>
                  <p className="font-medium">{invoice.entityName || invoice.entityType}</p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Invoice Date</span>
                  <p className="font-medium">{fmtDate(invoice.invoiceDate)}</p>
                </div>
                {invoice.dueDate && (
                  <div>
                    <span className="text-neutral-500 dark:text-neutral-400">Due Date</span>
                    <p className="font-medium">{fmtDate(invoice.dueDate)}</p>
                  </div>
                )}
              </div>

              {/* Amount summary */}
              <div className="rounded-md bg-neutral-50 p-3 dark:bg-neutral-900">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-600 dark:text-neutral-400">Total</span>
                  <span className="font-semibold">{fmtCurrency(invoice.totalAmountCents, invoice.currency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-600 dark:text-neutral-400">Paid</span>
                  <span className="font-medium text-green-600 dark:text-green-400">{fmtCurrency(invoice.paidAmountCents, invoice.currency)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between text-sm font-semibold">
                  <span>Remaining</span>
                  <span className={remainingCents > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                    {fmtCurrency(remainingCents, invoice.currency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              {invoice.status === "draft" && (
                <Button size="sm" onClick={() => handleStatusChange("pending")}>
                  Mark as Pending
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setShowPaymentDialog(true)}>
                <DollarSign className="mr-1 h-4 w-4" />
                Record Payment
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowUploadDialog(true)}>
                <Upload className="mr-1 h-4 w-4" />
                Upload Document
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void loadTemplates();
                  setShowGeneratePdf(true);
                }}
              >
                <Printer className="mr-1 h-4 w-4" />
                Generate PDF
              </Button>
            </div>

            <Separator />

            {/* Document Lifecycle */}
            <DocumentLifecycleSection
              invoice={invoice}
              onSend={(docType) => setShowSendDialog(docType)}
              onConfirm={(docType) => handleDocStatusAction(docType, "confirm")}
              onReject={(docType) => {
                const note = prompt("Rejection reason (optional):");
                handleDocStatusAction(docType, "reject", undefined, note || undefined);
              }}
            />

            <Separator />

            {/* Line items */}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Policy Items ({invoice.items.length})</h4>
              {invoice.items.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">No items</p>
              ) : (
                <div className="space-y-1">
                  {invoice.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                      <div>
                        <span className="font-medium">{item.policyNumber || `Policy #${item.policyId}`}</span>
                        {item.description && (
                          <span className="ml-2 text-neutral-500 dark:text-neutral-400">{item.description}</span>
                        )}
                      </div>
                      <span className="tabular-nums font-medium">{fmtCurrency(item.amountCents, invoice.currency)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Payments */}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Payments ({invoice.payments.length})</h4>
              {invoice.payments.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">No payments recorded</p>
              ) : (
                <div className="space-y-2">
                  {invoice.payments.map((pmt) => (
                    <div key={pmt.id} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                      <div className="flex items-center justify-between">
                        <span className="font-medium tabular-nums">{fmtCurrency(pmt.amountCents, pmt.currency)}</span>
                        <StatusBadge status={pmt.status} labels={PAYMENT_STATUS_LABELS} />
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                        <span>Method: {pmt.paymentMethod || "—"}</span>
                        <span>Date: {fmtDate(pmt.paymentDate)}</span>
                        {pmt.referenceNumber && <span className="col-span-2">Ref: {pmt.referenceNumber}</span>}
                        {pmt.notes && <span className="col-span-2">Notes: {pmt.notes}</span>}
                      </div>
                      {pmt.status === "rejected" && pmt.rejectionNote && (
                        <div className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-400">
                          Rejected: {pmt.rejectionNote}
                        </div>
                      )}
                      {pmt.status === "submitted" && (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="default" onClick={() => handleVerifyPayment(pmt.id, "verify")}>
                            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const note = prompt("Rejection reason (optional):");
                              handleVerifyPayment(pmt.id, "reject", note || undefined);
                            }}
                          >
                            <XCircle className="mr-1 h-3.5 w-3.5" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Documents */}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Documents ({invoice.documents.length})</h4>
              {invoice.documents.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">No documents uploaded</p>
              ) : (
                <div className="space-y-1">
                  {invoice.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                      <FileText className="h-4 w-4 shrink-0 text-neutral-500" />
                      <span className="flex-1 truncate">{doc.fileName}</span>
                      <Badge variant="outline" className="text-[10px]">{doc.docType}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {invoice.notes && (
              <>
                <Separator />
                <div>
                  <h4 className="mb-1 text-sm font-semibold">Notes</h4>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">{invoice.notes}</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Record Payment Dialog */}
      <RecordPaymentDialog
        open={showPaymentDialog}
        onClose={() => setShowPaymentDialog(false)}
        invoiceId={invoiceId}
        currency={invoice?.currency || "HKD"}
        remainingCents={remainingCents}
        onRecorded={() => {
          setShowPaymentDialog(false);
          void loadInvoice();
          onUpdated();
        }}
      />

      {/* Upload Document Dialog */}
      <UploadDocumentDialog
        open={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        invoiceId={invoiceId}
        onUploaded={() => {
          setShowUploadDialog(false);
          void loadInvoice();
        }}
      />

      {/* Generate PDF Dialog */}
      <Dialog open={showGeneratePdf} onOpenChange={setShowGeneratePdf}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate PDF Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Select a PDF template to generate a document for this invoice.
            </p>
            {templates.length === 0 ? (
              <p className="py-4 text-center text-sm text-neutral-500">
                No PDF templates found. Create templates in Admin → Policy Settings → PDF Mail Merge.
              </p>
            ) : (
              <div className="max-h-[300px] space-y-1 overflow-y-auto">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    disabled={generatingPdf}
                    onClick={() => handleGeneratePdf(tpl.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-neutral-200 p-3 text-left text-sm transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                  >
                    {generatingPdf ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-500" />
                    ) : (
                      <Printer className="h-4 w-4 shrink-0 text-neutral-500" />
                    )}
                    <span className="font-medium">{tpl.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Send Document Dialog */}
      <SendDocumentDialog
        open={!!showSendDialog}
        docType={showSendDialog || ""}
        onClose={() => setShowSendDialog(null)}
        onSend={(sentTo) => {
          if (showSendDialog) {
            handleDocStatusAction(showSendDialog, "send", sentTo);
          }
          setShowSendDialog(null);
        }}
      />
    </SlideDrawer>
  );
}

const DOC_STATUS_COLORS: Record<string, string> = {
  generated: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  sent: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const DOC_TYPE_ICONS: Record<string, React.ElementType> = {
  quotation: FileText,
  invoice: FileCheck,
  receipt: DollarSign,
  statement: FileText,
};

function DocumentLifecycleSection({
  invoice,
  onSend,
  onConfirm,
  onReject,
}: {
  invoice: InvoiceWithItems;
  onSend: (docType: string) => void;
  onConfirm: (docType: string) => void;
  onReject: (docType: string) => void;
}) {
  const docStatus = (invoice.documentStatus ?? {}) as DocumentStatusMap;
  const hasVerifiedPayment = invoice.payments.some((p) => p.status === "verified");
  const isReceivable = invoice.direction === "receivable";
  const entityLabel = invoice.entityName || invoice.entityType;

  const directionLabel = isReceivable ? "Receivable" : "Payable";
  const directionDescription = isReceivable
    ? `Documents to send to ${entityLabel}`
    : `Documents from ${entityLabel}`;

  const docTypes: Array<{
    key: string;
    label: string;
    description: string;
    available: boolean;
    reason?: string;
    canSend: boolean;
    canConfirm: boolean;
  }> = [];

  if (isReceivable) {
    docTypes.push({
      key: "quotation",
      label: "Quotation",
      description: `Send to ${entityLabel} for confirmation`,
      available: true,
      canSend: true,
      canConfirm: true,
    });

    const quotationConfirmed = docStatus.quotation?.status === "confirmed";
    docTypes.push({
      key: "invoice",
      label: "Invoice",
      description: `Send to ${entityLabel} for payment`,
      available: quotationConfirmed || !docStatus.quotation,
      reason: !quotationConfirmed && docStatus.quotation ? "Quotation must be confirmed first" : undefined,
      canSend: true,
      canConfirm: false,
    });

    docTypes.push({
      key: "receipt",
      label: "Receipt",
      description: `Issue to ${entityLabel} after payment verified`,
      available: hasVerifiedPayment,
      reason: !hasVerifiedPayment ? "Payment must be verified first" : undefined,
      canSend: true,
      canConfirm: false,
    });
  } else {
    docTypes.push({
      key: "invoice",
      label: "Invoice",
      description: `Received from ${entityLabel}`,
      available: true,
      canSend: false,
      canConfirm: true,
    });

    docTypes.push({
      key: "receipt",
      label: "Receipt",
      description: `Received from ${entityLabel} after we pay`,
      available: hasVerifiedPayment,
      reason: !hasVerifiedPayment ? "Payment must be verified first" : undefined,
      canSend: false,
      canConfirm: true,
    });
  }

  if (invoice.invoiceType === "statement") {
    docTypes.push({
      key: "statement",
      label: "Statement",
      description: `Batch statement for ${entityLabel}`,
      available: true,
      canSend: true,
      canConfirm: false,
    });
  }

  return (
    <div>
      <div className="mb-2">
        <h4 className="text-sm font-semibold">Document Status</h4>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          <span className={isReceivable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
            {directionLabel}
          </span>
          {" · "}{directionDescription}
        </p>
      </div>
      <div className="space-y-2">
        {docTypes.map(({ key, label, description, available, reason, canSend, canConfirm }) => {
          const entry = docStatus[key as keyof DocumentStatusMap];
          const Icon = DOC_TYPE_ICONS[key] || FileText;

          return (
            <div key={key} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-neutral-500" />
                  <div>
                    <span className="text-sm font-medium">{label}</span>
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500">{description}</p>
                  </div>
                </div>
                {entry?.status ? (
                  <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${DOC_STATUS_COLORS[entry.status] || ""}`}>
                    {DOC_LIFECYCLE_LABELS[entry.status as DocLifecycleStatus] || entry.status}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-neutral-400">Not tracked</span>
                )}
              </div>

              {entry && (
                <div className="mt-1.5 space-y-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                  {entry.generatedAt && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Generated: {fmtDate(entry.generatedAt)}
                    </div>
                  )}
                  {entry.sentAt && (
                    <div>Sent: {fmtDate(entry.sentAt)}{entry.sentTo ? ` to ${entry.sentTo}` : ""}</div>
                  )}
                  {entry.confirmedAt && (
                    <div>Confirmed: {fmtDate(entry.confirmedAt)}</div>
                  )}
                  {entry.rejectedAt && (
                    <div className="text-red-500">
                      Rejected: {fmtDate(entry.rejectedAt)}
                      {entry.rejectionNote ? ` — ${entry.rejectionNote}` : ""}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {!available && reason && (
                  <span className="text-[10px] italic text-neutral-400">{reason}</span>
                )}
                {canSend && available && (!entry?.status || entry.status === "generated" || entry.status === "rejected") && (
                  <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => onSend(key)}>
                    <Send className="mr-1 h-3 w-3" />
                    {entry?.status ? "Send" : "Mark Sent"}
                  </Button>
                )}
                {canConfirm && available && (!entry?.status || entry.status === "sent" || entry.status === "generated") && (
                  <>
                    <Button size="sm" variant="default" className="h-6 text-[11px]" onClick={() => onConfirm(key)}>
                      <ThumbsUp className="mr-1 h-3 w-3" />
                      {isReceivable ? "Client Confirmed" : "Mark Received"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => onReject(key)}>
                      <ThumbsDown className="mr-1 h-3 w-3" />
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SendDocumentDialog({
  open,
  docType,
  onClose,
  onSend,
}: {
  open: boolean;
  docType: string;
  onClose: () => void;
  onSend: (sentTo: string) => void;
}) {
  const [email, setEmail] = React.useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send {docType.charAt(0).toUpperCase() + docType.slice(1)}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label>Recipient Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              className="mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!email.trim()) {
                toast.error("Please enter an email address");
                return;
              }
              onSend(email.trim());
              setEmail("");
            }}
          >
            <Send className="mr-1 h-4 w-4" />
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentDialog({
  open,
  onClose,
  invoiceId,
  currency,
  remainingCents,
  onRecorded,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: number;
  currency: string;
  remainingCents: number;
  onRecorded: () => void;
}) {
  const [amount, setAmount] = React.useState("");
  const [paymentDate, setPaymentDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = React.useState("bank_transfer");
  const [referenceNumber, setReferenceNumber] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setAmount((remainingCents / 100).toFixed(2));
    }
  }, [open, remainingCents]);

  const handleSubmit = async () => {
    const cents = Math.round(Number(amount) * 100);
    if (cents <= 0) {
      toast.error("Amount must be positive");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/accounting/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: cents,
          currency,
          paymentDate: paymentDate || null,
          paymentMethod,
          referenceNumber: referenceNumber || null,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      toast.success("Payment recorded");
      setAmount("");
      setReferenceNumber("");
      setNotes("");
      onRecorded();
    } catch (err: any) {
      toast.error(err.message || "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label>Amount ({currency})</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Remaining: {fmtCurrency(remainingCents, currency)}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label>Payment Date</Label>
              <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>Payment Method</Label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                {PAYMENT_METHOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label>Reference Number</Label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className="mt-1" placeholder="e.g., cheque number, transfer reference" />
          </div>
          <div>
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadDocumentDialog({
  open,
  onClose,
  invoiceId,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: number;
  onUploaded: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [docType, setDocType] = React.useState("invoice");
  const [uploading, setUploading] = React.useState(false);

  const handleUpload = async () => {
    if (!file) {
      toast.error("Please select a file");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docType", docType);

      const res = await fetch(`/api/accounting/invoices/${invoiceId}/documents`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      toast.success("Document uploaded");
      setFile(null);
      onUploaded();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload document");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div>
            <Label>Document Type</Label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <option value="invoice">Invoice</option>
              <option value="quotation">Quotation</option>
              <option value="receipt">Receipt</option>
              <option value="statement">Statement</option>
              <option value="payment_proof">Payment Proof</option>
            </select>
          </div>
          <div>
            <Label>File</Label>
            <Input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleUpload} disabled={uploading || !file}>
            {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
