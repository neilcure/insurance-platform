import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements } from "@/db/schema/announcements";
import { requireUser } from "@/lib/auth/require-user";
import { ActiveOrgError, resolveActiveOrgId } from "@/lib/auth/active-org";
import { sanitizeAnnouncementHtml } from "@/lib/announcements/sanitize-html";
import { parseTargeting, TargetingSchema } from "@/lib/announcements/targeting";
import { assertClientIdsExist, assertUserIdsBelongToOrg } from "@/lib/announcements/org-users";
import { sanitizeAnnouncementLinkUrl } from "@/lib/announcements/sanitize-url";
import { z } from "zod";

export const dynamic = "force-dynamic";

function assertAnnouncementsAdmin(me: Awaited<ReturnType<typeof requireUser>>) {
  if (me.userType !== "admin" && me.userType !== "internal_staff") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

const PostBody = z.object({
  organisationId: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(500),
  bodyHtml: z.string().max(80_000).optional(),
  linkUrl: z.string().trim().max(2000).optional().nullable(),
  mediaKind: z.enum(["none", "image", "pdf"]).optional(),
  mediaStoredName: z.string().max(500).optional().nullable(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  autoCloseSeconds: z.number().int().min(0).max(3600).optional().nullable(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  targeting: z.unknown().optional(),
});

export async function GET(request: Request) {
  try {
    const me = await requireUser();
    const forbidden = assertAnnouncementsAdmin(me);
    if (forbidden) return forbidden;

    let orgId: number;
    try {
      const { searchParams } = new URL(request.url);
      const rawOrg = searchParams.get("organisationId");
      orgId = await resolveActiveOrgId(me, rawOrg ? Number(rawOrg) : undefined, {
        context: "GET /api/admin/announcements",
      });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const rows = await db
      .select()
      .from(announcements)
      .where(eq(announcements.organisationId, orgId))
      .orderBy(desc(announcements.priority), desc(announcements.id));

    return NextResponse.json(rows);
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
    const forbidden = assertAnnouncementsAdmin(me);
    if (forbidden) return forbidden;

    const json = await request.json();
    const parsed = PostBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }

    let orgId: number;
    try {
      orgId = await resolveActiveOrgId(me, parsed.data.organisationId, {
        context: "POST /api/admin/announcements",
      });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const startsAt = parsed.data.startsAt;
    const endsAt = parsed.data.endsAt;
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
    }

    let targeting = parseTargeting(parsed.data.targeting);
    const tr = TargetingSchema.safeParse(targeting);
    if (!tr.success) {
      targeting = { mode: "all" };
    } else {
      targeting = tr.data;
    }

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

    const mediaKind = parsed.data.mediaKind ?? "none";
    let mediaStoredName = parsed.data.mediaStoredName?.trim() || null;
    if (mediaKind === "none") {
      mediaStoredName = null;
    }
    if (mediaKind !== "none" && !mediaStoredName) {
      return NextResponse.json({ error: "Upload media or set media kind to none" }, { status: 400 });
    }

    const bodyHtml = sanitizeAnnouncementHtml(parsed.data.bodyHtml ?? "");
    const linkUrl = sanitizeAnnouncementLinkUrl(parsed.data.linkUrl ?? null);

    const [row] = await db
      .insert(announcements)
      .values({
        organisationId: orgId,
        title: parsed.data.title,
        bodyHtml,
        mediaKind,
        mediaStoredName,
        linkUrl,
        startsAt,
        endsAt,
        autoCloseSeconds: parsed.data.autoCloseSeconds ?? null,
        isActive: parsed.data.isActive ?? true,
        priority: parsed.data.priority ?? 0,
        targeting,
        createdBy: Number(me.id),
      })
      .returning();

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
