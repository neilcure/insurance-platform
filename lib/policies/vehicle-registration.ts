/**
 * Plate / registration from a car row: plate_number first, then vehicle package snapshot fields.
 */

const EXPLICIT_VEHICLE_REG_KEYS = [
  "plateNo",
  "plateNumber",
  "registration",
  "vehicleRegistration",
  "regNo",
  "hkPlate",
  "licensePlate",
] as const;

/** Substrings for field names that often hold a plate / reg (case-insensitive). */
const REG_KEY_HINTS = ["plate", "registration", "regno", "vehiclereg", "licenseno", "vehicleid"];

function packageValues(pkg: unknown): Record<string, unknown> {
  if (!pkg || typeof pkg !== "object") return {};
  return (
    "values" in (pkg as Record<string, unknown>)
      ? ((pkg as { values?: Record<string, unknown> }).values ?? pkg)
      : pkg
  ) as Record<string, unknown>;
}

function readFromVehiclePackage(pkgs: Record<string, unknown>): string | null {
  const vehicle = pkgs.vehicle as Record<string, unknown> | undefined;
  if (!vehicle) return null;
  const vals = packageValues(vehicle);
  for (const k of EXPLICIT_VEHICLE_REG_KEYS) {
    const v = vals[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Scan all snapshot packages for plate-like fields (endorsements / odd layouts). */
function readFromAnyPackage(pkgs: Record<string, unknown>): string | null {
  for (const pkg of Object.values(pkgs)) {
    if (!pkg || typeof pkg !== "object") continue;
    const vals = packageValues(pkg);
    for (const k of EXPLICIT_VEHICLE_REG_KEYS) {
      const v = vals[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    for (const [k, v] of Object.entries(vals)) {
      if (typeof v !== "string" || !v.trim()) continue;
      const kn = k.toLowerCase();
      if (REG_KEY_HINTS.some((h) => kn.includes(h))) return v.trim();
    }
  }
  return null;
}

function readFromPackagesSnapshot(extra: Record<string, unknown> | null | undefined): string | null {
  if (!extra || typeof extra !== "object") return null;
  const snap = extra.packagesSnapshot ?? (extra as { packages_snapshot?: unknown }).packages_snapshot;
  const pkgs =
    snap && typeof snap === "object" && !Array.isArray(snap) ? (snap as Record<string, unknown>) : undefined;
  if (!pkgs) return null;
  const fromVehicle = readFromVehiclePackage(pkgs);
  if (fromVehicle) return fromVehicle;
  return readFromAnyPackage(pkgs);
}

/** Registration label for statement line items / linked policy rows. */
export function readVehicleRegistrationFromCar(
  plateNumber: string | null | undefined,
  extraAttributes: Record<string, unknown> | null | undefined,
): string | null {
  const top = typeof plateNumber === "string" ? plateNumber.trim() : "";
  if (top) return top;
  return readFromPackagesSnapshot(extraAttributes ?? undefined);
}
