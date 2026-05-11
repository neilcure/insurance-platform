/**
 * One-time cleanup: dedupe `insuredSnapshot` keys in every `cars` row.
 *
 * Background: an earlier bug in the policy wizard's "fill form from
 * existing record" path wrote both the original key (e.g. `insured__ciNumber`)
 * AND a lowercased / single-underscore clone (e.g. `insured__cinumber`,
 * `insured_category`) into React Hook Form state. On submit, every prefixed
 * key in the form is copied into `insuredSnapshot`, so the snapshot ended
 * up with two keys per logical field. The audit log then reported every
 * lowercase clone as "changed from null", which looks to the end user like
 * "insured data was edited" — even when the user typed nothing.
 *
 * The wizard now de-dupes on save (see lib/policies/insured-snapshot-dedupe.ts),
 * but rows written before that fix still carry the duplicate keys.  Running
 * this script collapses each duplicate pair to the canonical key, leaving
 * the actual value untouched.
 *
 * It does NOT modify `_audit`, `packagesSnapshot`, `_lastEditedAt`, or any
 * other extra_attributes field. It only rewrites `insuredSnapshot`.
 *
 * Run:  npx tsx scripts/cleanup-insured-snapshot-dupes.ts             (dry-run)
 *       npx tsx scripts/cleanup-insured-snapshot-dupes.ts --apply     (actually update)
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const rootDir = path.resolve(__dirname, "..");
loadDotenv(path.join(rootDir, ".env.local"));
loadDotenv(path.join(rootDir, ".env"));

import postgres from "postgres";
import { dedupeInsuredSnapshot, findDuplicateInsuredKeys } from "../lib/policies/insured-snapshot-dedupe";

const APPLY = process.argv.includes("--apply");

async function main() {
  const DATABASE_URL = (process.env.DATABASE_URL ?? "").replace(
    /[?&]channel_binding=require/,
    "",
  );
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

    const rows = await sql<
      Array<{
        id: number;
        policy_number: string;
        extra_attributes: Record<string, unknown> | null;
      }>
    >`
      SELECT c.id, p.policy_number, c.extra_attributes
      FROM cars c
      JOIN policies p ON c.policy_id = p.id
      WHERE c.extra_attributes IS NOT NULL
        AND c.extra_attributes->'insuredSnapshot' IS NOT NULL
      ORDER BY c.id
    `;

    console.log(`Scanned ${rows.length} car rows with insuredSnapshot.\n`);

    let affected = 0;
    let totalDroppedKeys = 0;
    const samples: Array<{ policyNumber: string; carId: number; dropped: string[] }> = [];

    for (const row of rows) {
      const extra = row.extra_attributes ?? {};
      const insured = extra.insuredSnapshot as Record<string, unknown> | null;
      if (!insured || typeof insured !== "object") continue;

      const duplicates = findDuplicateInsuredKeys(insured);
      if (duplicates.length === 0) continue;

      affected++;
      totalDroppedKeys += duplicates.length;
      if (samples.length < 5) {
        samples.push({
          policyNumber: row.policy_number,
          carId: row.id,
          dropped: duplicates,
        });
      }

      if (APPLY) {
        const cleaned = dedupeInsuredSnapshot(insured);
        const newExtra = { ...extra, insuredSnapshot: cleaned };
        await sql`
          UPDATE cars
             SET extra_attributes = ${JSON.stringify(newExtra)}::jsonb
           WHERE id = ${row.id}
        `;
      }
    }

    console.log(`Rows with duplicate keys: ${affected}`);
    console.log(`Total duplicate keys dropped: ${totalDroppedKeys}`);
    if (samples.length > 0) {
      console.log("\nSample affected policies (first 5):");
      for (const s of samples) {
        console.log(`  • ${s.policyNumber} (car_id=${s.carId})`);
        for (const k of s.dropped) {
          console.log(`      drop: ${k}`);
        }
      }
    }

    if (!APPLY && affected > 0) {
      console.log("\nRe-run with --apply to actually update the database.");
    } else if (APPLY && affected > 0) {
      console.log("\nDone. Audit logs were NOT touched.");
    } else {
      console.log("\nNothing to clean up.");
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
