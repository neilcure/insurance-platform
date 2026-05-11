/**
 * Cleanup script: removes duplicate keys (lowercase clones of camelCase keys)
 * from packagesSnapshot.insured.values and packagesSnapshot.contactinfo.values
 * across ALL cars. This is the companion to cleanup-insured-snapshot-dupes.ts —
 * that one cleaned `insuredSnapshot`, this one cleans the same data inside
 * `packagesSnapshot.{insured,contactinfo}.values`.
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
 * Mirror of `lib/policies/insured-snapshot-dedupe.ts#dedupeInsuredSnapshot`.
 * Kept inline so this script has no project-level imports.
 */
function dedupeInsuredSnapshot(snapshot) {
  const norm = (k) =>
    k.toLowerCase().replace(/^(insured|contactinfo)_{1,2}/, "").replace(/_/g, "");
  const seen = new Map();
  for (const [k, v] of Object.entries(snapshot)) {
    const n = norm(k);
    const prev = seen.get(n);
    if (!prev) {
      seen.set(n, { key: k, val: v });
      continue;
    }
    const kHasDouble = k.includes("__");
    const prevHasDouble = prev.key.includes("__");
    if (kHasDouble && !prevHasDouble) {
      seen.set(n, { key: k, val: v });
    } else if (kHasDouble && prevHasDouble) {
      if (k !== k.toLowerCase() && prev.key === prev.key.toLowerCase()) {
        seen.set(n, { key: k, val: v });
      }
    }
  }
  const result = {};
  for (const { key, val } of seen.values()) {
    result[key] = val;
  }
  return result;
}

/**
 * Also filter the _audit array to drop false `null → value` changes for
 * lowercase clone keys that no longer exist after dedupe.
 */
function cleanAuditForCloneKeys(audit, removedKeys) {
  if (!Array.isArray(audit)) return audit;
  const removedSet = new Set(removedKeys.map(k => k.toLowerCase()));
  return audit
    .map(entry => {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      const filtered = changes.filter(c => {
        const key = String(c.key || '');
        const isCloneAdd = removedSet.has(key.toLowerCase()) && (c.from === null || c.from === undefined);
        return !isCloneAdd;
      });
      return { ...entry, changes: filtered };
    })
    .filter(entry => (entry.changes || []).length > 0);
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY-RUN MODE === (pass --apply to write)');

  const rows = await sql`
    SELECT c.id as car_id, p.policy_number, c.extra_attributes
    FROM cars c
    LEFT JOIN policies p ON c.policy_id = p.id
    WHERE c.extra_attributes IS NOT NULL
      AND jsonb_typeof(c.extra_attributes) = 'object'
      AND (
        c.extra_attributes->'packagesSnapshot'->'insured'->'values' IS NOT NULL OR
        c.extra_attributes->'packagesSnapshot'->'contactinfo'->'values' IS NOT NULL
      )
    ORDER BY c.id
  `;

  let totalAffected = 0;
  let totalRemovedKeys = 0;
  let totalAuditEntriesScrubbed = 0;

  for (const row of rows) {
    const carId = row.car_id;
    const policyNumber = row.policy_number;
    const ea = row.extra_attributes;
    if (!ea || typeof ea !== 'object') continue;

    const pkgs = ea.packagesSnapshot;
    if (!pkgs || typeof pkgs !== 'object') continue;

    let removedKeysAll = [];
    const updatedPkgs = { ...pkgs };
    let changed = false;

    for (const pkgName of ['insured', 'contactinfo']) {
      const pkg = pkgs[pkgName];
      if (!pkg || typeof pkg !== 'object') continue;
      const vals = pkg.values;
      if (!vals || typeof vals !== 'object') continue;

      const deduped = dedupeInsuredSnapshot(vals);
      const removedKeys = Object.keys(vals).filter(k => !(k in deduped));
      if (removedKeys.length > 0) {
        updatedPkgs[pkgName] = { ...pkg, values: deduped };
        removedKeysAll = removedKeysAll.concat(removedKeys);
        changed = true;
      }
    }

    if (!changed) continue;

    const cleanedAudit = cleanAuditForCloneKeys(ea._audit, removedKeysAll);
    const auditEntriesRemoved = (ea._audit || []).length - (cleanedAudit || []).length;

    const updated = {
      ...ea,
      packagesSnapshot: updatedPkgs,
      _audit: cleanedAudit,
    };

    totalAffected++;
    totalRemovedKeys += removedKeysAll.length;
    totalAuditEntriesScrubbed += auditEntriesRemoved;

    console.log(`\n  car_id=${carId} ${policyNumber || '(unknown)'}`);
    console.log(`    Duplicate keys removed: ${removedKeysAll.length}`);
    console.log(`    Sample removed: ${removedKeysAll.slice(0, 6).join(', ')}${removedKeysAll.length > 6 ? '...' : ''}`);
    console.log(`    Audit entries pruned: ${auditEntriesRemoved}`);

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

  console.log(`\nDone. Cars affected: ${totalAffected}. Total duplicate keys removed: ${totalRemovedKeys}. Audit entries pruned: ${totalAuditEntriesScrubbed}.`);
  if (!APPLY && totalAffected > 0) {
    console.log('Re-run with --apply to apply changes.');
  }
}

main()
  .catch(e => { console.error('Fatal error:', e.message); process.exit(1); })
  .finally(() => sql.end());
