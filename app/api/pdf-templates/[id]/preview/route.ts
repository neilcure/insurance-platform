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
  await requireUser();

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

  const buffer = await readPdfTemplate(meta.filePath);

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${row.label}.pdf"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
