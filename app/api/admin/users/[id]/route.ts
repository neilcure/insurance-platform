import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users, memberships } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateNextUserNumber } from "@/lib/user-number";

const PatchBody = z.object({
  name: z.string().optional(),
  userType: z.enum(["admin", "agent", "accounting", "internal_staff"]).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    const parsed = PatchBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const values = parsed.data;
    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 });
    }
    // Non-admins cannot assign admin or agent roles
    if ((await requireUser()).userType !== "admin" && (values.userType === "admin" || values.userType === "agent")) {
      return NextResponse.json({ error: "Only admin can assign admin/agent roles." }, { status: 403 });
    }
    const [updated] = await db
      .update(users)
      .set(values)
      .where(eq(users.id, userId))
      .returning({ id: users.id, userType: users.userType, isActive: users.isActive, name: users.name, userNumber: users.userNumber });

    // If userType changed to an allowed type and userNumber is missing, assign one
    if (values.userType && ["admin", "agent", "accounting", "internal_staff"].includes(values.userType) && !updated.userNumber) {
      try {
        // Get the user's organisation (first membership)
        let orgId: number | undefined;
        try {
          const orgRows = await db.select({ organisationId: memberships.organisationId }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
          orgId = Number(orgRows?.[0]?.organisationId);
        } catch {}
        const userNumber = await generateNextUserNumber(values.userType as any, orgId);
        const [after] = await db
          .update(users)
          .set({ userNumber })
          .where(eq(users.id, userId))
          .returning({ id: users.id, userType: users.userType, isActive: users.isActive, name: users.name, userNumber: users.userNumber });
        return NextResponse.json(
          { id: after.id, userType: after.userType, isActive: after.isActive, name: after.name, userNumber: after.userNumber },
          { status: 200 }
        );
      } catch (err) {
        console.error("Failed to generate userNumber on PATCH:", err);
        // Continue returning the original update if numbering fails
      }
    }

    return NextResponse.json(
      { id: updated.id, userType: updated.userType, isActive: updated.isActive, name: updated.name, userNumber: updated.userNumber },
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
    if (Number(me.id) === userId) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }
    await db.delete(users).where(eq(users.id, userId));
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

















