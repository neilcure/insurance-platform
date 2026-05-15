import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { requireUser } from "@/lib/auth/require-user";
import { ActiveOrgError, resolveActiveOrgId } from "@/lib/auth/active-org";
import { ensureOrgMediaDir, mediaFilePath } from "@/lib/announcements/storage";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

function extForMime(mime: string): string | null {
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "application/pdf") return ".pdf";
  return null;
}

function mediaKindForMime(mime: string): "image" | "pdf" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return null;
}

export async function POST(request: Request) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin" && me.userType !== "internal_staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let orgId: number;
    try {
      const { searchParams } = new URL(request.url);
      const rawOrg = searchParams.get("organisationId");
      orgId = await resolveActiveOrgId(me, rawOrg ? Number(rawOrg) : undefined, {
        context: "POST /api/admin/announcements/upload",
      });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }

    const mime = file.type || "";
    const ext = extForMime(mime);
    const kind = mediaKindForMime(mime);
    if (!ext || !kind) {
      return NextResponse.json(
        { error: "Allowed types: JPEG, PNG, WebP, PDF" },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 12 MB)" }, { status: 400 });
    }

    const storedName = `${crypto.randomUUID()}${ext}`;
    await ensureOrgMediaDir(orgId);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(mediaFilePath(orgId, storedName), buf);

    return NextResponse.json({ storedName, mediaKind: kind });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
