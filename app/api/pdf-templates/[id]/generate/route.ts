import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta, PdfImageMapping } from "@/lib/types/pdf-template";
import { generateFilledPdf } from "@/lib/pdf/generate";
import { buildMergeContext } from "@/lib/pdf/build-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  await requireUser();

  const { id } = await ctx.params;
  const body = await request.json();
  const policyId = Number(body.policyId);
  const audience: string | undefined = body.audience;
  // Optional runtime overrides for checkboxes / radio groups, supplied
  // by the preview dialog when the user has ticked boxes / picked
  // Yes/No before downloading or generating.
  const checkboxOverrides: Record<string, boolean> | undefined =
    body.checkboxOverrides && typeof body.checkboxOverrides === "object" ? body.checkboxOverrides : undefined;
  const radioOverrides: Record<string, string> | undefined =
    body.radioOverrides && typeof body.radioOverrides === "object" ? body.radioOverrides : undefined;
  const textInputOverrides: Record<string, string> | undefined =
    body.textInputOverrides && typeof body.textInputOverrides === "object" ? body.textInputOverrides : undefined;

  if (!policyId) {
    return NextResponse.json({ error: "policyId is required" }, { status: 400 });
  }

  const [tplRow] = await db
    .select()
    .from(formOptions)
    .where(
      and(
        eq(formOptions.id, Number(id)),
        eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
      ),
    )
    .limit(1);

  if (!tplRow) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
  if (!meta?.filePath) {
    return NextResponse.json(
      { error: "Template has no PDF file" },
      { status: 400 },
    );
  }

  const result = await buildMergeContext(policyId);
  if (!result) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }
  const { ctx: mergeCtx, policyNumber } = result;

  const docTrackingKey = tplRow.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const isAgentTpl = (meta as unknown as { isAgentTemplate?: boolean }).isAgentTemplate;
  mergeCtx.currentDocTrackingKey = isAgentTpl ? `${docTrackingKey}_agent` : docTrackingKey;

  try {
    const templateBytes = await readPdfTemplate(meta.filePath);
    const templateImages: PdfImageMapping[] = meta.images ?? [];
    const filteredFields = audience
      ? meta.fields.filter((f) => !f.audience || f.audience === "all" || f.audience === audience)
      : meta.fields;
    const filledPdf = await generateFilledPdf(templateBytes, filteredFields, mergeCtx, {
      pages: meta.pages,
      images: templateImages,
      drawings: meta.drawings,
      checkboxes: meta.checkboxes,
      radioGroups: meta.radioGroups,
      textInputs: meta.textInputs,
      checkboxOverrides,
      radioOverrides,
      textInputOverrides,
      loadImage: (storedName: string) => readPdfTemplate(storedName),
    });

    return new NextResponse(filledPdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${tplRow.label} - ${policyNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: 500 },
    );
  }
}
