const fs = require("fs");
const postgres = require("postgres");

const envText = fs.readFileSync(".env.local", "utf8");
const match = envText.match(/DATABASE_URL=\"([^\"]+)\"/);
if (!match) throw new Error("DATABASE_URL not found in .env.local");
const sql = postgres(match[1], { ssl: "require" });

async function main() {
  const rows = await sql`
    select id, meta
    from form_options
    where group_key = 'document_templates'
      and value = 'agent_commission_credit_advice'
    limit 1
  `;
  if (rows.length === 0) throw new Error("Template not found");

  const row = rows[0];
  const meta = { ...(row.meta || {}) };
  const sections = Array.isArray(meta.sections) ? [...meta.sections] : [];
  const idx = sections.findIndex((s) => String(s.id) === "cn3");
  if (idx < 0) throw new Error("Credit Details section (cn3) not found");

  sections[idx] = {
    ...sections[idx],
    source: "statement",
    fields: [
      {
        key: "commissionTotal",
        label: "Commission Credit to Agent",
        format: "currency",
        currencyCode: "HKD",
      },
    ],
  };

  meta.sections = sections;

  await sql`
    update form_options
    set meta = ${meta}
    where id = ${row.id}
  `;

  console.log(`Updated template #${row.id}: cn3 now uses statement.commissionTotal`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end();
  });
