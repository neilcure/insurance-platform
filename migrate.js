const fs = require("fs");
const path = require("path");

async function runMigrations() {
  const postgres = require("postgres");

  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
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
    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }

    await sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${file}, ${Date.now()})`;
  }

  await sql.end();
  console.log("  Migrations complete.");
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
