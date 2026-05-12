/**
 * Shared definition of "synthetic / computed" fields per source.
 *
 * These are NOT in `form_options` — they're produced by
 * {@link lib/field-resolver.ts} (`getInsuredDisplayName`,
 * `getInsuredPrimaryId`, `buildAddressFromGetter`, etc.) and
 * auto-pick the right value for the given snapshot regardless of
 * personal vs company / cascading vs flat / category-locked variants.
 *
 * Multiple surfaces consume this catalogue:
 *
 *  - `components/admin/pdf-templates/PdfTemplateEditor.tsx` —
 *    PDF Mail-Merge "Add Section" picker shows these as the
 *    default-on, "Auto" badged entries above admin-configured
 *    fields. (See `SYNTHETIC_FIELDS_BY_SOURCE` re-export there.)
 *
 *  - `components/dashboard/policy-expiry-calendar.tsx` —
 *    "Extra fields per row" picker mirrors the same catalogue so
 *    the user can pick "Display Name" / "Primary ID" / "Full
 *    Address" without knowing which raw snapshot key holds the
 *    value for a particular policy.
 *
 * Keep in sync with `lib/field-resolver.ts`:
 *  - `resolveInsured`     → `displayName`, `primaryId`, `age`
 *  - `resolveContact`     → `fullAddress`
 *  - `resolveOrganisation`→ `fullAddress`
 *  - `resolveClient`      → `displayName`, `primaryId`
 *
 * Per the `dynamic-config-first` skill, do NOT add new entries
 * here without a matching resolver branch — synthetic fields are
 * the ONE place we accept hard-coded labels because the underlying
 * computation is cross-cutting (e.g. picking lastName+firstName vs
 * companyName based on `insuredType`).
 */

export type SyntheticFieldFormat = "currency" | "date" | "number" | "boolean" | "match";

export type SyntheticFieldDef = {
  /** Human-readable label shown in any field picker UI. */
  label: string;
  /** Canonical key understood by `lib/field-resolver.ts`. */
  fieldKey: string;
  /** Hint for {@link formatResolvedValue} when rendering. */
  format?: SyntheticFieldFormat;
};

/**
 * Synthetic fields keyed by source name. Sources match the
 * `PdfFieldMapping["source"]` enum and the API's `extraFields`
 * package keys (e.g. "insured", "contactinfo", "organisation").
 */
export const SYNTHETIC_FIELDS_BY_SOURCE: Record<string, SyntheticFieldDef[]> = {
  insured: [
    { label: "Display Name", fieldKey: "displayName" },
    { label: "Primary ID", fieldKey: "primaryId" },
    { label: "Age", fieldKey: "age", format: "number" },
  ],
  contactinfo: [
    { label: "Full Address", fieldKey: "fullAddress" },
  ],
  organisation: [
    { label: "Full Address", fieldKey: "fullAddress" },
  ],
  client: [
    { label: "Display Name", fieldKey: "displayName" },
    { label: "Primary ID", fieldKey: "primaryId" },
  ],
};

/**
 * Admin field keys that are SUBSUMED by a synthetic field for the
 * same source. The picker UIs hide these from the "main" list (or
 * tuck them under a "More fields" divider) so admins reach for the
 * synthetic Auto-resolving entry by default.
 *
 * Matching is fuzzy (lowercase + alphanumerics only) so admins can
 * use `last_name` / `lastName` / `LastName` / `LAST NAME` etc.
 */
export const HANDLED_FIELD_KEYS_BY_SOURCE: Record<string, Set<string>> = {
  insured: new Set([
    // Subsumed by `displayName` (resolves person OR company name).
    "lastname", "firstname", "fullname", "name",
    "companyname", "fullcompanyname",
    // Subsumed by `primaryId` (HKID OR BR number, by insuredType).
    "idnumber", "id", "hkid", "hkidnumber",
    "brnumber", "br", "businessregistration", "businessregistrationnumber",
    "cinumber", "ci",
    // Subsumed by `age` (insured-with-license OR Driver 1 fallback).
    "age",
  ]),
  contactinfo: new Set([
    "address", "fulladdress",
    "flatnumber", "floornumber", "blocknumber", "blockname",
    "streetnumber", "streetname",
    "propertyname", "districtname", "area",
  ]),
  organisation: new Set([
    "address", "fulladdress",
    "flatnumber", "floornumber", "blocknumber", "blockname",
    "streetnumber", "streetname",
    "propertyname", "districtname", "area",
  ]),
};

/** Lowercase + strip non-alphanum so admin key spellings collapse. */
export function normalizeFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True if the admin field is already covered by a synthetic field. */
export function isHandledByDefault(source: string, fieldKey: string): boolean {
  const set = HANDLED_FIELD_KEYS_BY_SOURCE[source];
  if (!set) return false;
  return set.has(normalizeFieldKey(fieldKey));
}
