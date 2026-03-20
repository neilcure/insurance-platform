import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users, appSettings } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  type PasswordPolicy,
  DEFAULT_PASSWORD_POLICY,
  validatePassword,
} from "@/lib/password-policy";

const Body = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(1, "New password is required"),
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
    const me = await requireUser();
    const userId = Number(me.id);

    const json = await request.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 },
      );
    }

    const { currentPassword, newPassword } = parsed.data;

    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 },
      );
    }

    const policy = await loadPolicy();
    const policyErrors = validatePassword(newPassword, policy);
    if (policyErrors.length > 0) {
      return NextResponse.json(
        { error: policyErrors.join(". ") },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId));

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
