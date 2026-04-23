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
 * `masterSection` (single-master view, no collision awareness).
 *
 * Match priority (strongest first):
 *
 *   1. Same title (case-insensitive, trimmed) — TITLES ARE THE USER'S PRIMARY
 *      IDENTITY. Two sections both called "Excess" should match even when one
 *      is `package/policyinfo` and the other isn't.
 *   2. Same source AND same packageName (case-insensitive). Useful when titles
 *      diverge but the underlying data binding is identical.
 *   3. Same non-package source (e.g. both `policy`, both `insured`).
 *
 * Returns the matched section and the reason for the match, or
 * `{ match: null, reason: "new" }` if nothing matched.
 *
 * NOTE: This function is collision-blind — it picks the strongest match for
 * ONE master regardless of whether that target was already claimed by another
 * master. For the FULL multi-master assignment used by sync, see
 * `assignMasterSectionsToTargets` below, which guarantees no two masters
 * end up claiming the same target.
 */
export function findMatchingSection(
  masterSection: TemplateSection,
  currentSections: TemplateSection[],
): SectionMatchResult {
  let bySourcePackage: TemplateSection | null = null;
  let bySource: TemplateSection | null = null;
  const titleNorm = masterSection.title.trim().toLowerCase();
  const masterPkgNorm = masterSection.packageName?.trim().toLowerCase() ?? "";

  for (const s of currentSections) {
    // Title match (strongest) — bail immediately, can't beat this.
    if (titleNorm && s.title.trim().toLowerCase() === titleNorm) {
      return { match: s, reason: "title" };
    }
    if (
      !bySourcePackage &&
      masterSection.source === "package" &&
      s.source === "package" &&
      masterPkgNorm &&
      s.packageName?.trim().toLowerCase() === masterPkgNorm
    ) {
      bySourcePackage = s;
    }
    if (
      !bySource &&
      masterSection.source !== "package" &&
      s.source === masterSection.source
    ) {
      bySource = s;
    }
  }
  if (bySourcePackage) return { match: bySourcePackage, reason: "source+package" };
  if (bySource) return { match: bySource, reason: "source" };
  return { match: null, reason: "new" };
}

/**
 * Computes the FINAL master->target assignment for a sync, guaranteeing
 * that no two master sections ever claim the same target. This is the
 * collision-free version of `findMatchingSection` — use it whenever you're
 * matching a list of master sections at once (which is always, in practice).
 *
 * Multi-pass strategy (each pass only considers UNCLAIMED targets, masters
 * walked in their original order so the user's section ordering is honored):
 *
 *   Pass 1 — title match (case-insensitive). Highest signal: titles are what
 *            the admin sees in the UI and treats as identity. Both Master
 *            and Target call it "Excess" → it's the same section.
 *   Pass 2 — source + packageName match (case-insensitive). For sections
 *            that share a data binding but were renamed in one of the two
 *            templates.
 *   Pass 3 — source-only match (non-package sources only). Last-resort
 *            fallback for things like `insured` / `policy` where the source
 *            type is the identity.
 *
 * Anything still unmatched returns `{ targetSection: null, reason: "new" }`
 * — caller decides whether to append it or skip it.
 */
export type SectionAssignment = {
  masterSection: TemplateSection;
  targetSection: TemplateSection | null;
  reason: SectionMatchReason;
};

export function assignMasterSectionsToTargets(
  masterSections: TemplateSection[],
  targetSections: TemplateSection[],
): SectionAssignment[] {
  const assignments: SectionAssignment[] = masterSections.map((ms) => ({
    masterSection: ms,
    targetSection: null,
    reason: "new" as SectionMatchReason,
  }));
  const claimed = new Set<string>(); // target section ids already taken

  function tryAssign(
    predicate: (master: TemplateSection, target: TemplateSection) => boolean,
    reason: Exclude<SectionMatchReason, "new">,
  ) {
    for (const a of assignments) {
      if (a.targetSection) continue; // already matched in an earlier pass
      const found = targetSections.find(
        (t) => !claimed.has(t.id) && predicate(a.masterSection, t),
      );
      if (found) {
        a.targetSection = found;
        a.reason = reason;
        claimed.add(found.id);
      }
    }
  }

  // Pass 1: title (case-insensitive)
  tryAssign((m, t) => {
    const mn = m.title.trim().toLowerCase();
    if (!mn) return false;
    return t.title.trim().toLowerCase() === mn;
  }, "title");

  // Pass 2: source + packageName (case-insensitive)
  tryAssign((m, t) => {
    if (m.source !== "package" || t.source !== "package") return false;
    const mn = m.packageName?.trim().toLowerCase() ?? "";
    const tn = t.packageName?.trim().toLowerCase() ?? "";
    return mn.length > 0 && mn === tn;
  }, "source+package");

  // Pass 3: source-only (non-package only — package sections without a
  // package match are different things, don't lump them together)
  tryAssign((m, t) => {
    if (m.source === "package") return false;
    return m.source === t.source;
  }, "source");

  return assignments;
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

  // Use the collision-free multi-pass matcher so two masters never end up
  // claiming the same target. Title matches always win over source/package
  // matches, which is what you'd expect intuitively — see comments on
  // `assignMasterSectionsToTargets` for the full rationale.
  const assignments = assignMasterSectionsToTargets(
    masterMeta.sections,
    currentMeta.sections,
  );

  // Lookup: target id -> winning master (so we can patch in one pass).
  const targetIdToMaster = new Map<string, TemplateSection>();
  const updated: SectionUpdateInfo[] = [];
  for (const a of assignments) {
    if (!a.targetSection) continue;
    targetIdToMaster.set(a.targetSection.id, a.masterSection);
    updated.push({
      masterTitle: a.masterSection.title || "(untitled)",
      targetTitle: a.targetSection.title || "(untitled)",
      reason: a.reason as SectionUpdateInfo["reason"],
    });
  }

  // Build target sections in their original order, patching the matched ones.
  const newSections: TemplateSection[] = currentMeta.sections.map((cs) => {
    const ms = targetIdToMaster.get(cs.id);
    if (!ms) return cs;
    const next: TemplateSection = { ...cs };
    if (properties.has("fields")) next.fields = ms.fields.map((f) => ({ ...f }));
    if (properties.has("columns")) {
      // "Columns" is the umbrella for ALL column / grouping related layout
      // knobs so an admin who ticks the one checkbox gets a consistent
      // visual result, not a half-applied layout. Includes: section
      // default columns, group-blocks-per-row, group-header visibility
      // flags, per-group columns override and per-group full-width toggle.
      next.columns = ms.columns;
      next.fieldGroupColumns = ms.fieldGroupColumns;
      next.showFieldGroupHeaders = ms.showFieldGroupHeaders;
      next.hiddenGroupHeaders = ms.hiddenGroupHeaders ? [...ms.hiddenGroupHeaders] : undefined;
      next.groupColumns = ms.groupColumns ? { ...ms.groupColumns } : undefined;
      next.fullWidthGroups = ms.fullWidthGroups ? [...ms.fullWidthGroups] : undefined;
    }
    if (properties.has("layout")) next.layout = ms.layout;
    if (properties.has("audience")) next.audience = ms.audience;
    if (properties.has("title")) next.title = ms.title;
    return next;
  });
  const updatedCount = updated.length;

  // Append: anything that found no match in any pass.
  let appendedCount = 0;
  const appended: SectionAppendInfo[] = [];
  if (appendNewSections) {
    for (const a of assignments) {
      if (a.targetSection) continue;
      newSections.push({
        ...a.masterSection,
        id: generateId(),
        fields: a.masterSection.fields.map((f) => ({ ...f })),
      });
      appendedCount += 1;
      appended.push({
        masterTitle: a.masterSection.title || "(untitled)",
        reason: "no-match",
      });
    }
  }

  const claimedTargetIds = new Set<string>(targetIdToMaster.keys());
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

export type ReplaceFromMasterOptions = {
  /**
   * Optional: provide a custom id generator. Defaults to `crypto.randomUUID()`.
   * Tests / non-browser callers can inject their own.
   */
  generateId?: () => string;
};

export type ReplaceFromMasterResult = {
  meta: DocumentTemplateMeta;
  /** Master sections that re-used an existing target section's id (kept references). */
  reused: SectionUpdateInfo[];
  /** Master sections that were inserted fresh (no target counterpart). */
  added: { masterTitle: string }[];
  /** Target sections that were dropped because no master section matched them. */
  removedTargetTitles: string[];
};

/**
 * Rebuilds the target template's sections so they MIRROR the master exactly:
 *   - Same set of sections as Master.
 *   - Same ORDER as Master.
 *   - Every section's properties (title, fields, columns, layout, audience,
 *     group settings) are taken from Master.
 *   - Matched target sections KEEP their original id, so any references
 *     elsewhere in the template (e.g. flow/condition wiring) remain valid.
 *   - Unmatched master sections are inserted with a fresh id.
 *   - Target sections that no master section matched are DROPPED.
 *
 * Per-document settings outside `sections` (header text, type, flows, footer,
 * style, audience, etc.) are preserved unchanged. Use `mergeStyleFromMaster`
 * separately if you also want to copy the master's visual style.
 *
 * NEVER mutates the input metas.
 *
 * Use this when the admin wants "make my template look exactly like Master"
 * rather than the per-property selective merge in `mergeSectionsFromMaster`.
 */
export function replaceSectionsFromMaster(
  currentMeta: DocumentTemplateMeta,
  masterMeta: DocumentTemplateMeta,
  options: ReplaceFromMasterOptions = {},
): ReplaceFromMasterResult {
  const generateId = options.generateId ?? (() => crypto.randomUUID());

  const assignments = assignMasterSectionsToTargets(
    masterMeta.sections,
    currentMeta.sections,
  );

  const reused: SectionUpdateInfo[] = [];
  const added: { masterTitle: string }[] = [];
  const claimedTargetIds = new Set<string>();

  const newSections: TemplateSection[] = assignments.map((a) => {
    // Deep-ish clone of the master section so callers can mutate freely
    // without poisoning the master in memory.
    const cloned: TemplateSection = {
      ...a.masterSection,
      fields: a.masterSection.fields.map((f) => ({ ...f })),
      hiddenGroupHeaders: a.masterSection.hiddenGroupHeaders
        ? [...a.masterSection.hiddenGroupHeaders]
        : undefined,
      groupColumns: a.masterSection.groupColumns
        ? { ...a.masterSection.groupColumns }
        : undefined,
      fullWidthGroups: a.masterSection.fullWidthGroups
        ? [...a.masterSection.fullWidthGroups]
        : undefined,
    };
    if (a.targetSection) {
      // Preserve identity so any existing references survive the rebuild.
      cloned.id = a.targetSection.id;
      claimedTargetIds.add(a.targetSection.id);
      reused.push({
        masterTitle: a.masterSection.title || "(untitled)",
        targetTitle: a.targetSection.title || "(untitled)",
        reason: a.reason as SectionUpdateInfo["reason"],
      });
    } else {
      cloned.id = generateId();
      added.push({ masterTitle: a.masterSection.title || "(untitled)" });
    }
    return cloned;
  });

  const removedTargetTitles = currentMeta.sections
    .filter((cs) => !claimedTargetIds.has(cs.id))
    .map((cs) => cs.title || "(untitled)");

  return {
    meta: { ...currentMeta, sections: newSections },
    reused,
    added,
    removedTargetTitles,
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

/**
 * Merges the Master's **style** settings into a target `DocumentTemplateMeta`.
 *
 * Copied: `meta.layout` (section spacing, body font, label/value colors, title
 * sizes), `meta.footer` (footer text, signature lines), and the header *display*
 * settings (titleSize, subtitleSize, subtitleColor, showDate, showPolicyNumber).
 *
 * Intentionally NOT copied: `header.title` and `header.subtitle` — those are
 * the document name and tagline which every template customises for its own
 * type (e.g. "Invoice" vs "Quotation"). After a style sync the admin can still
 * freely edit those two fields on each template.
 *
 * NEVER mutates the input metas.
 */
export function mergeStyleFromMaster(
  currentMeta: DocumentTemplateMeta,
  masterMeta: DocumentTemplateMeta,
): DocumentTemplateMeta {
  return {
    ...currentMeta,
    // Copy layout block wholesale (or clear it if master has none).
    layout: masterMeta.layout ? { ...masterMeta.layout } : undefined,
    // Copy footer wholesale, preserving the text if master has none.
    footer: masterMeta.footer
      ? { ...masterMeta.footer }
      : currentMeta.footer,
    // Copy header display settings; keep title + subtitle from current template.
    // NOTE: the LOGO is intentionally NOT copied here. Each template can have
    // its own brand asset (e.g. a quotation might use a colour logo while a
    // statement uses a mono one), and copying file references silently across
    // templates is surprising. Admins who want to push the logo too can do
    // it via the explicit "Apply style to others" dialog if/when we add a
    // logo toggle there — for the implicit Sync from Master flow, leave it
    // alone.
    header: {
      // These two always come from the TARGET — never overwritten.
      title: currentMeta.header.title,
      subtitle: currentMeta.header.subtitle,
      // Logo also stays on the TARGET to avoid surprising file-asset swaps.
      logoStoredName: currentMeta.header.logoStoredName,
      logoSize: currentMeta.header.logoSize,
      logoPosition: currentMeta.header.logoPosition,
      // Everything else is a pure display/style knob — copy from master.
      titleSize: masterMeta.header.titleSize,
      subtitleSize: masterMeta.header.subtitleSize,
      subtitleColor: masterMeta.header.subtitleColor,
      showDate: masterMeta.header.showDate,
      showPolicyNumber: masterMeta.header.showPolicyNumber,
      documentNumberSize: masterMeta.header.documentNumberSize,
      documentNumberColor: masterMeta.header.documentNumberColor,
    },
  };
}
