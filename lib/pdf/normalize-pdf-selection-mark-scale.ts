/**
 * Server-safe clamp for `selectionMarkScale` on PDF generate APIs.
 * Standalone so App Route handlers never import `form-selections-preferences.ts`.
 */
export function normalizePdfSelectionMarkScale(v: unknown): number {
  if (v === null || v === undefined || v === "") return 1;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.35, Math.max(0.55, n));
}
