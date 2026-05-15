/**
 * Allow http/https/mailto/tel only. Anything else (`javascript:`,
 * `data:`, malformed URLs) becomes `null` so the dashboard never
 * renders a clickable XSS vector even if an admin pastes one in.
 */
export function sanitizeAnnouncementLinkUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const proto = url.protocol.toLowerCase();
    if (proto === "http:" || proto === "https:" || proto === "mailto:" || proto === "tel:") {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}
