const fs = require("fs");
const postgres = require("postgres");

const envText = fs.readFileSync(".env.local", "utf8");
const match = envText.match(/DATABASE_URL=\"([^\"]+)\"/);
if (!match) throw new Error("DATABASE_URL not found in .env.local");
const sql = postgres(match[1], { ssl: "require" });

async function main() {
  const rows = await sql`
    select id, label, value, meta
    from form_options
    where group_key = 'document_templates'
      and value = 'agent_commission_credit_advice'
    limit 1
  `;
  if (rows.length === 0) throw new Error("Template not found");
  console.log(JSON.stringify(rows[0], null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await sql.end();
  });
