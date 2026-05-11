/**
 * Repair script: The previous cleanup script accidentally double-encoded
 * extra_attributes as a JSONB string instead of a JSONB object.
 * This script:
 *  1. Finds all car rows where extra_attributes is a JSONB string
 *  2. Parses the inner JSON string back to an object
 *  3. Removes false audit changes (insured/contactinfo keys that were null→value,
 *     which were created by the duplicate-key bug, not real user edits)
 *  4. Re-stores as a proper JSONB object
 *
 * Run with --apply to actually write changes. Default is dry-run.
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
 * Returns true if a change in the audit log was a FALSE change caused by the
 * duplicate-key bug: insured/contactinfo key that went from null → some value.
 * A real insured edit would have a non-null `from` (the previous value).
 */
function isFalseInsuredChange(change) {
  const key = (change.key || '').toLowerCase();
  const isInsuredOrContact =
    key.startsWith('insured') || key.startsWith('contactinfo');
  return isInsuredOrContact && change.from === null;
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY-RUN MODE === (pass --apply to write)');

  // Find cars where extra_attributes is stored as a JSONB string (not object)
  // jsonb_typeof returns 'string' for a JSON string value, 'object' for an object
  const corruptedRows = await sql`
    SELECT c.id as car_id, p.policy_number, c.extra_attributes
    FROM cars c
    JOIN policies p ON c.policy_id = p.id
    WHERE c.extra_attributes IS NOT NULL
      AND jsonb_typeof(c.extra_attributes) = 'string'
    ORDER BY c.id
  `;

  console.log(`Found ${corruptedRows.length} corrupted car rows (extra_attributes stored as JSON string)`);

  for (const row of corruptedRows) {
    const carId = row.car_id;
    const policyNumber = row.policy_number;

    // extra_attributes is a JSONB string — postgres.js parses it as a JS string
    const rawStr = row.extra_attributes;
    let parsed;
    try {
      parsed = JSON.parse(rawStr);
    } catch (e) {
      console.error(`  [SKIP] car_id=${carId} ${policyNumber}: Cannot parse inner JSON:`, e.message);
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.error(`  [SKIP] car_id=${carId} ${policyNumber}: Inner value is not an object`);
      continue;
    }

    // Clean up false insured audit entries
    const originalAudit = Array.isArray(parsed._audit) ? parsed._audit : [];
    const cleanedAudit = originalAudit.map(entry => {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      const realChanges = changes.filter(c => !isFalseInsuredChange(c));
      return { ...entry, changes: realChanges };
    }).filter(entry => entry.changes.length > 0);

    const removedEntries = originalAudit.length - cleanedAudit.length;
    const totalFalseChanges = originalAudit.reduce((sum, e) => {
      return sum + (e.changes || []).filter(isFalseInsuredChange).length;
    }, 0);

    const fixed = { ...parsed, _audit: cleanedAudit };

    console.log(`\n  car_id=${carId} ${policyNumber}`);
    console.log(`    Audit entries: ${originalAudit.length} → ${cleanedAudit.length} (removed ${removedEntries} empty entries)`);
    console.log(`    False insured changes removed: ${totalFalseChanges}`);
    console.log(`    insuredSnapshot keys: ${Object.keys(parsed.insuredSnapshot || {}).length}`);

    if (APPLY) {
      // Use sql.json() to ensure it's stored as a proper JSONB object, not a string
      await sql`
        UPDATE cars
           SET extra_attributes = ${sql.json(fixed)}
         WHERE id = ${carId}
      `;
      console.log(`    ✓ Updated`);
    } else {
      console.log(`    [dry-run] Would update car_id=${carId}`);
    }
  }

  console.log('\nDone.');
  if (!APPLY && corruptedRows.length > 0) {
    console.log('Re-run with --apply to apply changes.');
  }
}

main()
  .catch(e => { console.error('Fatal error:', e.message); process.exit(1); })
  .finally(() => sql.end());
