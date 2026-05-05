import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Body = z.object({
  name: z.string().min(1, "Name is required").max(200),
  mobile: z.string().max(64).optional(),
  timezone: z.string().max(255).optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const me = await requireUser();
    const json = await request.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const updateValues: any = {
      name: parsed.data.name,
      updatedAt: new Date().toISOString() as unknown as any,
    };
    if (typeof parsed.data.timezone === "string" && parsed.data.timezone.trim().length > 0) {
      updateValues.timezone = parsed.data.timezone.trim();
    }
    if (typeof parsed.data.mobile === "string") {
      const trimmedMobile = parsed.data.mobile.trim();
      updateValues.mobile = trimmedMobile.length > 0 ? trimmedMobile : null;
    }

    const [updated] = await db
      .update(users)
      .set(updateValues)
      .where(eq(users.id, Number(me.id)))
      .returning({ id: users.id, name: users.name, mobile: users.mobile, timezone: users.timezone });

    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

