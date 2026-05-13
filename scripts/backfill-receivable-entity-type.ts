/**
 * One-time backfill: flip `entityType` from `client` to `agent` on
 * `accounting_invoices` receivable rows whose underlying policy
 * has an agent linked NOW but didn't at the time the row was
 * created.
 *
 * Background:
 *   `lib/auto-create-invoices.ts` decides whether a row is
 *   `entityType=client` or `entityType=agent` at the moment of
 *   row creation, based on `policy.agentId` (or the parent
 *   policy's agentId for endorsements). If admin linked the
 *   agent AFTER the first Invoice template was sent, the row
 *   gets stuck as `entityType=client` and surfaces under
 *   "Client Premium" on `/dashboard/accounting` — even though
 *   the architecture rule says:
 *     "With agent: receivable = agentPremium (= net premium).
 *      Agent collects from client, keeps commission, remits net
 *      to admin."
 *   See `.cursor/rules/insurance-platform-architecture.mdc`
 *   "Payment paths (who pays admin)".
 *
 *   This script reconciles the historical data with the current
 *   rule. It scans every non-cancelled receivable row, looks up
 *   the underlying policy's effective agent (parent fallback
 *   for endorsements, same as `resolvePolicyAgent`), and flips
 *   rows that should now be `entityType=agent` to that value.
 *
 *   It also updates the `entityName` column so the dashboard's
 *   counterparty display matches the new entity type.
 *
 * What it does NOT touch:
 *   - `accounting_payments` (the payer flag stays as recorded).
 *   - `direction`, `premiumType`, amounts, or the `invoiceNumber`.
 *   - Rows already on `entityType=agent` (already correct).
 *   - Cancelled / refunded rows.
 *   - Statement-bundled rows (`invoiceType='statement'`) — those
 *     are aggregated parents, not policy receivables.
 *   - Commission AP rows (`direction='payable'`).
 *   - Client-direct-payment tracking rows
 *     (`premium_type='client_premium'`). These are created by
 *     `findOrCreateClientInvoice` in
 *     `app/api/accounting/invoices/[id]/payments/route.ts` to
 *     track the "client paid the agent directly" path. They
 *     MUST stay `entity_type='client'` even on agent-linked
 *     policies — flipping them creates a phantom second row in
 *     Agent Settlement. An earlier version of this script
 *     missed the `premium_type='agent_premium'` filter and DID
 *     mis-flip those; see
 *     `backfill-receivable-entity-type-rollback.ts` to repair.
 *
 * Run:
 *   npx tsx scripts/backfill-receivable-entity-type.ts             (dry-run)
 *   npx tsx scripts/backfill-receivable-entity-type.ts --apply     (actually update)
 *
 * Re-runnable: safe. Rows already correct are skipped.
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
  current_entity_type: string;
  current_entity_name: string | null;
  policy_id: number;
  policy_number: string;
  policy_agent_id: number | null;
  linked_parent_policy_id: number | null;
  parent_agent_id: number | null;
  resolved_agent_id: number;
  resolved_agent_name: string;
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

    // The candidate set: every non-cancelled, non-statement,
    // non-credit-note RECEIVABLE row currently tagged as
    // `entityType='client'`, whose underlying policy (or parent
    // policy via `cars.extra_attributes.linkedPolicyId`) now has
    // an `agentId`. Identified rows are exactly those that
    // `lib/auto-create-invoices.ts` would create as
    // `entityType='agent'` if the auto-create function ran today.
    //
    // The COALESCE chain mirrors `resolvePolicyAgent`:
    //   own agent  →  parent's agent (for endorsements)
    const candidates = await sql<Candidate[]>`
      SELECT
        ai.id                                     AS invoice_id,
        ai.invoice_number                         AS invoice_number,
        ai.entity_type                            AS current_entity_type,
        ai.entity_name                            AS current_entity_name,
        p.id                                      AS policy_id,
        p.policy_number                           AS policy_number,
        p.agent_id                                AS policy_agent_id,
        (
          SELECT (c.extra_attributes->>'linkedPolicyId')::int
          FROM cars c
          WHERE c.policy_id = p.id
          LIMIT 1
        )                                         AS linked_parent_policy_id,
        (
          SELECT pp.agent_id
          FROM cars c
          JOIN policies pp
            ON pp.id = (c.extra_attributes->>'linkedPolicyId')::int
          WHERE c.policy_id = p.id
          LIMIT 1
        )                                         AS parent_agent_id,
        COALESCE(
          p.agent_id,
          (
            SELECT pp.agent_id
            FROM cars c
            JOIN policies pp
              ON pp.id = (c.extra_attributes->>'linkedPolicyId')::int
            WHERE c.policy_id = p.id
            LIMIT 1
          )
        )                                         AS resolved_agent_id,
        COALESCE(u.name, u.email, '(unnamed)')    AS resolved_agent_name,
        cl.display_name                           AS client_display_name
      FROM accounting_invoices ai
      JOIN accounting_invoice_items aii
        ON aii.invoice_id = ai.id
      JOIN policies p
        ON p.id = aii.policy_id
      LEFT JOIN clients cl
        ON cl.id = p.client_id
      LEFT JOIN users u
        ON u.id = COALESCE(
          p.agent_id,
          (
            SELECT pp.agent_id
            FROM cars c
            JOIN policies pp
              ON pp.id = (c.extra_attributes->>'linkedPolicyId')::int
            WHERE c.policy_id = p.id
            LIMIT 1
          )
        )
      WHERE ai.direction = 'receivable'
        AND ai.entity_type = 'client'
        -- CRITICAL: only flip rows that are AGENT settlements
        -- (premium_type=agent_premium). Rows with
        -- premium_type=client_premium are created by
        -- findOrCreateClientInvoice to track client-direct
        -- payments and must STAY entity_type=client even when
        -- the policy has an agent. See the rollback script
        -- backfill-receivable-entity-type-rollback.ts for why.
        AND ai.premium_type = 'agent_premium'
        AND ai.invoice_type <> 'statement'
        AND ai.invoice_type <> 'credit_note'
        AND ai.status <> 'cancelled'
        AND COALESCE(
          p.agent_id,
          (
            SELECT pp.agent_id
            FROM cars c
            JOIN policies pp
              ON pp.id = (c.extra_attributes->>'linkedPolicyId')::int
            WHERE c.policy_id = p.id
            LIMIT 1
          )
        ) IS NOT NULL
      ORDER BY ai.id
    `;

    console.log(`Found ${candidates.length} receivable row(s) that should be entityType='agent':\n`);

    if (candidates.length === 0) {
      console.log("Nothing to backfill. Every row is already consistent.");
      return;
    }

    // Group preview by client so the operator can sanity-check
    // who's affected before running --apply.
    const byClient = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const key = c.client_display_name ?? "(unknown client)";
      const arr = byClient.get(key) ?? [];
      arr.push(c);
      byClient.set(key, arr);
    }

    for (const [client, rows] of byClient) {
      console.log(`• ${client}  (${rows.length} row${rows.length === 1 ? "" : "s"})`);
      for (const r of rows.slice(0, 5)) {
        const via = r.policy_agent_id != null
          ? "own agent"
          : `parent ${r.linked_parent_policy_id ?? "?"} agent`;
        console.log(
          `    inv #${r.invoice_id} ${r.invoice_number} on ${r.policy_number}` +
          ` → entityType client → agent (${r.resolved_agent_name}, via ${via})`,
        );
      }
      if (rows.length > 5) {
        console.log(`    ... and ${rows.length - 5} more`);
      }
    }
    console.log();

    if (!APPLY) {
      console.log("DRY-RUN complete. Re-run with --apply to actually update.");
      return;
    }

    // Apply in a single transaction so partial failure doesn't
    // leave the table half-flipped. Each row update is small;
    // grouping into one tx keeps the runtime well under the
    // statement-timeout budget even for thousands of rows.
    await sql.begin(async (tx) => {
      for (const c of candidates) {
        await tx`
          UPDATE accounting_invoices
             SET entity_type = 'agent',
                 entity_name = ${c.resolved_agent_name},
                 updated_at  = NOW()
           WHERE id = ${c.invoice_id}
        `;
      }
    });

    console.log(`✓ Updated ${candidates.length} row(s).`);
    console.log("  - entity_type:  'client' → 'agent'");
    console.log("  - entity_name:  set to the resolved agent's name");
    console.log("  - direction / premiumType / amounts / invoice_number: UNCHANGED");
    console.log("\nPayments on these rows are unchanged (payer flag is the source of truth).");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
