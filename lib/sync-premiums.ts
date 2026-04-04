import { db } from "@/db/client";
import { policyPremiums } from "@/db/schema/premiums";
import { cars } from "@/db/schema/insurance";
import { and, eq } from "drizzle-orm";
import { loadAccountingFields, buildFieldColumnMap, getColumnType } from "@/lib/accounting-fields";

function displayToCents(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Syncs premium values from packagesSnapshot.premiumRecord into the
 * policy_premiums table. This ensures the accounting system always has
 * up-to-date premium data regardless of whether the user saved via
 * the Package Edit form or the Premium tab.
 *
 * For endorsement policies (those with linkedPolicyId), it scans ALL
 * packages in the snapshot rather than only premiumRecord, because
 * endorsements may inherit the parent's premiumRecord with incorrect data.
 */
export async function syncPremiumSnapshotToTable(
  policyId: number,
  userId: number,
): Promise<void> {
  const [carRow] = await db
    .select({ extra: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.policyId, policyId))
    .limit(1);

  if (!carRow) return;

  const extra = (carRow.extra ?? {}) as Record<string, unknown>;
  const pkgs = (extra.packagesSnapshot ?? {}) as Record<string, unknown>;
  const isEndorsement = !!extra.linkedPolicyId;

  const stripPfx = (k: string) => {
    const idx = k.indexOf("__");
    return idx >= 0 ? k.slice(idx + 2) : k;
  };

  const snapMap = new Map<string, unknown>();

  if (isEndorsement) {
    // For endorsements, scan ALL packages for premium field values.
    // The premiumRecord package may contain the parent's data (copied at
    // endorsement creation time), so we prefer premium fields from
    // non-premiumRecord packages and validate against the parent.
    const otherPkgValues = new Map<string, unknown>();
    let hasPremiumFieldsOutsidePremiumRecord = false;

    for (const [pkgName, pkgData] of Object.entries(pkgs)) {
      if (!pkgData || typeof pkgData !== "object") continue;
      if (pkgName === "premiumRecord" || pkgName === "accounting") continue;
      const vals = ("values" in (pkgData as Record<string, unknown>)
        ? (pkgData as { values?: Record<string, unknown> }).values
        : pkgData) as Record<string, unknown> | undefined;
      if (!vals || typeof vals !== "object") continue;
      for (const [k, v] of Object.entries(vals)) {
        if (v === undefined || v === null || v === "") continue;
        const stripped = stripPfx(k);
        otherPkgValues.set(stripped, v);
        const lower = stripped.toLowerCase();
        if (lower.includes("premium") || lower.includes("gross") ||
            lower.includes("commission") || lower === "currency") {
          hasPremiumFieldsOutsidePremiumRecord = true;
        }
      }
    }

    if (hasPremiumFieldsOutsidePremiumRecord) {
      for (const [k, v] of otherPkgValues) snapMap.set(k, v);
    } else {
      // Only premiumRecord has premium data. Check if it's the parent's
      // copied data by comparing with the parent's policy_premiums.
      const premPkg = (pkgs.premiumRecord ?? pkgs.accounting) as Record<string, unknown> | undefined;
      if (premPkg && typeof premPkg === "object") {
        const vals = ("values" in premPkg
          ? (premPkg as { values?: Record<string, unknown> }).values
          : premPkg) as Record<string, unknown> | undefined;
        if (vals && typeof vals === "object") {
          // Extract endorsement premiumRecord gross value
          let endorseGross = 0;
          for (const [k, v] of Object.entries(vals)) {
            const stripped = stripPfx(k).toLowerCase();
            if (stripped.includes("gpremium") || stripped.includes("grosspremium") || stripped === "gross_premium") {
              endorseGross = Number(v) || 0;
            }
          }

          // Compare with parent's gross premium
          let parentGross = 0;
          const linkedId = Number(extra.linkedPolicyId);
          if (Number.isFinite(linkedId) && linkedId > 0) {
            try {
              const [parentPrem] = await db
                .select({ gross: policyPremiums.grossPremiumCents })
                .from(policyPremiums)
                .where(and(eq(policyPremiums.policyId, linkedId), eq(policyPremiums.lineKey, "main")))
                .limit(1);
              if (parentPrem?.gross) {
                parentGross = parentPrem.gross / 100;
              }
            } catch { /* ignore */ }
          }

          // If endorsement premiumRecord matches parent's gross, it's copied data — skip sync
          if (endorseGross > 0 && parentGross > 0 && Math.abs(endorseGross - parentGross) < 0.01) {
            return;
          }

          for (const [k, v] of Object.entries(vals)) {
            if (v === undefined || v === null || v === "") continue;
            snapMap.set(stripPfx(k), v);
          }
        }
      }
      for (const [k, v] of otherPkgValues) {
        if (!snapMap.has(k)) snapMap.set(k, v);
      }
    }
  } else {
    const premPkg = (pkgs.premiumRecord ?? pkgs.accounting) as Record<string, unknown> | undefined;
    if (!premPkg || typeof premPkg !== "object") return;

    const snapVals = ("values" in premPkg
      ? (premPkg as { values?: Record<string, unknown> }).values
      : premPkg) as Record<string, unknown> | undefined;
    if (!snapVals || typeof snapVals !== "object") return;

    for (const [k, v] of Object.entries(snapVals)) {
      if (v === undefined || v === null || v === "") continue;
      snapMap.set(stripPfx(k), v);
    }
  }

  if (snapMap.size === 0) return;

  const fields = await loadAccountingFields();
  const fieldColumnMap = buildFieldColumnMap(fields);

  const structuredColumns: Record<string, unknown> = {};
  const extraValues: Record<string, unknown> = {};

  for (const f of fields) {
    const val = snapMap.get(f.key);
    if (val === undefined) continue;

    const mappedCol = fieldColumnMap[f.key];
    if (mappedCol) {
      const colType = getColumnType(mappedCol);
      if (colType === "cents") {
        structuredColumns[mappedCol] = displayToCents(val);
      } else if (colType === "rate") {
        const n = Number(val);
        structuredColumns[mappedCol] = Number.isFinite(n) ? n.toFixed(2) : null;
      } else {
        structuredColumns[mappedCol] = typeof val === "string" && val.trim() ? val.trim() : val;
      }
    } else {
      extraValues[f.key] = val === "" ? null : (val ?? null);
    }
  }

  const hasAnyValue = Object.values(structuredColumns).some((v) => v !== null && v !== undefined);
  if (!hasAnyValue && Object.keys(extraValues).length === 0) return;

  const lineKey = "main";
  const dbPayload: Record<string, unknown> = {
    lineLabel: "Premium",
    currency: (structuredColumns.currency as string) ?? "HKD",
    extraValues: Object.keys(extraValues).length > 0 ? extraValues : null,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };

  // Dynamically include ALL structured columns from package fields — no hardcoding
  for (const [col, val] of Object.entries(structuredColumns)) {
    if (col === "currency") continue;
    dbPayload[col] = val ?? null;
  }

  const [existing] = await db
    .select({ id: policyPremiums.id })
    .from(policyPremiums)
    .where(and(eq(policyPremiums.policyId, policyId), eq(policyPremiums.lineKey, lineKey)))
    .limit(1);

  if (existing) {
    await db
      .update(policyPremiums)
      .set(dbPayload)
      .where(and(eq(policyPremiums.policyId, policyId), eq(policyPremiums.lineKey, lineKey)));
  } else {
    await db.insert(policyPremiums).values({ policyId, lineKey, ...dbPayload });
  }
}
