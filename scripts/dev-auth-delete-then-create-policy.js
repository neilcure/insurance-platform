/* eslint-disable no-console */
/**
 * Repro/proof script for the "deleted fields come back" bug:
 * - Auth via Credentials (no browser)
 * - PATCH /api/clients/:id to delete tel/blockname
 * - POST /api/policies with the same clientId but with insured containing STALE tel/blockname
 * - Verify DB still does NOT contain those keys (policy create must not re-add)
 *
 * Usage:
 *   node scripts/dev-auth-delete-then-create-policy.js --clientId=83
 */
const fs = require("node:fs");
const path = require("node:path");

const bcrypt = require("bcryptjs");
const postgres = require("postgres");

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
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

function normalizeHost(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.hostname.toLowerCase() === "host") parsed.hostname = "localhost";
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
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
  return normalizeHost(v);
}

function getBaseUrl() {
  const v = getEnv("NEXTAUTH_URL") || "http://localhost:3000";
  return String(v).replace(/\/+$/, "");
}

function addSetCookiesToJar(setCookies, jar) {
  for (const sc of setCookies) {
    const first = String(sc).split(";")[0] || "";
    const idx = first.indexOf("=");
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1);
    if (!name) continue;
    jar.set(name, value);
  }
}

function cookieHeaderFromJar(jar) {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function getSetCookieArray(res) {
  if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  const one = res.headers.get("set-cookie");
  return one ? [one] : [];
}

async function ensureDevUser(sql, { email, password }) {
  const existing = await sql/* sql */`select id from users where email=${email} limit 1`;
  if (existing.length) return;
  const passwordHash = await bcrypt.hash(password, 10);
  await sql/* sql */`
    insert into users (email, password_hash, user_type, is_active, name)
    values (${email}, ${passwordHash}, 'admin', true, 'Dev Test Admin')
  `;
}

async function signInGetCookieJar({ baseUrl, email, password }) {
  const jar = new Map();
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { method: "GET" });
  addSetCookiesToJar(getSetCookieArray(csrfRes), jar);
  const csrfJson = await csrfRes.json();
  const csrfToken = csrfJson?.csrfToken;
  if (!csrfToken) throw new Error("Failed to get csrfToken");

  const form = new URLSearchParams();
  form.set("csrfToken", csrfToken);
  form.set("email", email);
  form.set("password", password);
  form.set("callbackUrl", `${baseUrl}/`);
  form.set("json", "true");

  const cbRes = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeaderFromJar(jar),
    },
    body: form.toString(),
    redirect: "manual",
  });
  addSetCookiesToJar(getSetCookieArray(cbRes), jar);

  if (!jar.has("next-auth.session-token") && !jar.has("__Secure-next-auth.session-token")) {
    const t = await cbRes.text().catch(() => "");
    throw new Error(`Sign-in failed. status=${cbRes.status} body=${t.slice(0, 300)}`);
  }
  return jar;
}

async function dbKeyPresence(sql, clientId) {
  const rows = await sql/* sql */`select extra_attributes as extra from clients where id=${clientId} limit 1`;
  if (!rows.length) throw new Error(`Client not found: ${clientId}`);
  const extra = (rows[0].extra && typeof rows[0].extra === "object") ? rows[0].extra : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(extra, k);
  return {
    tel: has("contactinfo_tel") ? extra.contactinfo_tel : undefined,
    blockname: has("contactinfo_blockname") ? extra.contactinfo_blockname : undefined,
    telPresent: has("contactinfo_tel"),
    blocknamePresent: has("contactinfo_blockname"),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const clientId = Number(args.clientId ?? 83);
  const email = "devtest-admin@example.com";
  const password = "devtest123!";

  const baseUrl = getBaseUrl();
  const sql = postgres(getDatabaseUrl(), { max: 1 });
  try {
    await ensureDevUser(sql, { email, password });
    const jar = await signInGetCookieJar({ baseUrl, email, password });

    const before = await dbKeyPresence(sql, clientId);
    console.log("DB before:", before);

    // 1) Delete on client
    const delPayload = {
      deletedKeys: ["contactinfo_tel", "contactinfo_blockname"],
      insured: { contactinfo_tel: null, contactinfo_blockname: null },
    };
    const delRes = await fetch(`${baseUrl}/api/clients/${clientId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-debug": "1",
        cookie: cookieHeaderFromJar(jar),
      },
      body: JSON.stringify(delPayload),
    });
    const delJson = await delRes.json().catch(() => ({}));
    console.log("PATCH /api/clients status:", delRes.status);
    console.log("PATCH debug.stored:", delJson?.debug?.stored ?? null);

    const afterDelete = await dbKeyPresence(sql, clientId);
    console.log("DB after delete:", afterDelete);

    // 2) Create policy while sending stale values (this used to re-add them via policy route)
    const policyPayload = {
      policy: { clientId },
      insured: { contactinfo_tel: before.tel ?? 12345678, contactinfo_blockname: before.blockname ?? "STALE" },
      packages: {},
    };
    const polRes = await fetch(`${baseUrl}/api/policies`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeaderFromJar(jar),
      },
      body: JSON.stringify(policyPayload),
    });
    const polJson = await polRes.json().catch(() => ({}));
    console.log("POST /api/policies status:", polRes.status, "body:", polJson);

    const afterPolicy = await dbKeyPresence(sql, clientId);
    console.log("DB after policy create:", afterPolicy);

    if (afterPolicy.telPresent || afterPolicy.blocknamePresent) {
      throw new Error("BUG: policy creation re-added deleted client fields.");
    }

    console.log("OK: policy creation did not re-add deleted fields.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exitCode = 1;
});

