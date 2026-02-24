import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users, userInvites } from "@/db/schema/core";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

type PostBody = {
  token: string;
  password: string;
};

export async function POST(request: Request) {
  try {
    const { token, password } = (await request.json()) as PostBody;
    if (typeof token !== "string" || token.length === 0) {
      return NextResponse.json({ error: "Invalid token" }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 10) {
      return NextResponse.json({ error: "Password must be at least 10 characters" }, { status: 400 });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const nowIso = new Date().toISOString();

    const [invite] = await db
      .select()
      .from(userInvites)
      .where(
        and(
          eq(userInvites.tokenHash, tokenHash),
          isNull(userInvites.usedAt),
          gt(userInvites.expiresAt, nowIso as unknown as any)
        )
      )
      .limit(1);

    if (!invite) {
      return NextResponse.json({ error: "Invalid or expired invite" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, isActive: true }).where(eq(users.id, invite.userId));
      await tx.update(userInvites).set({ usedAt: nowIso as unknown as any }).where(eq(userInvites.id, invite.id));
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}




















