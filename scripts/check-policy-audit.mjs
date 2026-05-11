import { neon } from '@neondatabase/serverless';

const DB_URL = "postgresql://neondb_owner:npg_j95pyShXdMaB@ep-steep-night-a14qtl2o-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const sql = neon(DB_URL);

const rows = await sql`
  SELECT 
    c.id,
    p.policy_number,
    c.extra_attributes->>'_lastEditedAt' as last_edited,
    c.extra_attributes->'_audit' as audit_log,
    c.extra_attributes->'insuredSnapshot' as insured_snapshot
  FROM cars c
  JOIN policies p ON p.car_id = c.id
  WHERE p.policy_number = 'POLS-1778466529253-4H6V'
  LIMIT 1
`;

if (rows.length === 0) {
  console.log('Policy not found');
} else {
  const row = rows[0];
  console.log('Policy ID:', row.id);
  console.log('Policy Number:', row.policy_number);
  console.log('Last Edited:', row.last_edited);
  console.log('\n=== Insured Snapshot ===');
  console.log(JSON.stringify(row.insured_snapshot, null, 2));
  console.log('\n=== Audit Log ===');
  const audit = row.audit_log;
  if (Array.isArray(audit) && audit.length > 0) {
    for (const entry of audit) {
      console.log('\nAudit Entry:', entry.at, 'by', entry.by?.email);
      console.log('Changes:', JSON.stringify(entry.changes, null, 2));
    }
  } else {
    console.log('No audit entries');
  }
}
