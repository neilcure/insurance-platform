"use client";

import * as React from "react";
import { Copy, FileText, Loader2, MessageCircle, Send } from "lucide-react";
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
  buildWhatsAppUrl,
  formatWhatsAppDisplay,
  normalizeForWhatsApp,
} from "@/lib/whatsapp";
import {
  usePolicyVisiblePdfTemplates,
  type DeliveryDocGroup,
} from "@/lib/document-delivery";

/**
 * @deprecated Re-exported from `@/lib/document-delivery` as `DeliveryDocGroup`.
 * Kept here so existing imports continue to compile — new code should
 * import the canonical name from the shared module.
 */
export type WhatsAppDocGroup = DeliveryDocGroup;

export type WhatsAppUploadedFilesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: number;
  policyNumber?: string;
  /** Pre-fill recipient mobile (any of: 12345678, +852 1234 5678, etc.). */
  defaultPhone?: string;
  /** Pre-fill recipient name for the message body. */
  defaultRecipientName?: string;
  /** Pre-checked file IDs. Optional; defaults to all visible files. */
  initialSelectedIds?: number[];
  groups: WhatsAppDocGroup[];
  /** Fired after the share link is created and WhatsApp opened. */
  onSent?: (sentCount: number, recipientPhone: string) => void;
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EXPIRY_OPTIONS = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

export function WhatsAppUploadedFilesDialog({
  open,
  onOpenChange,
  policyId,
  policyNumber,
  defaultPhone,
  defaultRecipientName,
  initialSelectedIds,
  groups,
  onSent,
}: WhatsAppUploadedFilesDialogProps) {
  const allDocIds = React.useMemo(
    () => groups.flatMap((g) => g.uploads.map((u) => u.id)),
    [groups],
  );

  const [phone, setPhone] = React.useState("");
  const [recipientName, setRecipientName] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [expiresInDays, setExpiresInDays] = React.useState(7);
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [creating, setCreating] = React.useState(false);
  const [createdUrl, setCreatedUrl] = React.useState<string | null>(null);
  const [createdExpiresAt, setCreatedExpiresAt] = React.useState<string | null>(null);

  // PDF merge templates — same loader as Email Files dialog.
  const { templates: pdfTemplates, loading: loadingTpls } =
    usePolicyVisiblePdfTemplates(open);
  const [selectedTplIds, setSelectedTplIds] = React.useState<Set<number>>(new Set());

  // Re-seed local state every time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setPhone(formatWhatsAppDisplay(defaultPhone) ?? defaultPhone ?? "");
    setRecipientName(defaultRecipientName ?? "");
    setExpiresInDays(7);
    const greetingName = defaultRecipientName ? `Hi ${defaultRecipientName.split(/\s+/)[0]}` : "Hi";
    setMessage(
      policyNumber
        ? `${greetingName}, here are your documents for policy ${policyNumber}. Tap the link to download — it expires in 7 days.`
        : `${greetingName}, here are your documents. Tap the link to download — it expires in 7 days.`,
    );
    setSelectedTplIds(new Set());
    const seed = initialSelectedIds && initialSelectedIds.length > 0
      ? initialSelectedIds.filter((id) => allDocIds.includes(id))
      : allDocIds;
    setSelectedIds(new Set(seed));
    setCreatedUrl(null);
    setCreatedExpiresAt(null);
  }, [open, defaultPhone, defaultRecipientName, policyNumber, initialSelectedIds, allDocIds]);

  const totalSelectedBytes = React.useMemo(() => {
    let bytes = 0;
    for (const g of groups) {
      for (const u of g.uploads) {
        if (selectedIds.has(u.id)) bytes += u.fileSize ?? 0;
      }
    }
    return bytes;
  }, [groups, selectedIds]);

  function toggleId(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() { setSelectedIds(new Set(allDocIds)); }
  function selectNone() { setSelectedIds(new Set()); }

  function toggleTplId(id: number) {
    setSelectedTplIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const normalizedPhone = normalizeForWhatsApp(phone);
  const phoneIsValid = !!normalizedPhone && normalizedPhone.length >= 10;
  const totalAttachments = selectedIds.size + selectedTplIds.size;
  const hasFiles = totalAttachments > 0;
  const totalFiles = allDocIds.length;
  const allSelected = totalFiles > 0 && selectedIds.size === totalFiles;

  /**
   * Mint the share link, then open WhatsApp with a pre-filled message
   * containing the link. Two-step on purpose so a popup-blocked
   * browser still gets the URL into state — the user can then click
   * "Open WhatsApp" or "Copy link".
   */
  async function handleSend() {
    if (!phoneIsValid) {
      toast.error("Enter a valid mobile number (e.g. 1234 5678)");
      return;
    }
    if (!hasFiles) {
      toast.error("Select at least one file or document");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/documents/share-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentIds: Array.from(selectedIds),
          pdfTemplateIds: Array.from(selectedTplIds),
          flattenPdfs: true,
          recipientPhone: normalizedPhone,
          recipientName: recipientName.trim() || null,
          message: message.trim() || null,
          expiresInDays,
          label: policyNumber ? `Policy ${policyNumber}` : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create share link");
      }
      const data = (await res.json()) as {
        ok: boolean;
        url: string;
        expiresAt: string;
        fileCount: number;
      };
      setCreatedUrl(data.url);
      setCreatedExpiresAt(data.expiresAt);

      const messageWithLink = `${message.trim()}\n\n${data.url}`.trim();
      const waUrl = buildWhatsAppUrl(normalizedPhone, messageWithLink);
      if (waUrl) {
        window.open(waUrl, "_blank", "noopener,noreferrer");
      }

      toast.success(`Link ready for ${formatWhatsAppDisplay(normalizedPhone)}`);
      onSent?.(data.fileCount, normalizedPhone ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyLink() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy — long-press the link to copy manually");
    }
  }

  function handleReopenWhatsApp() {
    if (!createdUrl || !normalizedPhone) return;
    const messageWithLink = `${message.trim()}\n\n${createdUrl}`.trim();
    const waUrl = buildWhatsAppUrl(normalizedPhone, messageWithLink);
    if (waUrl) window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            WhatsApp uploaded files
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
            WhatsApp can&apos;t attach files via a click-to-chat link. We
            generate a secure download link, open WhatsApp with it pre-filled,
            and the recipient taps to download. Link expires automatically.
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="wa-files-phone">Recipient mobile</Label>
              <Input
                id="wa-files-phone"
                type="tel"
                placeholder="1234 5678 or +852 1234 5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1"
              />
              {phone && !phoneIsValid && (
                <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                  Enter at least 8 digits.
                </p>
              )}
              {phoneIsValid && (
                <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  Sending to {formatWhatsAppDisplay(normalizedPhone)}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="wa-files-name">Recipient name (optional)</Label>
              <Input
                id="wa-files-name"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="mt-1"
                placeholder="Tai Man"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="wa-files-msg">Message</Label>
            <textarea
              id="wa-files-msg"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 dark:border-neutral-700"
            />
            <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              The download link is appended to this message automatically.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="wa-files-expiry" className="shrink-0">
              Link expires in
            </Label>
            <select
              id="wa-files-expiry"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className="rounded-md border border-neutral-200 bg-transparent px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-emerald-400 dark:border-neutral-700"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Files in download bundle</Label>
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
                <span className="text-neutral-500 dark:text-neutral-400">
                  {totalAttachments} selected
                  {totalSelectedBytes > 0 && ` · ${formatBytes(totalSelectedBytes)}`}
                </span>
              </div>
            </div>

            <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
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
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}

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
                    Generated on download from the latest policy data.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {createdUrl && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs dark:border-emerald-900/40 dark:bg-emerald-950/30">
              <div className="mb-1 font-medium text-emerald-800 dark:text-emerald-300">
                Link ready
                {createdExpiresAt && (
                  <span className="ml-1.5 font-normal text-emerald-700/80 dark:text-emerald-400/80">
                    · expires {new Date(createdExpiresAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <code className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-emerald-900 dark:bg-neutral-900 dark:text-emerald-300">
                  {createdUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="rounded p-1.5 text-neutral-500 transition-colors hover:bg-white hover:text-emerald-700 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-emerald-300"
                  title="Copy link"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1 text-[10px] text-emerald-700/70 dark:text-emerald-400/70">
                If WhatsApp didn&apos;t open automatically, use the buttons below.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            {createdUrl ? "Close" : "Cancel"}
          </Button>
          {createdUrl ? (
            <Button
              size="sm"
              onClick={handleReopenWhatsApp}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
              Open WhatsApp again
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={creating || !phoneIsValid || !hasFiles}
              className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-neutral-300 disabled:text-neutral-500"
            >
              {creating ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Creating link…
                </>
              ) : (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Send via WhatsApp
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
