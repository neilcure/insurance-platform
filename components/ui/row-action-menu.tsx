"use client";

import * as React from "react";
import { MoreHorizontal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
  loading?: boolean;
  disabled?: boolean;
}

interface RowActionMenuProps {
  actions: RowAction[];
  label?: string;
}

export function RowActionMenu({ actions, label = "Actions" }: RowActionMenuProps) {
  const hasLoading = actions.some((a) => a.loading);
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout>>(null);

  function handleEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }

  function handleLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {/* Trigger label */}
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium shadow-sm",
          "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
          hasLoading && "opacity-50",
        )}
      >
        {hasLoading ? (
          <Loader2 className="h-4 w-4 animate-spin sm:hidden lg:inline" />
        ) : (
          <MoreHorizontal className="h-4 w-4 sm:hidden lg:inline" />
        )}
        <span className="hidden sm:inline">{label}</span>
      </span>

      {/* Slide-out action pills (to the right) */}
      <div
        className={cn(
          "flex items-center overflow-hidden transition-all duration-500 ease-in-out",
          open ? "max-w-[500px] opacity-100 ml-1" : "max-w-0 opacity-0 ml-0",
        )}
      >
        <div className="flex items-center gap-0 rounded-md border border-neutral-200 bg-neutral-100 p-0.5 dark:border-neutral-700 dark:bg-neutral-800">
          {actions.map((action, i) => (
            <button
              key={i}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                "focus:outline-none disabled:pointer-events-none disabled:opacity-50",
                action.variant === "destructive"
                  ? "text-red-600 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/50 dark:hover:text-red-300"
                  : "text-neutral-600 hover:bg-white hover:text-neutral-900 hover:shadow-sm dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100",
              )}
            >
              {action.loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin sm:hidden lg:inline" />
              ) : action.icon ? (
                <span className="sm:hidden lg:inline [&_svg]:h-3.5 [&_svg]:w-3.5">{action.icon}</span>
              ) : null}
              <span className="hidden sm:inline">{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
