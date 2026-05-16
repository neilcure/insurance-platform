import { parseAnyDate, fmtDateDDMMYYYY } from "@/lib/format/date";

/**
 * Admins often write `{insured_insuredOccupation}` while RHF keys are
 * `insured__occupation` (field `value` in `insured_fields` is `occupation`).
 * Expands to canonical keys so `resolveFieldValue` and formula UI can find
 * the same cell as the insured select.
 */
export function expandRedundantPackageFieldRef(refKey: string): string[] {
  const refKeyTrim = String(refKey ?? "").trim();
  const m = /^([a-zA-Z][a-zA-Z0-9]*)(?:__|_)(.+)$/.exec(refKeyTrim);
  if (!m) return [];
  const [, srcPkg, tail] = m;
  const pl = srcPkg.toLowerCase();
  const out: string[] = [];
  const push = (s: string) => {
    const t = String(s ?? "").trim();
    if (!t || out.some((e) => e.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };
  if (tail.length > pl.length && tail.slice(0, pl.length).toLowerCase() === pl) {
    const after = tail.slice(srcPkg.length);
    if (after) {
      push(`${srcPkg}__${after.charAt(0).toLowerCase() + after.slice(1)}`);
      push(`${srcPkg}_${after.charAt(0).toLowerCase() + after.slice(1)}`);
    }
  }
  const re = new RegExp(`^${srcPkg}_`, "i");
  const st = tail.replace(re, "");
  if (st && st !== tail) {
    push(`${srcPkg}__${st}`);
    push(`${srcPkg}_${st}`);
  }
  return out;
}

function sepFlipKeyVariants(k: string): string[] {
  const m = /^([a-zA-Z][a-zA-Z0-9]*)(__|_)(.+)$/.exec(k);
  if (!m) return [k];
  const [, prefix, sep, rest] = m;
  const altSep = sep === "__" ? "_" : "__";
  const alt = `${prefix}${altSep}${rest}`;
  return k === alt ? [k] : [k, alt];
}

/**
 * Resolve a field reference key to its current string value from form data.
 * When `pkg` is provided, tries `pkg__key` first (package-scoped lookup),
 * then falls back to direct key and fuzzy suffix matching.
 *
 * Tolerances (intentional — admins write formulas in many shapes):
 *   - `_` ↔ `__` mismatches between the scope prefix and the rest of the
 *     key. `{insured_dateOfBirth}` and `{insured__dateOfBirth}` must find
 *     the same value.
 *   - Case mismatches in the PACKAGE PREFIX. Some admins type
 *     `{Insured_idNumber}` while the form value lives under
 *     `insured__idNumber`. `form_options` enforces lowercase package keys,
 *     so the canonical stored shape is always lowercase — the resolver
 *     must look at both spellings or the formula silently resolves to "".
 *   - Case-insensitive whole-key match as a last resort (so a wholly
 *     mismatched-case formula still finds its value).
 */
export function resolveFieldValue(
  key: string,
  formValues: Record<string, unknown>,
  pkg?: string,
): string {
  const variantSet = new Set<string>();
  // Build case variants of the package prefix so `Insured_x` matches
  // `insured__x`. We only mutate the segment BEFORE the first separator,
  // never the tail — admins rely on case-sensitive tail keys today.
  const caseVariants = (k: string): string[] => {
    const m = /^([a-zA-Z][a-zA-Z0-9]*)(__|_)(.+)$/.exec(k);
    if (!m) return [k];
    const [, prefix, sep, rest] = m;
    const lower = prefix.toLowerCase();
    if (lower === prefix) return [k];
    return [k, `${lower}${sep}${rest}`];
  };

  for (const root of [key, ...expandRedundantPackageFieldRef(key)]) {
    for (const k of sepFlipKeyVariants(root)) {
      for (const ck of caseVariants(k)) variantSet.add(ck);
    }
  }
  const variants = [...variantSet];

  const candidates: unknown[] = [];
  for (const k of variants) {
    if (pkg) candidates.push(formValues[`${pkg}__${k}`]);
    candidates.push(formValues[k]);
  }
  for (const v of candidates) {
    if (v !== undefined && v !== null && v !== "") return String(v);
  }

  // Case-insensitive whole-key match (last resort). We look at the full
  // form key, not just the suffix-after-`__`, because an admin formula
  // like `{Insured_insuredOccuption}` needs to find the form key
  // `insured__insuredOccuption` — those don't share a suffix after the
  // last `__`, only the case-folded whole identifier matches.
  const normalize = (s: string) => s.toLowerCase().replace(/__/g, "_");
  const keyNormalized = normalize(key);
  for (const [fk, fv] of Object.entries(formValues)) {
    if (fv === undefined || fv === null || fv === "") continue;
    if (normalize(fk) === keyNormalized) return String(fv);
    // Suffix-only match (legacy): `idNumber` finds `insured__idNumber`.
    const suffix = fk.includes("__") ? fk.split("__").pop()! : fk;
    if (suffix.toLowerCase() === key.toLowerCase()) return String(fv);
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
