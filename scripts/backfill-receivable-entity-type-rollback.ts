/**
 * One-time rollback: undo over-aggressive flips made by an earlier
 * version of `scripts/backfill-receivable-entity-type.ts`.
 *
 * Background:
 *   The original backfill flipped `entity_type` from `client` to
 *   `agent` on EVERY non-statement receivable whose underlying
 *   policy has an agent. That correctly fixed legacy
 *   `entity_type=client` rows that should have been
 *   `agent_premium` settlements (Chan Tai Man's orphan invoice).
 *
 *   But it ALSO incorrectly flipped rows created by
 *   `findOrCreateClientInvoice` in
 *   `app/api/accounting/invoices/[id]/payments/route.ts`. Those
 *   rows have `premium_type='client_premium'` by design — they
 *   track the "client paid the agent directly" path and MUST stay
 *   `entity_type='client'` (Client Premium tab), NOT
 *   `entity_type='agent'` (Agent Settlement tab). Flipping them
 *   makes the same policy appear TWICE in Agent Settlement.
 *
 *   The repair criterion is structural: any receivable that is
 *   `entity_type='agent'` but `premium_type='client_premium'`
 *   is a mis-flipped row. Real agent settlements always have
 *   `premium_type='agent_premium'`.
 *
 * What it does:
 *   - Finds rows: direction='receivable' AND entity_type='agent'
 *     AND premium_type='client_premium' AND invoice_type<>'statement'
 *     AND status<>'cancelled'.
 *   - Flips entity_type back to 'client'.
 *   - Restores entity_name to the policy's client display name
 *     (or 'Client' as a safe default) so the UI fallback chain
 *     in `accounting/page.tsx`'s `insuredLabel` still works.
 *
 * What it does NOT touch:
 *   - `direction`, `premium_type`, amounts, `invoice_number`.
 *   - Payments, items, audit log.
 *   - Rows that were correctly created as `entity_type='client'`
 *     in the first place (entity_type='client' is excluded).
 *
 * Run:
 *   npx tsx scripts/backfill-receivable-entity-type-rollback.ts             (dry-run)
 *   npx tsx scripts/backfill-receivable-entity-type-rollback.ts --apply     (actually update)
 *
 * Re-runnable: safe.
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

type Candidate = {
  invoice_id: number;
  invoice_number: string;
  current_entity_name: string | null;
  policy_id: number | null;
  policy_number: string | null;
  client_display_name: string | null;
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

    const candidates = await sql<Candidate[]>`
      SELECT
        ai.id                  AS invoice_id,
        ai.invoice_number      AS invoice_number,
        ai.entity_name         AS current_entity_name,
        p.id                   AS policy_id,
        p.policy_number        AS policy_number,
        cl.display_name        AS client_display_name
      FROM accounting_invoices ai
      LEFT JOIN accounting_invoice_items aii
        ON aii.invoice_id = ai.id
      LEFT JOIN policies p
        ON p.id = COALESCE(ai.entity_policy_id, aii.policy_id)
      LEFT JOIN clients cl
        ON cl.id = p.client_id
      WHERE ai.direction = 'receivable'
        AND ai.entity_type = 'agent'
        AND ai.premium_type = 'client_premium'
        AND ai.invoice_type <> 'statement'
        AND ai.invoice_type <> 'credit_note'
        AND ai.status <> 'cancelled'
      GROUP BY ai.id, ai.invoice_number, ai.entity_name,
               p.id, p.policy_number, cl.display_name
      ORDER BY ai.id
    `;

    console.log(`Found ${candidates.length} mis-flipped row(s):\n`);

    if (candidates.length === 0) {
      console.log("Nothing to roll back. All client-direct rows look correct.");
      return;
    }

    for (const c of candidates) {
      const restoredName = c.client_display_name ?? "Client";
      console.log(
        `  inv #${c.invoice_id} ${c.invoice_number} on ${c.policy_number ?? "(unknown policy)"}`,
      );
      console.log(
        `      entity_type: 'agent' → 'client'`,
      );
      console.log(
        `      entity_name: ${JSON.stringify(c.current_entity_name)} → ${JSON.stringify(restoredName)}`,
      );
    }
    console.log();

    if (!APPLY) {
      console.log("DRY-RUN complete. Re-run with --apply to actually update.");
      return;
    }

    await sql.begin(async (tx) => {
      for (const c of candidates) {
        const restoredName = c.client_display_name ?? "Client";
        await tx`
          UPDATE accounting_invoices
             SET entity_type = 'client',
                 entity_name = ${restoredName},
                 updated_at  = NOW()
           WHERE id = ${c.invoice_id}
        `;
      }
    });

    console.log(`✓ Restored ${candidates.length} row(s) to entity_type='client'.`);
    console.log("  These rows will return to the Client Premium tab where they belong.");
    console.log("  Direction / premium_type / amounts / invoice_number: UNCHANGED.");
    console.log("  Payments: UNCHANGED.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
