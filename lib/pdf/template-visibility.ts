import type { PdfTemplateMeta } from "@/lib/types/pdf-template";

/**
 * Read each `packagesSnapshot[pkg].category` from a policy's
 * `extraAttributes` blob into a flat lookup. Defensive against missing
 * / malformed snapshots — callers don't want a thrown error to hide
 * every PDF template from the policy's Documents tab.
 */
export function readPackageCategoriesFromPolicy(
  extraAttributes: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const root = (extraAttributes ?? {}) as Record<string, unknown>;
  const snap = root.packagesSnapshot;
  if (!snap || typeof snap !== "object") return out;
  for (const [pkgKey, pkgVal] of Object.entries(snap as Record<string, unknown>)) {
    if (!pkgVal || typeof pkgVal !== "object") continue;
    const obj = pkgVal as { category?: unknown };
    const cat = String(obj.category ?? "").trim();
    if (cat) out[pkgKey] = cat;
  }
  return out;
}

/**
 * Decide whether a PDF (or HTML) template's `packageCategories`
 * restriction is satisfied by the given policy.
 *
 * Semantics:
 *   • Empty / missing `packageCategories` on the template      → match (no restriction).
 *   • Empty array `[]` for a particular package on the template → match (no restriction from that package).
 *   • Non-empty array — the policy's `packagesSnapshot[pkg].category`
 *     MUST be included in the array. If the policy has no category
 *     stored for that package (older policies / wizard didn't ask for
 *     a category), the template is hidden — we treat unknown as a
 *     non-match because the admin explicitly said "only X / Y / Z".
 *   • Multiple packages on the template → ALL must pass (AND).
 *
 * Used by `components/policies/tabs/DocumentsTab.tsx` and any other
 * surface that lists templates available for a policy.
 */
export function matchesPackageCategories(
  templateCategories: PdfTemplateMeta["packageCategories"],
  policyPackageCategories: Record<string, string>,
): boolean {
  if (!templateCategories) return true;
  for (const [pkgKey, cats] of Object.entries(templateCategories)) {
    if (!Array.isArray(cats) || cats.length === 0) continue;
    const policyCat = policyPackageCategories[pkgKey];
    if (!policyCat) return false;
    const wanted = cats.map((c) => String(c ?? "").trim().toLowerCase()).filter(Boolean);
    if (!wanted.includes(policyCat.toLowerCase())) return false;
  }
  return true;
}
