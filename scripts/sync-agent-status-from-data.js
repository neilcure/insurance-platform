/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

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

function parseArgs(argv) {
  const out = { apply: false, policyId: 0 };
  for (const a of argv.slice(2)) {
    if (a === "--apply") out.apply = true;
    const m = a.match(/^--policyId=(\d+)$/);
    if (m) out.policyId = Number(m[1]) || 0;
  }
  return out;
}

function normalizeObj(raw) {
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

function deriveAgentStatus(tracking, commissionStatuses) {
  const entries = Object.entries(tracking || {}).filter(([k]) => !k.startsWith("_") && k.endsWith("_agent"));

  const hasStatus = (keywords, statuses) =>
    entries.some(([k, v]) =>
      keywords.some((kw) => k.toLowerCase().includes(kw))
      && !!v
      && !!v.status
      && statuses.includes(String(v.status).toLowerCase()),
    );

  const hasPreparedDocNumber = (keywords) =>
    entries.some(([k, v]) =>
      keywords.some((kw) => k.toLowerCase().includes(kw))
      && !!v
      && !!v.documentNumber
      && (!v.status || String(v.status).toLowerCase() === "prepared"),
    );

  const lowerStatuses = (commissionStatuses || []).map((s) => String(s).toLowerCase());
  const hasStatementCreated = lowerStatuses.includes("statement_created");
  const hasSettled = lowerStatuses.some((s) => s === "paid" || s === "verified" || s === "settled");
  const hasAnyCommission = lowerStatuses.length > 0;

  const statementKeywords = ["statement"];
  const creditKeywords = ["credit", "commission_credit", "credit_advice", "advice"];

  if (hasSettled) return "commission_settled";
  if (hasStatus(creditKeywords, ["confirmed"])) return "credit_advice_confirmed";
  if (hasStatus(creditKeywords, ["sent"])) return "credit_advice_sent";
  if (hasPreparedDocNumber(creditKeywords)) return "credit_advice_prepared";
  if (hasStatus(statementKeywords, ["confirmed"])) return "statement_confirmed";
  if (hasStatus(statementKeywords, ["sent"])) return "statement_sent";
  if (hasPreparedDocNumber(statementKeywords) || hasStatementCreated) return "statement_created";
  if (hasAnyCommission) return "commission_pending";
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const sql = postgres(getDatabaseUrl(), { ssl: "require", max: 1 });

  try {
    const policies = await sql`
      select
        p.id as "policyId",
        p.agent_id as "agentId",
        p.document_tracking as "tracking",
        c.id as "carId",
        c.extra_attributes as "extra"
      from policies p
      inner join cars c on c.policy_id = p.id
      where p.agent_id is not null
        and (${args.policyId} = 0 or p.id = ${args.policyId})
      order by p.id asc
    `;

    let scanned = 0;
    let changes = 0;

    for (const p of policies) {
      scanned += 1;
      const tracking = normalizeObj(p.tracking);
      const extra = normalizeObj(p.extra);

      const inv = await sql`
        select status
        from accounting_invoices
        where entity_policy_id = ${p.policyId}
          and entity_type = 'agent'
          and direction = 'payable'
          and premium_type = 'agent_premium'
          and status <> 'cancelled'
      `;
      const commissionStatuses = inv.map((r) => r.status);
      const target = deriveAgentStatus(tracking, commissionStatuses);
      if (!target) continue;

      const current = String(extra.statusAgent ?? extra.statusClient ?? extra.status ?? "quotation_prepared");
      if (current === target) continue;

      const hist = Array.isArray(extra.statusHistoryAgent) ? [...extra.statusHistoryAgent] : [];
      hist.push({
        status: target,
        changedAt: new Date().toISOString(),
        changedBy: "system:sync-agent-status",
        note: "One-time sync from statements/commission/doc-tracking",
      });

      extra.statusAgent = target;
      extra.statusHistoryAgent = hist;
      extra._lastEditedAt = new Date().toISOString();

      changes += 1;
      if (args.apply) {
        await sql`
          update cars
          set extra_attributes = ${extra}
          where id = ${p.carId}
        `;
      }
    }

    console.log(`Mode: ${args.apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`Scanned policies: ${scanned}`);
    console.log(`Updated agent statuses: ${changes}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
