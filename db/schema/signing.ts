import { index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { policies } from "./insurance";
import { users } from "./core";

/**
 * Online signing sessions for documents emailed out to clients/agents.
 *
 * A row is created when an internal user clicks "Email" on a document
 * and the recipient receives a `Sign Online` link in the email body
 * pointing at `/sign/<token>`. The recipient opens that page (no
 * login — token is the credential, see notes below), draws / types /
 * click-accepts a signature, and we store the signed PDF + flip the
 * matching `policies.documentTracking[trackingKey]` entry to a
 * confirmed state so the in-app UI reflects the signature.
 *
 * Security model: `token` is a UUIDv4 (122 bits of entropy), so the
 * unguessable URL itself is the credential. Same trust model as a
 * password-reset link or a Calendly invite URL. We additionally
 * enforce `expiresAt` so abandoned links auto-invalidate, and we
 * record the signer's IP + user-agent in `signatureData` for an
 * audit trail.
 *
 * `documentHtml` stores the FULL inline-styled HTML body that was
 * used to render the original PDF. We keep it server-side so the
 * signed PDF can be re-rendered (with the captured signature image
 * injected into the client-signature slot) without needing to
 * re-fetch policy data — important because a long-lived signing
 * link could outlast a policy edit, and the recipient should sign
 * the document as it was originally sent to them.
 *
 * `unsignedPdfStoredName` / `signedPdfStoredName` reference rows in
 * `pdf_template_files` (it's a generic bytea-backed file table). We
 * reuse it instead of creating a new files table to avoid schema
 * sprawl.
 */
export const signingSessions = pgTable("signing_sessions", {
  id: serial("id").primaryKey(),
  // Unguessable public token used in /sign/<token> URL.
  token: varchar("token", { length: 64 }).notNull().unique(),

  policyId: integer("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
  // Matches the keys used in `policies.documentTracking` (e.g.
  // "motor_insurance_quotation" or "motor_insurance_quotation_agent").
  // Used by the signing-submit handler to update the right tracking row.
  trackingKey: varchar("tracking_key", { length: 128 }).notNull(),
  // Human-readable label of the document, shown on the sign page
  // header so the recipient knows what they're signing.
  documentLabel: text("document_label").notNull(),
  // Subject line of the email that was sent (also used as the PDF
  // filename when the recipient downloads the signed copy).
  subject: text("subject").notNull(),

  recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
  recipientName: text("recipient_name"),
  // Internal user who sent the email + signing link.
  senderUserId: integer("sender_user_id").references(() => users.id, { onDelete: "set null" }),

  // Inline-styled <body> HTML the original PDF was rendered from.
  // Re-rendered server-side after signature capture with the
  // signature image injected into the client-signature slot.
  documentHtml: text("document_html").notNull(),

  // References pdf_template_files.storedName.
  unsignedPdfStoredName: varchar("unsigned_pdf_stored_name", { length: 512 }).notNull(),
  signedPdfStoredName: varchar("signed_pdf_stored_name", { length: 512 }),

  // "draw" | "type" | "accept" — null until the recipient signs.
  signatureMethod: varchar("signature_method", { length: 16 }),
  // { value: <png data url | typed name | "accepted">, ip, userAgent, signedAt }
  signatureData: jsonb("signature_data"),

  expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
  signedAt: timestamp("signed_at", { mode: "string" }),

  // Set when the recipient explicitly declines instead of signing.
  // Mutually exclusive with `signedAt`: a session is in exactly one
  // of (open, signed, declined, expired) at any given moment. We
  // store both the timestamp and the recipient's free-text reason
  // so the sender can see WHY the document was rejected.
  declinedAt: timestamp("declined_at", { mode: "string" }),
  declineReason: text("decline_reason"),

  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (t) => ({
  // Look-ups by token are the hot path (every page load on the sign
  // URL). Unique constraint already covers it but the explicit index
  // documents the access pattern.
  tokenIdx: index("signing_sessions_token_idx").on(t.token),
  policyIdx: index("signing_sessions_policy_id_idx").on(t.policyId),
}));
