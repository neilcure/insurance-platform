"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface SlideDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "left" | "right";
  /** Width classes — defaults differ by side */
  widthClass?: string;
  /** Extra z-index class (e.g. "z-60" for stacked drawers) */
  zClass?: string;
  /**
   * When true the backdrop doesn't block pointer events on elements
   * behind it (used for stacked drawers that sit above another drawer).
   */
  passthrough?: boolean;
  children: React.ReactNode;
}

const LEFT_WIDTH = "w-[280px] sm:w-[320px] md:w-[380px]";
const RIGHT_WIDTH = "w-[300px] sm:w-[360px] md:w-[420px]";

export function SlideDrawer({
  open,
  onClose,
  title,
  side = "left",
  widthClass,
  zClass = "z-50",
  passthrough = false,
  children,
}: SlideDrawerProps) {
  const width = widthClass ?? (side === "left" ? LEFT_WIDTH : RIGHT_WIDTH);
  const isLeft = side === "left";

  const posClass = isLeft
    ? "left-0 top-0 border-r"
    : "right-0 top-0 border-l";

  const translateHidden = isLeft ? "-translate-x-full" : "translate-x-full";
  const translateVisible = "translate-x-0";

  return (
    <div className={`fixed inset-0 ${zClass} ${passthrough ? "pointer-events-none" : ""}`}>
      <div
        className={`${passthrough ? "pointer-events-auto" : ""} absolute inset-0 bg-black transition-opacity duration-300 ${
          open ? "opacity-60" : "opacity-0"
        }`}
        onClick={onClose}
        aria-label={`Close ${title}`}
      />
      <aside
        className={`${passthrough ? "pointer-events-auto" : ""} absolute ${posClass} h-full ${width} bg-white dark:bg-neutral-950/40 dark:backdrop-blur-xl border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-300 ease-out will-change-transform ${
          open ? translateVisible : translateHidden
        }`}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
          <div className="font-semibold">{title}</div>
          <Button size="iconCompact" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        {children}
      </aside>
    </div>
  );
}
