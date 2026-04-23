"use client";

import * as React from "react";
import { Loader2, Palette } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  DocumentTemplateMeta,
  DocumentTemplateRow,
} from "@/lib/types/document-template";
import { mergeStyleFromMaster } from "@/lib/document-template-sync";

/**
 * "Apply this template's style to other templates" dialog.
 *
 * Pushes the current template's STYLE settings (page layout, header display
 * settings, footer settings) to one or more selected target templates without
 * touching their sections, fields, flows, or any other configuration.
 *
 * Title and subtitle text on each target template are intentionally
 * preserved — those are the document name and tagline which every template
 * customises for its own type. Only display-style knobs travel.
 *
 * Implementation notes:
 *  - We reuse `mergeStyleFromMaster` so this stays in lock-step with
 *    "Sync style from Master" (no two functions to keep in sync).
 *  - Each target gets its own PATCH so a partial failure can't corrupt the
 *    others — successes and failures are reported in a single toast.
 */
export function StyleApplyToOthersDialog({
  open,
  onOpenChange,
  sourceMeta,
  sourceTemplateId,
  sourceTemplateLabel,
  allTemplates,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current (in-memory) meta of the template whose style we're pushing. */
  sourceMeta: DocumentTemplateMeta;
  /** id of the template currently being edited (excluded from the target list) */
  sourceTemplateId: number | null;
  /** Display label for the source template — shown in the header banner. */
  sourceTemplateLabel: string;
  allTemplates: DocumentTemplateRow[];
  /** Called after a successful apply so the parent can re-load templates. */
  onApplied: (appliedCount: number) => void;
}) {
  const [selectedTargets, setSelectedTargets] = React.useState<Set<number>>(new Set());
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    if (open) setSelectedTargets(new Set());
  }, [open]);

  const candidates = React.useMemo(
    () => allTemplates.filter((t) => t.id !== sourceTemplateId && t.meta),
    [allTemplates, sourceTemplateId],
  );

  const allSelected = candidates.length > 0 && candidates.every((c) => selectedTargets.has(c.id));

  function toggleTarget(id: number) {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(check: boolean) {
    setSelectedTargets(check ? new Set(candidates.map((c) => c.id)) : new Set());
  }

  async function applyToTargets() {
    if (selectedTargets.size === 0) {
      toast.error("Pick at least one template to copy to");
      return;
    }
    setApplying(true);
    let okCount = 0;
    let failCount = 0;
    try {
      const targets = candidates.filter((c) => selectedTargets.has(c.id));
      // Sequential so a single failure cleanly maps to a target name in
      // the toast and we don't blast parallel writes at the same row.
      for (const t of targets) {
        const newMeta = mergeStyleFromMaster(t.meta!, sourceMeta);
        try {
          const res = await fetch(`/api/admin/form-options/${t.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ meta: newMeta }),
          });
          if (!res.ok) throw new Error(await res.text());
          okCount++;
        } catch (err) {
          failCount++;
          console.error(`[apply-style] failed for "${t.label}"`, err);
        }
      }
      if (okCount > 0 && failCount === 0) {
        toast.success(`Style applied to ${okCount} template${okCount === 1 ? "" : "s"}`);
      } else if (okCount > 0) {
        toast.warning(`Applied to ${okCount}, failed on ${failCount}`);
      } else {
        toast.error(`Failed to apply to all ${failCount} target${failCount === 1 ? "" : "s"}`);
      }
      if (okCount > 0) {
        onApplied(okCount);
        onOpenChange(false);
      }
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Apply style to other templates
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Source banner */}
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
            <div className="font-semibold text-neutral-700 dark:text-neutral-200">
              From: {sourceTemplateLabel || "(this template)"}
            </div>
            <div className="mt-0.5 text-neutral-500 dark:text-neutral-400">
              Pushes <strong>page layout</strong>, <strong>header display</strong>{" "}
              and <strong>footer</strong> settings.{" "}
              <span className="text-neutral-700 dark:text-neutral-300">
                Header title &amp; subtitle text are kept on each target — only
                font sizes, colors, spacing and signature toggle travel.
              </span>{" "}
              Sections, fields, flows and statuses are <strong>never</strong> touched.
            </div>
          </div>

          {/* Target picker */}
          <div>
            <div className="mb-1.5 flex items-end justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Apply to ({candidates.length} other template{candidates.length === 1 ? "" : "s"})
              </Label>
              {candidates.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => toggleAll(!allSelected)}
                >
                  {allSelected ? "Clear all" : "Select all"}
                </Button>
              )}
            </div>
            {candidates.length === 0 ? (
              <div className="rounded-md border border-dashed border-neutral-300 px-3 py-6 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                No other templates available.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700">
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {candidates.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    >
                      <Checkbox
                        checked={selectedTargets.has(c.id)}
                        onChange={() => toggleTarget(c.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-neutral-800 dark:text-neutral-100">
                          {c.label}
                          {!c.isActive && (
                            <span className="ml-1.5 rounded bg-neutral-200 px-1 py-0.5 text-[9px] font-semibold text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                              INACTIVE
                            </span>
                          )}
                          {c.meta?.isMaster && (
                            <span className="ml-1.5 rounded bg-yellow-100 px-1 py-0.5 text-[9px] font-semibold text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300">
                              MASTER
                            </span>
                          )}
                        </div>
                        {c.meta?.type && (
                          <div className="truncate text-neutral-500 dark:text-neutral-400">
                            <span className="font-mono">{c.meta.type}</span>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancel
          </Button>
          <Button
            onClick={applyToTargets}
            disabled={applying || candidates.length === 0 || selectedTargets.size === 0}
          >
            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply style to {selectedTargets.size || ""} template
            {selectedTargets.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
