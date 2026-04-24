import { NextResponse } from "next/server";
import { getSigningSession } from "@/lib/signing-sessions";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public-by-token endpoint that returns the SIGNED PDF after the
 * recipient has submitted their signature. Used by:
 *   - the success state on /sign/<token> (recipient's "download"
 *     link),
 *   - the in-app DocumentsTab tracking row (sender clicks the
 *     "Download signed PDF" button).
 *
 * Returns 404 until `signedAt` is set on the session, even if the
 * row exists — we don't want to leak the un-signed PDF here when
 * callers explicitly asked for the signed version.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const session = await getSigningSession(token);
  if (!session || !session.signedPdfStoredName || !session.signedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readPdfTemplate(session.signedPdfStoredName);
  } catch (err) {
    console.error("[/api/sign/signed.pdf] read failed:", err);
    return NextResponse.json({ error: "Signed PDF unavailable" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${sanitize(session.subject)}-signed.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function sanitize(name: string): string {
  return name.replace(/[^\p{L}\p{N}._\- ]+/gu, "_").trim() || "document";
}
