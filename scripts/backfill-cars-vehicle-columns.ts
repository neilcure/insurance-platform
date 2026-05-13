/**
 * One-time backfill: re-derive `cars.make`, `cars.model`,
 * `cars.year` from each row's
 * `extra_attributes.packagesSnapshot`.
 *
 * Background:
 *   The legacy POST handler in `app/api/policies/route.ts` had
 *   a make-extraction regex (`/make(name)?/`) that accidentally
 *   matched the field `makeOfYear` BEFORE the proper `make`
 *   field, and grabbed the year string (e.g. `"2025"`) into the
 *   `cars.make` column. The actual vehicle make has always been
 *   correct in the snapshot, but the column held garbage.
 *
 *   Surfaces that read the column directly (Accounting list,
 *   statement builder, linked-policy widget, exports) then
 *   showed "2025" / "2020" / "2009" instead of "BMW" / "Iisuzu"
 *   / "Toyota".
 *
 *   This script rewrites the column from the snapshot using the
 *   shared extractor at `lib/policies/extract-vehicle-columns.ts`.
 *
 * What it DOES NOT touch:
 *   - `plate_number` — this column is INTENTIONALLY the
 *     historical record of the vehicle the policy was originally
 *     issued for. When an endorsement changes the registered
 *     vehicle (e.g. "swap GH7888 → KD6668"), the BASE POLICY's
 *     snapshot is updated to reflect the new current-effective
 *     vehicle, but the column stays frozen at the original plate
 *     because the base-policy invoice was issued against THAT
 *     plate. Overwriting the column from the snapshot would
 *     destroy that history.
 *   - `extra_attributes` itself — the snapshot is unchanged.
 *   - Audit log / `_lastEditedAt` — this is reconciliation, not
 *     a user edit.
 *
 * Run:
 *   npx tsx scripts/backfill-cars-vehicle-columns.ts             (dry-run)
 *   npx tsx scripts/backfill-cars-vehicle-columns.ts --apply     (actually update)
 *
 * Re-runnable: safe. Rows already in sync are skipped.
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
import { extractVehicleColumns } from "../lib/policies/extract-vehicle-columns";

const APPLY = process.argv.includes("--apply");

type CarRow = {
  id: number;
  policy_id: number;
  plate_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  extra_attributes: Record<string, unknown> | null;
  policy_number: string;
};

type Diff = {
  carId: number;
  policyNumber: string;
  changes: Array<{ col: "make" | "model" | "year"; from: unknown; to: unknown }>;
  next: { make: string | null; model: string | null; year: number | null };
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

    const rows = await sql<CarRow[]>`
      SELECT c.id,
             c.policy_id,
             c.plate_number,
             c.make,
             c.model,
             c.year,
             c.extra_attributes,
             p.policy_number
      FROM cars c
      JOIN policies p ON p.id = c.policy_id
      WHERE c.extra_attributes IS NOT NULL
        AND c.extra_attributes->'packagesSnapshot' IS NOT NULL
      ORDER BY c.id
    `;

    console.log(`Scanned ${rows.length} car row(s) with a packagesSnapshot.\n`);

    const diffs: Diff[] = [];
    for (const row of rows) {
      const extra = (row.extra_attributes ?? {}) as Record<string, unknown>;
      const packagesSnapshot = extra.packagesSnapshot;
      if (!packagesSnapshot || typeof packagesSnapshot !== "object") continue;

      const extracted = extractVehicleColumns({
        packages: packagesSnapshot as Record<string, unknown>,
      });

      const changes: Diff["changes"] = [];

      // `plate_number` is INTENTIONALLY NOT compared here — see the
      // header comment. The column is the historical record of which
      // vehicle the policy was originally issued for; the snapshot
      // reflects the current state after endorsements. Overwriting
      // the column from the snapshot would erase that history.
      //
      // We only sync make / model / year, because those have no
      // accounting-history meaning and the column garbage we see in
      // the wild (e.g. `make = "2025"`) is unambiguous legacy bug
      // residue from an old POST extractor.
      //
      // We also skip "extractor says null but column has something"
      // because that's typically a human edit on the column that
      // the snapshot never saw.
      if (extracted.make !== null && extracted.make !== row.make) {
        changes.push({ col: "make", from: row.make, to: extracted.make });
      }
      if (extracted.model !== null && extracted.model !== row.model) {
        changes.push({ col: "model", from: row.model, to: extracted.model });
      }
      if (extracted.year !== null && extracted.year !== row.year) {
        changes.push({ col: "year", from: row.year, to: extracted.year });
      }

      if (changes.length > 0) {
        diffs.push({
          carId: row.id,
          policyNumber: row.policy_number,
          changes,
          next: {
            make: extracted.make,
            model: extracted.model,
            year: extracted.year,
          },
        });
      }
    }

    console.log(`Rows with drifted columns: ${diffs.length}\n`);

    if (diffs.length === 0) {
      console.log("Nothing to backfill. Every row is already in sync.");
      return;
    }

    // Preview the first 10 affected rows so the operator can
    // sanity-check the diffs before running --apply.
    const preview = diffs.slice(0, 10);
    for (const d of preview) {
      console.log(`• car_id=${d.carId} (${d.policyNumber})`);
      for (const c of d.changes) {
        console.log(`    ${c.col}: ${JSON.stringify(c.from)}  →  ${JSON.stringify(c.to)}`);
      }
    }
    if (diffs.length > preview.length) {
      console.log(`  ... and ${diffs.length - preview.length} more row(s)`);
    }
    console.log();

    // Aggregate count per column for quick visibility.
    const perCol: Record<string, number> = { make: 0, model: 0, year: 0 };
    for (const d of diffs) {
      for (const c of d.changes) perCol[c.col]++;
    }
    console.log(
      `Per-column update counts: make=${perCol.make}, model=${perCol.model}, year=${perCol.year}\n`,
    );

    if (!APPLY) {
      console.log("DRY-RUN complete. Re-run with --apply to actually update.");
      return;
    }

    await sql.begin(async (tx) => {
      for (const d of diffs) {
        // Build the SET clause from only the columns that actually
        // need changing — keeps untouched columns at their existing
        // value, avoids generating SQL that no-ops on uninvolved
        // fields, and produces clearer audit (if you ever wire one).
        const sets: Record<string, unknown> = {};
        for (const c of d.changes) {
          if (c.col === "make") sets.make = c.to as string | null;
          if (c.col === "model") sets.model = c.to as string | null;
          if (c.col === "year") sets.year = c.to as number | null;
        }
        // postgres.js does not have a tagged-template object-spread
        // for SET, so issue the columns we know about explicitly.
        // Conditional updates ensure NULLs are not blanket-applied.
        const updates: string[] = [];
        const params: unknown[] = [];
        let p = 1;
        if ("make" in sets) {
          updates.push(`make = $${p++}`);
          params.push(sets.make);
        }
        if ("model" in sets) {
          updates.push(`model = $${p++}`);
          params.push(sets.model);
        }
        if ("year" in sets) {
          updates.push(`year = $${p++}`);
          params.push(sets.year);
        }
        params.push(d.carId);
        // eslint-disable-next-line no-await-in-loop -- sequential by design inside the tx
        await tx.unsafe(
          `UPDATE cars SET ${updates.join(", ")} WHERE id = $${p}`,
          params as never,
        );
      }
    });

    console.log(`✓ Updated ${diffs.length} car row(s) to match their packagesSnapshot.`);
    console.log("  - plate_number: UNCHANGED (historical column, preserved)");
    console.log("  - extra_attributes (the snapshot itself): UNCHANGED");
    console.log("  - audit log: UNCHANGED (this is reconciliation, not a user edit)");
    console.log("\nThe Accounting list, statement builder, and linked-policy widget");
    console.log("will now show the correct make/model/year for every policy.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
