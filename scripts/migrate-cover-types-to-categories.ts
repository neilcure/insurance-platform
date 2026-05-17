/**
 * Migrate document templates' legacy `groupCoverTypes` /
 * `groupHideCoverTypes` rules into the new admin-friendly
 * `groupCoverCategories` rule.
 *
 * The new field stores POLICY-CATEGORY SLUGS (one per option in the
 * Policy Category admin list — e.g. `tpo`, `comp`, `tpo_with_od`).
 * The renderer derives each policy's category from its line-key set
 * and shows the group only when the category is in the list.
 *
 * Conversion rules:
 *   - For each section that has BOTH a SHOW rule on group X AND a HIDE
 *     rule on the same group, we collapse them to a category list
 *     equal to: {categories whose accountingLines set EQUALS the SHOW
 *     keys}.
 *   - A SHOW rule alone -> same: {categories whose lines EQUAL the
 *     SHOW set}.
 *   - A HIDE rule alone -> {categories whose lines are NOT a superset
 *     of the HIDE set} — i.e. the policy types where the group should
 *     still appear.
 *   - Sum Premium (TPO + PD) gates on multi-cover policies, so it
 *     resolves to ["tpo_with_od"].
 *   - General Accounting / PD Accounting with a HIDE rule on
 *     [tpo, own_vehicle_damage] resolves to {tpo, comp} (the single-
 *     cover categories) — only those should show.
 *
 * The script also DROPS the legacy `groupCoverTypes` /
 * `groupHideCoverTypes` entries it converts, so the editor stops
 * showing stale rules. Anything it can't confidently convert is left
 * untouched and logged.
 *
 * Run:
 *   npx tsx scripts/migrate-cover-types-to-categories.ts             # dry-run
 *   npx tsx scripts/migrate-cover-types-to-categories.ts --apply     # write
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
  [k: string]: unknown;
};

type DocMeta = {
  sections?: DocSection[];
  [k: string]: unknown;
};

type CategoryRow = {
  value: string;
  label: string;
  lineKeys: string[]; // accountingLines[].key, lowercased
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

function resolveCategories(
  showKeys: string[] | undefined,
  hideKeys: string[] | undefined,
  categories: CategoryRow[],
): { slugs: string[]; reason: string } {
  const showSet = (showKeys ?? []).map((k) => k.toLowerCase());
  const hideSet = (hideKeys ?? []).map((k) => k.toLowerCase());

  // No legacy rule -> nothing to migrate.
  if (showSet.length === 0 && hideSet.length === 0) {
    return { slugs: [], reason: "no-legacy-rule" };
  }

  if (showSet.length > 0) {
    const matched = categories
      .filter((c) => setEqual(c.lineKeys, showSet))
      .map((c) => c.value);
    return {
      slugs: matched,
      reason: `show-equals-[${showSet.join(",")}]`,
    };
  }

  // HIDE-only: keep all categories whose line-keys are NOT a superset
  // of the HIDE set (= the group is shown on policies that don't
  // match the HIDE rule).
  const matched = categories
    .filter((c) => !isSubset(hideSet, c.lineKeys))
    .map((c) => c.value);
  return {
    slugs: matched,
    reason: `hide-[${hideSet.join(",")}]-keeps-non-superset`,
  };
}

function migrateSection(
  section: DocSection,
  categories: CategoryRow[],
): { section: DocSection; changed: boolean; log: string[] } {
  const log: string[] = [];
  const oldShow = section.groupCoverTypes ?? {};
  const oldHide = section.groupHideCoverTypes ?? {};

  const groupNames = new Set<string>([
    ...Object.keys(oldShow),
    ...Object.keys(oldHide),
  ]);
  if (groupNames.size === 0) return { section, changed: false, log };

  const newCats: Record<string, string[]> = { ...(section.groupCoverCategories ?? {}) };
  const newShow: Record<string, string[]> = { ...oldShow };
  const newHide: Record<string, string[]> = { ...oldHide };

  let changed = false;
  for (const g of groupNames) {
    const { slugs, reason } = resolveCategories(
      oldShow[g],
      oldHide[g],
      categories,
    );
    if (slugs.length === 0) {
      // Couldn't resolve confidently — leave the legacy rule alone.
      log.push(`    group "${g}": cannot map (${reason}); keeping legacy`);
      continue;
    }
    // If the new rule equals "every category" (i.e. no filtering),
    // drop it entirely — empty is the universal default.
    const isUniversal = slugs.length === categories.length;
    if (isUniversal) {
      delete newCats[g];
      log.push(`    group "${g}": resolves to all ${slugs.length} categories (no gate); clearing legacy`);
    } else {
      newCats[g] = slugs;
      log.push(`    group "${g}": ${reason} -> categories [${slugs.join(", ")}]`);
    }
    delete newShow[g];
    delete newHide[g];
    changed = true;
  }

  if (!changed) return { section, changed: false, log };

  return {
    section: {
      ...section,
      groupCoverTypes: Object.keys(newShow).length > 0 ? newShow : undefined,
      groupHideCoverTypes: Object.keys(newHide).length > 0 ? newHide : undefined,
      groupCoverCategories: Object.keys(newCats).length > 0 ? newCats : undefined,
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
      const result = migrateSection(s, categories);
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
    console.log("  npx tsx scripts/migrate-cover-types-to-categories.ts --apply");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
