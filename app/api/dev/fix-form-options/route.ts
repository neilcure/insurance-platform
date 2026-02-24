import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }
  try {
    // 1) Dedupe existing rows by (group_key, value), keeping the newest active row.
    const dedupeRes = await db.execute(sql`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY "group_key", "value"
            ORDER BY "is_active" DESC, "created_at" DESC, "id" DESC
          ) AS rn
        FROM "form_options"
      )
      DELETE FROM "form_options" f
      USING ranked r
      WHERE f."id" = r."id" AND r."rn" > 1
      RETURNING f."id";
    `);

    const deletedCount =
      Array.isArray(dedupeRes)
        ? dedupeRes.length
        : (dedupeRes as unknown as { rowCount?: number; rows?: unknown[] }).rowCount ??
          ((dedupeRes as unknown as { rows?: unknown[] }).rows?.length ?? 0);

    // 2) Ensure unique constraint exists (works even if table pre-existed without it).
    await db.execute(sql`
      DO $$
      BEGIN
        ALTER TABLE "form_options"
          ADD CONSTRAINT "form_options_group_value_unique" UNIQUE ("group_key", "value");
      EXCEPTION
        WHEN duplicate_object THEN
          -- already exists
          NULL;
      END $$;
    `);

    // 3) Ensure group_key index exists.
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "form_options_group_key_idx" ON "form_options" ("group_key");
    `);

    return NextResponse.json({ ok: true, deletedDuplicates: deletedCount }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Fix failed" }, { status: 500 });
  }
}

