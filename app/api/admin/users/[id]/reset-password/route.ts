import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users, appSettings } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { type PasswordPolicy, DEFAULT_PASSWORD_POLICY, validatePassword } from "@/lib/password-policy";

const Body = z.object({
  newPassword: z.string().min(1, "Password is required"),
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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const json = await request.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }

    const policy = await loadPolicy();
    const policyErrors = validatePassword(parsed.data.newPassword, policy);
    if (policyErrors.length > 0) {
      return NextResponse.json({ error: policyErrors.join(". ") }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);

    const [updated] = await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId))
      .returning({ id: users.id, email: users.email });

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, email: updated.email }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
