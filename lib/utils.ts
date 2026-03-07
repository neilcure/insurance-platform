export function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Normalize a field key for comparison: strip leading underscores,
 * lowercase, and remove all non-alphanumeric characters.
 */
export function normalizeFieldKey(s: string): string {
  return s.replace(/^_+/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Normalize a raw string into a safe, lowercase key
 * (spaces → underscores, strip non-alphanumeric except _ and -).
 */
export function normalizeKeyLike(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

const HELPER_PACKAGE_FRAGMENTS = ["newexistingclient", "existorcreateclient", "existcreate", "chooseclient"] as const;
const HELPER_PACKAGE_LABELS = ["new or existing client"] as const;

/**
 * Returns true if a package should be hidden from snapshot display
 * (helper packages have no user-facing data).
 */
export function isHiddenPackage(name: string, label?: string): boolean {
  const nk = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (HELPER_PACKAGE_FRAGMENTS.some(f => nk.includes(f))) return true;
  if (label) {
    const ll = label.toLowerCase();
    if (HELPER_PACKAGE_LABELS.some(l => ll.includes(l))) return true;
  }
  return false;
}

