import type { AddressFieldMap } from "@/components/policies/address-tool";

/**
 * Tokens used to auto-detect which form field should receive each part of a
 * geocoded address. The keys MUST mirror the {@link AddressFieldMap} shape
 * (`flatNumber`, `floorNumber`, `latitude`, etc.).
 *
 * IMPORTANT: tokens are matched against form field labels and values using
 * WORD-BOUNDARY matching (see {@link discoverAddressFields}). A short token
 * like `"lat"` will only match a standalone word `lat` / `Lat` / `latDeg`
 * — it will NOT match the substring `lat` inside `relationship`,
 * `lateral`, `translation`, etc. This is intentional: the previous naive
 * `String.includes` matching produced wrong mappings such as
 * `latitude → driver__relationship` (because `re-LAT-ionship` contains
 * `lat`), which then caused geocoded latitudes to be applied to the
 * driver's Relationship field.
 */
export const ADDRESS_TOKENS: Record<string, string[]> = {
  flatNumber: ["flat", "unit", "room", "rm"],
  floorNumber: ["floor", "flr", "level", "lvl", "foor"],
  blockNumber: ["blockno", "block number", "blkno"],
  blockName: ["blockname", "block name", "building name", "estate name", "tower name"],
  streetNumber: ["streetno", "street no", "streetnumber"],
  streetName: ["street", "road", "rd", "avenue", "ave", "lane"],
  propertyName: ["property", "building", "estate", "mansion", "court"],
  districtName: ["district"],
  area: ["area", "areacode"],
  verifiedAddress: ["formatted address", "formattedaddress", "full address", "verified address"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lng", "lon"],
  placeId: ["place id", "placeid"],
};

export type AddressDiscoverRow = {
  label?: string;
  value?: string;
  meta?: { options?: { label?: string; value?: string }[] };
};

export type AddressDiscoverResult = {
  fieldMap: AddressFieldMap;
  areaOptions: { label?: string; value?: string }[];
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalise a label or value so that camelCase / snake_case / kebab-case
 * boundaries become real whitespace, e.g. `flatNumber` → `flat number`.
 * This is what allows a token like `"flat"` to match a value like
 * `flatNumber` while a token like `"lat"` does NOT match `relationship`.
 */
function normaliseHaystack(input: string): string {
  return String(input ?? "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .toLowerCase()
    .trim();
}

function matchesAnyToken(haystack: string, tokens: string[]): boolean {
  if (!haystack) return false;
  for (const raw of tokens) {
    const token = String(raw ?? "").toLowerCase().trim();
    if (!token) continue;
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`);
    if (re.test(haystack)) return true;
  }
  return false;
}

/**
 * Inspect a list of `form_options` rows for a given package and return a
 * partial {@link AddressFieldMap} whose values are fully-prefixed RHF field
 * names (e.g. `contactinfo__latitude`). Pass a shared `usedFieldValues`
 * Set when discovering across multiple packages to prevent the same field
 * being claimed by two address concepts.
 */
export function discoverAddressFields(
  rows: AddressDiscoverRow[],
  prefix: string,
  options: {
    tokens?: Record<string, string[]>;
    usedFieldValues?: Set<string>;
  } = {},
): AddressDiscoverResult {
  const tokens = options.tokens ?? ADDRESS_TOKENS;
  const used = options.usedFieldValues ?? new Set<string>();
  const map: Record<string, string> = {};
  let areaOpts: { label?: string; value?: string }[] = [];

  for (const [addrKey, tks] of Object.entries(tokens)) {
    if (map[addrKey]) continue;
    for (const r of rows) {
      const fv = String(r.value ?? "");
      const compositeKey = `${prefix}:${fv}`;
      if (used.has(compositeKey)) continue;
      const labelHay = normaliseHaystack(r.label ?? "");
      const valueHay = normaliseHaystack(fv);
      if (!matchesAnyToken(labelHay, tks) && !matchesAnyToken(valueHay, tks)) {
        continue;
      }
      used.add(compositeKey);
      map[addrKey] = `${prefix}__${fv}`;
      if (
        addrKey === "area" &&
        Array.isArray(r.meta?.options) &&
        r.meta.options.length > 0
      ) {
        areaOpts = r.meta.options
          .filter(
            (o): o is { label?: string; value?: string } =>
              Boolean(o && typeof o === "object"),
          )
          .map((o) => ({
            label: String(o.label ?? ""),
            value: String(o.value ?? ""),
          }));
      }
      break;
    }
  }

  return { fieldMap: map as AddressFieldMap, areaOptions: areaOpts };
}
