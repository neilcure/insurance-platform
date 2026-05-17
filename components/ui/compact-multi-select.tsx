"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CompactMultiSelectOption = {
  value: string;
  label: string;
};

type CompactMultiSelectProps = {
  /** Options shown in the dropdown panel. */
  options: CompactMultiSelectOption[];
  /** Currently selected values. */
  value: string[];
  /** Receives the next selection on each toggle (Clear empties the list). */
  onChange: (next: string[]) => void;
  /** Trigger text shown when nothing is selected. Defaults to "Any". */
  placeholder?: string;
  /** Trigger text shown when there are zero options. Defaults to "—". */
  emptyOptionsLabel?: string;
  /** Optional extra classes for the wrapper. */
  className?: string;
  /** Max width of the trigger button. Defaults to "9rem". */
  maxWidth?: string;
  /** Disables interaction. */
  disabled?: boolean;
};

/**
 * Compact multi-select dropdown — same look + behaviour as `CompactSelect`
 * but allows multiple values. Trigger is a single-line button that shows a
 * short summary ("Third Party", "Third Party +1", or the placeholder when
 * empty). Clicking opens a small popup with a checkbox list anchored under
 * the trigger; clicking outside closes it.
 *
 * Built for cramped admin tables where the previous chip-based
 * `CompactMultiCheck` was way too tall — each picker still fits on a single
 * row, no matter how many options are picked.
 */
export function CompactMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Any",
  emptyOptionsLabel = "—",
  className,
  maxWidth = "9rem",
  disabled,
}: CompactMultiSelectProps) {
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

  const labelByValue = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.value, o.label);
    return m;
  }, [options]);

  const selected = React.useMemo(
    () => value.filter((v) => labelByValue.has(v)),
    [value, labelByValue],
  );

  const summary = React.useMemo(() => {
    if (options.length === 0) return emptyOptionsLabel;
    if (selected.length === 0) return placeholder;
    const first = labelByValue.get(selected[0]) ?? selected[0];
    if (selected.length === 1) return first;
    return `${first} +${selected.length - 1}`;
  }, [options.length, selected, labelByValue, placeholder, emptyOptionsLabel]);

  function toggle(v: string) {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      const set = new Set([...value, v]);
      onChange(options.map((o) => o.value).filter((ov) => set.has(ov)));
    }
  }

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((prev) => !prev)}
        className="h-7 w-full justify-between gap-1 px-2 text-[11px] font-normal"
        style={{ maxWidth }}
        title={selected.length > 0 ? selected.map((v) => labelByValue.get(v) ?? v).join(", ") : undefined}
      >
        <span className={cn("truncate", selected.length === 0 && "text-neutral-400")}>{summary}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </Button>

      {open && options.length > 0 && (
        <div
          className={cn(
            "absolute left-0 top-full z-50 mt-1 min-w-40 rounded-md border border-neutral-200 bg-white p-1 shadow-md",
            "dark:border-neutral-700 dark:bg-neutral-800",
          )}
        >
          {options.map((opt) => {
            const checked = value.includes(opt.value);
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs",
                  "hover:bg-neutral-100 dark:hover:bg-neutral-700",
                )}
              >
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={checked}
                  onChange={() => toggle(opt.value)}
                />
                <span className="truncate">{opt.label}</span>
              </label>
            );
          })}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className={cn(
                "mt-1 w-full rounded px-2 py-1 text-left text-[10px] text-neutral-500",
                "hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-100",
              )}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
