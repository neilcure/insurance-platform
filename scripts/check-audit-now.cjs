const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

const envFile = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envFile, 'utf-8');
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

async function main() {
  try {
    // Step 1: find the policy
    const pols = await sql`
      SELECT p.id as policy_id, p.policy_number FROM policies p
      WHERE p.policy_number = 'POLS-1778466529253-4H6V'
      LIMIT 5
    `;
    console.log('Policies found:', pols.length);
    if (!pols.length) { console.log('Policy not found in DB'); return; }
    for (const p of pols) console.log('  policy_id=' + p.policy_id, p.policy_number);

    // Step 2: find cars for this policy
    const policyId = pols[0].policy_id;
    const carRows = await sql`
      SELECT c.id as car_id,
             c.extra_attributes IS NOT NULL as has_extra,
             c.extra_attributes->>'_lastEditedAt' as last_edited,
             jsonb_array_length(COALESCE(c.extra_attributes->'_audit','[]'::jsonb)) as audit_count,
             c.extra_attributes->'insuredSnapshot' as snap,
             c.extra_attributes->'_audit' as audit_log
      FROM cars c
      WHERE c.policy_id = ${policyId}
      ORDER BY c.id
    `;
    console.log('\nCar rows for policy:', carRows.length);
    for (const r of carRows) {
      const snap = r.snap;
      const audit = r.audit_log;
      console.log('\n  car_id=' + r.car_id, '| has_extra=' + r.has_extra,
        '| last_edited=' + r.last_edited, '| audit_entries=' + r.audit_count);
      if (snap) console.log('  insuredSnapshot keys:', Object.keys(snap).join(', '));
      else console.log('  insuredSnapshot: null');

      if (Array.isArray(audit)) {
        for (const entry of audit) {
          console.log('\n  [' + entry.at + '] by', entry.by && entry.by.email);
          const insuredChanges = (entry.changes||[]).filter(c =>
            c.key.toLowerCase().startsWith('insured') || c.key.toLowerCase().startsWith('contactinfo')
          );
          console.log('    total changes:', (entry.changes||[]).length, '| insured-related:', insuredChanges.length);
          for (const ch of insuredChanges) {
            console.log('     ', ch.key, ':', JSON.stringify(ch.from), '->', JSON.stringify(ch.to));
          }
        }
      }
    }
  } finally {
    await sql.end();
  }
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
