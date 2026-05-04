/**
 * GET /api/share/[token]/file/[idx]
 *
 * Streams ONE file from a share bundle to the recipient's browser.
 * Public — the token is the credential. Idx is the ordinal position
 * in the manifest returned by GET /api/share/[token].
 *
 * Behaviour
 * ---------
 *   - Uploaded file rows: stream the raw bytes from `lib/storage`.
 *   - PDF template rows: regenerate on the fly via `buildMergeContext`
 *     + `generateFilledPdf` so the recipient always gets the freshest
 *     snapshot of policy data (same code path as the email flow).
 *
 * Audit
 * -----
 * On every successful download we bump `access_count` and stamp
 * `last_accessed_at`. Cheap, gives the sender a "did they open it?"
 * signal.
 *
 * Errors are deliberately vague (404 "not found", 410 "expired") so
 * a probing attacker can't distinguish "wrong token" from "token I
 * already used".
 */

import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { documentShares, policyDocuments } from "@/db/schema/documents";
import { formOptions } from "@/db/schema/form_options";
import { policies } from "@/db/schema/insurance";
import { readFile } from "@/lib/storage";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";
import { buildMergeContext } from "@/lib/pdf/build-context";
import { generateFilledPdf } from "@/lib/pdf/generate";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta, PdfImageMapping } from "@/lib/types/pdf-template";

export const dynamic = "force-dynamic";

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._\- ]+/gu, "_").trim();
  return cleaned || "document";
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string; idx: string }> },
) {
  try {
    const { token: tokenParam, idx: idxParam } = await ctx.params;
    const token = String(tokenParam ?? "").trim();
    const idx = Number(idxParam);
    if (!token || token.length < 16 || !Number.isFinite(idx) || idx < 0) {
      return NextResponse.json({ error: "Invalid link" }, { status: 400 });
    }

    const [share] = await db
      .select()
      .from(documentShares)
      .where(eq(documentShares.token, token))
      .limit(1);
    if (!share) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }
    if (new Date(share.expiresAt) < new Date()) {
      return NextResponse.json({ error: "Link expired" }, { status: 410 });
    }

    const documentIds = (Array.isArray(share.documentIds)
      ? share.documentIds
      : []) as number[];
    const templateIds = (Array.isArray(share.pdfTemplateIds)
      ? share.pdfTemplateIds
      : []) as number[];

    // The manifest order is documentIds first, then templateIds. Map
    // `idx` to the right kind/id without exposing internal IDs.
    const totalDocs = documentIds.length;
    const isUpload = idx < totalDocs;
    const targetId = isUpload ? documentIds[idx] : templateIds[idx - totalDocs];
    if (!Number.isFinite(targetId)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    // The recipient may want to view the file inline (PDFs preview in
    // mobile browsers) instead of forcing a download. Default to
    // inline; pass `?download=1` to force the Save dialog.
    const forceDownload = url.searchParams.get("download") === "1";

    let buffer: Buffer;
    let fileName: string;
    let mimeType: string;

    if (isUpload) {
      // Stream the raw upload from disk. Re-validate the row belongs
      // to the share's policy as a defense-in-depth check (the
      // share-link POST already enforces this, but a stale share
      // pointing at a deleted-and-rotated id would be caught here).
      const [doc] = await db
        .select({
          id: policyDocuments.id,
          fileName: policyDocuments.fileName,
          storedPath: policyDocuments.storedPath,
          mimeType: policyDocuments.mimeType,
        })
        .from(policyDocuments)
        .where(
          and(
            eq(policyDocuments.id, targetId),
            eq(policyDocuments.policyId, share.policyId),
          ),
        )
        .limit(1);
      if (!doc) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      try {
        buffer = await readFile(doc.storedPath);
      } catch (err) {
        console.error(
          `[share/file] read failed for doc ${doc.id} (${doc.storedPath}):`,
          err,
        );
        return NextResponse.json(
          { error: "File could not be read" },
          { status: 500 },
        );
      }
      fileName = sanitizeFilename(doc.fileName);
      mimeType = doc.mimeType ?? "application/octet-stream";
    } else {
      // PDF template — regenerate from the latest policy snapshot.
      const [tplRow] = await db
        .select()
        .from(formOptions)
        .where(
          and(
            eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
            inArray(formOptions.id, [targetId]),
          ),
        )
        .limit(1);
      if (!tplRow) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
      if (!meta?.filePath) {
        return NextResponse.json({ error: "Document not configured" }, { status: 404 });
      }

      const [policyRow] = await db
        .select({ policyNumber: policies.policyNumber })
        .from(policies)
        .where(eq(policies.id, share.policyId))
        .limit(1);

      const ctxResult = await buildMergeContext(share.policyId);
      if (!ctxResult) {
        return NextResponse.json(
          { error: "Could not load policy context" },
          { status: 500 },
        );
      }
      const { ctx: mergeCtx } = ctxResult;

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
        const filled = await generateFilledPdf(templateBytes, meta.fields, mergeCtx, {
          pages: meta.pages,
          images,
          drawings: meta.drawings,
          checkboxes: meta.checkboxes,
          radioGroups: meta.radioGroups,
          textInputs: meta.textInputs,
          loadImage: (storedName: string) => readPdfTemplate(storedName),
          flatten: share.flattenPdfs,
        });
        buffer = Buffer.from(filled as Uint8Array);
      } catch (err) {
        console.error(
          `[share/file] PDF generation failed for template ${tplRow.id}:`,
          err,
        );
        return NextResponse.json(
          { error: "Failed to generate PDF" },
          { status: 500 },
        );
      }

      fileName = sanitizeFilename(`${tplRow.label} - ${policyRow?.policyNumber ?? "policy"}.pdf`);
      mimeType = "application/pdf";
    }

    // Best-effort audit. A failure here must NOT block the download.
    try {
      await db
        .update(documentShares)
        .set({
          accessCount: sql`${documentShares.accessCount} + 1`,
          lastAccessedAt: new Date().toISOString(),
        })
        .where(eq(documentShares.id, share.id));
    } catch (err) {
      console.error("[share/file] audit update failed (non-fatal):", err);
    }

    const disposition = forceDownload ? "attachment" : "inline";
    // Filename* uses RFC 5987 encoding so non-ASCII characters survive
    // round-tripping through middleboxes that mangle plain Latin-1.
    const headers = new Headers({
      "content-type": mimeType,
      "content-length": String(buffer.length),
      "content-disposition":
        `${disposition}; filename="${fileName.replace(/"/g, "")}"; ` +
        `filename*=UTF-8''${encodeURIComponent(fileName)}`,
      // Don't let CDNs cache the response — share rows can be revoked
      // (deleted policy / expired) and we want every fetch to re-check.
      "cache-control": "private, no-store, max-age=0",
    });

    return new NextResponse(new Uint8Array(buffer), { status: 200, headers });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
