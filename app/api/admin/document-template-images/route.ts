import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { savePdfTemplate } from "@/lib/storage-pdf-templates";

export const dynamic = "force-dynamic";

/**
 * Upload a logo (or other inline image) for a document template.
 *
 * We piggy-back on the existing `pdfTemplateFiles` blob store so the
 * served URL (`/api/pdf-templates/images/[storedName]`) and its auth
 * + cache headers come for free. From the storage layer's perspective
 * a logo is just another binary asset keyed by a UUID-prefixed name —
 * the table doesn't care whether the consumer is the PDF editor or the
 * doc-template editor.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file || !file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "An image file (PNG or JPG) is required" },
      { status: 400 },
    );
  }

  // 2 MB cap matches the PDF-template uploader so admins have one
  // mental model for "what file is small enough".
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Image must be under 2 MB" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storedName = await savePdfTemplate(file.name, buffer);

  return NextResponse.json({ storedName });
}
