import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { users, memberships } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { generateNextUserNumber } from "@/lib/user-number";

const ProfileMetaPatch = z.object({
  accountType: z.enum(["personal", "company"]).optional(),
  companyName: z.string().nullable().optional(),
  primaryId: z.string().nullable().optional(),
});

const PatchBody = z.object({
  email: z.string().email("Invalid email").optional(),
  mobile: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  userType: z.enum(["admin", "agent", "accounting", "internal_staff"]).optional(),
  isActive: z.boolean().optional(),
  profileMeta: ProfileMetaPatch.optional(),
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
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }
    const values = parsed.data;
    if (Object.keys(values).length === 0) {
      return NextResponse.json({ error: "No changes provided" }, { status: 400 });
    }
    if (values.userType === "admin" || values.userType === "agent") {
      // We already require admin above, but keep the guard explicit.
      if (me.userType !== "admin") {
        return NextResponse.json({ error: "Only admin can assign admin/agent roles." }, { status: 403 });
      }
    }

    // Email change requires uniqueness check (the column is UNIQUE in the DB,
    // but we want a friendly 409 instead of a Postgres unique-violation 500).
    if (typeof values.email === "string") {
      values.email = values.email.trim().toLowerCase();
      if (!values.email) {
        return NextResponse.json({ error: "Email cannot be empty" }, { status: 400 });
      }
      const dupes = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, values.email), ne(users.id, userId)))
        .limit(1);
      if (dupes.length > 0) {
        return NextResponse.json({ error: "Email already in use by another account" }, { status: 409 });
      }
    }

    if (typeof values.mobile === "string") {
      const trimmed = values.mobile.trim();
      values.mobile = trimmed ? trimmed : null;
    }
    if (typeof values.name === "string") {
      const trimmed = values.name.trim();
      values.name = trimmed ? trimmed : null;
    }

    // Merge profileMeta with the existing one so partial updates don't wipe
    // unrelated fields (e.g. patching only `companyName` keeps `primaryId`).
    let mergedProfileMeta: Record<string, unknown> | undefined;
    if (values.profileMeta) {
      const [existing] = await db
        .select({ profileMeta: users.profileMeta, userType: users.userType })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!existing) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      const current = (existing.profileMeta ?? {}) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...current };
      for (const [k, v] of Object.entries(values.profileMeta)) {
        if (v === null || v === undefined) {
          delete next[k];
        } else if (typeof v === "string") {
          const trimmed = v.trim();
          if (trimmed) next[k] = trimmed;
          else delete next[k];
        } else {
          next[k] = v;
        }
      }
      mergedProfileMeta = next;
    }

    const updateValues: Record<string, unknown> = {};
    if (values.email !== undefined) updateValues.email = values.email;
    if (values.mobile !== undefined) updateValues.mobile = values.mobile;
    if (values.name !== undefined) updateValues.name = values.name;
    if (values.userType !== undefined) updateValues.userType = values.userType;
    if (values.isActive !== undefined) updateValues.isActive = values.isActive;
    if (mergedProfileMeta !== undefined) updateValues.profileMeta = mergedProfileMeta;
    updateValues.updatedAt = new Date().toISOString();

    let updated;
    try {
      const [u] = await db
        .update(users)
        .set(updateValues)
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          email: users.email,
          mobile: users.mobile,
          userType: users.userType,
          isActive: users.isActive,
          name: users.name,
          userNumber: users.userNumber,
          profileMeta: users.profileMeta,
        });
      updated = u;
    } catch (err) {
      const code = (err as { code?: string } | null | undefined)?.code;
      if (code === "23505") {
        return NextResponse.json({ error: "Email already in use by another account" }, { status: 409 });
      }
      throw err;
    }
    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // If userType changed to an allowed type and userNumber is missing, assign one
    if (values.userType && ["admin", "agent", "accounting", "internal_staff"].includes(values.userType) && !updated.userNumber) {
      try {
        let orgId: number | undefined;
        try {
          const orgRows = await db.select({ organisationId: memberships.organisationId }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
          orgId = Number(orgRows?.[0]?.organisationId);
        } catch {}
        const userNumber = await generateNextUserNumber(values.userType as "admin" | "agent" | "accounting" | "internal_staff", orgId);
        const [after] = await db
          .update(users)
          .set({ userNumber })
          .where(eq(users.id, userId))
          .returning({
            id: users.id,
            email: users.email,
            mobile: users.mobile,
            userType: users.userType,
            isActive: users.isActive,
            name: users.name,
            userNumber: users.userNumber,
            profileMeta: users.profileMeta,
          });
        return NextResponse.json(after, { status: 200 });
      } catch (err) {
        console.error("Failed to generate userNumber on PATCH:", err);
      }
    }

    return NextResponse.json(updated, { status: 200 });
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
