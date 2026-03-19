/* eslint-disable no-console */
/**
 * Dev helper: verify what's actually stored in Postgres for a given client.
 *
 * Usage:
 *   node scripts/db-check-client-extra.js 83
 */
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
  // Matches:
  //   KEY="value"
  //   KEY='value'
  //   KEY=value
  const re = new RegExp(`^${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\r\\n#]+))`, "m");
  const m = envText.match(re);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim();
}

function getDatabaseUrl() {
  // Prefer real process env if present (e.g. when running via next/dev).
  let databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && typeof databaseUrl === "string") return normalizeHost(databaseUrl);

  const envLocalPath = path.join(process.cwd(), ".env.local");
  const envPath = path.join(process.cwd(), ".env");

  const envLocal = readEnvFile(envLocalPath);
  if (envLocal) {
    const v = pickEnvValue(envLocal, "DATABASE_URL");
    if (v) return normalizeHost(v);
  }

  const env = readEnvFile(envPath);
  if (env) {
    const v = pickEnvValue(env, "DATABASE_URL");
    if (v) return normalizeHost(v);
  }

  throw new Error("DATABASE_URL is not set (and not found in .env.local/.env).");
}

function normalizeHost(databaseUrl) {
  return databaseUrl;
}

async function main() {
  const clientId = Number(process.argv[2] ?? 83);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    throw new Error(`Invalid client id: ${process.argv[2]}`);
  }

  const databaseUrl = getDatabaseUrl();
  const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

  try {
    const rows = await sql/* sql */ `
      select
        id,
        client_number,
        extra_attributes as extra
      from clients
      where id = ${clientId}
      limit 1
    `;

    if (!rows.length) {
      console.log(`Client not found: id=${clientId}`);
      return;
    }

    const r = rows[0];
    const extra = (r.extra && typeof r.extra === "object") ? r.extra : {};
    const hasOwn = (k) => Object.prototype.hasOwnProperty.call(extra, k);

    console.log(`DB check client id=${r.id} clientNumber=${r.client_number}`);
    for (const k of ["contactinfo_tel", "contactinfo_blockname", "contactinfo__tel", "contactinfo__blockname"]) {
      const present = hasOwn(k);
      const value = present ? extra[k] : undefined;
      console.log(`${k}: present=${present} value=${present ? JSON.stringify(value) : "undefined"}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exitCode = 1;
});

