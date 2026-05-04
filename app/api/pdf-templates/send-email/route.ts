import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { policies } from "@/db/schema/insurance";
import { and, eq, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta, PdfImageMapping } from "@/lib/types/pdf-template";
import { generateFilledPdf } from "@/lib/pdf/generate";
import { buildMergeContext } from "@/lib/pdf/build-context";
import { normalizePdfSelectionMarkScale } from "@/lib/pdf/normalize-pdf-selection-mark-scale";
import { sendEmail } from "@/lib/email";
import { canAccessPolicy } from "@/lib/policy-access";
import {
  audienceVisibilityForRole,
  pdfTemplateAudienceDescriptor,
} from "@/lib/auth/document-audience";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();

  const body = await request.json();
  const policyId = Number(body.policyId);
  const templateIds: number[] = body.templateIds;
  const email = String(body.email ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const message = String(body.message ?? "").trim();
  const audience: string | undefined = body.audience;
  // Default true: email recipients get a tamper-proof flat copy with
  // all AcroForm widgets (checkboxes, radio buttons, text inputs)
  // baked into the page content. Stops the blue "fillable field"
  // markup from appearing in the recipient's PDF viewer and prevents
  // them from changing values after the fact. Pass `flattenPdfs:
  // false` from the client to keep the form interactive.
  const flattenPdfs = body?.flattenPdfs !== false;
  // Optional per-template overrides: { [templateId]: { checkboxOverrides, radioOverrides } }.
  // Supplied by the inline preview-send form so the recipient receives
  // the version the user just ticked/selected, not a fresh default.
  type TemplateOverride = {
    checkboxOverrides?: Record<string, boolean>;
    radioOverrides?: Record<string, string>;
    textInputOverrides?: Record<string, string>;
  };
  const templateOverrides: Record<string, TemplateOverride> =
    body.templateOverrides && typeof body.templateOverrides === "object"
      ? (body.templateOverrides as Record<string, TemplateOverride>)
      : {};
  const selectionMarkStyle: "check" | "cross" | undefined =
    body.selectionMarkStyle === "cross"
      ? "cross"
      : body.selectionMarkStyle === "check"
        ? "check"
        : undefined;
  const selectionMarkScale = normalizePdfSelectionMarkScale(body.selectionMarkScale);

  if (!policyId) {
    return NextResponse.json({ error: "policyId is required" }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email address is required" }, { status: 400 });
  }
  if (!templateIds?.length) {
    return NextResponse.json({ error: "At least one templateId is required" }, { status: 400 });
  }

  // Layer 2: policy scope check. Before this, the route only called
  // requireUser() and trusted the policyId from the body — any
  // signed-in user could POST any policyId and generate/email
  // documents for a policy they don't own. See
  // `.cursor/skills/document-user-rights/SKILL.md`.
  const hasAccess = await canAccessPolicy(
    { id: Number(user.id), userType: user.userType },
    policyId,
  );
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tplRowsRaw = await db
    .select()
    .from(formOptions)
    .where(
      and(
        inArray(formOptions.id, templateIds),
        eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
      ),
    );

  // Layer 3: drop templates the caller's role is not allowed to
  // receive. Same semantics as the POST /api/policies/[id]/documents/email
  // filter — a legitimate mixed-audience selection still goes through
  // for staff; a direct_client ends up with only the client-audience
  // templates (or 404 if none remain).
  const tplRows = tplRowsRaw.filter((tplRow) => {
    const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
    const decision = audienceVisibilityForRole(
      user.userType,
      pdfTemplateAudienceDescriptor(meta),
    );
    return decision.allowedAudiences.length > 0;
  });

  if (tplRows.length === 0) {
    return NextResponse.json({ error: "No templates found" }, { status: 404 });
  }

  const [policy] = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
    })
    .from(policies)
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!policy) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }

  const built = await buildMergeContext(policyId);
  if (!built) {
    return NextResponse.json({ error: "Failed to build merge context for policy" }, { status: 500 });
  }
  const mergeCtx = built.ctx;

  const attachments: { content: string; name: string }[] = [];

  for (const tplRow of tplRows) {
    const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
    if (!meta?.filePath || (!meta.fields?.length && !meta.images?.length)) continue;

    try {
      const templateBytes = await readPdfTemplate(meta.filePath);
      const templateImages: PdfImageMapping[] = meta.images ?? [];
      const filteredFields = audience
        ? meta.fields.filter((f) => !f.audience || f.audience === "all" || f.audience === audience)
        : meta.fields;
      const ov = templateOverrides[String(tplRow.id)] ?? {};
      const filledPdf = await generateFilledPdf(templateBytes, filteredFields, mergeCtx, {
        pages: meta.pages,
        images: templateImages,
        drawings: meta.drawings,
        checkboxes: meta.checkboxes,
        radioGroups: meta.radioGroups,
        textInputs: meta.textInputs,
        checkboxOverrides: ov.checkboxOverrides,
        radioOverrides: ov.radioOverrides,
        textInputOverrides: ov.textInputOverrides,
        selectionMarkStyle,
        selectionMarkScale,
        loadImage: (storedName: string) => readPdfTemplate(storedName),
        flatten: flattenPdfs,
      });
      const base64 = Buffer.from(filledPdf).toString("base64");
      attachments.push({
        content: base64,
        name: `${tplRow.label} - ${policy.policyNumber}.pdf`,
      });
    } catch (err) {
      console.error(`PDF generation error for template ${tplRow.id}:`, err);
    }
  }

  if (attachments.length === 0) {
    return NextResponse.json({ error: "Failed to generate any PDFs" }, { status: 500 });
  }

  const emailSubject = subject || `Policy ${policy.policyNumber} - Documents`;
  const customMessage = message
    ? `<p style="margin-bottom:16px;white-space:pre-wrap;">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`
    : "";

  const result = await sendEmail({
    to: email,
    subject: emailSubject,
    attachments,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Policy Documents</h2>
        ${customMessage}
        <p>Please find attached ${attachments.length} document${attachments.length !== 1 ? "s" : ""} for Policy <strong>${policy.policyNumber}</strong>.</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-weight: 600;">Policy #</td>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-family: monospace;">${policy.policyNumber}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-weight: 600;">Attachments</td>
            <td style="padding: 8px; border: 1px solid #e5e5e5;">${attachments.map((a) => a.name).join("<br>")}</td>
          </tr>
        </table>
        <p>Sent by ${user.name || user.email}.</p>
        <p style="color: #888; font-size: 12px; margin-top: 24px;">
          This email was sent from the insurance platform.
        </p>
      </div>
    `,
    text: `Policy ${policy.policyNumber} documents attached. Sent by ${user.name || user.email}.`,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sent: attachments.length });
}
