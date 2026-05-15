/**
 * One-time backfill: populate `policies.start_date_indexed` and
 * `policies.end_date_indexed` from each policy's
 * `cars.extra_attributes` snapshot.
 *
 * Background
 * ----------
 * The Policy Calendar widget historically pulled every active
 * policy (up to FETCH_HARD_CAP = 1000) and filtered by date in JS.
 * Migration `0015_add_policy_indexed_dates.sql` adds two denormalised
 * `date` columns so the calendar's window filter can run as an
 * indexed range scan instead.
 *
 * New writes populate the columns automatically via
 * `lib/policies/indexed-dates.ts`. This script fills in the
 * historical rows. It is:
 *
 *   - Idempotent — re-running it on already-backfilled rows is a
 *     no-op (the computed values match what's already stored).
 *   - Safe — only updates rows where the computed value DIFFERS
 *     from the current column. Rows with a manually-set value (e.g.
 *     by an operator running an ad-hoc UPDATE) are left alone if
 *     they happen to match the snapshot.
 *   - Resumable — uses a single transaction per chunk so a network
 *     blip restarts cleanly.
 *
 * Run
 * ---
 *   npx tsx scripts/backfill-policy-indexed-dates.ts             (dry-run)
 *   npx tsx scripts/backfill-policy-indexed-dates.ts --apply     (actually update)
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
import { derivePolicyIndexedDates } from "../lib/policies/indexed-dates";

const APPLY = process.argv.includes("--apply");
const CHUNK_SIZE = 200;

type Row = {
  policy_id: number;
  policy_number: string;
  current_start: string | null;
  current_end: string | null;
  extra_attributes: Record<string, unknown> | null;
};

type Update = {
  policyId: number;
  policyNumber: string;
  from: { start: string | null; end: string | null };
  to: { start: string | null; end: string | null };
};

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

    // Pull every active policy along with its snapshot. We touch
    // inactive rows too — partial index only includes active ones,
    // but populating both gives the operator the option to enable
    // inactive policies later without re-running.
    const rows = await sql<Row[]>`
      SELECT p.id AS policy_id,
             p.policy_number,
             p.start_date_indexed::text AS current_start,
             p.end_date_indexed::text   AS current_end,
             c.extra_attributes
      FROM policies p
      LEFT JOIN cars c ON c.policy_id = p.id
      ORDER BY p.id
    `;

    console.log(`Scanned ${rows.length} policy row(s).\n`);

    const updates: Update[] = [];
    for (const row of rows) {
      const derived = derivePolicyIndexedDates(row.extra_attributes ?? null);
      const currentStart = row.current_start ?? null;
      const currentEnd = row.current_end ?? null;
      if (
        derived.startDate === currentStart &&
        derived.endDate === currentEnd
      ) {
        continue; // already in sync
      }
      updates.push({
        policyId: row.policy_id,
        policyNumber: row.policy_number,
        from: { start: currentStart, end: currentEnd },
        to: { start: derived.startDate, end: derived.endDate },
      });
    }

    console.log(`Rows needing update: ${updates.length}\n`);

    if (updates.length === 0) {
      console.log("Nothing to backfill — every policy is already in sync.");
      return;
    }

    // Preview the first 10 affected rows so the operator can sanity
    // check before --apply.
    const preview = updates.slice(0, 10);
    for (const u of preview) {
      console.log(
        `• policy ${u.policyId} (${u.policyNumber})  start: ${JSON.stringify(u.from.start)} → ${JSON.stringify(u.to.start)}   end: ${JSON.stringify(u.from.end)} → ${JSON.stringify(u.to.end)}`,
      );
    }
    if (updates.length > preview.length) {
      console.log(`  ... and ${updates.length - preview.length} more row(s)`);
    }
    console.log();

    // Distribution of resolution outcomes — useful for verifying
    // that the snapshot extraction is finding dates as expected.
    const stats = {
      bothNull: 0,
      onlyStart: 0,
      onlyEnd: 0,
      both: 0,
    };
    for (const u of updates) {
      const hasStart = u.to.start !== null;
      const hasEnd = u.to.end !== null;
      if (!hasStart && !hasEnd) stats.bothNull += 1;
      else if (hasStart && !hasEnd) stats.onlyStart += 1;
      else if (!hasStart && hasEnd) stats.onlyEnd += 1;
      else stats.both += 1;
    }
    console.log(
      `Resolution stats: both=${stats.both}, onlyStart=${stats.onlyStart}, onlyEnd=${stats.onlyEnd}, neither=${stats.bothNull}\n`,
    );

    if (!APPLY) {
      console.log("DRY-RUN complete. Re-run with --apply to actually update.");
      return;
    }

    // Chunk the writes so a slow Neon connection doesn't time out
    // on a huge UPDATE batch. Each chunk runs as one transaction.
    let written = 0;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      await sql.begin(async (tx) => {
        for (const u of chunk) {
          await tx`
            UPDATE policies
            SET start_date_indexed = ${u.to.start}::date,
                end_date_indexed   = ${u.to.end}::date
            WHERE id = ${u.policyId}
          `;
        }
      });
      written += chunk.length;
      process.stdout.write(`\rUpdated ${written}/${updates.length}`);
    }
    console.log("\nDone.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
