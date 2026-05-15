import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { announcements } from "@/db/schema/announcements";
import { requireUser } from "@/lib/auth/require-user";
import { ActiveOrgError, resolveActiveOrgId } from "@/lib/auth/active-org";
import { filterAnnouncementsForUser } from "@/lib/announcements/eligibility";
import { mediaFilePath } from "@/lib/announcements/storage";

export const dynamic = "force-dynamic";

function contentTypeForKind(kind: string, storedName: string): string {
  const lower = storedName.toLowerCase();
  if (kind === "pdf" || lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function GET(request: Request) {
  try {
    const me = await requireUser();
    const { searchParams } = new URL(request.url);
    const idRaw = searchParams.get("announcementId");
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid announcementId" }, { status: 400 });
    }

    let orgId: number;
    try {
      orgId = await resolveActiveOrgId(me, undefined, { context: "GET /api/me/announcements/media" });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      throw e;
    }

    const nowIso = new Date().toISOString();

    const [row] = await db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.id, id),
          eq(announcements.organisationId, orgId),
          eq(announcements.isActive, true),
          lte(announcements.startsAt, nowIso),
          gte(announcements.endsAt, nowIso),
        ),
      )
      .limit(1);

    if (!row || row.mediaKind === "none" || !row.mediaStoredName) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const visible = await filterAnnouncementsForUser([row], me);
    if (visible.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const absPath = mediaFilePath(orgId, row.mediaStoredName);
    const buf = await readFile(absPath);
    const ct = contentTypeForKind(row.mediaKind, row.mediaStoredName);

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "private, max-age=3600",
        ...(row.mediaKind === "pdf"
          ? { "Content-Disposition": 'inline; filename="announcement.pdf"' }
          : {}),
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
