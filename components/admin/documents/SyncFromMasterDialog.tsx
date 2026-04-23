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
  assignMasterSectionsToTargets,
  mergeSectionsFromMaster,
  mergeStyleFromMaster,
  replaceSectionsFromMaster,
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
  // Style sync is separate from section sync — off by default so admins who
  // only want to pull section structure don't accidentally overwrite their
  // per-template font sizes or colors.
  const [syncStyle, setSyncStyle] = React.useState(false);
  // "mirror" : full replace — target's sections are rebuilt to match master
  //            exactly (same order, same titles, same fields). Sections that
  //            exist in the target but not in master are dropped. This is the
  //            DEFAULT because "Sync from Master" naturally reads as "make me
  //            look like Master" — admins who clicked it without thinking too
  //            hard expect duplicates to disappear and order to follow master.
  // "merge"  : opt-in selective sync, the legacy behaviour. Admin picks which
  //            master sections to pull and which properties to copy. Sections
  //            present in the target but not in master are left untouched.
  //            Use when you only want to refresh a few fields without
  //            reorganising the template structure.
  const [mode, setMode] = React.useState<"merge" | "mirror">("mirror");

  // Compute the candidate master sections together with their match in the
  // current template. Only sections that have a match are selectable.
  type Candidate = {
    masterSection: TemplateSection;
    currentMatch: TemplateSection | null;
    matchReason: "source+package" | "source" | "title" | "new";
  };

  const candidates: Candidate[] = React.useMemo(() => {
    // Use the same collision-free assignment that the actual sync uses, so
    // the preview list matches the real outcome 1:1. Without this the dialog
    // would show one match while the merger picked a different one (e.g.
    // when the master has multiple sections sharing source+packageName but
    // the target has a section title that disambiguates them).
    const assignments = assignMasterSectionsToTargets(
      masterMeta.sections,
      currentMeta.sections,
    );
    return assignments.map((a) => ({
      masterSection: a.masterSection,
      currentMatch: a.targetSection,
      matchReason: a.reason,
    }));
  }, [masterMeta.sections, currentMeta.sections]);

  // Reset selections on open so stale state doesn't persist across template edits.
  React.useEffect(() => {
    if (open) {
      setSelectedProps(new Set(DEFAULT_PROPERTIES));
      setSyncStyle(false);
      setMode("mirror");
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

  // Mirror-mode preview — computed from the SAME assignment logic the actual
  // replace uses, so what the admin sees is what they'll get after Apply.
  const mirrorPreview = React.useMemo(() => {
    const matchedTargetIds = new Set(
      candidates
        .filter((c) => c.currentMatch)
        .map((c) => c.currentMatch!.id),
    );
    const willAdd = candidates
      .filter((c) => !c.currentMatch)
      .map((c) => c.masterSection.title || "(untitled)");
    const willRemove = currentMeta.sections
      .filter((cs) => !matchedTargetIds.has(cs.id))
      .map((cs) => cs.title || "(untitled)");
    const willKeep = candidates
      .filter((c) => c.currentMatch)
      .map((c) => ({
        masterTitle: c.masterSection.title || "(untitled)",
        targetTitle: c.currentMatch!.title || "(untitled)",
      }));
    return { willAdd, willRemove, willKeep };
  }, [candidates, currentMeta.sections]);

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
    let nextMeta = currentMeta;

    if (mode === "mirror") {
      // Full replace — sections are rebuilt to mirror master exactly. Matched
      // target sections keep their id so any references survive the rebuild.
      ({ meta: nextMeta } = replaceSectionsFromMaster(nextMeta, masterMeta));
    } else {
      if (selectedSections.size === 0 && !syncStyle) return;
      // Selective merge — admin's chosen master sections + chosen properties.
      if (selectedSections.size > 0 && selectedProps.size > 0) {
        const filteredMaster: DocumentTemplateMeta = {
          ...masterMeta,
          sections: masterMeta.sections.filter((s) => selectedSections.has(s.id)),
        };
        ({ meta: nextMeta } = mergeSectionsFromMaster(nextMeta, filteredMaster, {
          properties: selectedProps,
          appendNewSections: true,
        }));
      }
    }

    // Style sync is independent of section sync mode.
    // title + subtitle are always preserved from the current template.
    if (syncStyle) {
      nextMeta = mergeStyleFromMaster(nextMeta, masterMeta);
    }

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
            Synced changes apply to in-memory state only —{" "}
            <strong>click Save afterwards</strong> to persist.
            Your template&apos;s <strong>type</strong>, <strong>flows</strong>, and
            all other per-document settings are never touched.
            When style is synced, <strong>title</strong> and <strong>subtitle</strong>{" "}
            text are always kept from <em>this</em> template — only display settings
            (font sizes, colors, spacing, footer) are copied.
          </div>

          {/* Mode picker — Mirror Master (default) vs Selective merge */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Sync mode
            </Label>
            <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-md border-2 px-3 py-2 text-xs transition-colors ${
                  mode === "mirror"
                    ? "border-amber-500 bg-amber-50 ring-2 ring-amber-200 dark:border-amber-600 dark:bg-amber-950/30 dark:ring-amber-900/40"
                    : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                }`}
              >
                <input
                  type="radio"
                  name="sync-mode"
                  value="mirror"
                  checked={mode === "mirror"}
                  onChange={() => setMode("mirror")}
                  className="mt-0.5 accent-amber-600"
                />
                <span>
                  <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                    Mirror Master exactly
                  </span>
                  <span className="ml-1 rounded bg-amber-200 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-900 dark:bg-amber-800/40 dark:text-amber-200">
                    Recommended
                  </span>
                  <span className="mt-0.5 block text-neutral-600 dark:text-neutral-400">
                    Rebuild sections 1:1 with Master — same order, same titles.
                    Duplicates and sections not in Master are <strong>removed</strong>.
                  </span>
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-md border-2 px-3 py-2 text-xs transition-colors ${
                  mode === "merge"
                    ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200 dark:border-blue-600 dark:bg-blue-950/30 dark:ring-blue-900/40"
                    : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                }`}
              >
                <input
                  type="radio"
                  name="sync-mode"
                  value="merge"
                  checked={mode === "merge"}
                  onChange={() => setMode("merge")}
                  className="mt-0.5 accent-blue-600"
                />
                <span>
                  <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                    Selective merge
                  </span>
                  <span className="mt-0.5 block text-neutral-600 dark:text-neutral-400">
                    Pick sections + properties to copy. Your existing extras
                    and ordering are kept untouched.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Style sync toggle — independent of section sync */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Style settings
            </Label>
            <label className="mt-1.5 flex cursor-pointer items-start gap-2 rounded-md border border-transparent px-2 py-2 text-xs hover:border-neutral-200 hover:bg-neutral-50 dark:hover:border-neutral-700 dark:hover:bg-neutral-900">
              <Checkbox
                checked={syncStyle}
                onChange={(e) => setSyncStyle(e.currentTarget.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-neutral-800 dark:text-neutral-100">
                  Copy layout &amp; style from Master
                </span>
                <span className="ml-1 text-neutral-500">
                  — spacing, font sizes, label/value colors, footer text &amp; signature, header display settings.
                  <strong className="text-neutral-700 dark:text-neutral-300"> Title and subtitle text are always kept from this template.</strong>
                </span>
              </span>
            </label>
          </div>

          {/* Mirror-mode preview — shows what will change so admins aren't surprised */}
          {mode === "mirror" && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Preview of changes
              </Label>
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700 dark:bg-amber-950/20">
                {mirrorPreview.willRemove.length > 0 && (
                  <div>
                    <div className="font-semibold text-red-700 dark:text-red-400">
                      Will be REMOVED ({mirrorPreview.willRemove.length})
                    </div>
                    <ul className="mt-0.5 list-disc pl-5 text-neutral-700 dark:text-neutral-300">
                      {mirrorPreview.willRemove.map((t, i) => (
                        <li key={`rm-${i}`}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {mirrorPreview.willAdd.length > 0 && (
                  <div>
                    <div className="font-semibold text-blue-700 dark:text-blue-400">
                      Will be ADDED ({mirrorPreview.willAdd.length})
                    </div>
                    <ul className="mt-0.5 list-disc pl-5 text-neutral-700 dark:text-neutral-300">
                      {mirrorPreview.willAdd.map((t, i) => (
                        <li key={`add-${i}`}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {mirrorPreview.willKeep.length > 0 && (
                  <div>
                    <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                      Will be UPDATED in place ({mirrorPreview.willKeep.length})
                    </div>
                    <ul className="mt-0.5 list-disc pl-5 text-neutral-700 dark:text-neutral-300">
                      {mirrorPreview.willKeep.map((p, i) => (
                        <li key={`keep-${i}`}>
                          {p.targetTitle === p.masterTitle ? (
                            p.masterTitle
                          ) : (
                            <>
                              <span className="line-through opacity-60">{p.targetTitle}</span>
                              {" → "}
                              <span className="font-medium">{p.masterTitle}</span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {mirrorPreview.willRemove.length === 0 &&
                  mirrorPreview.willAdd.length === 0 && (
                    <div className="text-neutral-600 dark:text-neutral-400">
                      Sections already mirror Master&apos;s structure — only their
                      fields, columns, layout, audience and titles will be refreshed.
                    </div>
                  )}
              </div>
            </div>
          )}

          {/* Section property picker + section picker — selective merge mode only */}
          {mode === "merge" && (<>
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
          </>)}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={applySync}
            disabled={
              mode === "mirror"
                ? candidates.length === 0
                : (selectedSections.size === 0 || selectedProps.size === 0) && !syncStyle
            }
            className="gap-1.5"
          >
            <Loader2 className="hidden h-4 w-4 animate-spin" />
            {mode === "mirror"
              ? `Mirror Master (${candidates.length} section${candidates.length === 1 ? "" : "s"})${syncStyle ? " + style" : ""}`
              : selectedSections.size > 0
                ? `Pull ${selectedSections.size} section${selectedSections.size === 1 ? "" : "s"}${syncStyle ? " + style" : ""} from Master`
                : syncStyle
                  ? "Copy style from Master"
                  : "Select sections or style"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
