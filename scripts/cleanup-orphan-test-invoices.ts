/**
 * One-time cleanup: cancel the 4 orphan accounting_invoices rows
 * left behind when the test policy `POLS-TEST-1775649441531` was
 * deleted on 2026-04-08.
 *
 * The schema sets `accounting_invoices.entity_policy_id` to
 * `ON DELETE: SET NULL`, so when the test policy was removed the
 * parent invoice rows survived as orphans. Their line items —
 * which had `ON DELETE: CASCADE` — were wiped, but the parent
 * rows have been polluting every dashboard stat for 5+ weeks.
 *
 * Per `.cursor/skills/accounting-view-reconciliation/SKILL.md` §4:
 *   "NEVER auto-cancel orphans server-side without an explicit
 *    admin action — there's no way to be 100% sure they're not
 *    legitimate. Cleanup is admin-driven (manual cancel via the
 *    invoice row's edit panel, or a one-off SQL script after audit)."
 *
 * This script is that one-off, audited cleanup.
 *
 * Targeted IDs:
 *   24  HIDIINV-2026-9389(A)   SImon Ho   HK$5,000
 *   26  HIDIENS-2026-9691      SImon Ho   HK$5,000
 *   27  HIDIENS-2026-1393      SImon Ho   HK$5,000  (notes: POLS-TEST-1775649441531(a))
 *   28  HIDIENS-2026-2218      SImon Ho   HK$2,400  (notes: POLS-TEST-1775649441531(b))
 *
 * Safety guards — each row MUST still meet ALL of these or it gets
 * SKIPPED (not silently mutated):
 *   - entity_policy_id IS NULL                 (still orphaned)
 *   - status = 'pending'                       (not paid, not already cancelled)
 *   - paid_amount_cents = 0                    (no money has come in)
 *   - no rows in accounting_invoice_items      (no real line work)
 *   - no rows in accounting_payments           (no payment history)
 *   - entity_name = 'SImon Ho'                 (matches the audit trail)
 *
 * Run:  npx tsx scripts/cleanup-orphan-test-invoices.ts             (dry-run)
 *       npx tsx scripts/cleanup-orphan-test-invoices.ts --apply     (actually cancel)
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

// The exact 4 rows tied to the deleted test policy
// POLS-TEST-1775649441531. Hard-coded by ID so this script can
// NEVER mass-cancel anything it wasn't audited for.
const TARGET_INVOICE_IDS = [24, 26, 27, 28] as const;
const EXPECTED_ENTITY_NAME = "SImon Ho";

function fmt(cents: number): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: "HKD",
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

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
    console.log("");
    console.log("──────────────────────────────────────────────────────────────");
    console.log("  Cleanup: orphan invoices from deleted test policy");
    console.log("  POLS-TEST-1775649441531");
    console.log("──────────────────────────────────────────────────────────────");
    console.log(`  Mode: ${APPLY ? "APPLY (will UPDATE rows)" : "DRY RUN (no changes)"}`);
    console.log(`  Target IDs: ${TARGET_INVOICE_IDS.join(", ")}`);
    console.log("");

    type Row = {
      id: number;
      invoice_number: string;
      entity_name: string | null;
      entity_policy_id: number | null;
      status: string;
      total_amount_cents: number;
      paid_amount_cents: number;
      notes: string | null;
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
        ai.notes,
        (SELECT COUNT(*)::int FROM accounting_invoice_items aii WHERE aii.invoice_id = ai.id) AS items_count,
        (SELECT COUNT(*)::int FROM accounting_payments ap WHERE ap.invoice_id = ai.id) AS payments_count
      FROM accounting_invoices ai
      WHERE ai.id = ANY(${[...TARGET_INVOICE_IDS]})
      ORDER BY ai.id
    `;

    const toCancel: number[] = [];
    const skipped: Array<{ id: number; reason: string }> = [];

    for (const r of rows) {
      const reasons: string[] = [];
      if (r.entity_policy_id !== null)
        reasons.push(`entity_policy_id is now ${r.entity_policy_id} (no longer orphan)`);
      if (r.status !== "pending")
        reasons.push(`status is "${r.status}" (expected "pending")`);
      if (r.paid_amount_cents > 0)
        reasons.push(`paid_amount_cents = ${r.paid_amount_cents} (expected 0)`);
      if (r.items_count > 0)
        reasons.push(`has ${r.items_count} line item(s) (expected 0)`);
      if (r.payments_count > 0)
        reasons.push(`has ${r.payments_count} payment row(s) (expected 0)`);
      if (r.entity_name !== EXPECTED_ENTITY_NAME)
        reasons.push(
          `entity_name = "${r.entity_name}" (expected "${EXPECTED_ENTITY_NAME}")`,
        );

      const stamp = r.entity_policy_id !== null || r.status !== "pending" || r.paid_amount_cents > 0
        ? "❌"
        : "✓";
      console.log(
        `  ${stamp} id=${r.id}  ${r.invoice_number.padEnd(22)}  ${r.entity_name ?? "?"}  ` +
          `${fmt(r.total_amount_cents).padStart(10)}  status=${r.status}`,
      );
      if (r.notes) console.log(`        notes: ${r.notes}`);

      if (reasons.length === 0) {
        toCancel.push(r.id);
      } else {
        skipped.push({ id: r.id, reason: reasons.join("; ") });
        console.log(`        SKIPPED — ${reasons.join("; ")}`);
      }
    }

    const foundIds = new Set(rows.map((r) => r.id));
    const missing = TARGET_INVOICE_IDS.filter((id) => !foundIds.has(id));
    if (missing.length) {
      console.log("");
      console.log(`  NOTE: ${missing.length} target ID(s) no longer exist in DB: ${missing.join(", ")}`);
      console.log("  (Probably already deleted. Nothing to do for those.)");
    }

    console.log("");
    console.log(`  Plan: cancel ${toCancel.length} row(s)${toCancel.length ? ` (IDs ${toCancel.join(", ")})` : ""}`);
    if (skipped.length) {
      console.log(`        skip   ${skipped.length} row(s)`);
    }
    console.log("");

    if (toCancel.length === 0) {
      console.log("  Nothing to do.");
      return;
    }

    if (!APPLY) {
      console.log("  DRY RUN — re-run with --apply to actually cancel these rows.");
      return;
    }

    const result = await sql`
      UPDATE accounting_invoices
      SET
        status = 'cancelled',
        cancellation_date = CURRENT_DATE,
        notes = COALESCE(notes, '') ||
                CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END ||
                '[Auto-cancelled ' || CURRENT_DATE ||
                ' — orphan from deleted test policy POLS-TEST-1775649441531; see scripts/cleanup-orphan-test-invoices.ts]',
        updated_at = NOW()
      WHERE id = ANY(${toCancel})
        AND status = 'pending'
        AND entity_policy_id IS NULL
        AND paid_amount_cents = 0
      RETURNING id, invoice_number, status
    `;

    console.log("  ✓ APPLIED");
    for (const r of result) {
      console.log(`     · id=${r.id} ${r.invoice_number} → status=${r.status}`);
    }
    console.log("");
    console.log(`  ${result.length} row(s) cancelled. Total amount removed from receivable book: ` +
      fmt(rows.filter((r) => toCancel.includes(r.id)).reduce((s, r) => s + r.total_amount_cents, 0)));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
