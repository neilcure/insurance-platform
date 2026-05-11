/**
 * Cleanup script: removes false audit entries where `from` and `to` are
 * semantically equal but stored as different JS types (string "true" vs
 * boolean true, string "false" vs boolean false, string number vs number,
 * etc.). These are NOT real value changes — they're type-coercion noise
 * caused by the wizard re-saving boolean fields whose input control
 * changed between versions (checkbox with value="true" → radio with
 * setValueAs coercing to a real boolean).
 *
 * Run with --apply to actually write. Default is dry-run.
 */

const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

const envContent = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8');
const envVars = {};
for (const line of envContent.split(/\r?\n/)) {
  const idx = line.indexOf('=');
  if (idx < 0) continue;
  const key = line.slice(0, idx).trim();
  let val = line.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  envVars[key] = val;
}

const DB_URL = (envVars['DATABASE_URL'] || '').replace(/[?&]channel_binding=require/, '');
const sql = postgres(DB_URL, { ssl: { rejectUnauthorized: false }, max: 1, idle_timeout: 5, connect_timeout: 15 });

/**
 * MUST match `normalizeForCompare` in
 * `app/api/policies/[id]/route.ts`.
 *
 * Two values are semantically equal if their canonical forms match.
 */
function normalizeForCompare(v) {
  if (v === null || v === undefined || v === '') return JSON.stringify(null);
  if (v === true || v === 'true') return JSON.stringify(true);
  if (v === false || v === 'false') return JSON.stringify(false);
  if (typeof v === 'string' && v !== '' && /^-?\d+(\.\d+)?$/.test(v) && !/^-?0\d/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v) return JSON.stringify(n);
  }
  return JSON.stringify(v);
}

function isFalseCoercionChange(c) {
  return normalizeForCompare(c.from) === normalizeForCompare(c.to);
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY-RUN MODE === (pass --apply to write)');

  const rows = await sql`
    SELECT c.id as car_id, p.policy_number, c.extra_attributes
    FROM cars c
    LEFT JOIN policies p ON c.policy_id = p.id
    WHERE c.extra_attributes IS NOT NULL
      AND jsonb_typeof(c.extra_attributes) = 'object'
      AND c.extra_attributes->'_audit' IS NOT NULL
    ORDER BY c.id
  `;

  let totalAffected = 0;
  let totalChangesRemoved = 0;
  let totalEntriesPruned = 0;

  for (const row of rows) {
    const carId = row.car_id;
    const policyNumber = row.policy_number;
    const ea = row.extra_attributes;
    if (!ea || typeof ea !== 'object') continue;
    const audit = ea._audit;
    if (!Array.isArray(audit)) continue;

    let changesRemoved = 0;
    const cleanedAudit = audit
      .map(entry => {
        const changes = Array.isArray(entry.changes) ? entry.changes : [];
        const realChanges = changes.filter(c => {
          if (isFalseCoercionChange(c)) {
            changesRemoved++;
            return false;
          }
          return true;
        });
        return { ...entry, changes: realChanges };
      })
      .filter(entry => (entry.changes || []).length > 0);

    if (changesRemoved === 0) continue;

    const entriesPruned = audit.length - cleanedAudit.length;
    totalAffected++;
    totalChangesRemoved += changesRemoved;
    totalEntriesPruned += entriesPruned;

    const updated = { ...ea, _audit: cleanedAudit };

    console.log(`\n  car_id=${carId} ${policyNumber || '(unknown)'}`);
    console.log(`    False coercion changes removed: ${changesRemoved}`);
    console.log(`    Audit entries pruned (now empty): ${entriesPruned}`);

    if (APPLY) {
      await sql`
        UPDATE cars
           SET extra_attributes = ${sql.json(updated)}
         WHERE id = ${carId}
      `;
      console.log('    Updated.');
    } else {
      console.log('    [dry-run] would update.');
    }
  }

  console.log(`\nDone. Cars affected: ${totalAffected}. False changes removed: ${totalChangesRemoved}. Empty audit entries pruned: ${totalEntriesPruned}.`);
  if (!APPLY && totalAffected > 0) {
    console.log('Re-run with --apply to apply changes.');
  }
}

main()
  .catch(e => { console.error('Fatal error:', e.message); process.exit(1); })
  .finally(() => sql.end());
