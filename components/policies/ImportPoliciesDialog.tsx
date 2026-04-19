"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, Upload, Loader2, FileSpreadsheet } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flowKey: string;
  flowLabel: string;
  /**
   * Kept for backwards compatibility but unused — after the staging-area
   * refactor the parent doesn't need to refresh on commit; the user is
   * redirected to the batch review page.
   */
  onImportComplete?: () => void;
}

/**
 * Upload-only dialog. After upload, the user is redirected to the batch
 * review page (/dashboard/imports/[batchId]) where they:
 *   • Inspect the issue summary
 *   • Edit / skip / fix individual rows
 *   • Commit the batch when ready
 *
 * No more in-dialog preview/commit — the staging-table architecture moves
 * those into the review page so admins can take their time with large files.
 */
export function ImportPoliciesDialog({
  open,
  onOpenChange,
  flowKey,
  flowLabel,
}: Props) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      setFile(null);
      setBusy(false);
    }
  }, [open]);

  async function downloadTemplate() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/flows/${encodeURIComponent(flowKey)}/import/template`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${flowKey}-import-template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Template downloaded");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadAndOpen() {
    if (!file) {
      toast.error("Please choose a file first");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("flowKey", flowKey);
      const res = await fetch(`/api/imports/batches`, {
        method: "POST",
        body: fd,
      });
      const body = (await res.json().catch(() => ({}))) as
        | { batchId?: number; error?: string }
        | Record<string, unknown>;
      if (!res.ok) {
        const errMsg =
          (body as { error?: string }).error || `Upload failed (HTTP ${res.status})`;
        throw new Error(errMsg);
      }
      const batchId = (body as { batchId?: number }).batchId;
      if (!batchId) throw new Error("Upload succeeded but no batch id returned.");
      toast.success("Uploaded — opening review");
      onOpenChange(false);
      router.push(`/dashboard/imports/${batchId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import {flowLabel} from Excel</DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
            <p className="mb-2 font-medium">How it works</p>
            <ol className="ml-5 list-decimal space-y-1">
              <li>Download the template (always matches the current field setup).</li>
              <li>Fill one row per policy. Leave the Client Number column blank to auto-create a new client.</li>
              <li>Upload — you&apos;ll be taken to a review page where you can fix issues, skip rows, and finally commit.</li>
            </ol>
          </div>

          <div>
            <Button variant="outline" onClick={downloadTemplate} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Template
            </Button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Excel file</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="sr-only"
              aria-label="Excel file"
            />
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                <Upload className="h-4 w-4" />
                Choose file…
              </Button>
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-700 dark:text-neutral-300">
                {file ? file.name : <span className="text-neutral-400">No file selected</span>}
              </span>
              {file && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  disabled={busy}
                >
                  Clear
                </Button>
              )}
            </div>
            {file && (
              <p className="mt-1 text-xs text-neutral-500">{(file.size / 1024).toFixed(1)} KB</p>
            )}
          </div>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
            <p>
              Every upload goes through a staging review screen. Issues like
              unknown select values, off-category data, and conditional-gating
              warnings are surfaced for inspection but do not block commit —
              you decide which rows to fix, skip, or commit as-is.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={uploadAndOpen} disabled={!file || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            Upload & open review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
