import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";

export const dynamic = "force-dynamic";

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ storedName: string }> },
) {
  await requireUser();

  const { storedName } = await ctx.params;

  try {
    const buffer = await readPdfTemplate(storedName);
    const ext = storedName.substring(storedName.lastIndexOf(".")).toLowerCase();
    const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
}
