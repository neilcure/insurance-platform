import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements, announcementDismissals } from "@/db/schema/announcements";
import { requireUser } from "@/lib/auth/require-user";
import { ActiveOrgError, resolveActiveOrgId } from "@/lib/auth/active-org";
import { filterAnnouncementsForUser } from "@/lib/announcements/eligibility";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const me = await requireUser();

    let orgId: number;
    try {
      orgId = await resolveActiveOrgId(me, undefined, { context: "GET /api/me/announcements" });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ announcements: [] }, { status: 200 });
      }
      throw e;
    }

    const nowIso = new Date().toISOString();

    const dismissedRows = await db
      .select({ announcementId: announcementDismissals.announcementId })
      .from(announcementDismissals)
      .where(eq(announcementDismissals.userId, Number(me.id)));

    const dismissed = new Set(dismissedRows.map((r) => r.announcementId));

    const rows = await db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.organisationId, orgId),
          eq(announcements.isActive, true),
          lte(announcements.startsAt, nowIso),
          gte(announcements.endsAt, nowIso),
        ),
      )
      .orderBy(desc(announcements.priority), desc(announcements.id));

    const undismissed = rows.filter((r) => !dismissed.has(r.id));
    const visible = await filterAnnouncementsForUser(undismissed, me);

    const payload = visible.map((r) => ({
      id: r.id,
      title: r.title,
      bodyHtml: r.bodyHtml,
      linkUrl: r.linkUrl,
      mediaKind: r.mediaKind,
      mediaUrl:
        r.mediaKind !== "none" && r.mediaStoredName
          ? `/api/me/announcements/media?announcementId=${r.id}`
          : null,
      autoCloseSeconds: r.autoCloseSeconds,
    }));

    return NextResponse.json({ announcements: payload });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
