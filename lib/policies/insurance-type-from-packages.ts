/**
 * Derives a human-readable insurance type label from package snapshot + optional admin package labels.
 * Extend knownByLabel / knownByPkg when new product lines ship.
 */

export const INSURANCE_TYPE_SORT_ORDER = [
  "Vehicle Insurance",
  "Employee Compensation",
  "Liability Insurance",
] as const;

/** Display / grouping label for motor policies — keep in sync with INSURANCE_TYPE_SORT_ORDER[0]. */
export const VEHICLE_INSURANCE_LABEL = INSURANCE_TYPE_SORT_ORDER[0];

/** Policies we could not classify (or empty packages) — keep in sync with sortInsuranceTypeGroupLabels. */
export const OTHER_POLICIES_GROUP_LABEL = "Other policies";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/** Package key → display label for grouping when no structured match. */
export function inferInsuranceTypeFromPackages(
  packages: Record<string, unknown> | null | undefined,
  packageLabels?: Record<string, string> | null,
): string | null {
  if (!packages || typeof packages !== "object") return null;
    const knownByLabel: Record<string, string> = {
    [normalize("Vehicle Insurance")]: "Vehicle Insurance",
    [normalize("Employee Compensation")]: "Employee Compensation",
    [normalize("Employee Compensation Insurance")]: "Employee Compensation",
    [normalize("Liability Insurance")]: "Liability Insurance",
  };
  const knownByPkg: Array<{ match: (s: string) => boolean; label: string }> = [
    { match: (s) => ["vehicleinfo", "vehicle", "car", "auto"].includes(s), label: "Vehicle Insurance" },
    { match: (s) => ["ecinfo", "employeecompensation", "ec"].includes(s), label: "Employee Compensation" },
    { match: (s) => ["liability", "liabilityinfo"].includes(s), label: "Liability Insurance" },
  ];

  try {
    for (const [pkgName, pkg] of Object.entries(packages)) {
      const lbl = packageLabels?.[pkgName];
      if (lbl) {
        const k = normalize(lbl);
        if (knownByLabel[k]) {
          const vals =
            pkg && typeof pkg === "object"
              ? ("values" in (pkg as Record<string, unknown>)
                ? ((pkg as { values?: Record<string, unknown> }).values ?? pkg)
                : pkg) as Record<string, unknown>
              : {};
          if (Object.values(vals).some((v) => v !== null && typeof v !== "undefined" && String(v).trim() !== "")) {
            return knownByLabel[k];
          }
        }
      }
      const pn = normalize(pkgName);
      for (const rule of knownByPkg) {
        if (rule.match(pn)) {
          const vals =
            pkg && typeof pkg === "object"
              ? ("values" in (pkg as Record<string, unknown>)
                ? ((pkg as { values?: Record<string, unknown> }).values ?? pkg)
                : pkg) as Record<string, unknown>
              : {};
          if (Object.values(vals).some((v) => v !== null && typeof v !== "undefined" && String(v).trim() !== "")) {
            return rule.label;
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function sortInsuranceTypeGroupLabels(labels: string[]): string[] {
  const order = [...INSURANCE_TYPE_SORT_ORDER];
  return [...labels].sort((a, b) => {
    const ia = order.indexOf(a as (typeof order)[number]);
    const ib = order.indexOf(b as (typeof order)[number]);
    if (a === OTHER_POLICIES_GROUP_LABEL) return 1;
    if (b === OTHER_POLICIES_GROUP_LABEL) return -1;
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}
