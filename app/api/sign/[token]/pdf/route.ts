import { NextResponse } from "next/server";
import { getSigningSession } from "@/lib/signing-sessions";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public-by-token PDF endpoint used by the /sign/<token> page to
 * embed the un-signed document as an `<iframe>` preview. Same auth
 * model as the signing page itself: the unguessable token IS the
 * credential. We deliberately serve the un-signed PDF here even
 * after the recipient has signed — the signed copy is served from
 * `/api/sign/<token>/signed.pdf` so the two are kept distinct and
 * downstream code can link to either explicitly.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const session = await getSigningSession(token);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readPdfTemplate(session.unsignedPdfStoredName);
  } catch (err) {
    console.error("[/api/sign/pdf] read failed:", err);
    return NextResponse.json({ error: "PDF unavailable" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${sanitize(session.subject)}.pdf"`,
      // No cache — content is small and we want updates to reflect
      // immediately if a future feature ever rotates the file.
      "Cache-Control": "no-store",
    },
  });
}

function sanitize(name: string): string {
  return name.replace(/[^\p{L}\p{N}._\- ]+/gu, "_").trim() || "document";
}
