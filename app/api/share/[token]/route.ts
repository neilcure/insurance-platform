/**
 * GET /api/share/[token]
 *
 * Public listing endpoint for the WhatsApp Files share flow.
 *
 * No authentication: the 128-bit unguessable token in the URL is the
 * only credential. We enforce expiry on every read so even a leaked
 * token rots automatically.
 *
 * Returns a manifest the public download page (`/d/[token]`) renders:
 *   - Friendly label + policy number
 *   - One row per uploaded file (real `policy_documents` row)
 *   - One row per PDF merge template (will be regenerated on download)
 *
 * We do NOT include `stored_path`, internal IDs, or anything the
 * recipient could use to enumerate other files. Each row carries an
 * opaque ordinal `idx` they pass back to the per-file download
 * endpoint.
 */

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { documentShares, policyDocuments } from "@/db/schema/documents";
import { formOptions } from "@/db/schema/form_options";
import { policies } from "@/db/schema/insurance";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";

export const dynamic = "force-dynamic";

type ManifestFile =
  | {
      idx: number;
      kind: "upload";
      label: string;
      fileName: string;
      mimeType: string | null;
      fileSize: number | null;
    }
  | {
      idx: number;
      kind: "pdf_template";
      label: string;
      fileName: string;
      mimeType: "application/pdf";
      fileSize: null;
    };

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token: tokenParam } = await ctx.params;
    const token = String(tokenParam ?? "").trim();
    if (!token || token.length < 16) {
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

    const [policyRow] = await db
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(eq(policies.id, share.policyId))
      .limit(1);

    const documentIds = Array.isArray(share.documentIds) ? share.documentIds : [];
    const templateIds = Array.isArray(share.pdfTemplateIds) ? share.pdfTemplateIds : [];

    const files: ManifestFile[] = [];

    if (documentIds.length > 0) {
      const docs = await db
        .select({
          id: policyDocuments.id,
          documentTypeKey: policyDocuments.documentTypeKey,
          fileName: policyDocuments.fileName,
          mimeType: policyDocuments.mimeType,
          fileSize: policyDocuments.fileSize,
        })
        .from(policyDocuments)
        .where(
          and(
            eq(policyDocuments.policyId, share.policyId),
            inArray(policyDocuments.id, documentIds as number[]),
          ),
        );
      // Preserve the original selection order so the recipient sees
      // the same ordering the sender chose.
      const byId = new Map(docs.map((d) => [d.id, d] as const));
      for (const id of documentIds as number[]) {
        const d = byId.get(id);
        if (!d) continue;
        files.push({
          idx: files.length,
          kind: "upload",
          label: humaniseTypeKey(d.documentTypeKey),
          fileName: d.fileName,
          mimeType: d.mimeType,
          fileSize: d.fileSize,
        });
      }
    }

    if (templateIds.length > 0) {
      const tplRows = await db
        .select({ id: formOptions.id, label: formOptions.label })
        .from(formOptions)
        .where(
          and(
            eq(formOptions.groupKey, PDF_TEMPLATE_GROUP_KEY),
            inArray(formOptions.id, templateIds as number[]),
          ),
        );
      const byId = new Map(tplRows.map((r) => [r.id, r] as const));
      for (const id of templateIds as number[]) {
        const t = byId.get(id);
        if (!t) continue;
        files.push({
          idx: files.length,
          kind: "pdf_template",
          label: t.label,
          fileName: `${t.label} - ${policyRow?.policyNumber ?? "policy"}.pdf`,
          mimeType: "application/pdf",
          fileSize: null,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      label: share.label,
      policyNumber: policyRow?.policyNumber ?? null,
      expiresAt: share.expiresAt,
      files,
      // Recipients see this only as a courtesy header; never a phone.
      recipientName: share.recipientName,
    });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function humaniseTypeKey(key: string): string {
  if (!key || key === "_pdf_template") return "Document";
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
