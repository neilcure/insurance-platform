/**
 * POST /api/policies/[id]/documents/share-link
 *
 * Mints a token-gated public download bundle so the sender can paste
 * the resulting `/d/<token>` URL into a WhatsApp (or any other) chat.
 * Tapping the link opens the public download page with NO LOGIN
 * required — the token IS the credential.
 *
 * Why a separate endpoint vs. the existing email flow
 * ---------------------------------------------------
 * The email flow (`.../documents/email`) fetches every selected file,
 * generates every PDF template, and base64-attaches them in one POST
 * to Brevo. It's correct for email, where the recipient never sees a
 * URL. For WhatsApp we can't attach files (Meta limitation on
 * `wa.me`), so we mint a row here and stream files lazily on download.
 *
 * Auth & access
 * -------------
 * 1. `requireUser()` — caller must be logged in.
 * 2. `canAccessPolicy()` — caller must be allowed to see this policy
 *    (admin / staff / agent-of-record / org member).
 * 3. PDF template audience filter — we silently drop any template the
 *    caller can't generate from (e.g. agent-only template requested
 *    by a direct_client). Mirrors `.../documents/email` behaviour.
 *
 * The recipient does NOT need to log in: the random 128-bit token in
 * the URL is the proof of authorisation. Same threat model as our
 * existing `/sign/<token>` flow.
 *
 * Returns
 * -------
 *   { ok: true, token, url, expiresAt, fileCount }
 *
 * `url` is built from `APP_URL` (env) → request origin (fallback).
 */

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { documentShares, policyDocuments } from "@/db/schema/documents";
import { formOptions } from "@/db/schema/form_options";
import { policies } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { canAccessPolicy } from "@/lib/policy-access";
import {
  audienceVisibilityForRole,
  pdfTemplateAudienceDescriptor,
} from "@/lib/auth/document-audience";
import { getBaseUrlFromRequestUrl } from "@/lib/email";
import { PDF_TEMPLATE_GROUP_KEY } from "@/lib/types/pdf-template";
import type { PdfTemplateMeta } from "@/lib/types/pdf-template";
import { generateShareToken } from "@/lib/share-token";

export const dynamic = "force-dynamic";

const DEFAULT_EXPIRY_DAYS = 7;
/** Hard cap so a leaked link can't sit out there forever. */
const MAX_EXPIRY_DAYS = 30;

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
    const flattenPdfs = body?.flattenPdfs !== false;
    const recipientPhone = String(body?.recipientPhone ?? "").slice(0, 32) || null;
    const recipientName = String(body?.recipientName ?? "").slice(0, 200) || null;
    const messageSent = String(body?.message ?? "").slice(0, 4000) || null;
    const label = String(body?.label ?? "").slice(0, 200) || null;
    const requestedDays = Number(body?.expiresInDays);
    const expiresInDays = Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(requestedDays, MAX_EXPIRY_DAYS)
      : DEFAULT_EXPIRY_DAYS;

    if (documentIds.length === 0 && pdfTemplateIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one file or document to share" },
        { status: 400 },
      );
    }

    const [policyRow] = await db
      .select({ id: policies.id, policyNumber: policies.policyNumber })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);
    if (!policyRow) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    // Validate documentIds actually belong to this policy. Without
    // this, a hostile caller could try to mint a share link with
    // file IDs from a different policy they don't own.
    let validDocumentIds: number[] = [];
    if (documentIds.length > 0) {
      const docs = await db
        .select({ id: policyDocuments.id })
        .from(policyDocuments)
        .where(
          and(
            eq(policyDocuments.policyId, policyId),
            inArray(policyDocuments.id, documentIds),
          ),
        );
      validDocumentIds = docs.map((d) => d.id);
      if (validDocumentIds.length === 0 && pdfTemplateIds.length === 0) {
        return NextResponse.json(
          { error: "None of the selected files belong to this policy" },
          { status: 404 },
        );
      }
    }

    // Audience-filter PDF templates the caller can't generate from.
    let validTemplateIds: number[] = [];
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

      const audienceFiltered = tplRows.filter((tplRow) => {
        const meta = tplRow.meta as unknown as PdfTemplateMeta | null;
        const decision = audienceVisibilityForRole(
          user.userType,
          pdfTemplateAudienceDescriptor(meta),
        );
        return decision.allowedAudiences.length > 0;
      });

      validTemplateIds = audienceFiltered.map((r) => r.id);
    }

    if (validDocumentIds.length === 0 && validTemplateIds.length === 0) {
      return NextResponse.json(
        { error: "No files available to share with your role" },
        { status: 403 },
      );
    }

    const token = await generateShareToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const [inserted] = await db
      .insert(documentShares)
      .values({
        token,
        policyId,
        documentIds: validDocumentIds,
        pdfTemplateIds: validTemplateIds,
        flattenPdfs,
        label: label ?? `Policy ${policyRow.policyNumber}`,
        messageSent,
        recipientPhone,
        recipientName,
        expiresAt: expiresAt.toISOString(),
        createdBy: Number(user.id),
      })
      .returning({
        id: documentShares.id,
        token: documentShares.token,
        expiresAt: documentShares.expiresAt,
      });

    if (!inserted) {
      return NextResponse.json(
        { error: "Failed to create share link" },
        { status: 500 },
      );
    }

    const baseUrl = getBaseUrlFromRequestUrl(request.url);
    const url = `${baseUrl}/d/${inserted.token}`;

    return NextResponse.json({
      ok: true,
      token: inserted.token,
      url,
      expiresAt: inserted.expiresAt,
      fileCount: validDocumentIds.length + validTemplateIds.length,
    });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
