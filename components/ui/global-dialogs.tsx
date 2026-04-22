"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * App-wide lightbox dialog system. Replaces native `window.confirm`,
 * `window.alert`, and `window.prompt`, which are forbidden in this codebase
 * (see `.cursor/rules/no-native-dialogs.mdc`).
 *
 * Usage from any client component:
 *
 *   import { confirmDialog, alertDialog, promptDialog } from "@/components/ui/global-dialogs";
 *
 *   if (!(await confirmDialog({ title: "Delete?", description: "..." }))) return;
 *   await alertDialog({ title: "Saved", description: "All good." });
 *   const name = await promptDialog({ title: "Rename", defaultValue: "old" });
 *
 * The `<GlobalDialogHost />` is mounted once in `app/layout.tsx` and listens
 * to a tiny module-level pub/sub. Each call returns a Promise that resolves
 * when the user dismisses the dialog. Only one dialog is shown at a time —
 * subsequent calls queue and open in order.
 */

type ConfirmRequest = {
  kind: "confirm";
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
};

type AlertRequest = {
  kind: "alert";
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  resolve: () => void;
};

type PromptRequest = {
  kind: "prompt";
  title: string;
  description?: React.ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: string | null) => void;
};

type DialogRequest = ConfirmRequest | AlertRequest | PromptRequest;

const subscribers = new Set<(req: DialogRequest) => void>();

function publish(req: DialogRequest) {
  if (subscribers.size === 0) {
    // No host mounted — fail loudly in dev so the bug is fixed,
    // but still resolve so the calling code doesn't hang forever.
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "[global-dialogs] No <GlobalDialogHost /> is mounted. Add it to app/layout.tsx.",
      );
    }
    if (req.kind === "confirm") req.resolve(false);
    else if (req.kind === "alert") req.resolve();
    else req.resolve(null);
    return;
  }
  for (const sub of subscribers) sub(req);
}

export function confirmDialog(opts: {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    publish({ kind: "confirm", ...opts, resolve });
  });
}

export function alertDialog(opts: {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
}): Promise<void> {
  return new Promise<void>((resolve) => {
    publish({ kind: "alert", ...opts, resolve });
  });
}

export function promptDialog(opts: {
  title: string;
  description?: React.ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    publish({ kind: "prompt", ...opts, resolve });
  });
}

/**
 * Mount once near the root of the app (in `app/layout.tsx`). All calls to
 * `confirmDialog` / `alertDialog` / `promptDialog` flow through this host.
 */
export function GlobalDialogHost() {
  const [queue, setQueue] = React.useState<DialogRequest[]>([]);
  const [promptValue, setPromptValue] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    function onRequest(req: DialogRequest) {
      setQueue((prev) => [...prev, req]);
    }
    subscribers.add(onRequest);
    return () => {
      subscribers.delete(onRequest);
    };
  }, []);

  const current = queue[0];

  // Reset prompt input whenever the active request changes.
  React.useEffect(() => {
    if (current?.kind === "prompt") {
      setPromptValue(current.defaultValue ?? "");
      // Focus the input shortly after mount so typing starts immediately.
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [current]);

  function dismiss() {
    setQueue((prev) => prev.slice(1));
  }

  function handleCancel() {
    if (!current) return;
    if (current.kind === "confirm") current.resolve(false);
    else if (current.kind === "prompt") current.resolve(null);
    else current.resolve();
    dismiss();
  }

  function handleConfirm() {
    if (!current) return;
    if (current.kind === "confirm") current.resolve(true);
    else if (current.kind === "prompt") current.resolve(promptValue);
    else current.resolve();
    dismiss();
  }

  if (!current) return null;

  const isAlert = current.kind === "alert";
  const isPrompt = current.kind === "prompt";
  const destructive = current.kind === "confirm" && current.destructive === true;

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) handleCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
        </DialogHeader>

        {current.description && (
          <div className="whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-400">
            {current.description}
          </div>
        )}

        {isPrompt && (
          <div className="mt-2">
            <Input
              ref={inputRef}
              value={promptValue}
              placeholder={(current as PromptRequest).placeholder}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
            />
          </div>
        )}

        <DialogFooter>
          {!isAlert && (
            <Button variant="outline" onClick={handleCancel}>
              {(current as ConfirmRequest | PromptRequest).cancelLabel ?? "Cancel"}
            </Button>
          )}
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            autoFocus={!isPrompt}
          >
            {("confirmLabel" in current && current.confirmLabel) ||
              (isAlert ? "OK" : destructive ? "Delete" : "Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
