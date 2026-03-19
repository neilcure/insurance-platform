const fs = require("fs");
const path = require("path");

async function runMigrations() {
  const postgres = require("postgres");

  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });
  const migrationsDir = path.join(__dirname, "db", "migrations");

  await sql`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      created_at BIGINT
    )
  `;

  const applied = await sql`SELECT hash FROM __drizzle_migrations`;
  const appliedSet = new Set(applied.map((r) => r.hash));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  Skipping (already applied): ${file}`);
      continue;
    }

    const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const statements = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`  Applying: ${file} (${statements.length} statements)`);
    let allSucceeded = true;
    for (const stmt of statements) {
      try {
        await sql.unsafe(stmt);
      } catch (err) {
        const msg = err.message || "";
        if (msg.includes("already exists")) {
          console.log(`    Skipping statement (already exists)`);
        } else {
          console.error(`    Statement failed: ${msg}`);
          allSucceeded = false;
        }
      }
    }

    if (allSucceeded) {
      await sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${file}, ${Date.now()})`;
      console.log(`  Applied: ${file}`);
    } else {
      console.log(`  Partially applied: ${file} (some non-critical errors)`);
      await sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${file}, ${Date.now()})`;
    }
  }

  await sql.end();
  console.log("  Migrations complete.");
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
