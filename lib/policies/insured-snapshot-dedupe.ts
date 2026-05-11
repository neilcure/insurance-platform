/**
 * Deduplicate `insuredSnapshot` keys that describe the same logical field
 * but differ only in casing or underscore style (e.g. `insured__ciNumber`
 * vs `insured__cinumber`, or `insured__category` vs `insured_category`).
 *
 * This exists because the policy wizard's "fill form from existing record"
 * helpers historically wrote both the original and a normalized lowercase /
 * single-underscore variant of every insured/contactinfo key into the React
 * Hook Form state. On submit the wizard collects every `insured_*` /
 * `contactinfo_*` form value into the outgoing `insured` payload, which is
 * then full-replaced into the database snapshot — leaving the snapshot with
 * two keys (one CamelCase, one lowercase) that BOTH appear as "changes from
 * null" in the audit log, even when the user typed nothing.
 *
 * Rules:
 *   1. Normalise the key by stripping the `insured__` / `insured_` /
 *      `contactinfo__` / `contactinfo_` prefix, then lowercasing, then
 *      removing remaining underscores. All keys that collapse to the same
 *      normalised form are duplicates of each other.
 *   2. Keep exactly ONE key per logical field. Preference order:
 *      a) `pkg__field` (double-underscore) beats `pkg_field` (single).
 *      b) When both are double-underscore, the one that preserves original
 *         casing beats the all-lowercase clone.
 *      c) Otherwise the first key encountered wins.
 *
 * The chosen key carries its own value (which in practice is identical to
 * the duplicate's value, since both were created from the same source).
 *
 * Non-prefixed keys (e.g. `insuredType`, `clientPolicyId`) pass through
 * unchanged — they normalise to themselves and never collide with prefixed
 * keys.
 */
export function dedupeInsuredSnapshot(
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const norm = (k: string) =>
    k.toLowerCase().replace(/^(insured|contactinfo)_{1,2}/, "").replace(/_/g, "");
  type Entry = { key: string; val: unknown };
  const seen = new Map<string, Entry>();
  for (const [k, v] of Object.entries(snapshot)) {
    const n = norm(k);
    const prev = seen.get(n);
    if (!prev) {
      seen.set(n, { key: k, val: v });
      continue;
    }
    const kHasDouble = k.includes("__");
    const prevHasDouble = prev.key.includes("__");
    if (kHasDouble && !prevHasDouble) {
      seen.set(n, { key: k, val: v });
    } else if (kHasDouble && prevHasDouble) {
      if (k !== k.toLowerCase() && prev.key === prev.key.toLowerCase()) {
        seen.set(n, { key: k, val: v });
      }
    }
  }
  const result: Record<string, unknown> = {};
  for (const { key, val } of seen.values()) {
    result[key] = val;
  }
  return result;
}

/**
 * Returns the list of keys that `dedupeInsuredSnapshot` would drop.
 * Useful for cleanup scripts and audit reporting.
 */
export function findDuplicateInsuredKeys(
  snapshot: Record<string, unknown>,
): string[] {
  const kept = dedupeInsuredSnapshot(snapshot);
  return Object.keys(snapshot).filter((k) => !(k in kept));
}
