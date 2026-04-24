"use client";

import * as React from "react";
import { Loader2, Mail, Send } from "lucide-react";
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
import type { PolicyDocumentRow } from "@/lib/types/upload-document";

/**
 * Maximum aggregate attachment size we let the user pick. Mirrors
 * the server-side cap in `app/api/policies/[id]/documents/email/route.ts`
 * so the UI can pre-flight before issuing a doomed POST.
 *
 * Kept slightly under the typical 25 MB ISP ceiling to leave room
 * for the MIME envelope + base64 overhead (~33%).
 */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export type EmailableDocGroup = {
  /** Document type key (e.g. "driving_license_copy"). */
  typeKey: string;
  /** Human-readable label shown above the file rows. */
  label: string;
  /** Uploaded files for this type. Rejected uploads are excluded by the parent. */
  uploads: PolicyDocumentRow[];
};

export type EmailUploadedFilesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: number;
  policyNumber?: string;
  /** Pre-fill recipient. If empty, the field starts blank. */
  defaultEmail?: string;
  /** Pre-checked file IDs. Optional; defaults to all visible files. */
  initialSelectedIds?: number[];
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
    const seed = initialSelectedIds && initialSelectedIds.length > 0
      ? initialSelectedIds.filter((id) => allDocIds.includes(id))
      : allDocIds;
    setSelectedIds(new Set(seed));
  }, [open, defaultEmail, policyNumber, initialSelectedIds, allDocIds]);

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

  async function handleSend() {
    if (!email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (selectedIds.size === 0) {
      toast.error("Please select at least one file");
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
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to send email");
      }
      const data = (await res.json()) as { sent?: number };
      const count = data.sent ?? selectedIds.size;
      toast.success(
        `Sent ${count} file${count === 1 ? "" : "s"} to ${email.trim()}`,
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
              <Label>Files to attach</Label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={allSelected ? selectNone : selectAll}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {allSelected ? "Select none" : "Select all"}
                </button>
                <span className="text-neutral-400">·</span>
                <span
                  className={
                    overSizeLimit
                      ? "text-red-600 dark:text-red-400"
                      : "text-neutral-500 dark:text-neutral-400"
                  }
                >
                  {selectedIds.size}/{totalFiles} · {formatBytes(totalSelectedBytes) || "0 B"}
                </span>
              </div>
            </div>

            <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
              {groups.length === 0 ? (
                <div className="py-4 text-center text-xs text-neutral-500 dark:text-neutral-400">
                  No uploaded files available to email.
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
            </div>

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
              selectedIds.size === 0 ||
              overSizeLimit
            }
          >
            {sending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Send {selectedIds.size > 0 ? `${selectedIds.size} ` : ""}
                file{selectedIds.size === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
