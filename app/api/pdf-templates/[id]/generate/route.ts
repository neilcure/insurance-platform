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
import { normalizePdfSelectionMarkScale } from "@/lib/pdf/normalize-pdf-selection-mark-scale";
import { canAccessPolicy } from "@/lib/policy-access";
import {
  pdfTemplateAudienceDescriptor,
  resolveDocumentVisibility,
  type DocumentAudience,
} from "@/lib/auth/document-audience";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();

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
  const selectionMarkStyle: "check" | "cross" | undefined =
    body.selectionMarkStyle === "cross"
      ? "cross"
      : body.selectionMarkStyle === "check"
        ? "check"
        : undefined;
  const selectionMarkScale = normalizePdfSelectionMarkScale(body.selectionMarkScale);
  // Preview canvas opt-in — server skips ✓/✗ glyphs and just leaves
  // the soft blue tint, so the client can overlay marks instantly.
  const skipSelectionMarks: boolean = body.skipSelectionMarks === true;

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

  // Layer 2 + 3: policy scope + audience gate. See
  // `.cursor/skills/document-user-rights/SKILL.md`. Before this
  // check existed, any signed-in user could POST any policyId to
  // generate an arbitrary template (including agent-only proposal
  // forms for policies they don't own).
  const audienceMeta = pdfTemplateAudienceDescriptor(meta);
  const vis = await resolveDocumentVisibility(user, policyId, audienceMeta, (u, pid) =>
    canAccessPolicy({ id: Number(u.id), userType: u.userType }, pid),
  );
  if (!vis.allowed) {
    const message =
      vis.reason === "scope"
        ? "Forbidden: no access to policy"
        : vis.reason === "audience"
          ? "Forbidden: audience restricted"
          : "Forbidden";
    return NextResponse.json({ error: message, reason: vis.reason }, { status: 403 });
  }
  const isAgentTpl = (meta as unknown as { isAgentTemplate?: boolean }).isAgentTemplate;
  const requestedAudience: DocumentAudience =
    audience === "agent" || audience === "client"
      ? audience
      : isAgentTpl
        ? "agent"
        : "client";
  if (!vis.allowedAudiences.includes(requestedAudience)) {
    return NextResponse.json(
      { error: "Forbidden: audience restricted", reason: "audience" },
      { status: 403 },
    );
  }

  const result = await buildMergeContext(policyId);
  if (!result) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }
  const { ctx: mergeCtx, policyNumber } = result;

  const docTrackingKey = tplRow.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
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
      selectionMarkStyle,
      selectionMarkScale,
      skipSelectionMarks,
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
