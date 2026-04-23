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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type {
  DocumentTemplateMeta,
  DocumentTemplateRow,
} from "@/lib/types/document-template";

/**
 * Picker dialog for "Sync All from Master".
 *
 * Lets the admin choose exactly which active templates should receive the
 * master's sections, instead of always blasting every active template. Any
 * template whose `meta.type` is in `excludedTypes` is shown for transparency
 * but cannot be selected (its checkbox is disabled with an "incompatible"
 * badge), so the admin can see why it was skipped.
 *
 * Compatible candidates are pre-checked by default (matches the previous
 * "sync all active" behaviour, just with the option to deselect any of
 * them).
 *
 * Returns the selected target ids via `onConfirm`. `onCancel` is called when
 * the dialog is dismissed without confirming.
 */
export type SyncAllTargetsPickerDialogProps = {
  open: boolean;
  master: DocumentTemplateRow | null;
  /**
   * All other active templates with meta. The dialog itself decides which
   * of these are compatible vs incompatible based on `excludedTypes`.
   */
  candidates: DocumentTemplateRow[];
  /**
   * Document types that cannot be synced into (e.g. "statement"). Templates
   * of these types are listed but their checkboxes are disabled.
   */
  excludedTypes: ReadonlySet<NonNullable<DocumentTemplateMeta["type"]>>;
  /** Human-readable label for each type code, used to render the type badge. */
  typeLabels: Record<string, string>;
  onCancel: () => void;
  /**
   * Called with the chosen target ids AND whether the admin wants style
   * settings copied in addition to sections.
   */
  onConfirm: (selectedIds: number[], syncStyle: boolean) => void;
};

export function SyncAllTargetsPickerDialog({
  open,
  master,
  candidates,
  excludedTypes,
  typeLabels,
  onCancel,
  onConfirm,
}: SyncAllTargetsPickerDialogProps) {
  const compatibleIds = React.useMemo(
    () =>
      candidates
        .filter((c) => !c.meta?.type || !excludedTypes.has(c.meta.type))
        .map((c) => c.id),
    [candidates, excludedTypes],
  );

  const [selected, setSelected] = React.useState<Set<number>>(
    () => new Set(compatibleIds),
  );
  const [syncStyle, setSyncStyle] = React.useState(false);

  // Reset selection whenever the dialog opens with a new candidate set so
  // an old selection from a previous master doesn't leak in.
  React.useEffect(() => {
    if (open) {
      setSelected(new Set(compatibleIds));
      setSyncStyle(false);
    }
  }, [open, compatibleIds]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllCompatible() {
    setSelected(new Set(compatibleIds));
  }

  function selectNone() {
    setSelected(new Set());
  }

  const selectedCount = selected.size;
  const allCompatibleSelected =
    compatibleIds.length > 0 && selectedCount === compatibleIds.length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Sync from {master ? `"${master.label}"` : "master"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-neutral-600 dark:text-neutral-400">
            Choose which active templates should receive sections from the master.
            Per matched section the following will be copied:{" "}
            <span className="font-medium">fields, columns, layout, audience</span>.
            Section titles, header, type, and flow settings are not changed.
            Master sections missing from a target will be appended.
          </p>

          {/* Style sync option */}
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700">
            <label className="flex cursor-pointer items-start gap-2 px-3 py-2.5 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-900">
              <Checkbox
                checked={syncStyle}
                onChange={(e) => setSyncStyle(e.currentTarget.checked)}
                className="mt-0.5"
              />
              <div>
                <Label className="cursor-pointer font-medium text-neutral-800 dark:text-neutral-100">
                  Also copy style settings from Master
                </Label>
                <p className="mt-0.5 text-neutral-500">
                  Copies layout &amp; spacing, body font size, label/value colors, footer text &amp; signature,
                  and header display settings (sizes, show date/policy#).{" "}
                  <strong className="text-neutral-700 dark:text-neutral-300">
                    Title and subtitle text are always kept from each template.
                  </strong>
                </p>
              </div>
            </label>
          </div>

          <div className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
            <span className="text-neutral-600 dark:text-neutral-300">
              {selectedCount} of {compatibleIds.length} compatible templates selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectAllCompatible}
                disabled={allCompatibleSelected || compatibleIds.length === 0}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectNone}
                disabled={selectedCount === 0}
              >
                Select none
              </Button>
            </div>
          </div>

          <ul className="max-h-[55vh] overflow-y-auto divide-y divide-neutral-100 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
            {candidates.length === 0 && (
              <li className="px-3 py-4 text-center text-neutral-500">
                No other active templates available.
              </li>
            )}
            {candidates.map((c) => {
              const type = c.meta?.type;
              const incompatible = !!type && excludedTypes.has(type);
              const checked = selected.has(c.id);
              const inputId = `sync-target-${c.id}`;
              return (
                <li
                  key={c.id}
                  className={
                    "flex items-center gap-3 px-3 py-2 " +
                    (incompatible ? "opacity-60" : "")
                  }
                >
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    disabled={incompatible}
                    onChange={() => toggle(c.id)}
                  />
                  <label
                    htmlFor={inputId}
                    className={
                      "flex flex-1 cursor-pointer items-center justify-between gap-2 " +
                      (incompatible ? "cursor-not-allowed" : "")
                    }
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                        {c.label}
                      </span>
                      {c.value && (
                        <span className="font-mono text-[10px] text-neutral-500">
                          {c.value}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {type && (
                        <span className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          {typeLabels[type] ?? type}
                        </span>
                      )}
                      {incompatible && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                          incompatible
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-neutral-500">
            This cannot be undone. After sync, every selected template can still
            be edited freely — the master link is one-shot, not a live binding.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(Array.from(selected), syncStyle)}
            disabled={selectedCount === 0}
          >
            Sync {selectedCount} template{selectedCount === 1 ? "" : "s"}
            {syncStyle ? " + style" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
