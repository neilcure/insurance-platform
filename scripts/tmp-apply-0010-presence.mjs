// One-shot: apply db/migrations/0010_add_user_presence.sql.
//
// The migrations 0001-0009 in this repo are hand-written SQL that the
// team applies outside drizzle-kit's `migrate` (the journal still only
// tracks 0000). To stay consistent with that workflow, this script
// reads the file and runs it. It's idempotent — the migration uses
// CREATE TABLE / INDEX IF NOT EXISTS — so re-running it is safe.
//
// Usage: node scripts/tmp-apply-0010-presence.mjs
// Delete after applying (compact picks it up via the tmp-* glob).

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
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sqlPath = resolve(__dirname, "..", "db", "migrations", "0010_add_user_presence.sql");
if (!existsSync(sqlPath)) {
  console.error(`Migration file not found: ${sqlPath}`);
  process.exit(1);
}

const sqlText = readFileSync(sqlPath, "utf-8");
const client = postgres(url, { max: 1, ssl: "require" });

try {
  console.log("Applying 0010_add_user_presence.sql ...");
  await client.unsafe(sqlText);

  // Verify by inspecting the new table.
  const cols = await client/* sql */`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'user_presence'
    ORDER BY ordinal_position
  `;
  console.log("user_presence columns:");
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(28)} nullable=${c.is_nullable}`);
  }

  const idx = await client/* sql */`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'user_presence'
    ORDER BY indexname
  `;
  console.log("user_presence indexes:");
  for (const i of idx) console.log(`  ${i.indexname}`);

  console.log("\nDone.");
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
