import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users, passwordResets, appSettings } from "@/db/schema/core";
import { and, eq, gt, isNull } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { type PasswordPolicy, DEFAULT_PASSWORD_POLICY, validatePassword } from "@/lib/password-policy";

const ResetBody = z.object({
  token: z.string().min(1),
  password: z.string().min(1, "Password is required"),
});

async function loadPolicy(): Promise<PasswordPolicy> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "password_policy"))
      .limit(1);
    return (row?.value as PasswordPolicy | undefined) ?? DEFAULT_PASSWORD_POLICY;
  } catch {
    return DEFAULT_PASSWORD_POLICY;
  }
}

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = ResetBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    }
    const { token, password } = parsed.data;

    const policy = await loadPolicy();
    const policyErrors = validatePassword(password, policy);
    if (policyErrors.length > 0) {
      return NextResponse.json({ error: policyErrors[0] }, { status: 400 });
    }

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




















