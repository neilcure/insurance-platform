/**
 * WhatsApp helpers — phone-number normalization + `wa.me` URL builder.
 *
 * No API integration, no cost, no Meta signup
 * -------------------------------------------
 * Everything in this module just produces a `https://wa.me/...` URL
 * that the user's own WhatsApp app (Web / Desktop / Mobile) opens.
 * That click-to-chat surface is documented at
 * https://faq.whatsapp.com/5913398998672934 and is free to use.
 *
 * If we ever want to send messages programmatically from the server
 * (templated notifications, broadcast, etc.) we'd need the WhatsApp
 * Business Cloud API which DOES have per-conversation pricing — that
 * would be a separate file under `lib/whatsapp-cloud-api.ts`.
 *
 * Number formats supported (Hong Kong defaults)
 * --------------------------------------------
 * All of the following inputs are treated as the SAME number:
 *
 *   12345678          (bare HK 8-digit local)
 *   1234 5678         (HK local with space)
 *   +852 12345678     (HK with country code, no internal space)
 *   +852 1234 5678    (HK with country code + internal space)
 *   (852) 1234-5678   (HK with parens / dashes)
 *
 * All resolve to the canonical international form `85212345678`.
 *
 * Other countries pass through with their existing country code:
 *
 *   +86 13800138000   → 8613800138000  (mainland China)
 *   +1  415 555 0123  → 14155550123    (US)
 *   +44 20 7946 0958  → 442079460958   (UK)
 */

const HK_COUNTRY_CODE = "852";
const HK_LOCAL_LENGTH = 8;

/**
 * Strip every non-digit (and a single leading `+`) from `raw`, then
 * prepend the HK country code when the result is exactly 8 digits
 * (the unambiguous signature of a bare HK mobile / landline).
 *
 * Returns `null` for empty / unparseable input so callers can treat
 * "no number" as a single sentinel value.
 */
export function normalizeForWhatsApp(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Drop everything that isn't a digit. The leading `+` is optional;
  // we don't preserve it because `wa.me/<n>` requires the bare digit
  // form anyway.
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;

  // Bare HK local number (8 digits with no country code) → prepend 852.
  if (digits.length === HK_LOCAL_LENGTH) {
    return `${HK_COUNTRY_CODE}${digits}`;
  }

  // Anything else: assume it already includes a country code (852, 86,
  // 1, 44, etc.). We deliberately don't try to "smart-detect" missing
  // country codes for non-HK numbers — that would silently corrupt
  // valid foreign numbers.
  return digits;
}

/**
 * Build a `https://wa.me/<number>?text=<message>` URL ready to drop
 * into a `<a href>` or `window.open()`.
 *
 * Returns `null` when the phone number can't be normalized — callers
 * should hide the WhatsApp button rather than render a broken link.
 *
 * Example:
 *
 *   buildWhatsAppUrl("+852 1234 5678", "Hi Alice, ping me first")
 *     // → "https://wa.me/85212345678?text=Hi%20Alice%2C%20ping%20me%20first"
 */
export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message?: string | null,
): string | null {
  const number = normalizeForWhatsApp(phone);
  if (!number) return null;

  const base = `https://wa.me/${number}`;
  if (!message) return base;

  const trimmed = String(message).trim();
  if (!trimmed) return base;

  return `${base}?text=${encodeURIComponent(trimmed)}`;
}

/**
 * Convenience: returns the canonical display form for a number,
 * e.g. `+852 1234 5678` for HK numbers (so we can show it consistently
 * in the UI even when the underlying record stores the unformatted
 * variant). Returns the original string when normalization fails.
 */
export function formatWhatsAppDisplay(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const normalized = normalizeForWhatsApp(raw);
  if (!normalized) return raw ?? null;

  // HK pattern: 852 + 8 digits → "+852 1234 5678"
  if (normalized.startsWith(HK_COUNTRY_CODE) && normalized.length === HK_COUNTRY_CODE.length + HK_LOCAL_LENGTH) {
    const local = normalized.slice(HK_COUNTRY_CODE.length);
    return `+${HK_COUNTRY_CODE} ${local.slice(0, 4)} ${local.slice(4)}`;
  }

  // Generic: just slap a leading "+" so the user knows it's
  // international form.
  return `+${normalized}`;
}
