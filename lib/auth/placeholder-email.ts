import crypto from "crypto";

/**
 * Placeholder-email helpers.
 *
 * The `users.email` column is `NOT NULL UNIQUE` and is used as the login key
 * across the platform, so we can't store NULL when an admin creates an
 * account in "Create Account Only" mode without supplying an email yet.
 *
 * Instead, we generate a deterministic-looking but still-unique placeholder
 * such as `noemail.a1b2c3d4e5f6@placeholder.local`. The local part includes
 * a 12-hex-char random suffix so multiple placeholders never collide on the
 * unique index. The TLD `.local` is RFC 6762 special-use, so it is
 * guaranteed not to resolve as a real domain — that means a stray
 * `sendEmail({ to: placeholder })` call cannot leak data to a third party.
 *
 * Admin can later replace the placeholder with a real address via the
 * Edit User dialog before issuing an invite. The "Send Invite" affordance
 * pre-fills an empty email field when the stored value is a placeholder so
 * admin always types a real one before the invite goes out.
 */

export const PLACEHOLDER_EMAIL_DOMAIN = "placeholder.local";

export function generatePlaceholderEmail(): string {
  const suffix = crypto.randomBytes(6).toString("hex");
  return `noemail.${suffix}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== "string") return false;
  return email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
