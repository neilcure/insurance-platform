import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import { generateNextUserNumber } from "@/lib/user-number";

export async function POST() {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Ensure required structures exist (self-healing in dev) - safe IF NOT EXISTS DDL
    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "user_number" text`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "user_counters" (
          "user_type" "user_type" NOT NULL,
          "last_number" integer NOT NULL DEFAULT 0,
          "updated_at" timestamp DEFAULT now(),
          CONSTRAINT "user_counters_pk" PRIMARY KEY ("user_type")
        )
      `);
    } catch {
      // ignore
    }

    // Try to query with userNumber column; if missing (migration not applied), return helpful error
    let missing: { id: number; userType: string }[] = [];
    try {
      missing =
        (await db
          .select({ id: users.id, userType: users.userType })
          .from(users)
          .where(and(isNull(users.userNumber), inArray(users.userType, ["admin", "agent", "accounting", "internal_staff"] as any)))
          .limit(1000)) as any;
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("user_number") || msg.toLowerCase().includes("column") || msg.toLowerCase().includes("relation")) {
        return NextResponse.json(
          { error: "Database migrations not applied. Please run `npm run db:migrate` and try again." },
          { status: 400 }
        );
      }
      throw err;
    }

    let updated = 0;
    for (const u of missing) {
      try {
        const num = await generateNextUserNumber(u.userType as any);
        await db.update(users).set({ userNumber: num }).where(eq(users.id, u.id));
        updated += 1;
      } catch (err: any) {
        const msg = String(err?.message ?? "");
        if (msg.toLowerCase().includes("user_counters") || msg.toLowerCase().includes("relation")) {
          return NextResponse.json(
            { error: "Numbering tables not found. Please run `npm run db:migrate` and try again." },
            { status: 400 }
          );
        }
        console.error("Failed to assign number for user", u.id, err);
      }
    }
    return NextResponse.json({ ok: true, updated }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

