/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

const GROUP_KEY = "policy_statuses";

const AGENT_STATUSES = [
  {
    value: "commission_pending",
    label: "Commission Pending",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  },
  {
    value: "statement_created",
    label: "Statement Created",
    color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  },
  {
    value: "statement_sent",
    label: "Statement Sent",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  },
  {
    value: "statement_confirmed",
    label: "Statement Confirmed",
    color: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  },
  {
    value: "credit_advice_prepared",
    label: "Credit Advice Prepared",
    color: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  },
  {
    value: "credit_advice_sent",
    label: "Credit Advice Sent",
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
  {
    value: "credit_advice_confirmed",
    label: "Credit Advice Confirmed",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  },
  {
    value: "commission_settled",
    label: "Commission Settled",
    color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
];

function readEnvFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function pickEnvValue(envText, key) {
  const re = new RegExp(`^${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\r\\n#]+))`, "m");
  const m = envText.match(re);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim();
}

function getEnv(key) {
  if (process.env[key]) return String(process.env[key]);
  const envLocal = readEnvFile(path.join(process.cwd(), ".env.local"));
  if (envLocal) {
    const v = pickEnvValue(envLocal, key);
    if (v) return v;
  }
  const env = readEnvFile(path.join(process.cwd(), ".env"));
  if (env) {
    const v = pickEnvValue(env, key);
    if (v) return v;
  }
  return null;
}

function getDatabaseUrl() {
  const v = getEnv("DATABASE_URL");
  if (!v) throw new Error("DATABASE_URL not found in env/.env.local/.env");
  return v;
}

async function main() {
  const sql = postgres(getDatabaseUrl(), { ssl: "require", max: 1 });
  try {
    const existing = await sql`
      select id, value, sort_order as "sortOrder", meta
      from form_options
      where group_key = ${GROUP_KEY}
      order by sort_order asc, id asc
    `;

    const existingByValue = new Map(existing.map((r) => [String(r.value), r]));
    let maxSort = existing.reduce((m, r) => Math.max(m, Number(r.sortOrder) || 0), 0);
    const inserted = [];
    const updated = [];

    for (const s of AGENT_STATUSES) {
      const row = existingByValue.get(s.value);
      if (!row) {
        maxSort += 10;
        await sql`
          insert into form_options (
            group_key, label, value, value_type, sort_order, is_active, meta
          ) values (
            ${GROUP_KEY}, ${s.label}, ${s.value}, 'string', ${maxSort}, true,
            ${{
              color: s.color,
              triggersInvoice: false,
            }}
          )
        `;
        inserted.push(s.value);
        continue;
      }

      const meta = (row.meta && typeof row.meta === "object") ? { ...row.meta } : {};
      if (!meta.color) {
        meta.color = s.color;
        await sql`
          update form_options
          set meta = ${meta}
          where id = ${row.id}
        `;
        updated.push(s.value);
      }
    }

    console.log(`Inserted: ${inserted.length} -> ${inserted.join(", ") || "(none)"}`);
    console.log(`Updated (added missing color): ${updated.length} -> ${updated.join(", ") || "(none)"}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
