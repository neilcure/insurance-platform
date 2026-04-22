import type {
  DocumentTemplateMeta,
  TemplateSection,
} from "@/lib/types/document-template";

/**
 * Properties of a section that can be copied from a Master template into
 * another template. `title` is opt-in because different document types
 * usually want different wording (e.g. "Vehicle Details" vs "Vehicle Info").
 */
export type CopyableSectionProperty =
  | "fields"
  | "columns"
  | "layout"
  | "audience"
  | "title";

export type SectionMatchReason =
  | "source+package"
  | "source"
  | "title"
  | "new";

export type SectionMatchResult = {
  match: TemplateSection | null;
  reason: SectionMatchReason;
};

/**
 * Finds the best matching section in `currentSections` for a given
 * `masterSection`. Match priority (strongest first):
 *
 *   1. Same source AND same packageName (only meaningful when both are package-based).
 *   2. Same non-package source (e.g. both `policy`, both `insured`).
 *   3. Same title (case-insensitive, trimmed).
 *
 * Returns the matched section and the reason for the match, or
 * `{ match: null, reason: "new" }` if nothing matched.
 *
 * Used by both:
 *   - `SyncFromMasterDialog` (interactive, per-template).
 *   - `syncAllFromMaster` broadcast (auto, all active templates).
 */
export function findMatchingSection(
  masterSection: TemplateSection,
  currentSections: TemplateSection[],
): SectionMatchResult {
  let bySource: TemplateSection | null = null;
  let byTitle: TemplateSection | null = null;
  const titleNorm = masterSection.title.trim().toLowerCase();

  for (const s of currentSections) {
    if (
      masterSection.source === "package" &&
      s.source === "package" &&
      s.packageName &&
      masterSection.packageName &&
      s.packageName === masterSection.packageName
    ) {
      return { match: s, reason: "source+package" };
    }
    if (
      !bySource &&
      masterSection.source !== "package" &&
      s.source === masterSection.source
    ) {
      bySource = s;
    }
    if (!byTitle && titleNorm && s.title.trim().toLowerCase() === titleNorm) {
      byTitle = s;
    }
  }
  if (bySource) return { match: bySource, reason: "source" };
  if (byTitle) return { match: byTitle, reason: "title" };
  return { match: null, reason: "new" };
}

export type MergeFromMasterOptions = {
  /** Which per-section properties to copy from master into the target. */
  properties: ReadonlySet<CopyableSectionProperty>;
  /**
   * If true, master sections that don't exist in the target template are
   * appended (with a fresh id). If false, only matched sections are touched
   * and unmatched master sections are ignored.
   */
  appendNewSections: boolean;
  /**
   * Optional: provide a custom id generator. Defaults to `crypto.randomUUID()`.
   * Tests / non-browser callers can inject their own.
   */
  generateId?: () => string;
};

export type SectionUpdateInfo = {
  /** Title of the master section that drove the update. */
  masterTitle: string;
  /** Title of the target section before the update. */
  targetTitle: string;
  /** How the master and target were matched. */
  reason: Exclude<SectionMatchReason, "new">;
};

export type SectionAppendInfo = {
  /** Title of the master section that was appended (no match in target). */
  masterTitle: string;
  /**
   * Why the master section had to be appended:
   *  - "no-match"   : nothing in target matched by source/packageName/title.
   *  - "collision"  : a different master section already claimed the matching
   *                   target, so this one was appended instead of being lost.
   */
  reason: "no-match" | "collision";
};

export type MergeFromMasterResult = {
  meta: DocumentTemplateMeta;
  /** How many existing sections were updated. */
  updatedCount: number;
  /** How many new sections were appended (0 when appendNewSections is false). */
  appendedCount: number;
  /** Per-section detail of every update applied to the target. */
  updated: SectionUpdateInfo[];
  /** Per-section detail of every section appended to the target. */
  appended: SectionAppendInfo[];
  /** Titles of target sections the master never mentioned (left untouched). */
  untouchedTargetTitles: string[];
};

/**
 * Returns a new `DocumentTemplateMeta` with sections merged from the master.
 * NEVER mutates the input metas.
 *
 * The current template's header, type, flows, and all per-document settings
 * are preserved unchanged — only `sections` is rebuilt.
 *
 * Section identity is preserved for matched sections (so existing references
 * by id elsewhere in the app keep working). Newly appended sections get a
 * fresh id.
 *
 * Multi-claim safety: if two master sections both match the SAME target
 * section, only the first one updates it. The runner-up is appended as a
 * new section instead of being silently dropped (provided
 * `appendNewSections` is true). This prevents data loss when, e.g., the
 * master has multiple "policy"-source sections but the target has only one.
 */
export function mergeSectionsFromMaster(
  currentMeta: DocumentTemplateMeta,
  masterMeta: DocumentTemplateMeta,
  options: MergeFromMasterOptions,
): MergeFromMasterResult {
  const { properties, appendNewSections } = options;
  const generateId = options.generateId ?? (() => crypto.randomUUID());

  // Pre-compute master->target matches once so each pass is O(N+M) instead of O(N*M).
  const masterMatches = masterMeta.sections.map((ms) => ({
    masterSection: ms,
    ...findMatchingSection(ms, currentMeta.sections),
  }));

  // First-claim-wins: walk masters in order. For each master that has a
  // match, only the first one to claim a given target id keeps the match;
  // later masters claiming the same target id get demoted to "no match",
  // which means they'll be appended (instead of silently lost).
  const claimedTargetIds = new Set<string>();
  const collisions = new Set<number>(); // indexes of masters that lost the race
  masterMatches.forEach((m, idx) => {
    if (!m.match) return;
    if (claimedTargetIds.has(m.match.id)) {
      collisions.add(idx);
    } else {
      claimedTargetIds.add(m.match.id);
    }
  });

  // Build target sections. Apply updates from the WINNING master for each id.
  let updatedCount = 0;
  const updated: SectionUpdateInfo[] = [];
  const newSections: TemplateSection[] = currentMeta.sections.map((cs) => {
    if (!claimedTargetIds.has(cs.id)) return cs;
    const winnerIdx = masterMatches.findIndex(
      (m, i) => m.match?.id === cs.id && !collisions.has(i),
    );
    if (winnerIdx < 0) return cs;
    const winner = masterMatches[winnerIdx];
    const ms = winner.masterSection;
    const next: TemplateSection = { ...cs };
    if (properties.has("fields")) next.fields = ms.fields.map((f) => ({ ...f }));
    if (properties.has("columns")) next.columns = ms.columns;
    if (properties.has("layout")) next.layout = ms.layout;
    if (properties.has("audience")) next.audience = ms.audience;
    if (properties.has("title")) next.title = ms.title;
    updatedCount += 1;
    updated.push({
      masterTitle: ms.title || "(untitled)",
      targetTitle: cs.title || "(untitled)",
      // `winner.reason` is one of source+package | source | title here
      // because we only entered this branch when there was a match.
      reason: winner.reason as SectionUpdateInfo["reason"],
    });
    return next;
  });

  // Append: anything with no match, plus collision losers (so nothing is lost).
  let appendedCount = 0;
  const appended: SectionAppendInfo[] = [];
  if (appendNewSections) {
    masterMatches.forEach((m, idx) => {
      const isUnmatched = m.match === null;
      const isCollision = collisions.has(idx);
      if (!isUnmatched && !isCollision) return;
      newSections.push({
        ...m.masterSection,
        id: generateId(),
        fields: m.masterSection.fields.map((f) => ({ ...f })),
      });
      appendedCount += 1;
      appended.push({
        masterTitle: m.masterSection.title || "(untitled)",
        reason: isCollision ? "collision" : "no-match",
      });
    });
  }

  const untouchedTargetTitles = currentMeta.sections
    .filter((cs) => !claimedTargetIds.has(cs.id))
    .map((cs) => cs.title || "(untitled)");

  return {
    meta: { ...currentMeta, sections: newSections },
    updatedCount,
    appendedCount,
    updated,
    appended,
    untouchedTargetTitles,
  };
}

/**
 * Default property set used by the global "Sync All from Master" broadcast.
 *
 * Copies structure (fields, columns, layout, audience) but preserves each
 * template's own section titles. This is the safest "unify the structure
 * but keep the wording" preset.
 */
export const BROADCAST_PROPERTIES: ReadonlySet<CopyableSectionProperty> =
  new Set<CopyableSectionProperty>(["fields", "columns", "layout", "audience"]);
