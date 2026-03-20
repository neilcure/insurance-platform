/**
 * Deep-compare two values (JSON-serialisable) for equality.
 * Used by admin CRUD forms to detect whether the user changed anything.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;

  return aKeys.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}

/**
 * Build a normalised snapshot of a form payload for comparison.
 * Strips `undefined` values so that missing vs undefined keys compare equal.
 */
export function formSnapshot(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload));
}
