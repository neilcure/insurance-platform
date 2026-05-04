"use client";

import * as React from "react";
import { FileText, Loader2, Mail, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  readPdfSelectionMarkFromStorage,
  readPdfSelectionMarkScaleFromStorage,
} from "@/lib/pdf/form-selections-preferences";
import {
  usePolicyVisiblePdfTemplates,
  type DeliveryDocGroup,
} from "@/lib/document-delivery";

/**
 * Maximum aggregate attachment size we let the user pick. Mirrors
 * the server-side cap in `app/api/policies/[id]/documents/email/route.ts`
 * so the UI can pre-flight before issuing a doomed POST.
 *
 * Kept slightly under the typical 25 MB ISP ceiling to leave room
 * for the MIME envelope + base64 overhead (~33%).
 */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * @deprecated Re-exported from `@/lib/document-delivery` as `DeliveryDocGroup`.
 * Kept here as a type alias so existing imports keep working — new
 * code should import the canonical name from the shared module.
 */
export type EmailableDocGroup = DeliveryDocGroup;

export type EmailUploadedFilesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: number;
  policyNumber?: string;
  /** Pre-fill recipient. If empty, the field starts blank. */
  defaultEmail?: string;
  /** Pre-checked file IDs. Optional; defaults to all visible files. */
  initialSelectedIds?: number[];
  /** Pre-checked PDF template IDs. Optional; defaults to none.
   *  Used by the per-template "Email this template" call sites to
   *  open the dialog with one specific template ready to send. */
  initialSelectedTplIds?: number[];
  groups: EmailableDocGroup[];
  /** Fired after a successful send so the parent can refresh / toast. */
  onSent?: (sentCount: number, recipient: string) => void;
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmailUploadedFilesDialog({
  open,
  onOpenChange,
  policyId,
  policyNumber,
  defaultEmail,
  initialSelectedIds,
  initialSelectedTplIds,
  groups,
  onSent,
}: EmailUploadedFilesDialogProps) {
  const allDocIds = React.useMemo(
    () => groups.flatMap((g) => g.uploads.map((u) => u.id)),
    [groups],
  );

  const [email, setEmail] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [sending, setSending] = React.useState(false);

  // PDF merge template selection — list comes from the shared
  // loader so this dialog stays in lockstep with WhatsApp Files.
  // Passing `policyId` scopes the list to templates that match the
  // policy's linked insurer (so an Allied World policy no longer
  // shows AIG / Zurich / BOC / AXA / Hanson / Dah Sing proposal
  // forms — same rule as the per-row Documents tab list).
  const { templates: pdfTemplates, loading: loadingTpls } =
    usePolicyVisiblePdfTemplates(open, policyId);
  const [selectedTplIds, setSelectedTplIds] = React.useState<Set<number>>(new Set());
  // Flatten AcroForm fields before attaching — on by default so recipients
  // get a tamper-proof copy instead of an editable form.
  const [flattenPdfs, setFlattenPdfs] = React.useState(true);

  // Re-seed local state every time the dialog opens. Without this
  // the user would see stale values after closing & re-opening
  // the dialog with different prefill props.
  React.useEffect(() => {
    if (!open) return;
    setEmail(defaultEmail ?? "");
    setSubject(
      policyNumber ? `Documents — Policy ${policyNumber}` : "Documents",
    );
    setMessage("");
    setSelectedTplIds(new Set(initialSelectedTplIds ?? []));
    const seed = initialSelectedIds && initialSelectedIds.length > 0
      ? initialSelectedIds.filter((id) => allDocIds.includes(id))
      : allDocIds;
    setSelectedIds(new Set(seed));
  }, [open, defaultEmail, policyNumber, initialSelectedIds, initialSelectedTplIds, allDocIds]);

  const totalSelectedBytes = React.useMemo(() => {
    let bytes = 0;
    for (const g of groups) {
      for (const u of g.uploads) {
        if (selectedIds.has(u.id)) bytes += u.fileSize ?? 0;
      }
    }
    return bytes;
  }, [groups, selectedIds]);

  const overSizeLimit = totalSelectedBytes > MAX_TOTAL_BYTES;

  function toggleId(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(allDocIds));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  function toggleTplId(id: number) {
    setSelectedTplIds((prev) => {
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
    if (selectedIds.size === 0 && selectedTplIds.size === 0) {
      toast.error("Please select at least one file or document");
      return;
    }
    if (overSizeLimit) {
      toast.error("Total attachment size is too large. Please de-select a few files.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/documents/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: Array.from(selectedIds),
          pdfTemplateIds: Array.from(selectedTplIds),
          flattenPdfs,
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
          selectionMarkStyle: readPdfSelectionMarkFromStorage(),
          selectionMarkScale: readPdfSelectionMarkScaleFromStorage(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send email");
      }
      const data = (await res.json()) as { sent?: number };
      const count = data.sent ?? (selectedIds.size + selectedTplIds.size);
      toast.success(
        `Sent ${count} attachment${count === 1 ? "" : "s"} to ${email.trim()}`,
      );
      onSent?.(count, email.trim());
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  const totalFiles = allDocIds.length;
  const allSelected = totalFiles > 0 && selectedIds.size === totalFiles;
  const totalAttachments = selectedIds.size + selectedTplIds.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Email uploaded files
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="email-files-to">Recipient email</Label>
            <Input
              id="email-files-to"
              type="email"
              placeholder="recipient@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="email-files-subject">Subject</Label>
            <Input
              id="email-files-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="email-files-msg">Message (optional)</Label>
            <textarea
              id="email-files-msg"
              rows={3}
              placeholder="Add a personal note..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-400 dark:border-neutral-700"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Attachments</Label>
              <div className="flex items-center gap-2 text-[11px]">
                {totalFiles > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={allSelected ? selectNone : selectAll}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {allSelected ? "Deselect files" : "Select all files"}
                    </button>
                    <span className="text-neutral-400">·</span>
                  </>
                )}
                <span
                  className={
                    overSizeLimit
                      ? "text-red-600 dark:text-red-400"
                      : "text-neutral-500 dark:text-neutral-400"
                  }
                >
                  {totalAttachments} selected
                  {totalSelectedBytes > 0 && ` · ${formatBytes(totalSelectedBytes)}`}
                </span>
              </div>
            </div>

            <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
              {/* Uploaded files section */}
              {groups.length === 0 ? (
                <div className="py-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
                  No uploaded files available.
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.typeKey}>
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                      {g.label}
                    </div>
                    <div className="space-y-1">
                      {g.uploads.map((u) => (
                        <label
                          key={u.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                        >
                          <Checkbox
                            checked={selectedIds.has(u.id)}
                            onChange={() => toggleId(u.id)}
                          />
                          <span className="flex-1 truncate font-mono text-[12px]" title={u.fileName}>
                            {u.fileName}
                          </span>
                          {u.fileSize ? (
                            <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
                              {formatBytes(u.fileSize)}
                            </span>
                          ) : null}
                          {u.status === "uploaded" && (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              Pending
                            </span>
                          )}
                          {u.status === "verified" && (
                            <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-900/40 dark:text-green-300">
                              Verified
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}

              {/* PDF merge templates section */}
              {loadingTpls ? (
                <div className="flex items-center gap-1.5 py-2 text-[11px] text-neutral-400 dark:text-neutral-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading documents…
                </div>
              ) : pdfTemplates.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                    <FileText className="h-3 w-3" />
                    Proposal Forms / Merge Documents
                  </div>
                  <div className="space-y-1">
                    {pdfTemplates.map((tpl) => (
                      <label
                        key={tpl.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                      >
                        <Checkbox
                          checked={selectedTplIds.has(tpl.id)}
                          onChange={() => toggleTplId(tpl.id)}
                        />
                        <span className="flex-1 truncate text-[12px]">{tpl.label}</span>
                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                          PDF
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                    Generated from current policy data when sent.
                  </p>
                </div>
              ) : null}
            </div>

            {/* Flatten toggle — only relevant when PDF templates are selected */}
            {selectedTplIds.size > 0 && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
                <Checkbox
                  checked={flattenPdfs}
                  onChange={() => setFlattenPdfs((v) => !v)}
                />
                Send as non-editable (flat) copy
                <span className="text-neutral-400 dark:text-neutral-500">— recommended</span>
              </label>
            )}

            {overSizeLimit && (
              <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                Total exceeds {Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB.
                Please de-select a few files.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={
              sending ||
              !email.trim() ||
              totalAttachments === 0 ||
              overSizeLimit
            }
          >
            {sending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Send {totalAttachments > 0 ? `${totalAttachments} ` : ""}
                {totalAttachments === 1 ? "attachment" : "attachments"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
