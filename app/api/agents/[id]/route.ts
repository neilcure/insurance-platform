import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { hasCompletedSetup } from "@/lib/auth/user-setup-status";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await context.params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    if (!(me.userType === "admin" || me.userType === "internal_staff" || (me.userType === "agent" && Number(me.id) === userId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const [row] = await db
      .select({
        id: users.id,
        userNumber: users.userNumber,
        email: users.email,
        mobile: users.mobile,
        name: users.name,
        profileMeta: users.profileMeta,
        userType: users.userType,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const completed = await hasCompletedSetup(userId);
    return NextResponse.json({ ...row, hasCompletedSetup: completed }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

