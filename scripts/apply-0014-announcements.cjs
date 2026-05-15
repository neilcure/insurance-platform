/**
 * Applies db/migrations/0014_announcements.sql when it is not yet picked up
 * by drizzle-kit's journal (manual migration file).
 *
 * Usage (from repo root):
 *   node --env-file=.env.local scripts/apply-0014-announcements.cjs
 *   node --env-file=.env scripts/apply-0014-announcements.cjs
 *
 * Requires DATABASE_URL in the environment.
 */

const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set.\nTry:\n  node --env-file=.env.local scripts/apply-0014-announcements.cjs",
    );
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "..", "db", "migrations", "0014_announcements.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  const sqlConn = postgres(url, { max: 1 });
  try {
    await sqlConn.unsafe(sql);
    console.log("OK — applied db/migrations/0014_announcements.sql");
  } finally {
    await sqlConn.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
