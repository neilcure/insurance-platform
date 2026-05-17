/**
 * Apply cover-types gates to every document template's Premium section
 * so:
 *
 *   - "Sum Premium (TPO + PD)" group renders ONLY when the policy has
 *     BOTH `tpo` AND `own_vehicle_damage` cover lines (multi-cover).
 *   - "General Accounting" group is HIDDEN on multi-cover policies
 *     (the combined Sum Premium row replaces the per-cover values).
 *   - "PD Accounting" group is HIDDEN on multi-cover policies (same
 *     reason — the sum already covers it).
 *
 * Net effect:
 *
 *   Single-cover (TPO only / Comprehensive only / Main only):
 *     → General Accounting visible, PD Accounting hidden anyway (no
 *       PD line), Sum Premium hidden.
 *   Multi-cover (TPO + own_vehicle_damage):
 *     → General Accounting hidden, PD Accounting hidden, Sum Premium
 *       visible.
 *
 * Idempotent — safe to re-run.
 *
 * Run:
 *   npx tsx scripts/apply-sum-premium-cover-gate.ts             # dry-run
 *   npx tsx scripts/apply-sum-premium-cover-gate.ts --apply     # write
 */
import { db } from "../db/client";
import { formOptions } from "../db/schema/form_options";
import { and, eq } from "drizzle-orm";

const SHOW_GROUP_NAME = "Sum Premium (TPO + PD)";
const SHOW_REQUIRED_KEYS = ["tpo", "own_vehicle_damage"];
const HIDE_ON_MULTICOVER = ["tpo", "own_vehicle_damage"];
const HIDE_GROUPS = ["General Accounting", "PD Accounting"];

type DocSection = {
  id: string;
  title?: string;
  source?: string;
  packageName?: string;
  groupCoverTypes?: Record<string, string[]>;
  groupHideCoverTypes?: Record<string, string[]>;
  fields?: Array<{ key?: string; label?: string; group?: string }>;
  [k: string]: unknown;
};

type DocMeta = {
  sections?: DocSection[];
  [k: string]: unknown;
};

function isPremiumSection(s: DocSection): boolean {
  return s.source === "package" && s.packageName === "premiumRecord";
}

function sameKeys(a: string[] | undefined, b: string[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  return [...a].sort().join(",") === [...b].sort().join(",");
}

function applyGate(section: DocSection): { section: DocSection; changed: boolean } {
  let changed = false;

  // 1) SHOW-when rule for "Sum Premium (TPO + PD)"
  const showMap: Record<string, string[]> = { ...(section.groupCoverTypes ?? {}) };
  if (!sameKeys(showMap[SHOW_GROUP_NAME], SHOW_REQUIRED_KEYS)) {
    showMap[SHOW_GROUP_NAME] = [...SHOW_REQUIRED_KEYS];
    changed = true;
  }

  // 2) HIDE-when rule for General Accounting + PD Accounting
  const hideMap: Record<string, string[]> = { ...(section.groupHideCoverTypes ?? {}) };
  for (const g of HIDE_GROUPS) {
    if (!sameKeys(hideMap[g], HIDE_ON_MULTICOVER)) {
      hideMap[g] = [...HIDE_ON_MULTICOVER];
      changed = true;
    }
  }

  if (!changed) return { section, changed: false };

  return {
    section: {
      ...section,
      groupCoverTypes: Object.keys(showMap).length > 0 ? showMap : undefined,
      groupHideCoverTypes: Object.keys(hideMap).length > 0 ? hideMap : undefined,
    },
    changed: true,
  };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  console.log(`Mode: ${dryRun ? "DRY-RUN (no DB write)" : "APPLY (writing changes)"}`);
  console.log(`SHOW "${SHOW_GROUP_NAME}" only when policy has: [${SHOW_REQUIRED_KEYS.join(", ")}]`);
  console.log(`HIDE ${HIDE_GROUPS.map((g) => `"${g}"`).join(", ")} when policy has: [${HIDE_ON_MULTICOVER.join(", ")}]\n`);

  const rows = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.groupKey, "document_templates"),
        eq(formOptions.isActive, true),
      ),
    );

  let touched = 0;
  let unchanged = 0;

  for (const r of rows) {
    const meta = ((r.meta as DocMeta | null) ?? {}) as DocMeta;
    const sections = Array.isArray(meta.sections) ? meta.sections : [];
    let templateChanged = false;
    const newSections = sections.map((s) => {
      if (!isPremiumSection(s)) return s;
      const { section: patched, changed } = applyGate(s);
      if (changed) templateChanged = true;
      return patched;
    });

    if (!templateChanged) {
      unchanged += 1;
      continue;
    }

    const newMeta: DocMeta = { ...meta, sections: newSections };
    console.log(`✓ ${r.label} (id=${r.id}, value="${r.value}")`);
    for (const s of newSections) {
      if (!isPremiumSection(s)) continue;
      const show = s.groupCoverTypes?.[SHOW_GROUP_NAME] ?? [];
      console.log(
        `    section "${s.title ?? s.id}": SHOW "${SHOW_GROUP_NAME}" when [${show.join(", ")}]`,
      );
      for (const g of HIDE_GROUPS) {
        const hide = s.groupHideCoverTypes?.[g] ?? [];
        console.log(`    section "${s.title ?? s.id}": HIDE "${g}" when [${hide.join(", ")}]`);
      }
    }

    if (!dryRun) {
      await db
        .update(formOptions)
        .set({ meta: newMeta as unknown as Record<string, unknown> })
        .where(eq(formOptions.id, r.id));
    }
    touched += 1;
  }

  console.log(
    `\nDone. ${touched} template(s) ${dryRun ? "would be" : "were"} updated. ${unchanged} already had the gate.`,
  );
  if (dryRun && touched > 0) {
    console.log(
      `Re-run with --apply to actually write the change:\n  npx tsx scripts/apply-sum-premium-cover-gate.ts --apply`,
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
