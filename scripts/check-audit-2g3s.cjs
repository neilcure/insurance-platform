const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

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

async function main() {
  try {
    const pols = await sql`SELECT id, policy_number FROM policies WHERE policy_number LIKE 'POLS-1778494%' OR policy_number LIKE 'POLS-%2G3S' ORDER BY id DESC LIMIT 5`;
    console.log('Matches:', pols.map(p => p.policy_number).join(', '));
    if (!pols.length) { console.log('Policy not found'); return; }
    if (!pols.length) { console.log('Policy not found'); return; }
    const policyId = pols[0].id;

    const rows = await sql`
      SELECT c.id as car_id, c.extra_attributes->'_audit' as audit,
             c.extra_attributes->'insuredSnapshot' as snap,
             c.extra_attributes->>'_lastEditedAt' as last_edited
      FROM cars c WHERE c.policy_id = ${policyId} LIMIT 1
    `;

    if (!rows.length) { console.log('No car'); return; }
    const audit = rows[0].audit;
    const snap = rows[0].snap;
    console.log('Last edited:', rows[0].last_edited);
    console.log('\nCurrent insuredSnapshot keys:');
    if (snap) {
      for (const k of Object.keys(snap)) {
        const v = snap[k];
        console.log('  ', k, '=', typeof v === 'string' && v.length > 50 ? v.slice(0,50)+'...' : v);
      }
    }

    console.log('\nAudit entries:', Array.isArray(audit) ? audit.length : 0);
    if (Array.isArray(audit)) {
      for (let i = 0; i < audit.length; i++) {
        const entry = audit[i];
        console.log(`\n[${i}] ${entry.at} by ${entry.by && entry.by.email}`);
        const changes = entry.changes || [];
        const insuredChanges = changes.filter(c => {
          const k = (c.key || '').toLowerCase();
          return k.startsWith('insured') || k.startsWith('contactinfo');
        });
        const otherChanges = changes.filter(c => {
          const k = (c.key || '').toLowerCase();
          return !k.startsWith('insured') && !k.startsWith('contactinfo');
        });
        console.log(`  Total changes: ${changes.length} (insured/contact: ${insuredChanges.length}, other: ${otherChanges.length})`);
        const trunc = (s) => s && s.length > 80 ? s.slice(0,80)+'...' : s;
        console.log('  ALL changes:');
        for (const c of changes) {
          console.log(`    ${c.key}: ${trunc(JSON.stringify(c.from))} -> ${trunc(JSON.stringify(c.to))}`);
        }
      }
    }
  } finally {
    await sql.end();
  }
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
