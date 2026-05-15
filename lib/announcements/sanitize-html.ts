/**
 * Strip dangerous fragments from admin-authored announcement HTML.
 * Not a full HTML parser — avoids script-like vectors and inline handlers.
 */
export function sanitizeAnnouncementHtml(raw: string): string {
  let s = raw.slice(0, 80_000);
  s = s.replace(/<\/(?:script|style|iframe|object|embed)[^>]*>/gi, "");
  s = s.replace(/<(?:script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/(?:script|style|iframe|object|embed)>/gi, "");
  s = s.replace(/<(?:script|style|iframe|object|embed)\b[^<>]*\/?>/gi, "");
  s = s.replace(/javascript:/gi, "");
  s = s.replace(/data:text\/html/gi, "");
  s = s.replace(/\son\w+\s*=/gi, " data-removed=");
  return s.trim();
}
