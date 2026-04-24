import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canAccessPolicy } from "@/lib/policy-access";
import { sendEmail } from "@/lib/email";
import { getSigningSession, isSessionOpenable } from "@/lib/signing-sessions";
import { readPdfTemplate } from "@/lib/storage-pdf-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-sends the original signing email to the same (or, optionally,
 * a different) recipient WITHOUT minting a new session. This means:
 *
 *   1. The existing /sign/<token> URL the recipient may still have
 *      open in their inbox keeps working.
 *   2. We don't pile up orphaned signing rows in the database.
 *   3. The recipient sees the SAME PDF they would have seen the
 *      first time, even if the policy data has been edited since
 *      (the unsigned PDF was frozen at create-time).
 *
 * Authorization:
 *   - Caller must be a logged-in user.
 *   - Caller must have policy access via canAccessPolicy().
 *   - The session must still be openable (not expired, not yet
 *     signed) — there's no point resending a link the recipient
 *     can't use.
 *
 * Body (all optional):
 *   - email?: string        — override the original recipient
 *                             (e.g. typo correction in original)
 *   - messageBody?: string  — short plain-text cover note;
 *                             defaults to a generic reminder
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; token: string }> },
) {
  try {
    const user = await requireUser();
    const { id: idParam, token } = await ctx.params;
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

    const session = await getSigningSession(token);
    if (!session) {
      return NextResponse.json({ error: "Signing session not found" }, { status: 404 });
    }
    // Defensive: tokens are unique globally, but make sure this
    // session actually belongs to the policy in the URL so a user
    // with access to policy A can't ping the resend endpoint for a
    // session attached to policy B.
    if (session.policyId !== policyId) {
      return NextResponse.json({ error: "Session does not belong to this policy" }, { status: 404 });
    }
    if (session.signedAt) {
      return NextResponse.json(
        { error: "This document has already been signed — no need to resend." },
        { status: 409 },
      );
    }
    if (!isSessionOpenable(session)) {
      return NextResponse.json(
        { error: "This signing link has expired. Please send a fresh request." },
        { status: 410 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const overrideEmail = String(body?.email ?? "").trim();
    const messageBody = String(body?.messageBody ?? "").trim();
    const recipientEmail = overrideEmail || session.recipientEmail;
    if (!recipientEmail.includes("@")) {
      return NextResponse.json({ error: "Valid recipient email required" }, { status: 400 });
    }

    const senderName =
      (user as unknown as { name?: string }).name ||
      (user as unknown as { email?: string }).email ||
      "Insurance Platform";

    const baseUrl = resolveBaseUrl(request);
    const signUrl = `${baseUrl.replace(/\/+$/, "")}/sign/${session.token}`;

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await readPdfTemplate(session.unsignedPdfStoredName);
    } catch (err) {
      console.error("[resend] failed to load unsigned PDF:", err);
      return NextResponse.json(
        { error: "Original PDF is no longer available. Please re-send the document from scratch." },
        { status: 410 },
      );
    }

    const defaultMessage =
      `Hi${session.recipientName ? ` ${session.recipientName}` : ""},\n\n` +
      `This is a reminder to review and sign the attached ${session.documentLabel}.\n\n` +
      `If you've already signed, please ignore this email.\n\n` +
      `Best regards,\n${senderName}`;

    const html = buildResendEmailBody(
      messageBody || defaultMessage,
      senderName,
      signUrl,
    );

    const filename = `${sanitizeFilename(session.subject || session.documentLabel)}.pdf`;

    const result = await sendEmail({
      to: recipientEmail,
      subject: `Reminder: ${session.subject}`,
      html,
      text: messageBody || defaultMessage,
      attachments: [
        {
          name: filename,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to resend email" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, signUrl, sentTo: recipientEmail });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    console.error("[resend] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Same email shell as send-document, kept inline here so the two
// routes don't entangle. If the visual style ever needs to change
// in lock-step, lift to a shared helper at lib/email-templates.ts.
function buildResendEmailBody(
  messageBody: string,
  senderName: string,
  signUrl: string,
): string {
  const escaped = messageBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a; font-size: 14px; line-height: 1.6;">
      <div>${escaped}</div>
      <div style="margin: 24px 0; padding: 16px; background: #f0f7ff; border: 1px solid #b3d4fc; border-radius: 6px;">
        <p style="margin: 0 0 12px; font-size: 14px; color: #1a1a1a;">
          <strong>Action requested:</strong> please review the attached PDF and sign online.
        </p>
        <a href="${signUrl}"
           style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 14px;">
          Sign Document Online
        </a>
        <p style="margin: 12px 0 0; font-size: 12px; color: #555;">
          Or copy this link into your browser:<br />
          <span style="word-break: break-all; color: #2563eb;">${signUrl}</span>
        </p>
      </div>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
      <p style="color: #888; font-size: 12px;">
        Sent by ${senderName} via Insurance Platform. The document is attached as a PDF.
      </p>
    </div>
  `;
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._\- ]+/gu, "_").trim();
  return cleaned || "document";
}

function resolveBaseUrl(request: Request): string {
  const fromEnv = process.env.APP_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const url = new URL(request.url);
  const xfHost = request.headers.get("x-forwarded-host");
  const xfProto = request.headers.get("x-forwarded-proto");
  const host = xfHost || url.host;
  const proto = xfProto || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
