/**
 * Form-selection mark prefs: storage keys + browser reads.
 * Safe to import from client code (no React in this file).
 *
 * `normalizePdfSelectionMarkScale` for API routes: `@/lib/pdf/normalize-pdf-selection-mark-scale`.
 * Hooks / emit: `form-selections-mark-prefs-client.tsx`.
 */

import { normalizePdfSelectionMarkScale as normalizeMarkScale } from "./normalize-pdf-selection-mark-scale";

export const PDF_SELECTION_MARK_STORAGE_KEY = "formSelections.pdfSelectionMark";

/** Scale for ✓/✗ vector marks vs the widget box (0.55–1.35). Default 1. */
export const PDF_SELECTION_MARK_SCALE_KEY = "formSelections.pdfSelectionMarkScale";

/** Same-tab updates (localStorage does not fire `storage` in the same window). */
export const PDF_SELECTION_MARK_CHANGED_EVENT = "pdf-selection-mark-changed";

export type PdfSelectionMarkStyle = "check" | "cross";

export function normalizePdfSelectionMarkStyle(v: unknown): PdfSelectionMarkStyle {
  if (v === "cross") return "cross";
  return "check";
}

/** Browser only — use from client components when building fetch bodies. */
export function readPdfSelectionMarkFromStorage(): PdfSelectionMarkStyle {
  if (typeof window === "undefined") return "check";
  try {
    const v = window.localStorage.getItem(PDF_SELECTION_MARK_STORAGE_KEY);
    return normalizePdfSelectionMarkStyle(v);
  } catch {
    return "check";
  }
}

/** Re-export for client bundles that already import this module. */
export function normalizePdfSelectionMarkScale(v: unknown): number {
  return normalizeMarkScale(v);
}

export function readPdfSelectionMarkScaleFromStorage(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(PDF_SELECTION_MARK_SCALE_KEY);
    return normalizeMarkScale(raw === null ? null : parseFloat(raw));
  } catch {
    return 1;
  }
}
