/**
 * Extract the four structured `cars` DB columns (plate / make /
 * model / year) from a policy's packages snapshot.
 *
 * Why this exists:
 *   `cars` has both a JSONB `extra_attributes.packagesSnapshot`
 *   (the wizard's source of truth) and four structured columns
 *   that early code paths populated from the snapshot at insert
 *   time. Various readers (accounting list, statement builder,
 *   linked-policy widget) prefer the column over the snapshot
 *   because the column is cheaper to query. If the column ever
 *   drifts from the snapshot — which happened when PATCH
 *   /api/policies/:id only wrote `extra_attributes` and never
 *   updated the columns — the two screens disagree about
 *   the same policy's plate.
 *
 *   This module centralises the extraction so the POST path,
 *   the PATCH path, and the offline backfill script all use
 *   the same rules.
 *
 * Resolution order (most specific first):
 *   1. Top-level `vehicle` object on the legacy POST body shape
 *      (`body.vehicle.plateNo` etc.).
 *   2. `packagesSnapshot.vehicle.values.*` — the wizard's flat
 *      values bag for the vehicle package.
 *   3. Generic scan across every package's `values` object,
 *      looking for fuzzy field names (`plate`, `registration`,
 *      `regNo`, `vrn`, `vehicleMake`, `modelNameInVRD`, etc.).
 *
 * Mirrors the exact behaviour previously inlined in
 * `app/api/policies/route.ts` POST so existing rows keep their
 * column values byte-for-byte stable.
 */

export type ExtractedVehicleColumns = {
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
};

function scanStringByKeyList(obj: unknown, keys: string[]): string | "" {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    const s =
      typeof v === "string"
        ? v.trim()
        : ((v as { toString?: () => string } | null | undefined)?.toString?.()?.trim?.() ?? "");
    if (s) return s;
  }
  return "";
}

function scanStringByTokens(obj: unknown, tokenGroups: RegExp[]): string | "" {
  if (!obj || typeof obj !== "object") return "";
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const nk = String(k).toLowerCase().replace(/\s+/g, "");
    if (tokenGroups.some((re) => re.test(nk))) {
      const s =
        typeof v === "string"
          ? v.trim()
          : ((v as { toString?: () => string } | null | undefined)?.toString?.()?.trim?.() ?? "");
      if (s) return s;
    }
  }
  return "";
}

function packageValues(pkg: unknown): Record<string, unknown> | null {
  if (!pkg || typeof pkg !== "object") return null;
  return (
    "values" in (pkg as Record<string, unknown>)
      ? ((pkg as { values?: Record<string, unknown> }).values ?? (pkg as Record<string, unknown>))
      : (pkg as Record<string, unknown>)
  ) as Record<string, unknown>;
}

function scanFromAll(
  vehicle: Record<string, unknown> | null | undefined,
  packages: Record<string, unknown> | null | undefined,
  keys: string[],
  tokenGroups: RegExp[],
): string {
  // Top-level vehicle object (legacy POST body shape).
  const fromVehicle = scanStringByKeyList(vehicle, keys) || scanStringByTokens(vehicle, tokenGroups);
  if (fromVehicle) return fromVehicle;

  // `packagesSnapshot.vehicle.values`
  const vehiclePkg = packages?.vehicle;
  const vehVals = packageValues(vehiclePkg);
  const fromVehPkg =
    scanStringByKeyList(vehVals, keys) || scanStringByTokens(vehVals, tokenGroups);
  if (fromVehPkg) return fromVehPkg;

  // Fall back: scan every package's values bag (handles
  // `vehicleinfo`, `motor`, `commvehicle`, etc.).
  if (packages && typeof packages === "object") {
    for (const entry of Object.values(packages as Record<string, unknown>)) {
      const vals = packageValues(entry);
      const s = scanStringByKeyList(vals, keys) || scanStringByTokens(vals, tokenGroups);
      if (s) return s;
    }
  }

  return "";
}

export function extractVehicleColumns(input: {
  vehicle?: Record<string, unknown> | null;
  packages?: Record<string, unknown> | null;
}): ExtractedVehicleColumns {
  const vehicle = input.vehicle ?? null;
  const packages = input.packages ?? null;

  const plate = scanFromAll(
    vehicle,
    packages,
    [
      "plateNo",
      "plate",
      "plateNumber",
      "registrationNumber",
      "registrationNo",
      "regNumber",
      "regNo",
      "vrn",
    ],
    [/(^|_)(plate|plateno|plate_number)($|_)/, /(reg|registration).*(number|no)/, /(^|_)vrn($|_)/],
  );

  const make = scanFromAll(
    vehicle,
    packages,
    ["make", "vehicleMake", "makeName"],
    [/^make$/, /(^|_)vehiclemake($|_)/, /make(name)?/],
  );

  const model = scanFromAll(
    vehicle,
    packages,
    ["model", "modelName", "model_name", "modelNameInVRD", "modelnameinvrd"],
    [/model(name)?/, /vrd.*model/],
  );

  const yearStr = scanFromAll(
    vehicle,
    packages,
    [
      "year",
      "makeOfYear",
      "make_year",
      "yearOfMake",
      "yearofmake",
      "manufactureYear",
      "manufacturedYear",
      "yearOfManufacture",
      "yearofmanufacture",
    ],
    [/year.*(make|manu|manufacture)/, /(^|_)(yom|year)($|_)/],
  );

  const yearDigits = String(yearStr ?? "").replace(/[^\d]/g, "");
  const yearParsed = Number.parseInt(yearDigits, 10);
  const year = Number.isFinite(yearParsed) ? yearParsed : null;

  return {
    plate: plate || null,
    make: make || null,
    model: model || null,
    year,
  };
}
