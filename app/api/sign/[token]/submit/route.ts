import { NextResponse } from "next/server";
import {
  getSigningSession,
  isSessionOpenable,
  markSigningSessionSigned,
  type SignaturePayload,
} from "@/lib/signing-sessions";
import { renderHtmlToPdf } from "@/lib/pdf/html-to-pdf";
import {
  acceptedSignatureToDataUrl,
  injectClientSignature,
  typedSignatureToDataUrl,
} from "@/lib/sign-injection";
import type { DocumentStatusEntry, DocumentTrackingData } from "@/lib/types/accounting";
import {
  autoAdvanceFromTrackingAction,
  isAgentTrackingDocType,
} from "@/lib/auto-advance-status";
import { updateDocumentTracking } from "@/lib/document-tracking/atomic-update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public endpoint hit by the recipient when they submit their
 * signature on the `/sign/<token>` page. The endpoint is unauthed
 * — the unguessable token in the URL IS the credential. We
 * additionally re-validate (1) the session exists, (2) it hasn't
 * already been signed (idempotency), and (3) it hasn't expired.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    const session = await getSigningSession(token);
    if (!session) {
      return NextResponse.json({ error: "Signing link not found" }, { status: 404 });
    }
    if (session.signedAt) {
      return NextResponse.json(
        { error: "This document has already been signed." },
        { status: 409 },
      );
    }
    if (!isSessionOpenable(session)) {
      return NextResponse.json(
        { error: "This signing link has expired. Please ask the sender for a new one." },
        { status: 410 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const method = body?.method as SignaturePayload["method"] | undefined;
    const value = String(body?.value ?? "");

    if (method !== "draw" && method !== "type" && method !== "accept") {
      return NextResponse.json({ error: "Invalid signature method" }, { status: 400 });
    }
    if ((method === "draw" || method === "type") && !value.trim()) {
      return NextResponse.json({ error: "Signature is required" }, { status: 400 });
    }

    // Resolve the data URL we'll inject into the signature slot.
    // For "draw" the client sends a PNG data URL straight from the
    // canvas. For "type" we render a script-font SVG server-side.
    // For "accept" we still inject a small "Accepted by ..." stamp
    // so the PDF visibly differs from the un-signed version.
    let signatureImageDataUrl: string;
    if (method === "draw") {
      if (!value.startsWith("data:image/")) {
        return NextResponse.json({ error: "Signature image must be a PNG data URL" }, { status: 400 });
      }
      signatureImageDataUrl = value;
    } else if (method === "type") {
      signatureImageDataUrl = typedSignatureToDataUrl(value.trim());
    } else {
      const displayName = (session.recipientName || session.recipientEmail || "recipient").trim();
      signatureImageDataUrl = acceptedSignatureToDataUrl(displayName);
    }

    // Re-render the document with the signature injected. We use
    // the SAME Puppeteer pipeline (and same print styles) as the
    // original send — the only diff is the slot content. This
    // guarantees the signed PDF is byte-identical to what the
    // recipient previewed, plus the captured signature.
    const signedDocumentHtml = injectClientSignature(
      session.documentHtml,
      signatureImageDataUrl,
    );
    let signedPdfBuffer: Buffer;
    try {
      signedPdfBuffer = await renderHtmlToPdf(signedDocumentHtml, session.subject);
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Render failed";
      console.error("[/api/sign/submit] PDF render failed:", message);
      return NextResponse.json(
        { error: `Failed to render signed PDF: ${message}` },
        { status: 500 },
      );
    }

    const signedAtIso = new Date().toISOString();
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "";
    const userAgent = request.headers.get("user-agent") || "";

    const updated = await markSigningSessionSigned({
      token,
      signedPdfBuffer,
      signature: {
        method,
        // For "draw" we keep the PNG data URL; for "type" we keep
        // the typed name; for "accept" we keep an empty value (the
        // method itself is the signal).
        value: method === "accept" ? "" : value,
        ip,
        userAgent,
        signedAt: signedAtIso,
      },
    });

    if (!updated) {
      return NextResponse.json({ error: "Failed to record signature" }, { status: 500 });
    }

    // Flip the matching documentTracking entry to confirmed so the
    // sender's in-app UI reflects the signature. This is best-
    // effort — if the policy was deleted between sending and
    // signing we don't fail the request (the signed PDF is still
    // stored and downloadable via the public token).
    try {
      const signerLabel =
        session.recipientName || session.recipientEmail || "Online signer";
      const noteByMethod: Record<SignaturePayload["method"], string> = {
        draw: `Signed online by ${signerLabel} (drawn signature)`,
        type: `Signed online by ${signerLabel} (typed signature)`,
        accept: `Accepted online by ${signerLabel}`,
      };
      const nextMap = await updateDocumentTracking(session.policyId, (current) => {
        const prevEntry: DocumentStatusEntry =
          (current[session.trackingKey] as DocumentStatusEntry | undefined) ??
          ({ status: "sent" } as DocumentStatusEntry);
        const nextEntry: DocumentStatusEntry = {
          ...prevEntry,
          status: "confirmed",
          confirmedAt: signedAtIso,
          confirmedBy: signerLabel,
          confirmMethod: "online_signature",
          confirmNote: noteByMethod[method],
          signedPdfStoredName: updated.signedPdfStoredName ?? undefined,
        };
        const next: DocumentTrackingData = {
          ...current,
          [session.trackingKey]: nextEntry,
        };
        return next;
      });
      if (nextMap) {

        // Mirror the regular "Confirm" path in /document-tracking:
        // a confirmed quotation/invoice/receipt should also drive
        // the workflow status forward (e.g. quotation_sent →
        // quotation_confirmed → invoice_prepared via the auto-
        // chain). Without this, online-signed docs would flip
        // tracking to "confirmed" but leave the policy stuck on
        // its previous status.
        try {
          await autoAdvanceFromTrackingAction({
            policyId: session.policyId,
            docType: session.trackingKey,
            action: "confirm",
            changedBy: signerLabel,
            track: isAgentTrackingDocType(session.trackingKey) ? "agent" : "client",
          });
        } catch (advanceErr) {
          console.error(
            "[/api/sign/submit] status auto-advance failed (non-fatal):",
            advanceErr,
          );
        }
      }
    } catch (err) {
      console.error("[/api/sign/submit] tracking update failed (non-fatal):", err);
    }

    return NextResponse.json({ ok: true, signedAt: signedAtIso });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    console.error("[/api/sign/submit] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
