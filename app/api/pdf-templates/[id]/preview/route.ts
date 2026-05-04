import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta } from "@/lib/types/pdf-template";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  // This endpoint returns the RAW blank PDF template — only admin-side
  // editors need it, never customers. Locking to non-client roles
  // prevents a signed-in direct_client from enumerating template IDs
  // and retrieving layouts they have no business seeing. See
  // `.cursor/skills/document-user-rights/SKILL.md`.
  if (user.userType === "direct_client" || user.userType === "service_provider") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const [row] = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.id, Number(id)),
        eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = row.meta as unknown as PdfTemplateMeta | null;
  if (!meta?.filePath) {
    return NextResponse.json({ error: "No PDF file" }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readPdfTemplate(meta.filePath);
  } catch (err) {
    console.error("PDF preview read error:", err);
    return NextResponse.json(
      { error: "PDF file not found. Please re-upload the template." },
      { status: 404 },
    );
  }

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${row.label}.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
