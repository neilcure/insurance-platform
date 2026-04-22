"use client";

import * as React from "react";
import { Crown, Loader2 } from "lucide-react";
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
  TemplateSection,
} from "@/lib/types/document-template";
import {
  findMatchingSection,
  mergeSectionsFromMaster,
  type CopyableSectionProperty,
} from "@/lib/document-template-sync";

/**
 * "Sync from Master" dialog shown inside the template editor.
 *
 * Pulls section configuration (fields, columns, layout, audience) from the
 * designated master template into the template currently being edited.
 * The header, type, flows, and all other per-document settings are NEVER
 * touched — only sections.
 *
 * The user picks:
 *   - Which master sections to pull (checkbox per section).
 *   - Which properties to copy per section (fields, columns, layout, audience).
 *     Title is OFF by default because different documents typically have
 *     different section titles (e.g. "Vehicle Details" vs "Vehicle Info").
 *
 * The result is applied into in-memory `meta` state via `onSync`.
 * No API call is made here — the admin still needs to click Save.
 *
 * Matching logic (same as SectionApplyToOthersDialog, reversed direction):
 *   1. Same source + packageName (strongest).
 *   2. Same source.
 *   3. Same title (case-insensitive).
 */
type CopyableProperty = CopyableSectionProperty;

const PROPERTY_LABELS: Record<CopyableProperty, string> = {
  fields: "Fields (the selected field list)",
  columns: "Columns (1 or 2 per row)",
  layout: "Layout (default vs table)",
  audience: "Audience (All / Client / Agent)",
  title: "Section title",
};

const DEFAULT_PROPERTIES: CopyableProperty[] = ["fields", "columns"];

export function SyncFromMasterDialog({
  open,
  onOpenChange,
  masterMeta,
  currentMeta,
  onSync,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  masterMeta: DocumentTemplateMeta;
  currentMeta: DocumentTemplateMeta;
  /**
   * Called with the updated meta after the admin confirms.
   * The caller is responsible for updating its own state and prompting to Save.
   */
  onSync: (updatedMeta: DocumentTemplateMeta) => void;
}) {
  const [selectedSections, setSelectedSections] = React.useState<Set<string>>(new Set());
  const [selectedProps, setSelectedProps] = React.useState<Set<CopyableProperty>>(
    () => new Set(DEFAULT_PROPERTIES),
  );

  // Compute the candidate master sections together with their match in the
  // current template. Only sections that have a match are selectable.
  type Candidate = {
    masterSection: TemplateSection;
    currentMatch: TemplateSection | null;
    matchReason: "source+package" | "source" | "title" | "new";
  };

  const candidates: Candidate[] = React.useMemo(() => {
    return masterMeta.sections.map((ms) => {
      const { match, reason } = findMatchingSection(ms, currentMeta.sections);
      return { masterSection: ms, currentMatch: match, matchReason: reason };
    });
  }, [masterMeta.sections, currentMeta.sections]);

  // Reset selections on open so stale state doesn't persist across template edits.
  React.useEffect(() => {
    if (open) {
      setSelectedProps(new Set(DEFAULT_PROPERTIES));
      // Pre-select only sections that already exist in the current template
      // (matching ones). "new" sections start unselected — admin must opt in.
      setSelectedSections(
        new Set(
          candidates
            .filter((c) => c.currentMatch !== null)
            .map((c) => c.masterSection.id),
        ),
      );
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const allMatchedSelected =
    candidates
      .filter((c) => c.currentMatch !== null)
      .every((c) => selectedSections.has(c.masterSection.id));

  function toggleSection(id: string) {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(check: boolean) {
    setSelectedSections(
      check
        ? new Set(candidates.filter((c) => c.currentMatch).map((c) => c.masterSection.id))
        : new Set(),
    );
  }

  function toggleProp(p: CopyableProperty, on: boolean) {
    setSelectedProps((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });
  }

  function applySync() {
    if (selectedSections.size === 0 || selectedProps.size === 0) return;

    // Restrict the master to only the sections the admin selected, then defer
    // to the shared merger so this dialog and the global "Sync All from Master"
    // broadcast share one canonical implementation.
    const filteredMaster: DocumentTemplateMeta = {
      ...masterMeta,
      sections: masterMeta.sections.filter((s) => selectedSections.has(s.id)),
    };
    const { meta: nextMeta } = mergeSectionsFromMaster(currentMeta, filteredMaster, {
      properties: selectedProps,
      appendNewSections: true,
    });

    onSync(nextMeta);
    onOpenChange(false);
  }

  const hasMatched = candidates.some((c) => c.currentMatch !== null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-yellow-500" />
            Sync sections from Master
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Note about what is NOT synced */}
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
            Only <strong>sections</strong> are synced. Your template's own
            <strong> header</strong> (title, subtitle, date/policy toggles),{" "}
            <strong>type</strong>, <strong>flows</strong>, and all other
            per-document settings are never touched.
            Synced changes apply to in-memory state only —{" "}
            <strong>click Save afterwards</strong> to persist.
          </div>

          {/* Property picker */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              What to copy per section
            </Label>
            <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {(Object.keys(PROPERTY_LABELS) as CopyableProperty[]).map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-neutral-200 hover:bg-neutral-50 dark:hover:border-neutral-700 dark:hover:bg-neutral-900 cursor-pointer"
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

          {/* Section picker */}
          <div>
            <div className="mb-1.5 flex items-end justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Which master sections to pull
              </Label>
              {hasMatched && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => toggleAll(!allMatchedSelected)}
                >
                  {allMatchedSelected ? "Clear matched" : "Select matched"}
                </Button>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700">
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {candidates.map((c) => {
                  const id = c.masterSection.id;
                  const isNew = c.currentMatch === null;
                  return (
                    <li
                      key={id}
                      className="flex items-start gap-2 px-3 py-2 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    >
                      <Checkbox
                        checked={selectedSections.has(id)}
                        onChange={() => toggleSection(id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-neutral-800 dark:text-neutral-100">
                            {c.masterSection.title || "(untitled)"}
                          </span>
                          {isNew && (
                            <span className="shrink-0 rounded bg-blue-100 px-1 py-0.5 text-[9px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              NEW — will be appended
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-neutral-500 dark:text-neutral-400">
                          <span className="font-mono">{c.masterSection.source}</span>
                          {c.masterSection.packageName && (
                            <> / <span className="font-mono">{c.masterSection.packageName}</span></>
                          )}
                          {" · "}
                          {c.masterSection.fields.length} field{c.masterSection.fields.length !== 1 ? "s" : ""}
                          {" · "}
                          {c.masterSection.columns === 2 ? "2 cols" : "1 col"}
                          {!isNew && (
                            <>
                              {" · "}
                              <span className="text-[10px] uppercase tracking-wide">
                                {c.matchReason === "source+package"
                                  ? "→ source + package match"
                                  : c.matchReason === "source"
                                    ? "→ source match"
                                    : "→ title match"}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={applySync}
            disabled={selectedSections.size === 0 || selectedProps.size === 0}
            className="gap-1.5"
          >
            <Loader2 className="hidden h-4 w-4 animate-spin" />
            Pull {selectedSections.size || ""} section
            {selectedSections.size === 1 ? "" : "s"} from Master
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
