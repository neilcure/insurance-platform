import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users, userInvites } from "@/db/schema/core";
import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token") ?? "";
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const nowIso = new Date().toISOString();

    const rows = await db
      .select({
        email: users.email,
      })
      .from(userInvites)
      .innerJoin(users, eq(users.id, userInvites.userId))
      .where(
        and(
          eq(userInvites.tokenHash, tokenHash),
          isNull(userInvites.usedAt),
          gt(userInvites.expiresAt, nowIso as unknown as any)
        )
      )
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
    }

    return NextResponse.json({ email: rows[0].email }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}




















