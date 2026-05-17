/**
 * Strong cleanup pass for legacy `groupCoverTypes` /
 * `groupHideCoverTypes` (and section-level mirrors) on every active
 * document template.
 *
 * For each section with any legacy gate:
 *
 *   1. Re-derive the equivalent `groupCoverCategories` (slug-based)
 *      gate using the same rules as the original migration:
 *        - SHOW=[tpo, own_vehicle_damage] => categories whose
 *          `accountingLines` EQUALS that set => [tpo_with_od].
 *        - HIDE=[tpo, own_vehicle_damage] alone => categories whose
 *          line-keys are NOT a superset => [tpo, comp].
 *   2. STRIP the legacy `groupCoverTypes` / `groupHideCoverTypes`
 *      (and section mirrors) — they're confusing in the editor (UI
 *      says "Show on: all policies" but legacy hide rules silently
 *      override) and the renderer now ignores them whenever a
 *      category rule is set for the same group.
 *   3. Preserve any existing `groupCoverCategories` admin-set rule.
 *
 * Idempotent — safe to re-run. Drops the legacy keys completely so
 * the editor UI and renderer behaviour are always aligned with the
 * `groupCoverCategories` state.
 *
 * Run:
 *   npx tsx scripts/cleanup-legacy-cover-rules.ts             # dry-run
 *   npx tsx scripts/cleanup-legacy-cover-rules.ts --apply     # write
 */
import { db } from "../db/client";
import { formOptions } from "../db/schema/form_options";
import { and, eq } from "drizzle-orm";

type DocSection = {
  id: string;
  title?: string;
  source?: string;
  packageName?: string;
  groupCoverTypes?: Record<string, string[]>;
  groupHideCoverTypes?: Record<string, string[]>;
  groupCoverCategories?: Record<string, string[]>;
  sectionCoverTypes?: string[];
  sectionHideCoverTypes?: string[];
  sectionCoverCategories?: string[];
  [k: string]: unknown;
};

type DocMeta = {
  sections?: DocSection[];
  [k: string]: unknown;
};

type CategoryRow = {
  value: string;
  label: string;
  lineKeys: string[];
};

function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

function isSubset(sub: string[], full: string[]): boolean {
  const set = new Set(full);
  return sub.every((x) => set.has(x));
}

function resolveCategories(
  showKeys: string[] | undefined,
  hideKeys: string[] | undefined,
  categories: CategoryRow[],
): { slugs: string[]; reason: string } {
  const showSet = (showKeys ?? []).map((k) => k.toLowerCase());
  const hideSet = (hideKeys ?? []).map((k) => k.toLowerCase());
  if (showSet.length === 0 && hideSet.length === 0) {
    return { slugs: [], reason: "no-legacy-rule" };
  }
  if (showSet.length > 0) {
    const matched = categories
      .filter((c) => setEqual(c.lineKeys, showSet))
      .map((c) => c.value);
    return { slugs: matched, reason: `show=[${showSet.join(",")}]` };
  }
  const matched = categories
    .filter((c) => !isSubset(hideSet, c.lineKeys))
    .map((c) => c.value);
  return { slugs: matched, reason: `hide=[${hideSet.join(",")}]` };
}

async function loadCategories(): Promise<CategoryRow[]> {
  const rows = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.groupKey, "policy_category"),
        eq(formOptions.isActive, true),
      ),
    );
  const out: CategoryRow[] = [];
  for (const r of rows) {
    const meta = (r.meta ?? {}) as { accountingLines?: { key?: string }[] };
    const lines = Array.isArray(meta.accountingLines) ? meta.accountingLines : [];
    const keys = lines
      .map((l) => String(l?.key ?? "").toLowerCase())
      .filter(Boolean);
    out.push({
      value: String(r.value ?? "").toLowerCase(),
      label: r.label ?? "",
      lineKeys: keys,
    });
  }
  return out;
}

function cleanupSection(
  section: DocSection,
  categories: CategoryRow[],
): { section: DocSection; changed: boolean; log: string[] } {
  const log: string[] = [];
  const oldShow = section.groupCoverTypes ?? {};
  const oldHide = section.groupHideCoverTypes ?? {};
  const existingCats = section.groupCoverCategories ?? {};

  const groupNames = new Set<string>([
    ...Object.keys(oldShow),
    ...Object.keys(oldHide),
    ...Object.keys(existingCats),
  ]);

  // Section-level cleanup mirrors the group-level rule.
  const sectionLegacyShow = section.sectionCoverTypes;
  const sectionLegacyHide = section.sectionHideCoverTypes;
  const sectionCats = section.sectionCoverCategories;

  let changed = false;
  const newCats: Record<string, string[]> = { ...existingCats };

  for (const g of groupNames) {
    const hasNew = Array.isArray(newCats[g]) && newCats[g].length > 0;
    if (hasNew) {
      // Admin already configured the new picker — keep it as-is, just
      // make sure the legacy entries are gone.
      if (g in oldShow || g in oldHide) {
        log.push(`    group "${g}": keep existing category=[${newCats[g].join(",")}], strip legacy`);
        changed = true;
      }
      continue;
    }
    // No new rule — derive one from the legacy.
    const { slugs, reason } = resolveCategories(oldShow[g], oldHide[g], categories);
    if (slugs.length === 0) {
      // Couldn't derive — strip legacy but don't synthesise a rule
      // (renderer falls back to "always show").
      if (g in oldShow || g in oldHide) {
        log.push(`    group "${g}": legacy=${reason} but no category match -> strip legacy, no gate`);
        changed = true;
      }
      continue;
    }
    const isUniversal = slugs.length === categories.length;
    if (isUniversal) {
      // The rule applies to every category — drop entirely (universal = no gate).
      log.push(`    group "${g}": ${reason} resolves to ALL categories -> drop`);
      changed = true;
      continue;
    }
    newCats[g] = slugs;
    log.push(`    group "${g}": ${reason} -> category=[${slugs.join(",")}]`);
    changed = true;
  }

  let sectionChanged = false;
  let nextSectionCats = sectionCats;
  if (sectionLegacyShow !== undefined || sectionLegacyHide !== undefined) {
    if (!sectionCats || sectionCats.length === 0) {
      const { slugs, reason } = resolveCategories(sectionLegacyShow, sectionLegacyHide, categories);
      if (slugs.length > 0 && slugs.length < categories.length) {
        nextSectionCats = slugs;
        log.push(`    section: ${reason} -> sectionCoverCategories=[${slugs.join(",")}]`);
      } else {
        log.push(`    section: ${reason} -> no gate`);
      }
    }
    sectionChanged = true;
  }

  if (!changed && !sectionChanged) return { section, changed: false, log };

  return {
    section: {
      ...section,
      // Always strip legacy on output.
      groupCoverTypes: undefined,
      groupHideCoverTypes: undefined,
      sectionCoverTypes: undefined,
      sectionHideCoverTypes: undefined,
      groupCoverCategories: Object.keys(newCats).length > 0 ? newCats : undefined,
      sectionCoverCategories: nextSectionCats && nextSectionCats.length > 0 ? nextSectionCats : undefined,
    },
    changed: true,
    log,
  };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  console.log(`Mode: ${dryRun ? "DRY-RUN (no DB write)" : "APPLY (writing changes)"}\n`);

  const categories = await loadCategories();
  console.log("Loaded policy categories:");
  for (const c of categories) {
    console.log(`  - ${c.value} (${c.label}) -> lines [${c.lineKeys.join(", ")}]`);
  }
  console.log("");

  const rows = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.groupKey, "document_templates"),
        eq(formOptions.isActive, true),
      ),
    );

  let updated = 0;
  let unchanged = 0;

  for (const r of rows) {
    const meta = (r.meta ?? {}) as DocMeta;
    const sections: DocSection[] = Array.isArray(meta.sections) ? meta.sections : [];
    if (sections.length === 0) {
      unchanged += 1;
      continue;
    }

    let templateChanged = false;
    const templateLog: string[] = [];
    const newSections = sections.map((s) => {
      const result = cleanupSection(s, categories);
      if (result.changed) {
        templateChanged = true;
        templateLog.push(`  section "${s.title ?? s.id}" (${s.source}/${s.packageName ?? "-"}):`);
        templateLog.push(...result.log);
        return result.section;
      }
      return s;
    });

    if (!templateChanged) {
      unchanged += 1;
      continue;
    }

    console.log(`✓ ${r.label} (id=${r.id}, value="${r.value}")`);
    for (const line of templateLog) console.log(line);

    if (!dryRun) {
      const newMeta = { ...meta, sections: newSections };
      await db
        .update(formOptions)
        .set({ meta: newMeta as unknown as Record<string, unknown> })
        .where(eq(formOptions.id, r.id));
    }
    updated += 1;
  }

  console.log("");
  console.log(`Done. ${updated} template(s) ${dryRun ? "would be" : "were"} updated. ${unchanged} unchanged.`);
  if (dryRun) {
    console.log("");
    console.log("Re-run with --apply to actually write the change:");
    console.log("  npx tsx scripts/cleanup-legacy-cover-rules.ts --apply");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
