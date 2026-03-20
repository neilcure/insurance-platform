"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CompactSelectOption = {
  value: string;
  label: string;
};

type CompactSelectProps = {
  options: CompactSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Max width of the trigger when collapsed (default: "8rem") */
  maxWidth?: string;
  /** Icon shown on small screens when label is hidden */
  icon?: React.ReactNode;
  /** Short label shown above the icon on small screens */
  iconLabel?: string;
};

export function CompactSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  className,
  maxWidth = "8rem",
  icon,
  iconLabel,
}: CompactSelectProps) {
  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder;
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          icon
            ? "h-auto flex-col gap-0 py-1 sm:h-9 sm:flex-row sm:gap-1 sm:py-0"
            : "h-9",
        )}
        style={{ maxWidth }}
      >
        {icon && iconLabel && <span className="text-[9px] leading-tight sm:hidden">{iconLabel}</span>}
        {icon && <span className="shrink-0 sm:hidden [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
        <span className={cn("truncate", !!icon && "hidden sm:inline")}>{label}</span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 opacity-50", !!icon && "hidden sm:inline")} />
      </Button>

      <div
        className={cn(
          "absolute right-0 top-full z-50 mt-1 overflow-hidden transition-all duration-500 ease-in-out",
          open ? "max-h-80 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="flex flex-col rounded-md border border-neutral-200 bg-neutral-100 p-0.5 shadow-md dark:border-neutral-700 dark:bg-neutral-800">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1.5 text-xs font-medium transition-colors",
                "focus:outline-none",
                opt.value === value
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                  : "text-neutral-600 hover:bg-white hover:text-neutral-900 hover:shadow-sm dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100",
              )}
            >
              <Check
                className={cn(
                  "h-3 w-3 shrink-0 transition-opacity",
                  opt.value === value ? "opacity-100" : "opacity-0",
                )}
              />
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
