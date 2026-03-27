import { readFileSync } from 'fs';
import postgres from 'postgres';

const envContent = readFileSync('.env', 'utf8');
const dbMatch = envContent.match(/DATABASE_URL="?([^"\n]+)"?/);
const dbUrl = dbMatch?.[1];
if (!dbUrl) { console.error('No DATABASE_URL found'); process.exit(1); }

const sql = postgres(dbUrl, { ssl: 'require' });

// Check the endorsement flow steps configuration
const flowSteps = await sql`
  SELECT id, label, value, sort_order, group_key, meta 
  FROM form_options 
  WHERE group_key LIKE '%endorsement%'
  ORDER BY group_key, sort_order
`;
console.log(`Endorsement-related form_options: ${flowSteps.length}`);
for (const s of flowSteps) {
  console.log(`  group_key="${s.group_key}", id=${s.id}, label="${s.label}", value="${s.value}"`);
  if (s.meta) console.log(`    meta=${JSON.stringify(s.meta)}`);
}

// Check the ordertype_category options and ordertype_fields
const otCats = await sql`
  SELECT id, label, value, sort_order, meta 
  FROM form_options 
  WHERE group_key = 'ordertype_category'
  ORDER BY sort_order
`;
console.log(`\nordertype_category options: ${otCats.length}`);
for (const c of otCats) {
  console.log(`  id=${c.id}, value="${c.value}", label="${c.label}", meta=${JSON.stringify(c.meta)}`);
}

// Check the ordertype steps (wizardStep assignments)
const otSteps = await sql`
  SELECT id, label, value, sort_order, meta 
  FROM form_options 
  WHERE group_key = 'orderType_steps'
  ORDER BY sort_order
`;
console.log(`\norderType_steps: ${otSteps.length}`);
for (const s of otSteps) {
  const meta = s.meta || {};
  console.log(`  id=${s.id}, label="${s.label}", value="${s.value}", wizardStep=${meta.wizardStep}, packages=${JSON.stringify(meta.packages)}`);
}

// Check how categories are set in the flow
const otFields = await sql`
  SELECT id, label, value, sort_order, meta 
  FROM form_options 
  WHERE group_key = 'ordertype_fields'
  ORDER BY sort_order
`;
console.log(`\nordertype_fields: ${otFields.length}`);
for (const f of otFields) {
  console.log(`  id=${f.id}, value="${f.value}", label="${f.label}", meta=${JSON.stringify(f.meta)}`);
}

await sql.end();
