import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

type ColumnPreset = {
  id: string;
  name: string;
  columns: string[];
  isDefault: boolean;
};

function settingsKey(userId: string, scope: string) {
  return `view_presets:user:${userId}:${scope}`;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "default";
    const key = settingsKey(user.id, scope);

    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);

    const presets = (row?.value as ColumnPreset[] | null) ?? [];
    return NextResponse.json(presets);
  } catch (err) {
    if ((err as Error)?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "default";
    const key = settingsKey(user.id, scope);

    const body = (await request.json()) as ColumnPreset[];

    if (!Array.isArray(body) || body.length > 5) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    await db
      .insert(appSettings)
      .values({ key, value: body as any, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: body as any, updatedAt: new Date().toISOString() },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as Error)?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
