// Diagnostic: prints recent signing_sessions rows and the matching
// `documentTracking` entry on the parent policy, so we can see why
// the in-app "Sign link" / "Signed PDF" affordances aren't showing.
//
// Three things must all be true for the UI to render the signed PDF
// link in DocumentsTab:
//   1. signing_sessions row exists with a signed_at + signed_pdf_stored_name
//   2. policies.document_tracking[tracking_key].signingSessionToken === <token>
//   3. policies.document_tracking[tracking_key].signedPdfStoredName === <stored_name>
//
// If (2) or (3) is missing, something is overwriting the tracking
// entry between sign-time and now. This script tells us which.
//
// Usage:  node scripts/tmp-diagnose-signing.mjs
// Delete after debugging.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(resolve(__dirname, "..", ".env.local"));
loadEnvFile(resolve(__dirname, "..", ".env"));

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const client = postgres(url, { max: 1 });

try {
  const sessions = await client/* sql */`
    SELECT id, token, policy_id, tracking_key, recipient_email,
           signed_at, declined_at, signed_pdf_stored_name, created_at
    FROM signing_sessions
    ORDER BY id DESC
    LIMIT 5
  `;
  if (sessions.length === 0) {
    console.log("No signing_sessions rows found at all.");
    process.exit(0);
  }
  console.log(`Found ${sessions.length} recent signing_sessions row(s):\n`);
  for (const s of sessions) {
    console.log("─".repeat(70));
    console.log(`Session #${s.id}`);
    console.log(`  token                : ${s.token.slice(0, 16)}...`);
    console.log(`  policy_id            : ${s.policy_id}`);
    console.log(`  tracking_key         : ${s.tracking_key}`);
    console.log(`  recipient_email      : ${s.recipient_email}`);
    console.log(`  signed_at            : ${s.signed_at ?? "— (not signed)"}`);
    console.log(`  declined_at          : ${s.declined_at ?? "— (not declined)"}`);
    console.log(`  signed_pdf_stored_name: ${s.signed_pdf_stored_name ?? "— (not stored)"}`);
    console.log(`  created_at           : ${s.created_at}`);

    const [policy] = await client/* sql */`
      SELECT id, document_tracking FROM policies WHERE id = ${s.policy_id}
    `;
    if (!policy) { console.log("  POLICY MISSING / DELETED"); continue; }

    const tracking = policy.document_tracking ?? {};
    const entry = tracking[s.tracking_key];
    console.log(`\n  Tracking entry at policy.document_tracking["${s.tracking_key}"]:`);
    if (!entry) {
      console.log("    >>> MISSING — no entry under this key. UI won't show anything.");
      console.log("    Other keys present in this policy:", Object.keys(tracking));
    } else {
      console.log("   ", JSON.stringify(entry, null, 4).split("\n").join("\n    "));
      console.log("\n  Field check:");
      console.log(`    status                 : ${entry.status ?? "(missing)"}`);
      console.log(`    signingSessionToken    : ${entry.signingSessionToken ? entry.signingSessionToken.slice(0,16)+"..." : ">>> MISSING"}`);
      console.log(`    signedPdfStoredName    : ${entry.signedPdfStoredName ?? ">>> MISSING"}`);
      console.log(`    confirmMethod          : ${entry.confirmMethod ?? "(missing)"}`);
      const tokensMatch = entry.signingSessionToken === s.token;
      console.log(`    token matches session  : ${tokensMatch ? "YES" : ">>> NO (" + entry.signingSessionToken + " vs " + s.token + ")"}`);
    }
    console.log("");
  }
} catch (err) {
  console.error("Diagnostic failed:", err);
  process.exit(2);
} finally {
  await client.end();
}
