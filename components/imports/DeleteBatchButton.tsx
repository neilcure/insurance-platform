"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Status = "parsing" | "review" | "committing" | "committed" | "cancelled";

type Props = {
  batchId: number;
  status: Status;
  filename: string | null;
  committedRows: number;
};

/**
 * Trash-icon button on the imports list. Opens a confirmation that explicitly
 * tells the user created policies stay. Disabled while the batch is actively
 * parsing/committing — the API will reject those anyway, but greying out the
 * button avoids a misleading click.
 *
 * Implemented with the primitive Dialog (not ConfirmDialog) because we need
 * to stay open during the request to show a spinner / inline error.
 */
export function DeleteBatchButton({ batchId, status, filename, committedRows }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const blocked = status === "parsing" || status === "committing";

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/imports/batches/${batchId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Delete batch #${batchId}`}
        title={
          blocked
            ? `Cannot delete a batch while it is ${status}`
            : "Delete this batch (created policies stay)"
        }
        disabled={blocked}
        onClick={() => setOpen(true)}
        className="ml-2 inline-flex items-center justify-center rounded p-1 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950 dark:hover:text-red-400"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete import batch #{batchId}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Removes the staging record for{" "}
              <span className="font-medium">{filename ?? `batch #${batchId}`}</span>{" "}
              and its row history.
            </p>
            {committedRows > 0 ? (
              <p className="rounded border border-green-200 bg-green-50 p-2 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
                <strong>
                  {committedRows} created {committedRows === 1 ? "policy" : "policies"}
                </strong>{" "}
                from this batch will <strong>NOT</strong> be deleted — only the
                import audit trail is removed.
              </p>
            ) : (
              <p className="text-neutral-600 dark:text-neutral-400">
                No policies were committed from this batch — only the staging
                record is removed.
              </p>
            )}
            {error && (
              <p className="rounded border border-red-200 bg-red-50 p-2 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete batch"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
