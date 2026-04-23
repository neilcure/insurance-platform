"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export type CompactMultiCheckOption = {
  value: string;
  label: string;
};

type CompactMultiCheckProps = {
  /** Field label, e.g. "Restrict to Flows". */
  label: React.ReactNode;
  /** Optional muted hint after the label, e.g. "(optional)". */
  hint?: React.ReactNode;
  /** Optional helper text shown when expanded (mirrors the old <p> below). */
  description?: React.ReactNode;
  /** Available options. */
  options: CompactMultiCheckOption[];
  /** Currently selected values. */
  value: string[];
  /** Receives the next list (already de-duped, original order preserved). */
  onChange: (next: string[]) => void;
  /**
   * Text shown in the trigger when nothing is selected.
   * e.g. "All flows" / "Always shown" / "All companies".
   */
  emptyLabel?: string;
  /** Text shown when there are no options at all. */
  noOptionsLabel?: string;
  /** Force initial state. Defaults to collapsed (compact). */
  defaultOpen?: boolean;
};

/**
 * One-line, chip-based replacement for the old "wrap a row of checkboxes"
 * UI. Collapsed by default: shows the label, the currently-selected items
 * as removable chips (or a muted placeholder), and a chevron to expand
 * the full checkbox grid for editing.
 *
 * Functionally identical to the previous wrap-of-checkboxes pattern —
 * just much shorter when the list is empty or only a couple items are
 * picked, which is the common case for document-template restrictions.
 */
export function CompactMultiCheck({
  label,
  hint,
  description,
  options,
  value,
  onChange,
  emptyLabel = "None selected",
  noOptionsLabel,
  defaultOpen = false,
}: CompactMultiCheckProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  // Map for label lookup when rendering chips.
  const labelByValue = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.value, o.label);
    return m;
  }, [options]);

  const selected = React.useMemo(
    () => value.filter((v) => labelByValue.has(v)),
    [value, labelByValue],
  );

  function toggle(v: string, checked: boolean) {
    if (checked) {
      if (value.includes(v)) return;
      // Preserve "options" order so chips stay stable across edits.
      const set = new Set([...value, v]);
      onChange(options.map((o) => o.value).filter((ov) => set.has(ov)));
    } else {
      onChange(value.filter((x) => x !== v));
    }
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div className="grid gap-1">
      {/* Trigger row: label + chips + expand chevron. Always visible. */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="shrink-0">
          {label}
          {hint ? <span className="ml-1 text-xs text-neutral-400">{hint}</span> : null}
        </Label>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "group inline-flex min-h-7 flex-1 min-w-0 items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-2 py-1 text-left text-xs shadow-sm transition-colors",
            "hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-600",
          )}
          aria-expanded={open}
        >
          <span className="flex flex-1 flex-wrap items-center gap-1 min-w-0">
            {options.length === 0 ? (
              <span className="text-neutral-400 italic">
                {noOptionsLabel ?? "No options available"}
              </span>
            ) : selected.length === 0 ? (
              <span className="text-neutral-400 italic">{emptyLabel}</span>
            ) : (
              selected.map((v) => (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  {labelByValue.get(v)}
                  {/* Inline remove handle so power-users don't have to expand. */}
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(v, false);
                    }}
                    className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                    aria-label={`Remove ${labelByValue.get(v)}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </span>
                </span>
              ))
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-neutral-400">
            {selected.length > 0 && (
              <span className="text-[10px] uppercase tracking-wide">
                {selected.length}/{options.length}
              </span>
            )}
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>
      </div>

      {/* Expanded panel: the original checkbox grid lives here. */}
      {open && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
          {options.length === 0 ? (
            <span className="text-xs text-neutral-400">
              {noOptionsLabel ?? "No options available"}
            </span>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {options.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={value.includes(o.value)}
                      onChange={(e) => toggle(o.value, e.target.checked)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              {selected.length > 0 && (
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={clearAll}
                    className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {description ? (
        <p className="text-xs text-neutral-400">{description}</p>
      ) : null}
    </div>
  );
}
