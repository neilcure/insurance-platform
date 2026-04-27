"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Portal the dialog to <body> so `position: fixed` is anchored to the
  // viewport rather than to whatever drawer / transformed ancestor we
  // happen to be rendered inside. Without this, dialogs opened from a
  // drawer inherit the drawer's containing block and get clipped to the
  // drawer's width.
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-100 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} aria-hidden="true" />
      {children}
    </div>,
    document.body,
  );
}

export function DialogContent({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative z-50 w-full max-w-lg rounded-t-md border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-800 dark:bg-neutral-950 sm:rounded-md sm:p-6 max-h-[85vh] overflow-y-auto",
        className
      )}
    >
      {children}
    </div>
  );
}

export function DialogHeader({
  className,
  children,
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-2", className)}>{children}</div>;
}

export function DialogTitle({
  className,
  children,
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-base font-semibold text-neutral-900 dark:text-neutral-100",
        className,
      )}
    >
      {children}
    </h3>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 flex justify-end gap-2">{children}</div>;
}


