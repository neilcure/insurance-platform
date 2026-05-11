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
    const rows = await sql`SELECT c.extra_attributes FROM cars c WHERE c.id = 368`;
    const ea = rows[0]?.extra_attributes;
    if (!ea) { console.log('extra_attributes is NULL'); return; }
    const keys = Object.keys(ea);
    console.log('Keys in extra_attributes:', keys.join(', '));
    // Show first 3000 chars
    const str = JSON.stringify(ea, null, 2);
    console.log(str.slice(0, 3000));
    if (str.length > 3000) console.log('...[truncated]');
  } finally {
    await sql.end();
  }
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
