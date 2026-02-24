/* eslint-disable no-console */
/**
 * End-to-end dev test (no browser):
 * - ensure a known Credentials user exists
 * - sign in via NextAuth endpoints to obtain session cookie
 * - PATCH /api/clients/:id with deletedKeys (and intentionally conflicting insured values)
 * - verify DB extra_attributes no longer contains the keys
 *
 * Usage:
 *   node scripts/dev-auth-and-test-client-delete.js --clientId=83
 *
 * Optional:
 *   --email=devtest-admin@example.com
 *   --password=devtest123!
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
  const existing = await sql/* sql */`select id, email from users where email=${email} limit 1`;
  if (existing.length) {
    console.log("Dev user exists:", email);
    return { id: existing[0].id, email };
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const rows = await sql/* sql */`
    insert into users (email, password_hash, user_type, is_active, name)
    values (${email}, ${passwordHash}, 'admin', true, 'Dev Test Admin')
    returning id, email
  `;
  console.log("Dev user created:", email);
  return { id: rows[0].id, email };
}

async function signInGetSessionCookie({ baseUrl, email, password }) {
  const jar = new Map();

  // 1) CSRF
  const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`, { method: "GET" });
  addSetCookiesToJar(getSetCookieArray(csrfRes), jar);
  const csrfJson = await csrfRes.json();
  const csrfToken = csrfJson?.csrfToken;
  if (!csrfToken) throw new Error("Failed to get csrfToken from /api/auth/csrf");

  // 2) Credentials callback
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

  // NextAuth sets one of these:
  // - next-auth.session-token
  // - __Secure-next-auth.session-token
  const sessionCookieName =
    jar.has("next-auth.session-token")
      ? "next-auth.session-token"
      : jar.has("__Secure-next-auth.session-token")
        ? "__Secure-next-auth.session-token"
        : null;
  if (!sessionCookieName) {
    const text = await cbRes.text().catch(() => "");
    throw new Error(
      `Sign-in did not yield a session cookie. Status=${cbRes.status}. Body=${text.slice(0, 400)}`
    );
  }
  return { jar, sessionCookieName };
}

async function patchDelete({ baseUrl, cookieJar, clientId, telValue, blockNameValue }) {
  const payload = {
    deletedKeys: ["contactinfo_tel", "contactinfo_blockname"],
    // Intentionally conflicting values to prove deletedKeys wins.
    insured: { contactinfo_tel: telValue, contactinfo_blockname: blockNameValue },
  };
  const res = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-debug": "1",
      cookie: cookieHeaderFromJar(cookieJar),
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function dbCheckExtra(sql, clientId) {
  const rows = await sql/* sql */`select extra_attributes as extra from clients where id=${clientId} limit 1`;
  if (!rows.length) return { found: false };
  const extra = (rows[0].extra && typeof rows[0].extra === "object") ? rows[0].extra : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(extra, k);
  return {
    found: true,
    keys: {
      contactinfo_tel: { present: has("contactinfo_tel"), value: has("contactinfo_tel") ? extra.contactinfo_tel : undefined },
      contactinfo_blockname: { present: has("contactinfo_blockname"), value: has("contactinfo_blockname") ? extra.contactinfo_blockname : undefined },
      contactinfo__tel: { present: has("contactinfo__tel"), value: has("contactinfo__tel") ? extra["contactinfo__tel"] : undefined },
      contactinfo__blockname: { present: has("contactinfo__blockname"), value: has("contactinfo__blockname") ? extra["contactinfo__blockname"] : undefined },
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const clientId = Number(args.clientId ?? 83);
  const email = String(args.email ?? "devtest-admin@example.com").trim().toLowerCase();
  const password = String(args.password ?? "devtest123!").trim();

  const baseUrl = getBaseUrl();
  const databaseUrl = getDatabaseUrl();

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await ensureDevUser(sql, { email, password });

    const before = await dbCheckExtra(sql, clientId);
    if (!before.found) throw new Error(`Client ${clientId} not found`);
    const telValue = before.keys.contactinfo_tel.present ? before.keys.contactinfo_tel.value : 88888888;
    const blockNameValue = before.keys.contactinfo_blockname.present ? before.keys.contactinfo_blockname.value : "BLOCK";

    console.log("DB before:", {
      contactinfo_tel: before.keys.contactinfo_tel,
      contactinfo_blockname: before.keys.contactinfo_blockname,
    });

    const { jar } = await signInGetSessionCookie({ baseUrl, email, password });
    console.log("Signed in via Credentials. Got session cookie.");

    const patched = await patchDelete({ baseUrl, cookieJar: jar, clientId, telValue, blockNameValue });
    console.log("PATCH status:", patched.status);
    console.log("PATCH debug.stored:", patched?.json?.debug?.stored ?? null);

    const after = await dbCheckExtra(sql, clientId);
    console.log("DB after:", {
      contactinfo_tel: after.keys.contactinfo_tel,
      contactinfo_blockname: after.keys.contactinfo_blockname,
      contactinfo__tel: after.keys.contactinfo__tel,
      contactinfo__blockname: after.keys.contactinfo__blockname,
    });

    const ok =
      after.keys.contactinfo_tel.present === false &&
      after.keys.contactinfo_blockname.present === false &&
      after.keys.contactinfo__tel.present === false &&
      after.keys.contactinfo__blockname.present === false;

    if (!ok) {
      throw new Error("Delete did NOT persist (keys still present in DB).");
    }

    console.log("OK: deleted keys are absent from DB extra_attributes.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exitCode = 1;
});

