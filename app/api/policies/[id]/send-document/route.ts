import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { sendEmail } from "@/lib/email";
import { canAccessPolicy } from "@/lib/policy-access";
import { renderHtmlToPdf } from "@/lib/pdf/html-to-pdf";
import { createSigningSession } from "@/lib/signing-sessions";
import { updateDocumentTracking } from "@/lib/document-tracking/atomic-update";
import type { DocumentStatusEntry, DocumentTrackingData } from "@/lib/types/accounting";

export const dynamic = "force-dynamic";

// Puppeteer launches Chromium which is not bundled by Next.js's
// Edge/serverless build pipeline. Force the Node.js runtime so the
// dynamic require of `puppeteer` works in production too.
export const runtime = "nodejs";

/**
 * Build the small HTML body used as the email itself when the
 * document is delivered as a PDF attachment. Recipients see this
 * short message first, then open the attached PDF for the actual
 * document. Keeping the body short (no inline document HTML) means
 * we don't trigger the Gmail/Outlook layout-quirks the inline path
 * had to work around.
 *
 * When `signUrl` is provided we also render a prominent "Sign
 * online" CTA button. Most email clients honour the inline styles
 * here (no flexbox, no background-image hacks) so the button shows
 * up reliably across Gmail / Outlook / Apple Mail.
 */
function buildPdfEmailBody(
  messageBody: string,
  senderName: string,
  signUrl?: string,
): string {
  const escaped = messageBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

  const ctaBlock = signUrl
    ? `
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
    `
    : "";

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a; font-size: 14px; line-height: 1.6;">
      <div>${escaped}</div>
      ${ctaBlock}
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
      <p style="color: #888; font-size: 12px;">
        Sent by ${senderName} via Insurance Platform. The document is attached as a PDF.
      </p>
    </div>
  `;
}

function sanitizeFilename(name: string): string {
  // Strip directory separators and characters that mail clients /
  // Windows / macOS file browsers don't like in filenames. Keep
  // letters, numbers, dot, dash, underscore, and spaces.
  const cleaned = name.replace(/[^\p{L}\p{N}._\- ]+/gu, "_").trim();
  return cleaned || "document";
}

/**
 * Translate a thrown DB error (Drizzle / postgres.js) into a short
 * user-facing string. The raw `.message` from `postgres` echoes
 * the entire failing query + every bound parameter, which can be
 * megabytes long when `document_html` is one of the params — bad
 * for toasts and logs alike.
 *
 * Returns `null` when the error doesn't look like a DB error so
 * the caller can fall back to a generic label.
 */
function formatDbError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; severity?: string; detail?: string; message?: string; routine?: string };
  // Postgres error code 42P01 = `undefined_table`. Most likely
  // cause when this code path is touched the first time after
  // pulling the online-signing feature.
  if (e.code === "42P01") {
    return "The signing_sessions table doesn't exist. Run the migration: db/migrations/0008_add_signing_sessions.sql";
  }
  // For all other DB errors, prefer the short `detail` field
  // when present (e.g. uniqueness violations include a clean
  // "Key (token)=(...) already exists." message).
  if (e.detail) return `${e.code ?? "DB"}: ${e.detail}`;
  if (e.code) return `${e.code}${e.routine ? ` (${e.routine})` : ""}`;
  // Last resort: take the first line of `.message` only and cap
  // it at a sane length.
  const firstLine = (e.message ?? "").split("\n")[0]?.trim();
  if (firstLine) return firstLine.slice(0, 200);
  return null;
}

/**
 * Resolve the absolute base URL we use to build the public sign
 * link. Tries (1) the explicit `APP_URL` env var, then (2) the
 * incoming request's `host` header (works behind reverse proxies as
 * long as they forward the original `Host`). Falls back to the dev
 * default. We intentionally do NOT trust `x-forwarded-host` blindly
 * — only when it's present we honour it for staging where Hostinger
 * fronts the app with their own proxy.
 */
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

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const hasAccess = await canAccessPolicy({ id: Number(user.id), userType: user.userType }, policyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const email = String(body?.email ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    // `documentHtml` is the inline-styled `<body>` fragment from
    // `generateEmailHtml()`; it's used to render the PDF attachment
    // via Puppeteer. The client should inline images (data: URLs)
    // before sending so Puppeteer doesn't need to make any network
    // requests during render.
    const documentHtml = String(body?.documentHtml ?? "").trim();
    // `messageBody` is the short, editable body of the email itself
    // (NOT the document). It's plain text with line breaks; we
    // HTML-escape and convert \n to <br /> when wrapping.
    const messageBody = String(body?.messageBody ?? "").trim();
    const filenameRaw = String(body?.filename ?? subject ?? "document").trim();
    const plainText = String(body?.plainText ?? "").trim();

    // New optional fields used when the sender wants the recipient
    // to e-sign the document. All four are required together; we
    // validate gracefully so a stale client missing these can still
    // send a non-signing email.
    const requestSignature = body?.requestSignature === true;
    const trackingKey = String(body?.trackingKey ?? "").trim();
    const documentLabel = String(body?.documentLabel ?? subject ?? "Document").trim();
    const recipientName = String(body?.recipientName ?? "").trim() || null;

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email address is required" }, { status: 400 });
    }
    if (!subject) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }
    if (!documentHtml) {
      return NextResponse.json({ error: "Document content is required" }, { status: 400 });
    }
    if (requestSignature && !trackingKey) {
      return NextResponse.json(
        { error: "trackingKey is required when requesting a signature" },
        { status: 400 },
      );
    }

    const senderName =
      (user as unknown as { name?: string }).name ||
      (user as unknown as { email?: string }).email ||
      "Insurance Platform";

    // Render the document HTML to a PDF. Failures here are
    // surfaced to the user with a clear error so they can either
    // retry or fall back to printing the document themselves —
    // we deliberately do NOT silently fall back to an HTML body
    // because the user explicitly chose "send as PDF".
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderHtmlToPdf(documentHtml, subject);
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "PDF render failed";
      console.error("[send-document] PDF render failed:", message);
      return NextResponse.json(
        { error: `Failed to render PDF: ${message}` },
        { status: 500 },
      );
    }

    // If the sender opted in to online signing, create the session
    // BEFORE sending the email so we can include the link in the
    // body. The session stores the un-signed PDF + the original
    // documentHtml so the recipient gets the same document they
    // were promised, even if the policy is edited later.
    let signUrl: string | undefined;
    let signingToken: string | undefined;
    if (requestSignature) {
      try {
        const baseUrl = resolveBaseUrl(request);
        const created = await createSigningSession(
          {
            policyId,
            trackingKey,
            documentLabel,
            subject,
            recipientEmail: email,
            recipientName,
            senderUserId: Number(user.id) || null,
            documentHtml,
            unsignedPdfBuffer: pdfBuffer,
          },
          baseUrl,
        );
        signUrl = created.signUrl;
        signingToken = created.session.token;

        // Stash the token on the tracking row so the sender's UI
        // can render a "Sign link" / "Resend" affordance and link
        // to the signed PDF once it lands. Best-effort: tracking
        // is also touched by the regular send action below, but
        // doing it here means the link is visible immediately,
        // even if the email send itself ends up failing later.
        try {
          await updateDocumentTracking(policyId, (current) => {
            const prevEntry: DocumentStatusEntry =
              (current[trackingKey] as DocumentStatusEntry | undefined) ??
              ({ status: "sent" } as DocumentStatusEntry);
            const nextEntry: DocumentStatusEntry = {
              ...prevEntry,
              signingSessionToken: signingToken,
            };
            const next: DocumentTrackingData = {
              ...current,
              [trackingKey]: nextEntry,
            };
            return next;
          });
        } catch (innerErr) {
          // Don't fail the whole send if the tracking patch flops
          // — the signing session itself is still valid and the
          // recipient can still sign via the email link.
          console.error("[send-document] tracking patch failed (non-fatal):", innerErr);
        }
      } catch (err: unknown) {
        // Surface a useful message back to the client. We
        // deliberately try the postgres-driver shape FIRST (`code`
        // + short string) before falling back to `message`,
        // because Drizzle's `message` echoes the entire failed
        // query + every parameter — useless in a toast since the
        // documentHtml param alone is megabytes long.
        const friendly = formatDbError(err) ?? "Failed to create signing session";
        console.error("[send-document] signing-session create failed:", err);
        return NextResponse.json(
          { error: `Failed to create signing session: ${friendly}` },
          { status: 500 },
        );
      }
    }

    const filename = `${sanitizeFilename(filenameRaw)}.pdf`;
    const defaultMessage =
      `Hi,\n\nPlease find attached the ${subject}.\n\nBest regards,\n${senderName}`;
    const html = buildPdfEmailBody(messageBody || defaultMessage, senderName, signUrl);

    const result = await sendEmail({
      to: email,
      subject,
      html,
      text: plainText || messageBody || defaultMessage,
      attachments: [
        {
          name: filename,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, signUrl: signUrl ?? null });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
