/**
 * One-time hard-delete: permanently remove the 4 orphan
 * accounting_invoices rows left behind when test policy
 * `POLS-TEST-1775649441531` was deleted.
 *
 * These rows were previously soft-cancelled by
 * `scripts/cleanup-orphan-test-invoices.ts`. They now show in
 * the Accounting table as VOID orphans with no insured name and
 * no vehicle — the user wants them gone entirely.
 *
 * Target IDs:  24, 26, 27, 28
 *   All still carry  entity_policy_id IS NULL
 *                    entity_name = 'SImon Ho'
 *                    paid_amount_cents = 0
 *                    no items, no payments
 *
 * Run:  npx tsx scripts/delete-orphan-test-invoices.ts          (dry-run)
 *       npx tsx scripts/delete-orphan-test-invoices.ts --apply  (hard-delete)
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

const APPLY = process.argv.includes("--apply");
const TARGET_IDS = [24, 26, 27, 28] as const;

function fmt(cents: number) {
  return new Intl.NumberFormat("en-HK", { style: "currency", currency: "HKD", minimumFractionDigits: 0 }).format(cents / 100);
}

async function main() {
  const DATABASE_URL = (process.env.DATABASE_URL ?? "").replace(/[?&]channel_binding=require/, "");
  if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

  const sql = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false }, max: 1, idle_timeout: 5, connect_timeout: 15 });

  try {
    console.log("");
    console.log("────────────────────────────────────────────────────────────");
    console.log("  Hard-delete: orphan invoices from POLS-TEST-1775649441531");
    console.log("────────────────────────────────────────────────────────────");
    console.log(`  Mode: ${APPLY ? "APPLY (will DELETE rows)" : "DRY RUN (no changes)"}`);
    console.log(`  Target IDs: ${TARGET_IDS.join(", ")}`);
    console.log("");

    type Row = {
      id: number;
      invoice_number: string;
      entity_name: string | null;
      entity_policy_id: number | null;
      status: string;
      total_amount_cents: number;
      paid_amount_cents: number;
      items_count: number;
      payments_count: number;
    };

    const rows = await sql<Row[]>`
      SELECT
        ai.id,
        ai.invoice_number,
        ai.entity_name,
        ai.entity_policy_id,
        ai.status,
        ai.total_amount_cents,
        ai.paid_amount_cents,
        (SELECT COUNT(*)::int FROM accounting_invoice_items aii WHERE aii.invoice_id = ai.id) AS items_count,
        (SELECT COUNT(*)::int FROM accounting_payments     ap  WHERE ap.invoice_id  = ai.id) AS payments_count
      FROM accounting_invoices ai
      WHERE ai.id = ANY(${[...TARGET_IDS]})
      ORDER BY ai.id
    `;

    const toDelete: number[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];

    for (const r of rows) {
      const reasons: string[] = [];
      // Hard safety guards — skip anything that looks live
      if (r.entity_policy_id !== null)
        reasons.push(`entity_policy_id = ${r.entity_policy_id} (row is linked to a live policy)`);
      if (r.paid_amount_cents > 0)
        reasons.push(`paid_amount_cents = ${r.paid_amount_cents} (money was received)`);
      if (r.items_count > 0)
        reasons.push(`has ${r.items_count} line item(s)`);
      if (r.payments_count > 0)
        reasons.push(`has ${r.payments_count} payment row(s)`);

      console.log(
        `  ${reasons.length ? "❌" : "✓"} id=${r.id}  ${r.invoice_number.padEnd(24)}  ` +
        `${(r.entity_name ?? "?").padEnd(12)}  ${fmt(r.total_amount_cents).padStart(10)}  ` +
        `status=${r.status}`,
      );

      if (reasons.length === 0) {
        toDelete.push(r.id);
      } else {
        skipped.push({ id: r.id, reason: reasons.join("; ") });
        console.log(`        SKIPPED — ${reasons.join("; ")}`);
      }
    }

    const foundIds = new Set(rows.map((r) => r.id));
    const missing = TARGET_IDS.filter((id) => !foundIds.has(id));
    if (missing.length) {
      console.log(`\n  NOTE: IDs ${missing.join(", ")} not found — already deleted.`);
    }

    console.log(`\n  Plan: DELETE ${toDelete.length} row(s)${toDelete.length ? ` (IDs: ${toDelete.join(", ")})` : ""}`);
    if (skipped.length) console.log(`        skip   ${skipped.length} row(s)`);
    console.log("");

    if (toDelete.length === 0) { console.log("  Nothing to delete."); return; }

    if (!APPLY) {
      console.log("  DRY RUN — re-run with --apply to permanently delete.");
      return;
    }

    // Hard delete — no soft-cancel, the rows are already cancelled.
    // The WHERE clause is a final safety net in the DB itself.
    const deleted = await sql`
      DELETE FROM accounting_invoices
      WHERE id = ANY(${toDelete})
        AND entity_policy_id IS NULL
        AND paid_amount_cents = 0
        AND NOT EXISTS (
          SELECT 1 FROM accounting_payments ap WHERE ap.invoice_id = accounting_invoices.id
        )
      RETURNING id, invoice_number
    `;

    console.log(`  ✓ DELETED ${deleted.length} row(s):`);
    for (const r of deleted) console.log(`     · id=${r.id}  ${r.invoice_number}`);
    console.log("");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
