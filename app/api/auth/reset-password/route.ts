import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users, passwordResets } from "@/db/schema/core";
import { and, eq, gt, isNull } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";

const ResetBody = z.object({
  token: z.string().min(1),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = ResetBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const { token, password } = parsed.data;

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const nowIso = new Date().toISOString();

    const [reset] = await db
      .select()
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, nowIso as unknown as any)
        )
      )
      .limit(1);

    if (!reset) {
      return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));
      await tx.update(passwordResets).set({ usedAt: nowIso as unknown as any }).where(eq(passwordResets.id, reset.id));
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}




















