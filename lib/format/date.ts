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
