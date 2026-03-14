import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { z } from "zod";

const SETTINGS_KEY = "password_policy";

export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
};

const DEFAULTS: PasswordPolicy = {
  minLength: 10,
  requireUppercase: false,
  requireLowercase: false,
  requireNumber: false,
  requireSpecial: false,
};

const PolicySchema = z.object({
  minLength: z.number().int().min(6).max(128),
  requireUppercase: z.boolean(),
  requireLowercase: z.boolean(),
  requireNumber: z.boolean(),
  requireSpecial: z.boolean(),
});

/** Public GET -- no auth required so reset-password page can read it */
export async function GET() {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SETTINGS_KEY))
      .limit(1);
    const policy = (row?.value as PasswordPolicy | undefined) ?? DEFAULTS;
    return NextResponse.json(policy);
  } catch (err) {
    console.error(err);
    return NextResponse.json(DEFAULTS);
  }
}

/** Admin-only POST */
export async function POST(request: NextRequest) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const json = await request.json();
    const parsed = PolicySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid policy" },
        { status: 400 }
      );
    }
    await db
      .insert(appSettings)
      .values({ key: SETTINGS_KEY, value: parsed.data })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed.data } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
