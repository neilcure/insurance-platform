import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements } from "@/db/schema/announcements";
import { requireUser } from "@/lib/auth/require-user";
import { ActiveOrgError, resolveActiveOrgId } from "@/lib/auth/active-org";
import { sanitizeAnnouncementHtml } from "@/lib/announcements/sanitize-html";
import { parseTargeting, TargetingSchema } from "@/lib/announcements/targeting";
import { assertClientIdsExist, assertUserIdsBelongToOrg } from "@/lib/announcements/org-users";
import { removeMediaFile } from "@/lib/announcements/storage";
import { sanitizeAnnouncementLinkUrl } from "@/lib/announcements/sanitize-url";
import { z } from "zod";

export const dynamic = "force-dynamic";

function assertAnnouncementsAdmin(me: Awaited<ReturnType<typeof requireUser>>) {
  if (me.userType !== "admin" && me.userType !== "internal_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

const PatchBody = z.object({
  organisationId: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  bodyHtml: z.string().max(80_000).optional(),
  linkUrl: z.string().trim().max(2000).optional().nullable(),
  mediaKind: z.enum(["none", "image", "pdf"]).optional(),
  mediaStoredName: z.string().max(500).optional().nullable(),
  startsAt: z.string().min(1).optional(),
  endsAt: z.string().min(1).optional(),
  autoCloseSeconds: z.number().int().min(0).max(3600).optional().nullable(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  targeting: z.unknown().optional(),
});

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const forbidden = assertAnnouncementsAdmin(me);
    if (forbidden) return forbidden;

    const { id: idRaw } = await ctx.params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    let orgId: number;
    try {
      orgId = await resolveActiveOrgId(me, undefined, { context: "GET /api/admin/announcements/[id]" });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const [row] = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.organisationId, orgId)))
      .limit(1);

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const forbidden = assertAnnouncementsAdmin(me);
    if (forbidden) return forbidden;

    const { id: idRaw } = await ctx.params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const json = await request.json();
    const parsed = PatchBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }

    let orgId: number;
    try {
      orgId = await resolveActiveOrgId(me, parsed.data.organisationId, {
        context: "PATCH /api/admin/announcements/[id]",
      });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const [existing] = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.organisationId, orgId)))
      .limit(1);

    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const startsAt = parsed.data.startsAt ?? existing.startsAt;
    const endsAt = parsed.data.endsAt ?? existing.endsAt;
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
    }

    let targeting = parsed.data.targeting !== undefined ? parseTargeting(parsed.data.targeting) : existing.targeting;
    const tr = TargetingSchema.safeParse(targeting);
    targeting = tr.success ? tr.data : { mode: "all" };

    if (targeting.mode === "users") {
      try {
        if (targeting.userIds.length > 0) await assertUserIdsBelongToOrg(targeting.userIds, orgId);
        if (targeting.clientIds && targeting.clientIds.length > 0) {
          await assertClientIdsExist(targeting.clientIds);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Invalid user targeting";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    let mediaKind = parsed.data.mediaKind ?? existing.mediaKind;
    let mediaStoredName =
      parsed.data.mediaStoredName !== undefined ? parsed.data.mediaStoredName : existing.mediaStoredName;

    if (parsed.data.mediaKind === "none") {
      if (existing.mediaStoredName) await removeMediaFile(orgId, existing.mediaStoredName);
      mediaKind = "none";
      mediaStoredName = null;
    } else if (
      parsed.data.mediaStoredName !== undefined &&
      parsed.data.mediaStoredName !== existing.mediaStoredName &&
      existing.mediaStoredName
    ) {
      await removeMediaFile(orgId, existing.mediaStoredName);
    }

    if (mediaKind !== "none" && !mediaStoredName) {
      return NextResponse.json({ error: "Upload media or set media kind to none" }, { status: 400 });
    }

    const [row] = await db
      .update(announcements)
      .set({
        updatedAt: new Date().toISOString(),
        startsAt,
        endsAt,
        targeting,
        mediaKind,
        mediaStoredName,
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.bodyHtml !== undefined
          ? { bodyHtml: sanitizeAnnouncementHtml(parsed.data.bodyHtml) }
          : {}),
        ...(parsed.data.linkUrl !== undefined
          ? { linkUrl: sanitizeAnnouncementLinkUrl(parsed.data.linkUrl ?? null) }
          : {}),
        ...(parsed.data.autoCloseSeconds !== undefined
          ? { autoCloseSeconds: parsed.data.autoCloseSeconds }
          : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      })
      .where(and(eq(announcements.id, id), eq(announcements.organisationId, orgId)))
      .returning();

    return NextResponse.json(row);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const forbidden = assertAnnouncementsAdmin(me);
    if (forbidden) return forbidden;

    const { id: idRaw } = await ctx.params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    let orgId: number;
    try {
      orgId = await resolveActiveOrgId(me, undefined, { context: "DELETE /api/admin/announcements/[id]" });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const [existing] = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), eq(announcements.organisationId, orgId)))
      .limit(1);

    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await removeMediaFile(orgId, existing.mediaStoredName);

    await db.delete(announcements).where(and(eq(announcements.id, id), eq(announcements.organisationId, orgId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
