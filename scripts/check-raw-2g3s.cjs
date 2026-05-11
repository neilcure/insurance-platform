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
const sql = postgres(DB_URL, { ssl: { rejectUnauthorized: false }, max: 1, idle_timeout: 5 });

async function main() {
  try {
    const rows = await sql`
      SELECT c.id as car_id, c.extra_attributes::text as raw
      FROM cars c JOIN policies p ON c.policy_id = p.id
      WHERE p.policy_number = 'POLS-1778494153301-2G3S' LIMIT 1
    `;
    const ea = JSON.parse(rows[0].raw);
    console.log('=== _audit (raw, all changes) ===');
    const audit = ea._audit || [];
    for (const entry of audit) {
      console.log(`At: ${entry.at}, By: ${entry.by?.email}`);
      for (const c of entry.changes || []) {
        console.log(`  key="${c.key}"  from=${JSON.stringify(c.from)}  to=${JSON.stringify(c.to)}`);
      }
    }
    console.log('\n=== insuredSnapshot keys ===');
    for (const k of Object.keys(ea.insuredSnapshot || {})) {
      console.log(`  "${k}"`);
    }
    console.log('\n=== packagesSnapshot.insured keys (if any) ===');
    const pkgs = ea.packagesSnapshot || {};
    for (const pkgName of ['insured', 'contactinfo']) {
      const pkg = pkgs[pkgName];
      if (!pkg) { console.log(`  [no ${pkgName} package]`); continue; }
      const vals = pkg.values || pkg;
      console.log(`  ${pkgName} category:`, pkg.category);
      console.log(`  ${pkgName} keys:`);
      for (const k of Object.keys(vals || {})) {
        const v = vals[k];
        console.log(`    "${k}" = ${JSON.stringify(v).slice(0,60)}`);
      }
    }
  } finally { await sql.end(); }
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
