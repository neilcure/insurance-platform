import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";

const BodySchema = z.object({
  hiddenStatuses: z.array(z.string()).max(200),
  visibleFields: z.array(z.string()).max(10),
});

const DEFAULT = { hiddenStatuses: [] as string[], visibleFields: [] as string[] };

export async function GET() {
  try {
    const me = await requireUser();
    const uid = Number(me.id);
    const [row] = await db
      .select({ profileMeta: users.profileMeta })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);
    const meta = (row?.profileMeta ?? {}) as Record<string, unknown>;
    const parsed = BodySchema.safeParse(meta.policyCalendarSettings);
    return NextResponse.json(parsed.success ? parsed.data : DEFAULT, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const me = await requireUser();
    const uid = Number(me.id);
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const [existing] = await db
      .select({ profileMeta: users.profileMeta })
      .from(users)
      .where(eq(users.id, uid))
      .limit(1);

    const prev =
      existing?.profileMeta && typeof existing.profileMeta === "object" && existing.profileMeta !== null
        ? (existing.profileMeta as Record<string, unknown>)
        : {};

    const merged: Record<string, unknown> = {
      ...prev,
      policyCalendarSettings: parsed.data,
    };

    await db
      .update(users)
      .set({
        profileMeta: merged,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, uid));

    return NextResponse.json(parsed.data, { status: 200 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
