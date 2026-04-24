import { NextResponse } from "next/server";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";

export const dynamic = "force-dynamic";

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/**
 * Public-read GET for template images (logos, authorized signatures, etc.).
 *
 * We deliberately do NOT require auth here for two reasons:
 *  1. These images are embedded in outbound transactional emails
 *     (quotations, invoices, statements). The recipient's email
 *     client must be able to fetch them directly — there's no auth
 *     cookie there. Brevo, our transactional email provider, does
 *     NOT support inline CID attachments
 *     (https://community.brevo.com/t/does-transactional-email-support-embedded-image/6665),
 *     so the only reliable way to render the logo / signature in
 *     Gmail / Outlook / etc. is a publicly fetchable URL.
 *  2. The `storedName` carries a UUIDv4 prefix (see
 *     `lib/storage-pdf-templates.ts` -> `writePdfTemplate`), so URLs
 *     are unguessable — same trust model as a public CDN with
 *     opaque object keys. The endpoint also only serves files that
 *     were intentionally uploaded as document-template assets; no
 *     user-private content is reachable through this route.
 *
 * Cache-Control is "public" so email clients' image-proxy caches
 * (notably Gmail's googleusercontent.com proxy) can keep a single
 * copy across all recipients of the same email blast.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ storedName: string }> },
) {
  const { storedName } = await ctx.params;

  try {
    const buffer = await readPdfTemplate(storedName);
    const ext = storedName.substring(storedName.lastIndexOf(".")).toLowerCase();
    const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
}
