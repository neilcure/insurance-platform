import { parseAnyDate, fmtDateDDMMYYYY } from "@/lib/format/date";

/**
 * Resolve a field reference key to its current string value from form data.
 * When `pkg` is provided, tries `pkg__key` first (package-scoped lookup),
 * then falls back to direct key and fuzzy suffix matching.
 */
export function resolveFieldValue(
  key: string,
  formValues: Record<string, unknown>,
  pkg?: string,
): string {
  const candidates: unknown[] = [];
  if (pkg) candidates.push(formValues[`${pkg}__${key}`]);
  candidates.push(formValues[key]);
  for (const v of candidates) {
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  const keyLower = key.toLowerCase();
  for (const [fk, fv] of Object.entries(formValues)) {
    if (fv === undefined || fv === null || fv === "") continue;
    const suffix = fk.includes("__") ? fk.split("__").pop()! : fk;
    if (suffix.toLowerCase() === keyLower) return String(fv);
  }
  return "";
}

/**
 * Evaluate a formula string like `{startDate} + 365` or `{premium} * 0.1`
 * using current form values. Supports date arithmetic (+ N days) and
 * basic numeric expressions.
 */
export function evaluateFormula(
  formula: string,
  formValues: Record<string, unknown>,
  pkg?: string,
): string {
  if (!formula) return "";
  try {
    const refs: Record<string, string> = {};
    formula.replace(/\{([^}]+)\}/g, (_, key: string) => {
      refs[key.trim()] = resolveFieldValue(key.trim(), formValues, pkg);
      return "";
    });
    if (Object.values(refs).some((v) => v === "")) return "";

    const hasDate = Object.values(refs).some((v) => parseAnyDate(v) !== null);

    if (hasDate) {
      const dateMatch = /^\{([^}]+)\}\s*([+-])\s*(\d+)\s*(d|days?)?$/i.exec(formula.trim());
      if (dateMatch) {
        const refVal = refs[dateMatch[1].trim()] ?? "";
        const baseDate = parseAnyDate(refVal);
        if (!baseDate) return "";
        const offset = Number(dateMatch[3]) * (dateMatch[2] === "-" ? -1 : 1);
        const result = new Date(baseDate);
        result.setDate(result.getDate() + offset);
        return fmtDateDDMMYYYY(result);
      }
      return "";
    }

    const resolved = formula.replace(/\{([^}]+)\}/g, (_, key: string) => {
      const raw = refs[key.trim()] || "0";
      const n = Number(raw);
      return Number.isFinite(n) ? String(n) : "0";
    });
    if (!/^[\d\s+\-*/().]+$/.test(resolved)) return "";
    const result = new Function(`"use strict"; return (${resolved});`)() as number;
    if (!Number.isFinite(result)) return "";
    return String(Math.round(result * 100) / 100);
  } catch {
    return "";
  }
}
