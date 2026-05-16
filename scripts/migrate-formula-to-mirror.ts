/**
 * One-time migration: convert `inputType: "formula"` fields whose
 * formula is JUST a single-placeholder mirror (e.g. `{insured_idNumber}`,
 * `{Insured_insuredOccuption}`) to the new dedicated
 * `inputType: "mirror"` with explicit `meta.mirrorSource`.
 *
 * Why this exists
 * ---------------
 * The formula path was originally designed for math (`{a} + {b}`,
 * `YEARS_BETWEEN(...)`) and inherits all the arithmetic-mode edge
 * cases that caused the driver Occupation to show stale single-letter
 * values. The `mirror` input type strips all of that — pick source
 * package + field, render read-only, done.
 *
 * Pattern matched
 * ---------------
 *   ^\s*\{[a-zA-Z][a-zA-Z0-9]*[_]{1,2}[a-zA-Z0-9_]+\}\s*$
 *
 * i.e. the formula trims to exactly one `{pkg_field}` / `{pkg__field}`
 * placeholder, with no math operators, no `+`, no functions. Anything
 * with date math, YEARS_BETWEEN, multi-placeholder, etc. is LEFT AS
 * `formula` because admins may want overridable / computed results.
 *
 * Idempotent. Re-running on already-migrated rows is a no-op.
 *
 * Usage
 * -----
 *   npx tsx scripts/migrate-formula-to-mirror.ts            (dry-run)
 *   npx tsx scripts/migrate-formula-to-mirror.ts --apply    (commit)
 */
import * as fs from "node:fs";
import * as path from "node:path";

function loadDotenv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key || key.startsWith("#") || process.env[key]) continue;
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadDotenv(path.join(__dirname, "..", ".env.local"));
loadDotenv(path.join(__dirname, "..", ".env"));

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");

const MIRROR_FORMULA_RE = /^\s*\{\s*([a-zA-Z][a-zA-Z0-9]*)(?:__|_)([a-zA-Z0-9_]+)\s*\}\s*$/;

type Row = {
  id: number;
  group_key: string;
  label: string;
  value: string;
  meta: Record<string, unknown> | null;
};

async function main() {
  const DATABASE_URL = (process.env.DATABASE_URL ?? "").replace(/[?&]channel_binding=require/, "");
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = postgres(DATABASE_URL, {
    ssl: { rejectUnauthorized: false }, max: 1, idle_timeout: 5, connect_timeout: 15,
  });
  try {
    console.log(`Mode: ${APPLY ? "APPLY (will update DB)" : "DRY-RUN"}\n`);

    const rows = await sql<Row[]>`
      SELECT id, group_key, label, value, meta
      FROM form_options
      WHERE meta->>'inputType' = 'formula'
        AND meta ? 'formula'
      ORDER BY group_key, sort_order, id;
    `;

    type Plan = { id: number; group: string; label: string; value: string; formula: string; src: { package: string; field: string } };
    const toMigrate: Plan[] = [];
    for (const r of rows) {
      const meta = r.meta ?? {};
      const formula = String(meta.formula ?? "").trim();
      const m = MIRROR_FORMULA_RE.exec(formula);
      if (!m) continue;
      const srcPkg = m[1].toLowerCase(); // form_options package keys are always lowercase
      const srcField = m[2];
      toMigrate.push({
        id: r.id,
        group: r.group_key,
        label: r.label,
        value: r.value,
        formula,
        src: { package: srcPkg, field: srcField },
      });
    }

    if (toMigrate.length === 0) {
      console.log("Nothing to migrate — no single-placeholder formula fields found.");
      return;
    }

    console.log(`Found ${toMigrate.length} field(s) to migrate:\n`);
    for (const p of toMigrate) {
      console.log(`  [${p.group}] "${p.label}" (id=${p.id}, key="${p.value}")`);
      console.log(`     ${p.formula}  →  mirror { package: "${p.src.package}", field: "${p.src.field}" }`);
    }

    if (!APPLY) {
      console.log("\nDry-run complete. Re-run with --apply to write the changes.");
      return;
    }

    console.log("\nApplying...");
    let applied = 0;
    for (const p of toMigrate) {
      // jsonb_set order: set mirrorSource, set inputType, drop formula.
      await sql`
        UPDATE form_options
        SET meta = (
          jsonb_set(
            jsonb_set(
              meta - 'formula',
              '{inputType}',
              to_jsonb('mirror'::text)
            ),
            '{mirrorSource}',
            jsonb_build_object('package', ${p.src.package}::text, 'field', ${p.src.field}::text)
          )
        )
        WHERE id = ${p.id};
      `;
      applied++;
    }
    console.log(`Updated ${applied} form_options row(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
