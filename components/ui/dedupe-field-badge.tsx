import * as React from "react";
import { ShieldCheck } from "lucide-react";

/**
 * Visual hint shown next to any field that an admin has tagged as a
 * duplicate-client identifier (`meta.dedupeIdentifier === true`).
 *
 * The /api/policies POST (client-creation flows) refuses to create a
 * duplicate client when the value typed in this field matches an existing
 * record. See `lib/import/client-resolver.ts` -> `findClientByIdentity`.
 *
 * Used in two places:
 *   - Wizard field labels (`components/policies/PackageBlock.tsx`) — sets
 *     end-user expectation BEFORE they hit Continue.
 *   - Admin field-list table (`components/admin/generic/GenericFieldsManager.tsx`)
 *     — lets admins see at a glance which fields are tagged.
 */
export function DedupeFieldBadge({ category }: { category?: string }) {
  const cat = String(category ?? "").trim().toLowerCase();
  const tooltip =
    cat && cat !== "any"
      ? `Used to detect duplicate clients (when category = ${cat})`
      : "Used to detect duplicate clients";
  return (
    <span
      className="ml-1 inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-medium leading-none text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
      title={tooltip}
      aria-label={tooltip}
    >
      <ShieldCheck className="h-2.5 w-2.5" />
      <span>unique</span>
    </span>
  );
}

/**
 * Returns a `<DedupeFieldBadge>` for a field's `meta` if it is tagged AND
 * belongs to a package that participates in the duplicate-client check.
 * Today, only the `insured` package's snapshot is consulted by
 * `findClientByIdentity`, so the badge is hidden on other packages even
 * if an admin accidentally tagged a non-insured field.
 */
export function dedupeBadgeFromMeta(
  meta: Record<string, unknown> | undefined | null,
  pkg: string,
): React.ReactNode {
  if (pkg !== "insured") return null;
  if (!meta || (meta as { dedupeIdentifier?: unknown }).dedupeIdentifier !== true) return null;
  const cat = (meta as { dedupeCategory?: unknown }).dedupeCategory;
  return <DedupeFieldBadge category={typeof cat === "string" ? cat : ""} />;
}
