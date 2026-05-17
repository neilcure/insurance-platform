/**
 * Recovery / setup script that does TWO things, idempotently:
 *
 *   1. ROLLS BACK an over-aggressive change a previous version of
 *      `apply-sum-premium-cover-gate.ts` wrote: it hid the
 *      "General Accounting" and "PD Accounting" groups whenever a
 *      policy had both `tpo` + `own_vehicle_damage`. That caused the
 *      whole Premium section to disappear on multi-cover policies
 *      because the Sum Premium fields weren't yet selected in any
 *      template. This script REMOVES those hide-rules so the
 *      per-cover rows render again.
 *
 *   2. ADDS the three "Sum Premium (TPO + PD)" field mappings to every
 *      template's Premium section so the Sum Premium group has actual
 *      content. The previously-installed SHOW-when rule
 *      (`groupCoverTypes["Sum Premium (TPO + PD)"] = ["tpo",
 *      "own_vehicle_damage"]`) keeps those rows hidden on
 *      single-cover policies, so the net effect is:
 *
 *        Single-cover (TPO only / Comprehensive only / Main only):
 *          → General Accounting (Net / Client / Agent Premium) shows.
 *          → Sum Premium rows hidden by SHOW-when gate.
 *
 *        Multi-cover (TPO + own_vehicle_damage):
 *          → General Accounting + PD Accounting still show (per-cover
 *            detail).
 *          → Sum Premium rows ALSO show (combined totals).
 *
 *      If the admin later wants to "swap" per-cover for a single Sum
 *      row on multi-cover, they can use the new "Hide when covers"
 *      input next to "Show when covers" in the admin editor.
 *
 * Run:
 *   npx tsx scripts/restore-sum-premium-fields.ts           # dry-run
 *   npx tsx scripts/restore-sum-premium-fields.ts --apply   # write
 */
import { db } from "../db/client";
import { formOptions } from "../db/schema/form_options";
import { and, eq } from "drizzle-orm";

const GROUP_NAME = "Sum Premium (TPO + PD)";
const HIDE_GROUPS_TO_ROLLBACK = ["General Accounting", "PD Accounting"];

// Sum Premium field templates — values mirrored from the live
// `premiumRecord_fields` rows so the document matches what admins
// configured in the package editor.
const SUM_PREMIUM_FIELDS: Array<{
  key: string;
  label: string;
  format: "currency";
  currencyCode: string;
  group: string;
}> = [
  { key: "sumPremiumNet", label: "Sum Premium Net", format: "currency", currencyCode: "HKD", group: GROUP_NAME },
  { key: "sumAgentPreNet", label: "Sum Agent Premium Net", format: "currency", currencyCode: "HKD", group: GROUP_NAME },
  { key: "sumClientPre", label: "Sum Client Premium", format: "currency", currencyCode: "HKD", group: GROUP_NAME },
];

type FieldRef = {
  key?: string;
  label?: string;
  format?: string;
  currencyCode?: string;
  group?: string;
  [k: string]: unknown;
};

type DocSection = {
  id: string;
  title?: string;
  source?: string;
  packageName?: string;
  groupCoverTypes?: Record<string, string[]>;
  groupHideCoverTypes?: Record<string, string[]>;
  fields?: FieldRef[];
  [k: string]: unknown;
};

type DocMeta = {
  sections?: DocSection[];
  [k: string]: unknown;
};

function isPremiumSection(s: DocSection): boolean {
  return s.source === "package" && s.packageName === "premiumRecord";
}

function rollbackHideRules(section: DocSection): { section: DocSection; changed: boolean } {
  if (!section.groupHideCoverTypes) return { section, changed: false };
  const next: Record<string, string[]> = { ...section.groupHideCoverTypes };
  let changed = false;
  for (const g of HIDE_GROUPS_TO_ROLLBACK) {
    if (g in next) {
      delete next[g];
      changed = true;
    }
  }
  if (!changed) return { section, changed: false };
  return {
    section: {
      ...section,
      groupHideCoverTypes: Object.keys(next).length > 0 ? next : undefined,
    },
    changed: true,
  };
}

function addSumPremiumFields(section: DocSection): { section: DocSection; addedKeys: string[] } {
  const fields = Array.isArray(section.fields) ? [...section.fields] : [];
  const seen = new Set(fields.map((f) => String(f.key ?? "")));
  const addedKeys: string[] = [];
  for (const def of SUM_PREMIUM_FIELDS) {
    if (seen.has(def.key)) continue;
    fields.push({ ...def });
    addedKeys.push(def.key);
  }
  if (addedKeys.length === 0) return { section, addedKeys };
  return { section: { ...section, fields }, addedKeys };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  console.log(`Mode: ${dryRun ? "DRY-RUN (no DB write)" : "APPLY (writing changes)"}`);
  console.log(`Rollback HIDE rules on: ${HIDE_GROUPS_TO_ROLLBACK.map((g) => `"${g}"`).join(", ")}`);
  console.log(`Add Sum Premium fields: [${SUM_PREMIUM_FIELDS.map((f) => f.key).join(", ")}]\n`);

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
  let noPremium = 0;

  for (const r of rows) {
    const meta = (r.meta ?? {}) as DocMeta;
    const sections: DocSection[] = Array.isArray(meta.sections) ? meta.sections : [];
    if (sections.length === 0) {
      noPremium += 1;
      continue;
    }

    let templateChanged = false;
    const newSections = sections.map((s) => {
      if (!isPremiumSection(s)) return s;
      const r1 = rollbackHideRules(s);
      const r2 = addSumPremiumFields(r1.section);
      if (r1.changed || r2.addedKeys.length > 0) {
        templateChanged = true;
        return r2.section;
      }
      return s;
    });

    if (!templateChanged) {
      unchanged += 1;
      continue;
    }

    const newMeta: DocMeta = { ...meta, sections: newSections };
    console.log(`✓ ${r.label} (id=${r.id}, value="${r.value}")`);
    for (const s of newSections) {
      if (!isPremiumSection(s)) continue;
      const hide = s.groupHideCoverTypes ?? {};
      const show = s.groupCoverTypes?.[GROUP_NAME] ?? [];
      const sumKeys = (s.fields ?? [])
        .filter((f) => SUM_PREMIUM_FIELDS.some((d) => d.key === f.key))
        .map((f) => f.key);
      console.log(
        `    section "${s.title ?? s.id}": SHOW "${GROUP_NAME}" when [${show.join(", ")}]`,
      );
      console.log(
        `    section "${s.title ?? s.id}": HIDE rules now -> ${Object.keys(hide).length === 0 ? "(none)" : JSON.stringify(hide)}`,
      );
      console.log(
        `    section "${s.title ?? s.id}": Sum Premium fields present -> [${sumKeys.join(", ")}]`,
      );
    }

    if (!dryRun) {
      await db
        .update(formOptions)
        .set({ meta: newMeta as unknown as Record<string, unknown> })
        .where(eq(formOptions.id, r.id));
    }
    updated += 1;
  }

  console.log("");
  console.log(`Done. ${updated} template(s) ${dryRun ? "would be" : "were"} updated. ${unchanged} already in sync. ${noPremium} skipped (no sections).`);
  if (dryRun) {
    console.log("");
    console.log("Re-run with --apply to actually write the change:");
    console.log("  npx tsx scripts/restore-sum-premium-fields.ts --apply");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
