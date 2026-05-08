/**
 * POST   /api/admin/assets/logo?variant=light|dark  — upload a logo variant (admin only)
 * GET    /api/admin/assets/logo?variant=light|dark  — serve the logo (public)
 * DELETE /api/admin/assets/logo?variant=light|dark  — remove a logo variant (admin only)
 *
 * `variant` defaults to "light" when omitted for backwards compatibility.
 */

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { requireUser } from "@/lib/auth/require-user";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const ASSETS_DIR = path.join(process.cwd(), ".uploads", "assets");

const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const ALLOWED_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB

type Variant = "light" | "dark";

function settingsKey(variant: Variant) {
  return `logo_${variant}_file_ext`;
}

function logoBaseName(variant: Variant) {
  return `logo-${variant}`;
}

async function ensureDir() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
}

function parseVariant(req: NextRequest): Variant {
  const v = new URL(req.url).searchParams.get("variant");
  return v === "dark" ? "dark" : "light";
}

/** POST — upload a logo variant */
export async function POST(request: NextRequest) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const variant = parseVariant(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const mimeType = file.type || "";
    const originalName = file.name || "logo";
    const ext = path.extname(originalName).toLowerCase() || ".png";

    if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
      return NextResponse.json(
        { error: `File type "${mimeType}" is not allowed. Use PNG, JPG, WEBP, or SVG.` },
        { status: 400 },
      );
    }
    if (!ALLOWED_IMAGE_EXT.has(ext)) {
      return NextResponse.json(
        { error: `Extension "${ext}" is not allowed.` },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_SIZE) {
      return NextResponse.json({ error: "File exceeds 2 MB limit." }, { status: 400 });
    }

    await ensureDir();

    // Remove any existing file for this variant
    try {
      const existing = await fs.readdir(ASSETS_DIR);
      const base = logoBaseName(variant);
      for (const name of existing.filter((n) => n.startsWith(`${base}.`))) {
        await fs.unlink(path.join(ASSETS_DIR, name)).catch(() => {});
      }
    } catch { /* ignore */ }

    const logoFile = `${logoBaseName(variant)}${ext}`;
    await fs.writeFile(path.join(ASSETS_DIR, logoFile), buffer);

    await db
      .insert(appSettings)
      .values({ key: settingsKey(variant), value: ext })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: ext } });

    return NextResponse.json({
      ok: true,
      url: `/api/admin/assets/logo?variant=${variant}`,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** GET — serve the logo variant (public, no auth) */
export async function GET(request: NextRequest) {
  try {
    const variant = parseVariant(request);
    const base = logoBaseName(variant);

    // Discover the file by scanning disk — no DB lookup needed.
    // This means a file copied directly into .uploads/assets/ works
    // immediately without a registration step.
    await ensureDir();
    let foundFile: string | null = null;
    try {
      const files = await fs.readdir(ASSETS_DIR);
      foundFile = files.find((f) => f.startsWith(`${base}.`)) ?? null;
    } catch {
      return new NextResponse(null, { status: 404 });
    }

    if (!foundFile) {
      return new NextResponse(null, { status: 404 });
    }

    const ext = path.extname(foundFile).toLowerCase();
    const fullPath = path.join(ASSETS_DIR, foundFile);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(fullPath);
    } catch {
      return new NextResponse(null, { status: 404 });
    }

    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    const contentType = mimeMap[ext] ?? "image/png";

    return new Response(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}

/** DELETE — remove a logo variant (admin only) */
export async function DELETE(request: NextRequest) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const variant = parseVariant(request);
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, settingsKey(variant)))
      .limit(1);

    if (row) {
      const ext = (row.value as string) || ".png";
      const fullPath = path.join(ASSETS_DIR, `${logoBaseName(variant)}${ext}`);
      await fs.unlink(fullPath).catch(() => {});
      await db.delete(appSettings).where(eq(appSettings.key, settingsKey(variant)));
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
