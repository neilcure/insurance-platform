/**
 * Shared helper: extract a date field (`startDate` or `endDate`) from
 * `cars.extraAttributes` (the policy snapshot JSONB column).
 *
 * Why JS-side extraction instead of SQL
 * -------------------------------------
 * The date is stored inside the JSONB snapshot under an admin-configured
 * key that varies per tenant (e.g. `startDate`, `startedDate`,
 * `policyinfo__startedDate`, etc.). Handling every variant in SQL would
 * require complex COALESCE chains over many JSONB paths; it's much safer
 * and more maintainable to do it in JS after fetching.
 *
 * This module is imported by:
 *   - app/api/policies/expiring/route.ts  (renewal calendar)
 *   - app/api/policies/route.ts           (month-tab filter)
 */

/** Tokens for start / end date field normalisation.
 *
 * NOTE: do NOT include `issuedate` — that's when paperwork was created,
 * not when coverage starts, and it false-matches alongside startedDate. */
const START_TOKENS = [
  "startdate",
  "starteddate",
  "datestarted",
  "effectivedate",
  "effectivefrom",
  "validfrom",
  "fromdate",
  "coverstart",
  "coveragestart",
  "termstart",
  "commencementdate",
  "inceptiondate",
];

const END_TOKENS = [
  "enddate",
  "endeddate",
  "expirydate",
  "expirationdate",
  "expireddate",
  "validto",
  "validuntil",
  "todate",
  "untildate",
  "coverend",
  "coverageend",
  "termend",
  "terminationdate",
];

/** Prefix words that get stripped before token matching so e.g.
 *  "policyStartDate" normalises to "startdate". */
const STRIP_PREFIX = /^(?:policy|cover|coverage|insurance|term|effective)/;

function normaliseKey(raw: string): string {
  let k = raw.toLowerCase();
  const dunder = k.indexOf("__");
  if (dunder >= 0) k = k.slice(dunder + 2);
  k = k.replace(/[-_\s]+/g, "");
  k = k.replace(STRIP_PREFIX, "");
  return k;
}

function scanFlat(
  obj: Record<string, unknown> | null | undefined,
  tokens: string[],
): string {
  if (!obj || typeof obj !== "object") return "";
  let firstSuffixMatch = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || (typeof v === "object" && !Array.isArray(v))) continue;
    const value = (typeof v === "string" ? v : String(v)).trim();
    if (!value) continue;
    const nk = normaliseKey(k);
    for (const t of tokens) {
      if (nk === t) return value; // exact → return immediately
    }
    if (!firstSuffixMatch) {
      for (const t of tokens) {
        if (nk.endsWith(t) || nk.includes(t)) {
          firstSuffixMatch = value;
          break;
        }
      }
    }
  }
  return firstSuffixMatch;
}

/**
 * Pull `startDate` or `endDate` out of `cars.extraAttributes`.
 *
 * Walks every package in `packagesSnapshot` (starting with `"policy"`)
 * and falls back to flat keys directly on `extraAttributes`.
 * Returns a raw date string (DD-MM-YYYY or YYYY-MM-DD) or `""`.
 */
export function extractDateField(
  carExtra: Record<string, unknown> | null | undefined,
  fieldKey: "endDate" | "startDate",
): string {
  if (!carExtra || typeof carExtra !== "object") return "";
  const tokens = fieldKey === "startDate" ? START_TOKENS : END_TOKENS;
  const snapshot = carExtra as Record<string, unknown>;
  const pkgs = (snapshot.packagesSnapshot ?? {}) as Record<string, unknown>;

  const pkgOrder = ["policy", ...Object.keys(pkgs).filter((k) => k !== "policy")];
  for (const pkgName of pkgOrder) {
    const pkg = pkgs[pkgName];
    if (!pkg || typeof pkg !== "object") continue;
    const values =
      (pkg as { values?: Record<string, unknown> }).values ??
      (pkg as Record<string, unknown>);
    const v = scanFlat(values as Record<string, unknown>, tokens);
    if (v) return v;
    if ((pkg as { values?: unknown }).values) {
      const w = scanFlat(pkg as Record<string, unknown>, tokens);
      if (w) return w;
    }
  }

  return scanFlat(snapshot, tokens);
}
