import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, "upload_notification"))
    .limit(1);

  const val = (row?.value ?? { enabled: false }) as Record<string, unknown>;
  return NextResponse.json(val);
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const settings = {
    enabled: !!body.enabled,
    recipientEmail: typeof body.recipientEmail === "string" ? body.recipientEmail.trim() : "",
  };

  await db
    .insert(appSettings)
    .values({ key: "upload_notification", value: settings })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: settings, updatedAt: new Date().toISOString() },
    });

  return NextResponse.json(settings);
}
