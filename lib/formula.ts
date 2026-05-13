import { parseAnyDate, fmtDateDDMMYYYY } from "@/lib/format/date";

/**
 * Resolve a field reference key to its current string value from form data.
 * When `pkg` is provided, tries `pkg__key` first (package-scoped lookup),
 * then falls back to direct key and fuzzy suffix matching.
 *
 * Also tolerates `_` ↔ `__` mismatches between the scope prefix and the rest
 * of the key. The wizard stores some snapshot keys with the package-style
 * `__` separator (e.g. `insured__dateOfBirth`) and others with the legacy
 * `_` separator (e.g. `insured_lastName`) depending on field origin. Admins
 * writing formulas shouldn't have to remember which one applies — both
 * `{insured_dateOfBirth}` and `{insured__dateOfBirth}` should find the same
 * value.
 */
export function resolveFieldValue(
  key: string,
  formValues: Record<string, unknown>,
  pkg?: string,
): string {
  const variants: string[] = [key];
  const m = /^([a-zA-Z][a-zA-Z0-9]*)(__|_)(.+)$/.exec(key);
  if (m) {
    const [, prefix, sep, rest] = m;
    const altSep = sep === "__" ? "_" : "__";
    variants.push(`${prefix}${altSep}${rest}`);
  }

  const candidates: unknown[] = [];
  for (const k of variants) {
    if (pkg) candidates.push(formValues[`${pkg}__${k}`]);
    candidates.push(formValues[k]);
  }
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

// ---- Date-difference helpers ------------------------------------------------
// Calendar-aware diffs: a person born on 30 Apr 1990 is "35" until 30 Apr 2026,
// not the day the day-count tips over 36*365.25. Same logic for months.

function diffYears(later: Date, earlier: Date): number {
  let years = later.getFullYear() - earlier.getFullYear();
  const monthDelta = later.getMonth() - earlier.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && later.getDate() < earlier.getDate())) {
    years--;
  }
  return years;
}

function diffMonths(later: Date, earlier: Date): number {
  let months = (later.getFullYear() - earlier.getFullYear()) * 12;
  months += later.getMonth() - earlier.getMonth();
  if (later.getDate() < earlier.getDate()) months--;
  return months;
}

function diffDays(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Resolve a single argument to a Date — accepts `TODAY`, a `{fieldKey}`
 * placeholder (looked up from refs), or a literal date string.
 */
function resolveDateArg(arg: string, refs: Record<string, string>): Date | null {
  const trimmed = arg.trim();
  if (/^TODAY$/i.test(trimmed)) return new Date();
  const refMatch = /^\{([^}]+)\}$/.exec(trimmed);
  if (refMatch) {
    const v = refs[refMatch[1].trim()] ?? "";
    return parseAnyDate(v);
  }
  return parseAnyDate(trimmed);
}

/**
 * Replace `YEARS_BETWEEN(a, b)` / `MONTHS_BETWEEN(a, b)` / `DAYS_BETWEEN(a, b)`
 * occurrences with their integer results so the rest of the pipeline can
 * treat them as plain numbers. Returns null if any argument fails to parse —
 * matches the existing "missing ref → empty result" contract.
 */
function applyDateFns(formula: string, refs: Record<string, string>): string | null {
  const re = /(YEARS_BETWEEN|MONTHS_BETWEEN|DAYS_BETWEEN)\s*\(\s*([^(),]+?)\s*,\s*([^(),]+?)\s*\)/gi;
  let failed = false;
  const out = formula.replace(re, (_m, fn: string, a: string, b: string) => {
    const da = resolveDateArg(a, refs);
    const db = resolveDateArg(b, refs);
    if (!da || !db) {
      failed = true;
      return "";
    }
    const [later, earlier] = da >= db ? [da, db] : [db, da];
    const fnUpper = fn.toUpperCase();
    let result: number;
    if (fnUpper === "YEARS_BETWEEN") result = diffYears(later, earlier);
    else if (fnUpper === "MONTHS_BETWEEN") result = diffMonths(later, earlier);
    else result = diffDays(later, earlier);
    return String(result);
  });
  return failed ? null : out;
}

/**
 * Pre-process FLOOR/CEIL/ROUND into Math.floor/Math.ceil/Math.round so the
 * numeric eval branch can execute them. Word-boundary anchored + requires `(`
 * immediately after, so it never collides with field keys like `{round_value}`.
 */
function applyMathFns(formula: string): string {
  return formula.replace(/\b(FLOOR|CEIL|ROUND)\s*\(/gi, (_m, fn: string) => {
    return `Math.${fn.toLowerCase()}(`;
  });
}

// Strict whitelist for the numeric eval branch. Allows digits, whitespace,
// arithmetic operators, parens, comma, and ONLY the three Math.* functions
// we substituted in above. Anything else (other identifiers, member access,
// brackets, semicolons, etc.) fails validation → eval is never reached.
const NUMERIC_TOKEN_RE = /^(?:Math\.(?:floor|ceil|round)|[\d\s+\-*/().,])+$/;

/**
 * Evaluate a formula string like `{startDate} + 365`, `{premium} * 0.1`, or
 * `YEARS_BETWEEN(TODAY, {dateOfBirth})` using current form values.
 *
 * Supported shapes (in priority order):
 *   - `TODAY` / `TODAY ± N`                       → formatted date (DD-MM-YYYY)
 *   - `{dateField} ± N`                            → formatted date, N is days
 *   - `YEARS_BETWEEN(a, b)`                        → integer years
 *   - `MONTHS_BETWEEN(a, b)`                       → integer months
 *   - `DAYS_BETWEEN(a, b)`                         → integer days
 *     (a/b can be `TODAY`, `{fieldKey}`, or a literal date)
 *   - `FLOOR(expr)`, `CEIL(expr)`, `ROUND(expr)`   → math wrappers
 *   - Pure numeric: `{a} * 0.05`, `{a} + {b}`, …  → number rounded to 2dp
 *
 * Returns "" when any referenced field is empty, mirroring the wizard's
 * "don't write half-computed results" contract.
 */
export function evaluateFormula(
  formula: string,
  formValues: Record<string, unknown>,
  pkg?: string,
): string {
  if (!formula) return "";
  try {
    const trimmed = formula.trim();

    // TODAY / TODAY +/- N — snapshot-safe single-date formulas
    const todayMatch = /^TODAY(?:\s*([+-])\s*(\d+)\s*(d|days?)?)?$/i.exec(trimmed);
    if (todayMatch) {
      const now = new Date();
      if (todayMatch[1]) {
        const offset = Number(todayMatch[2]) * (todayMatch[1] === "-" ? -1 : 1);
        now.setDate(now.getDate() + offset);
      }
      return fmtDateDDMMYYYY(now);
    }

    const refs: Record<string, string> = {};
    formula.replace(/\{([^}]+)\}/g, (_, key: string) => {
      refs[key.trim()] = resolveFieldValue(key.trim(), formValues, pkg);
      return "";
    });

    const hasDateFn = /\b(?:YEARS_BETWEEN|MONTHS_BETWEEN|DAYS_BETWEEN)\s*\(/i.test(trimmed);

    // Existing single-date arithmetic branch (e.g. `{startDate} + 365`).
    // Skip when a *_BETWEEN call is present — those mix dates with numbers
    // and must flow through the numeric branch below.
    if (!hasDateFn) {
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

      // Single-variable string passthrough: `{someField}` with no arithmetic.
      // Allows formula fields to mirror any text value (e.g. ID numbers, names)
      // from another field without needing a separate text input.
      const singleVarMatch = /^\{([^}]+)\}$/.exec(trimmed);
      if (singleVarMatch) {
        const v = refs[singleVarMatch[1].trim()];
        if (v) return v;
      }
    }

    // Numeric pipeline: substitute date functions → numbers, then refs → numbers,
    // then map FLOOR/CEIL/ROUND → Math.* and eval through the strict whitelist.
    let working = formula;

    if (hasDateFn) {
      const replaced = applyDateFns(working, refs);
      if (replaced === null) return "";
      working = replaced;
    }

    if (/\{[^}]+\}/.test(working)) {
      const remainingKeys: string[] = [];
      working.replace(/\{([^}]+)\}/g, (_, k: string) => {
        remainingKeys.push(k.trim());
        return "";
      });
      for (const k of remainingKeys) {
        if ((refs[k] ?? "") === "") return "";
      }
      working = working.replace(/\{([^}]+)\}/g, (_, key: string) => {
        const raw = refs[key.trim()] || "0";
        const n = Number(raw);
        return Number.isFinite(n) ? String(n) : "0";
      });
    }

    working = applyMathFns(working);

    if (!NUMERIC_TOKEN_RE.test(working.trim())) return "";
    const result = new Function(`"use strict"; return (${working});`)() as number;
    if (!Number.isFinite(result)) return "";
    return String(Math.round(result * 100) / 100);
  } catch {
    return "";
  }
}
