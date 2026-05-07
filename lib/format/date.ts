/**
 * Normalise a PostgreSQL `timestamp` (without time zone) value into a
 * proper ISO-UTC string ending in `Z`.
 *
 * Why this exists
 * ---------------
 * Almost every `timestamp` column in this codebase is declared as
 * `timestamp("...", { mode: "string" })` — i.e. WITHOUT a time zone.
 * PostgreSQL stamps `now()` in the DB server's local clock (UTC for
 * Neon / most cloud Postgres) and stores it without any tz marker.
 *
 * When a raw `db.execute(sql`SELECT ts FROM ...`)` round-trips that
 * value through postgres-js, the wire format is a plain string like
 * `"2026-05-07 01:47:23.456"` — no `Z`, no `+00:00`.
 *
 * Sending that raw string to the client breaks `Date.parse` in
 * non-trivial ways: per ECMAScript 2017+, an ISO-shaped string with
 * NO offset is interpreted as **local** time. So a viewer in Hong
 * Kong (UTC+8) treats the value as HKT, then subtracts the *real*
 * UTC `Date.now()` — and gets a constant 8-hour offset (the
 * "everyone online 8h ago, forever" symptom in the presence widget).
 *
 * This helper:
 *   - returns ISO unchanged if it already has Z or a +HH:MM suffix;
 *   - converts the postgres-js space-separated form into ISO + `Z`;
 *   - falls back to "now" for null/invalid input so callers never
 *     accidentally send `undefined` to the client.
 *
 * Use this in any API route that surfaces a `timestamp` column to
 * the browser for display (presence, audit logs, recent activity,
 * etc). Drizzle-mode select(), which also uses `mode: "string"`,
 * has the same issue — pipe the value through this helper before
 * `JSON.stringify`.
 */
export function pgTimestampToIsoUtc(
  value: string | Date | null | undefined,
): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? new Date().toISOString()
      : value.toISOString();
  }
  if (typeof value !== "string" || value.length === 0) {
    return new Date().toISOString();
  }
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value)) return value;
  const normalised = (value.includes("T") ? value : value.replace(" ", "T")) + "Z";
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Format an ISO date string as DD-MM-YYYY for display.
 */
export function formatDDMMYYYY(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Format an ISO date string as DD-MM-YYYY HH:MM for display (date + time).
 */
export function formatDDMMYYYYHHMM(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

/**
 * Parse a date string in DD-MM-YYYY, DD/MM/YYYY, or YYYY-MM-DD format.
 * Returns null for empty/invalid input.
 *
 * Accepting BOTH slash and hyphen separators is intentional: the wizard's
 * date input mask emits hyphens (`maskDDMMYYYY`) but the bulk-import
 * validator normalises to slashes (`formatDateDDMMYYYY` in lib/import/validate.ts),
 * and formula evaluation (lib/formula.ts → here) needs to recognise both
 * shapes so end-date / issue-date computations work for imported policies too.
 */
export function parseAnyDate(s: string): Date | null {
  const trimmed = String(s ?? "").trim();
  if (!trimmed) return null;
  // DD-MM-YYYY or DD/MM/YYYY (also tolerate "DD.MM.YYYY", same as the import
  // parser does — keeps a single source of truth for accepted shapes).
  const ddmmyyyy = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const d = new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (yyyymmdd) {
    const d = new Date(Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Format a Date object as DD-MM-YYYY.
 */
export function fmtDateDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/**
 * Live input mask: as the user types digits, format them into DD-MM-YYYY.
 */
export function maskDDMMYYYY(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}
