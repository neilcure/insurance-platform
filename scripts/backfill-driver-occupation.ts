/**
 * One-time backfill: repair `cars.extra_attributes.packagesSnapshot.driver.values.driver__occuption`
 * (and the alias `driver_occuption`) where it was silently truncated by a
 * case-mismatched formula in earlier wizard versions.
 *
 * Background
 * ----------
 * The driver Occupation field has the formula `{Insured_insuredOccuption}`
 * (capital "I"). Before the case-insensitive fix in `lib/formula.ts`, the
 * resolver could not find the form value stored under
 * `insured__insuredOccuption` (lowercase), so the formula resolved to "".
 * When the field was still editable, anything previously typed in the
 * driver row got stuck — most commonly the *first letter* of the insured's
 * actual occupation (e.g. "C" for "COACH (PING PONG)").
 *
 * Repair rule (idempotent + conservative)
 * ---------------------------------------
 *   For each policy:
 *     insured  = extra_attributes.insuredSnapshot.insured__insuredOccuption
 *                ?? insured.insuredOccuption
 *     driver   = packagesSnapshot.driver.values.driver__occuption
 *                ?? packagesSnapshot.driver.values.occuption
 *
 *   Repair when ALL of:
 *     1. `insured` is a non-empty string.
 *     2. `driver` is either empty, OR shorter than `insured`, OR a
 *        case-insensitive prefix of `insured` (i.e. clearly truncated).
 *     3. `insured` itself is NOT a case-insensitive prefix of `driver`
 *        (so we never overwrite a longer/more-edited value).
 *
 *   When the rule fires, set BOTH `driver__occuption` AND `occuption`
 *   in the driver package's values (the snapshot has historically used
 *   either spelling, and the resolver reads from both).
 *
 * Usage
 * -----
 *   npx tsx scripts/backfill-driver-occupation.ts          (dry-run; prints what WOULD change)
 *   npx tsx scripts/backfill-driver-occupation.ts --apply  (actually writes)
 */
import * as fs from "node:fs";
import * as path from "node:path";

function loadDotenv(file: string) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key || key.startsWith("#")) continue;
    if (process.env[key]) continue;
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
const rootDir = path.resolve(__dirname, "..");
loadDotenv(path.join(rootDir, ".env.local"));
loadDotenv(path.join(rootDir, ".env"));

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");

type Row = {
  policy_id: number;
  policy_number: string | null;
  extra_attributes: Record<string, unknown> | null;
};

function readInsured(extra: Record<string, unknown> | null | undefined): string | null {
  const snap = (extra?.insuredSnapshot ?? null) as Record<string, unknown> | null;
  if (!snap) return null;
  const candidates = [
    snap.insured__insuredOccuption,
    snap.insuredOccuption,
    snap.insured_insuredOccuption,
  ];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function readDriver(extra: Record<string, unknown> | null | undefined): string | null {
  const pkgs = (extra?.packagesSnapshot ?? null) as Record<string, unknown> | null;
  if (!pkgs) return null;
  const driver = (pkgs.driver ?? null) as Record<string, unknown> | null;
  if (!driver) return null;
  const vals = ((driver.values ?? driver) as Record<string, unknown>) ?? {};
  const candidates = [
    vals.driver__occuption,
    vals.occuption,
    vals.driver_occuption,
  ];
  for (const v of candidates) {
    if (typeof v === "string") return v;
  }
  return null;
}

function shouldRepair(insured: string, driver: string | null): boolean {
  if (!insured.trim()) return false;
  const i = insured.trim();
  const d = (driver ?? "").trim();
  if (!d) return true;
  if (d === i) return false;
  const iLow = i.toLowerCase();
  const dLow = d.toLowerCase();
  // Driver is clearly a prefix of insured (e.g. "C" vs "COACH (PING PONG)").
  if (iLow.startsWith(dLow) && i.length > d.length) return true;
  // Don't overwrite when driver looks like a real, longer, hand-edited value.
  return false;
}

async function main() {
  const DATABASE_URL = (process.env.DATABASE_URL ?? "").replace(/[?&]channel_binding=require/, "");
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = postgres(DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  });

  try {
    console.log(`Mode: ${APPLY ? "APPLY (will update DB)" : "DRY-RUN (no DB writes)"}\n`);

    const rows = await sql<Row[]>`
      SELECT p.id AS policy_id, p.policy_number, c.extra_attributes
      FROM policies p
      JOIN cars c ON c.policy_id = p.id
      WHERE c.extra_attributes->'packagesSnapshot'->'driver' IS NOT NULL
        AND c.extra_attributes->'insuredSnapshot' IS NOT NULL
      ORDER BY p.id;
    `;

    let toUpdate: { policyId: number; policyNumber: string | null; from: string | null; to: string }[] = [];
    for (const row of rows) {
      const extra = row.extra_attributes ?? null;
      const insured = readInsured(extra);
      if (!insured) continue;
      const driver = readDriver(extra);
      if (!shouldRepair(insured, driver)) continue;
      toUpdate.push({
        policyId: row.policy_id,
        policyNumber: row.policy_number,
        from: driver,
        to: insured,
      });
    }

    if (toUpdate.length === 0) {
      console.log("Nothing to repair — all driver Occupation values are consistent with the insured.");
      return;
    }

    console.log(`Found ${toUpdate.length} policy row(s) to repair:\n`);
    for (const u of toUpdate.slice(0, 30)) {
      console.log(
        `  policy ${u.policyId} (${u.policyNumber ?? "(no number)"}): "${u.from ?? "(empty)"}" → "${u.to}"`,
      );
    }
    if (toUpdate.length > 30) console.log(`  ... and ${toUpdate.length - 30} more`);

    if (!APPLY) {
      console.log("\nDry-run complete. Re-run with --apply to write the changes.");
      return;
    }

    console.log("\nApplying...");
    let applied = 0;
    for (const u of toUpdate) {
      // jsonb_set creates intermediate keys if missing. We update both the
      // canonical `driver__occuption` and the legacy `occuption` so any
      // downstream reader (resolver suffix-fallback, PDF context) sees a
      // consistent value.
      await sql`
        UPDATE cars
        SET extra_attributes = jsonb_set(
          jsonb_set(
            extra_attributes,
            '{packagesSnapshot,driver,values,driver__occuption}',
            to_jsonb(${u.to}::text)
          ),
          '{packagesSnapshot,driver,values,occuption}',
          to_jsonb(${u.to}::text)
        )
        WHERE policy_id = ${u.policyId};
      `;
      applied++;
    }
    console.log(`Updated ${applied} row(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
