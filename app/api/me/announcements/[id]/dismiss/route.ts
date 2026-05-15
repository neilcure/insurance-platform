import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements, announcementDismissals } from "@/db/schema/announcements";
import { requireUser } from "@/lib/auth/require-user";
import { ActiveOrgError, resolveActiveOrgId } from "@/lib/auth/active-org";
import { filterAnnouncementsForUser } from "@/lib/announcements/eligibility";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id: raw } = await ctx.params;
    const announcementId = Number(raw);
    if (!Number.isFinite(announcementId) || announcementId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    let orgId: number;
    try {
      orgId = await resolveActiveOrgId(me, undefined, { context: "POST /api/me/announcements/[id]/dismiss" });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const nowIso = new Date().toISOString();

    const [activeRow] = await db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.id, announcementId),
          eq(announcements.organisationId, orgId),
          eq(announcements.isActive, true),
          lte(announcements.startsAt, nowIso),
          gte(announcements.endsAt, nowIso),
        ),
      )
      .limit(1);

    if (!activeRow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const visible = await filterAnnouncementsForUser([activeRow], me);
    if (visible.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db
      .insert(announcementDismissals)
      .values({
        announcementId,
        userId: Number(me.id),
      })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
