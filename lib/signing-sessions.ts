import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { signingSessions } from "@/db/schema/signing";
import { savePdfTemplate } from "@/lib/storage-pdf-templates";

/**
 * Default lifetime for a signing link (30 days). Long enough for
 * realistic recipient response windows (people are slow to react to
 * insurance documents) but short enough that abandoned links don't
 * stay valid forever.  Override at create-time via
 * `createSigningSession({ ttlDays })`.
 */
const DEFAULT_TTL_DAYS = 30;

export type CreateSigningSessionInput = {
  policyId: number;
  trackingKey: string;
  documentLabel: string;
  subject: string;
  recipientEmail: string;
  recipientName?: string | null;
  senderUserId: number | null;
  documentHtml: string;
  unsignedPdfBuffer: Buffer;
  ttlDays?: number;
};

export type SigningSessionRow = typeof signingSessions.$inferSelect;

export type SignaturePayload = {
  method: "draw" | "type" | "accept";
  // For "draw": a `data:image/png;base64,...` URL captured from the
  // canvas. For "type": the typed name. For "accept": empty string
  // (the action itself is the signal).
  value: string;
  // Audit context — recorded on submit, NOT on create.
  ip: string;
  userAgent: string;
  signedAt: string;
};

/**
 * Persist the unsigned PDF to bytea storage and create a fresh
 * signing-session row. Returns the row + the absolute URL the
 * recipient should open to sign.
 */
export async function createSigningSession(
  input: CreateSigningSessionInput,
  baseUrl: string,
): Promise<{ session: SigningSessionRow; signUrl: string }> {
  const token = crypto.randomUUID().replace(/-/g, "");
  const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  // Stash the original (un-signed) PDF in pdf_template_files so the
  // recipient can preview it on the sign page even after the
  // sender's app session is gone.
  const filenameBase = (input.subject || input.documentLabel || "document").slice(0, 80);
  const unsignedPdfStoredName = await savePdfTemplate(
    `${filenameBase}.unsigned.pdf`,
    input.unsignedPdfBuffer,
  );

  const [row] = await db
    .insert(signingSessions)
    .values({
      token,
      policyId: input.policyId,
      trackingKey: input.trackingKey,
      documentLabel: input.documentLabel,
      subject: input.subject,
      recipientEmail: input.recipientEmail.toLowerCase(),
      recipientName: input.recipientName ?? null,
      senderUserId: input.senderUserId,
      documentHtml: input.documentHtml,
      unsignedPdfStoredName,
      expiresAt: expiresAt.toISOString(),
    })
    .returning();

  const cleanBase = baseUrl.replace(/\/+$/, "");
  return { session: row, signUrl: `${cleanBase}/sign/${token}` };
}

export async function getSigningSession(
  token: string,
): Promise<SigningSessionRow | null> {
  if (!token || typeof token !== "string") return null;
  const [row] = await db
    .select()
    .from(signingSessions)
    .where(eq(signingSessions.token, token))
    .limit(1);
  return row ?? null;
}

/**
 * Mark a session as signed. Stores the signed PDF, the captured
 * signature data, and the timestamp. Idempotency is enforced by the
 * caller (route checks `signedAt` first) — we don't second-guess
 * here so a partially-failed submit can be retried.
 */
export async function markSigningSessionSigned(input: {
  token: string;
  signedPdfBuffer: Buffer;
  signature: SignaturePayload;
}): Promise<SigningSessionRow | null> {
  const filenameBase = "signed";
  const signedPdfStoredName = await savePdfTemplate(
    `${filenameBase}.pdf`,
    input.signedPdfBuffer,
  );

  const [row] = await db
    .update(signingSessions)
    .set({
      signedPdfStoredName,
      signatureMethod: input.signature.method,
      signatureData: input.signature,
      signedAt: input.signature.signedAt,
    })
    .where(eq(signingSessions.token, input.token))
    .returning();
  return row ?? null;
}

/**
 * True when a session is still openable (not expired, not yet
 * signed, and not declined). Centralised so route handlers and
 * the sign page agree on what "valid" means.
 */
export function isSessionOpenable(session: SigningSessionRow): boolean {
  if (session.signedAt) return false;
  if (session.declinedAt) return false;
  const expiresAt = new Date(session.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

/**
 * Mark a session as declined by the recipient. Stores the reason
 * (free-text, may be empty) and the timestamp. Idempotency is
 * enforced by the caller — we don't second-guess so a partially
 * failed decline can be retried.
 */
export async function markSigningSessionDeclined(input: {
  token: string;
  reason: string;
  declinedAt: string;
}): Promise<SigningSessionRow | null> {
  const [row] = await db
    .update(signingSessions)
    .set({
      declinedAt: input.declinedAt,
      // Cap the reason at a generous length to avoid bloating the
      // row with pasted essays. 4 KB is enough for any realistic
      // decline note (a polite rejection rarely exceeds a tweet).
      declineReason: input.reason.slice(0, 4000),
    })
    .where(eq(signingSessions.token, input.token))
    .returning();
  return row ?? null;
}
