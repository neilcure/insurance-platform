/**
 * Premium / statement lines often append a letter suffix: "POLS-123(a)".
 * For UI we show one bordered card with the base number and open the primary policy row.
 */

/** Remove trailing " (a)" / "(b)" style suffix (case-insensitive). */
export function stripPolicyLineSuffix(policyNumber: string): string {
  return String(policyNumber ?? "").replace(/\s*\([a-z]\)\s*$/i, "").trim();
}

/** Optional: "POLS 1775" → "POLS-1775" for consistent mono display. */
export function formatPolicyNumberForDisplay(policyNumber: string): string {
  const s = String(policyNumber ?? "").trim();
  if (!s) return s;
  return s.replace(/^([A-Za-z]+)\s+(\d)/, "$1-$2");
}
