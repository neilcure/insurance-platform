/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

function parseArgs(argv) {
  const out = { apply: false, limit: 0 };
  for (const a of argv.slice(2)) {
    if (a === "--apply") out.apply = true;
    const m = a.match(/^--limit=(\d+)$/);
    if (m) out.limit = Number(m[1]) || 0;
  }
  return out;
}

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

function cloneHistoryWithStatus(status, history) {
  if (Array.isArray(history) && history.length > 0) return [...history];
  return [
    {
      status,
      changedAt: new Date().toISOString(),
      changedBy: "system:backfill",
      note: "Backfilled from legacy status",
    },
  ];
}

function normalizeExtra(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { ...parsed };
    } catch {
      return {};
    }
  }
  return {};
}

async function main() {
  const args = parseArgs(process.argv);
  const sql = postgres(getDatabaseUrl(), { max: 1, ssl: "require" });

  try {
    const rows = await sql/* sql */`
      select
        c.id as "carId",
        c.policy_id as "policyId",
        c.extra_attributes as "extra",
        p.agent_id as "agentId"
      from cars c
      left join policies p on p.id = c.policy_id
      where c.extra_attributes is not null
      order by c.id asc
      ${args.limit > 0 ? sql`limit ${args.limit}` : sql``}
    `;

    let scanned = 0;
    let changed = 0;
    let clientBackfilled = 0;
    let agentBackfilled = 0;

    for (const row of rows) {
      scanned += 1;
      const extra = normalizeExtra(row.extra);
      const legacyStatus = String(extra.status ?? "quotation_prepared");
      const legacyHistory = Array.isArray(extra.statusHistory) ? extra.statusHistory : [];
      const hasAgent = Number(row.agentId) > 0;

      let rowChanged = false;

      if (!extra.statusClient) {
        extra.statusClient = legacyStatus;
        clientBackfilled += 1;
        rowChanged = true;
      }
      if (!Array.isArray(extra.statusHistoryClient) || extra.statusHistoryClient.length === 0) {
        extra.statusHistoryClient = cloneHistoryWithStatus(String(extra.statusClient ?? legacyStatus), legacyHistory);
        rowChanged = true;
      }

      if (hasAgent) {
        if (!extra.statusAgent) {
          extra.statusAgent = String(extra.statusClient ?? legacyStatus);
          agentBackfilled += 1;
          rowChanged = true;
        }
        if (!Array.isArray(extra.statusHistoryAgent) || extra.statusHistoryAgent.length === 0) {
          extra.statusHistoryAgent = cloneHistoryWithStatus(String(extra.statusAgent ?? extra.statusClient ?? legacyStatus), legacyHistory);
          rowChanged = true;
        }
      }

      if (!rowChanged) continue;
      changed += 1;

      if (args.apply) {
        await sql/* sql */`
          update cars
          set extra_attributes = ${extra}
          where id = ${row.carId}
        `;
      }
    }

    console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`Scanned cars: ${scanned}`);
    console.log(`Rows needing update: ${changed}`);
    console.log(`Client track backfilled: ${clientBackfilled}`);
    console.log(`Agent track backfilled: ${agentBackfilled}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
