"use client";

import * as React from "react";
import { Loader2, Layers } from "lucide-react";
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
  DocumentTemplateRow,
  TemplateSection,
} from "@/lib/types/document-template";

/**
 * Per-section "Apply to other templates" dialog.
 *
 * Lets the admin take the configuration of one section (fields list, columns,
 * layout, audience, title) and push it onto matching sections in other
 * templates — so they don't have to re-do the same work template by template.
 *
 * Matching strategy (in order of preference, first hit wins per target):
 *   1. Same `source` + same `packageName` (covers package sections — e.g. all
 *      `package: vehicleinfo` sections across Quotation/Invoice/Receipt).
 *   2. Same `source` only (covers single-source sections like `policy`,
 *      `insured`, `agent`, etc.).
 *   3. Same `title` (case-insensitive, trimmed) — last-resort fallback when
 *      the source/package don't line up but the admin has reused the same
 *      section title.
 *
 * Saving uses the existing `PATCH /api/admin/form-options/:id` endpoint — one
 * request per target template — so each update is its own transaction and a
 * partial failure won't corrupt the others.
 */
type CopyableProperty = "fields" | "columns" | "layout" | "audience" | "title";

const PROPERTY_LABELS: Record<CopyableProperty, string> = {
  fields: "Fields (the selected field list)",
  columns: "Columns (1 or 2 per row)",
  layout: "Layout (default vs table)",
  audience: "Audience (All / Client / Agent)",
  title: "Section title",
};

const DEFAULT_PROPERTIES: CopyableProperty[] = ["fields", "columns"];

export function SectionApplyToOthersDialog({
  open,
  onOpenChange,
  sourceSection,
  sourceTemplateId,
  allTemplates,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceSection: TemplateSection;
  /** id of the template currently being edited (excluded from the target list) */
  sourceTemplateId: number | null;
  allTemplates: DocumentTemplateRow[];
  /** Called after a successful apply so the parent can re-load templates. */
  onApplied: () => void;
}) {
  const [selectedProps, setSelectedProps] = React.useState<Set<CopyableProperty>>(
    () => new Set(DEFAULT_PROPERTIES),
  );
  const [selectedTargets, setSelectedTargets] = React.useState<Set<number>>(new Set());
  const [applying, setApplying] = React.useState(false);

  // Reset selections whenever the dialog re-opens for a different source section
  // so stale selections from a previous open don't leak into the new run.
  React.useEffect(() => {
    if (open) {
      setSelectedProps(new Set(DEFAULT_PROPERTIES));
      setSelectedTargets(new Set());
    }
  }, [open, sourceSection.id]);

  // For each candidate template, decide which of its sections (if any) match
  // our source section, and how strongly.
  type Match = { section: TemplateSection; reason: "source+package" | "source" | "title" };
  type Candidate = { template: DocumentTemplateRow; match: Match | null };

  const candidates: Candidate[] = React.useMemo(() => {
    const titleNorm = sourceSection.title.trim().toLowerCase();
    return allTemplates
      .filter((t) => t.id !== sourceTemplateId && t.meta)
      .map<Candidate>((t) => {
        const sections = t.meta?.sections ?? [];
        let best: Match | null = null;
        for (const s of sections) {
          if (
            sourceSection.source === "package" &&
            s.source === "package" &&
            s.packageName &&
            sourceSection.packageName &&
            s.packageName === sourceSection.packageName
          ) {
            best = { section: s, reason: "source+package" };
            break;
          }
          if (sourceSection.source !== "package" && s.source === sourceSection.source) {
            // Prefer this over a title-only match found later, but keep scanning
            // in case there's an even better source+package hit (only possible
            // when our own source is package, which is handled above).
            if (!best || best.reason === "title") {
              best = { section: s, reason: "source" };
            }
          }
          if (
            !best &&
            titleNorm.length > 0 &&
            s.title.trim().toLowerCase() === titleNorm
          ) {
            best = { section: s, reason: "title" };
          }
        }
        return { template: t, match: best };
      });
  }, [allTemplates, sourceSection, sourceTemplateId]);

  const matchedCandidates = candidates.filter((c) => c.match);

  function toggleTarget(id: number) {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll(check: boolean) {
    setSelectedTargets(check ? new Set(matchedCandidates.map((c) => c.template.id)) : new Set());
  }
  function toggleProp(p: CopyableProperty, on: boolean) {
    setSelectedProps((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });
  }

  /**
   * Returns a *new* TemplateSection by overlaying the selected properties from
   * `sourceSection` onto `target`. We never overwrite the target's `id` so the
   * section keeps its place in the template.
   */
  function buildPatchedSection(target: TemplateSection): TemplateSection {
    const next: TemplateSection = { ...target };
    if (selectedProps.has("fields")) next.fields = sourceSection.fields.map((f) => ({ ...f }));
    if (selectedProps.has("columns")) next.columns = sourceSection.columns;
    if (selectedProps.has("layout")) next.layout = sourceSection.layout;
    if (selectedProps.has("audience")) next.audience = sourceSection.audience;
    if (selectedProps.has("title")) next.title = sourceSection.title;
    return next;
  }

  async function applyToTargets() {
    if (selectedTargets.size === 0) {
      toast.error("Pick at least one template to copy to");
      return;
    }
    if (selectedProps.size === 0) {
      toast.error("Pick at least one property to copy");
      return;
    }
    setApplying(true);
    let okCount = 0;
    let failCount = 0;
    try {
      const targets = matchedCandidates.filter((c) => selectedTargets.has(c.template.id));
      // Run sequentially so failures map cleanly to a target name in the toast,
      // and so we don't blow up the API with parallel writes to overlapping
      // form_options rows.
      for (const c of targets) {
        const meta = c.template.meta!;
        const matchedSection = c.match!.section;
        const newSections = meta.sections.map((s) =>
          s.id === matchedSection.id ? buildPatchedSection(s) : s,
        );
        const newMeta = { ...meta, sections: newSections };
        try {
          const res = await fetch(`/api/admin/form-options/${c.template.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ meta: newMeta }),
          });
          if (!res.ok) throw new Error(await res.text());
          okCount++;
        } catch (err) {
          failCount++;
          console.error(`[apply-section] failed for "${c.template.label}"`, err);
        }
      }
      if (okCount > 0 && failCount === 0) {
        toast.success(`Applied to ${okCount} template${okCount === 1 ? "" : "s"}`);
      } else if (okCount > 0) {
        toast.warning(`Applied to ${okCount}, failed on ${failCount}`);
      } else {
        toast.error(`Failed to apply to all ${failCount} target${failCount === 1 ? "" : "s"}`);
      }
      if (okCount > 0) {
        onApplied();
        onOpenChange(false);
      }
    } finally {
      setApplying(false);
    }
  }

  const allSelected =
    matchedCandidates.length > 0 && matchedCandidates.every((c) => selectedTargets.has(c.template.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Apply section to other templates
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Source section summary */}
          <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
            <div className="font-semibold text-neutral-700 dark:text-neutral-200">
              {sourceSection.title || "(untitled section)"}
            </div>
            <div className="mt-0.5 text-neutral-500 dark:text-neutral-400">
              <span className="font-mono">{sourceSection.source}</span>
              {sourceSection.packageName && (
                <>
                  {" / "}
                  <span className="font-mono">{sourceSection.packageName}</span>
                </>
              )}
              {" · "}
              {sourceSection.fields.length} field{sourceSection.fields.length === 1 ? "" : "s"}
              {" · "}
              {sourceSection.columns === 2 ? "2 cols" : "1 col"}
              {" · "}
              {sourceSection.audience ?? "all"}
            </div>
          </div>

          {/* Property picker */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              What to copy
            </Label>
            <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {(Object.keys(PROPERTY_LABELS) as CopyableProperty[]).map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-neutral-200 hover:bg-neutral-50 dark:hover:border-neutral-700 dark:hover:bg-neutral-900"
                >
                  <Checkbox
                    checked={selectedProps.has(p)}
                    onChange={(e) => toggleProp(p, e.currentTarget.checked)}
                  />
                  <span>{PROPERTY_LABELS[p]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Target picker */}
          <div>
            <div className="mb-1.5 flex items-end justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Apply to ({matchedCandidates.length} matching)
              </Label>
              {matchedCandidates.length > 0 && (
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
            {matchedCandidates.length === 0 ? (
              <div className="rounded-md border border-dashed border-neutral-300 px-3 py-6 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                No other templates have a matching section.
                <br />
                Sections match by source / package; if those don&apos;t line up, by title.
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700">
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {matchedCandidates.map((c) => (
                    <li
                      key={c.template.id}
                      className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    >
                      <Checkbox
                        checked={selectedTargets.has(c.template.id)}
                        onChange={() => toggleTarget(c.template.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-neutral-800 dark:text-neutral-100">
                          {c.template.label}
                          {!c.template.isActive && (
                            <span className="ml-1.5 rounded bg-neutral-200 px-1 py-0.5 text-[9px] font-semibold text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
                              INACTIVE
                            </span>
                          )}
                        </div>
                        <div className="truncate text-neutral-500 dark:text-neutral-400">
                          → &ldquo;{c.match!.section.title || "(untitled)"}&rdquo;{" · "}
                          <span className="text-[10px] uppercase tracking-wide">
                            {c.match!.reason === "source+package"
                              ? "source + package match"
                              : c.match!.reason === "source"
                                ? "source match"
                                : "title match"}
                          </span>
                        </div>
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
            disabled={applying || matchedCandidates.length === 0 || selectedTargets.size === 0}
          >
            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply to {selectedTargets.size || ""} template
            {selectedTargets.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
