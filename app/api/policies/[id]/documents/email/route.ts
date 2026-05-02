import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { policyDocuments } from "@/db/schema/documents";
import { formOptions } from "@/db/schema/form_options";
import { policies } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { canAccessPolicy } from "@/lib/policy-access";
import { readFile } from "@/lib/storage";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";
import { sendEmail } from "@/lib/email";
import { appendPolicyAudit } from "@/lib/audit";
import { buildMergeContext } from "@/lib/pdf/build-context";
import { generateFilledPdf } from "@/lib/pdf/generate";
import { normalizePdfSelectionMarkScale } from "@/lib/pdf/normalize-pdf-selection-mark-scale";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta, PdfImageMapping } from "@/lib/types/pdf-template";

export const dynamic = "force-dynamic";

/**
 * Combined-attachment cap. Brevo and most ISPs reject mail bigger
 * than ~25 MB; we apply a 20 MB ceiling to leave headroom for the
 * MIME envelope, base64 overhead (~33%), and the small HTML body.
 *
 * The check is done on the RAW file bytes (pre-base64). If the
 * limit is hit we surface a clear error so the user can de-select
 * a few items rather than have Brevo silently 4xx.
 */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeFilename(name: string): string {
  // Mirror the rule used by send-document: keep letters, numbers,
  // dot, dash, underscore, and spaces. Anything else becomes "_".
  // Mail clients on Windows / macOS render filenames inconsistently
  // when exotic characters survive a round-trip through MIME.
  const cleaned = name.replace(/[^\p{L}\p{N}._\- ]+/gu, "_").trim();
  return cleaned || "document";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function humaniseTypeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid policy id" }, { status: 400 });
    }

    const hasAccess = await canAccessPolicy(
      { id: Number(user.id), userType: user.userType },
      policyId,
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const documentIdsRaw = Array.isArray(body?.documentIds) ? body.documentIds : [];
    const documentIds = documentIdsRaw
      .map((v: unknown) => Number(v))
      .filter((n: number) => Number.isFinite(n) && n > 0);
    const pdfTemplateIdsRaw = Array.isArray(body?.pdfTemplateIds) ? body.pdfTemplateIds : [];
    const pdfTemplateIds = pdfTemplateIdsRaw
      .map((v: unknown) => Number(v))
      .filter((n: number) => Number.isFinite(n) && n > 0);
    // Default true: email recipients get a tamper-proof flat copy.
    const flattenPdfs = body?.flattenPdfs !== false;
    const selectionMarkStyle: "check" | "cross" | undefined =
      body?.selectionMarkStyle === "cross"
        ? "cross"
        : body?.selectionMarkStyle === "check"
          ? "check"
          : undefined;
    const selectionMarkScale = normalizePdfSelectionMarkScale(body?.selectionMarkScale);
    const email = String(body?.email ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    const message = String(body?.message ?? "").trim();

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email address is required" },
        { status: 400 },
      );
    }
    if (documentIds.length === 0 && pdfTemplateIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one file or document to email" },
        { status: 400 },
      );
    }

    const [policyRow] = await db
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);
    if (!policyRow) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }
    const policyNumber = policyRow.policyNumber;

    // Read all files first so we can pre-flight the size limit and
    // fail fast WITHOUT sending a partial email (Brevo would happily
    // accept a partial set if we streamed them in).
    type Loaded = { name: string; buffer: Buffer; documentTypeKey: string };
    const loaded: Loaded[] = [];
    let totalBytes = 0;
    const seenNames = new Set<string>();

    // Helper: de-duplicate filenames in the SAME envelope. Mail clients
    // happily accept duplicates but most show "file (1)", "file
    // (2)" which looks unprofessional. Append a numeric suffix
    // before the extension so the recipient sees clean, distinct names.
    function deduplicateName(base: string): string {
      let safeName = sanitizeFilename(base);
      if (seenNames.has(safeName)) {
        const dot = safeName.lastIndexOf(".");
        const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
        const ext = dot > 0 ? safeName.slice(dot) : "";
        let counter = 2;
        while (seenNames.has(`${stem}-${counter}${ext}`)) counter++;
        safeName = `${stem}-${counter}${ext}`;
      }
      seenNames.add(safeName);
      return safeName;
    }

    function checkSizeLimit(newBytes: number): NextResponse | null {
      totalBytes += newBytes;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return NextResponse.json(
          {
            error: `Total attachment size exceeds ${Math.round(
              MAX_TOTAL_BYTES / 1024 / 1024,
            )} MB. Please de-select a few files and try again.`,
          },
          { status: 413 },
        );
      }
      return null;
    }

    // --- Uploaded files ---
    if (documentIds.length > 0) {
      // Scope the document fetch to THIS policy so a hostile caller
      // can't use the route to exfiltrate files from another policy
      // even if they somehow guess the IDs.
      const docs = await db
        .select({
          id: policyDocuments.id,
          documentTypeKey: policyDocuments.documentTypeKey,
          fileName: policyDocuments.fileName,
          storedPath: policyDocuments.storedPath,
          mimeType: policyDocuments.mimeType,
          status: policyDocuments.status,
        })
        .from(policyDocuments)
        .where(
          and(
            eq(policyDocuments.policyId, policyId),
            inArray(policyDocuments.id, documentIds),
          ),
        );

      for (const doc of docs) {
        let buffer: Buffer;
        try {
          buffer = await readFile(doc.storedPath);
        } catch (err) {
          console.error(
            `[documents/email] read failed for doc ${doc.id} (${doc.storedPath}):`,
            err,
          );
          return NextResponse.json(
            { error: `Could not read file "${doc.fileName}". It may have been removed from storage.` },
            { status: 500 },
          );
        }

        const sizeError = checkSizeLimit(buffer.length);
        if (sizeError) return sizeError;

        loaded.push({
          name: deduplicateName(doc.fileName),
          buffer,
          documentTypeKey: doc.documentTypeKey,
        });
      }
    }

    // --- PDF merge templates (generated on the fly) ---
    if (pdfTemplateIds.length > 0) {
      const tplRows = await db
        .select()
        .from(formOptions)
        .where(
          and(
            eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
            inArray(formOptions.id, pdfTemplateIds),
          ),
        );

      // Build merge context once; reuse across all templates for this policy
      const ctxResult = await buildMergeContext(policyId);
      if (ctxResult) {
        const { ctx: mergeCtx } = ctxResult;

        for (const tplRow of tplRows) {
          const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
          if (!meta?.filePath) continue; // skip blank templates with no PDF

          const docTrackingKey = tplRow.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_|_$/g, "");
          mergeCtx.currentDocTrackingKey = meta.isAgentTemplate
            ? `${docTrackingKey}_agent`
            : docTrackingKey;

          try {
            const templateBytes = await readPdfTemplate(meta.filePath);
            const images: PdfImageMapping[] = meta.images ?? [];
            const filledPdf = await generateFilledPdf(templateBytes, meta.fields, mergeCtx, {
              pages: meta.pages,
              images,
              drawings: meta.drawings,
              checkboxes: meta.checkboxes,
              radioGroups: meta.radioGroups,
              textInputs: meta.textInputs,
              selectionMarkStyle,
              selectionMarkScale,
              loadImage: (storedName: string) => readPdfTemplate(storedName),
              flatten: flattenPdfs,
            });

            const buffer = Buffer.from(filledPdf as Uint8Array);
            const sizeError = checkSizeLimit(buffer.length);
            if (sizeError) return sizeError;

            loaded.push({
              name: deduplicateName(`${tplRow.label} - ${policyNumber}.pdf`),
              buffer,
              documentTypeKey: "_pdf_template",
            });
          } catch (err) {
            console.error(
              `[documents/email] PDF generation failed for template ${tplRow.id}:`,
              err,
            );
            return NextResponse.json(
              { error: `Failed to generate PDF for "${tplRow.label}". Please try again.` },
              { status: 500 },
            );
          }
        }
      }
    }

    if (loaded.length === 0) {
      return NextResponse.json(
        { error: "No files could be prepared for this policy" },
        { status: 404 },
      );
    }

    const senderName =
      (user as unknown as { name?: string }).name ||
      (user as unknown as { email?: string }).email ||
      "Insurance Platform";

    const finalSubject =
      subject || `Documents — Policy ${policyNumber}`;
    const intro = message
      ? `<p style="margin:0 0 16px;white-space:pre-wrap;">${escapeHtml(message)}</p>`
      : `<p style="margin:0 0 16px;">Please find attached ${loaded.length} document${
          loaded.length === 1 ? "" : "s"
        } for Policy <strong>${escapeHtml(policyNumber)}</strong>.</p>`;

    const fileListHtml = loaded
      .map(
        (l) =>
          `<li style="margin:2px 0;"><strong>${escapeHtml(
            humaniseTypeKey(l.documentTypeKey),
          )}</strong> — <span style="font-family:monospace;color:#444;">${escapeHtml(
            l.name,
          )}</span> <span style="color:#888;">(${formatBytes(l.buffer.length)})</span></li>`,
      )
      .join("");

    const html = `
      <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a; font-size: 14px; line-height: 1.6;">
        ${intro}
        <table style="border-collapse: collapse; margin: 0 0 16px;">
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #666;">Policy</td>
            <td><strong>${escapeHtml(policyNumber)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 4px 12px 4px 0; color: #666;">Files</td>
            <td>${loaded.length}</td>
          </tr>
        </table>
        <ul style="margin: 0 0 16px 16px; padding: 0;">${fileListHtml}</ul>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #888; font-size: 12px;">Sent by ${escapeHtml(senderName)} via Insurance Platform.</p>
      </div>
    `;

    const result = await sendEmail({
      to: email,
      subject: finalSubject,
      html,
      text:
        message ||
        `Policy ${policyNumber} — ${loaded.length} file${loaded.length === 1 ? "" : "s"} attached. Sent by ${senderName}.`,
      attachments: loaded.map((l) => ({
        name: l.name,
        content: l.buffer.toString("base64"),
      })),
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to send email" },
        { status: 500 },
      );
    }

    // Best-effort audit. `appendPolicyAudit` is keyed off the
    // `cars` table so it silently skips for non-motor policies —
    // we wrap in try/catch so an audit hiccup never blocks the
    // user-visible success response.
    try {
      await appendPolicyAudit(
        policyId,
        { id: Number(user.id), email: String(user.email ?? "") },
        [
          {
            key: "documents_emailed",
            from: null,
            to: {
              to: email,
              subject: finalSubject,
              fileCount: loaded.length,
              files: loaded.map((l) => l.name),
            },
          },
        ],
      );
    } catch (err) {
      console.error("[documents/email] audit append failed (non-fatal):", err);
    }

    return NextResponse.json({ ok: true, sent: loaded.length });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
