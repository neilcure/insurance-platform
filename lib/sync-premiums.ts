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
  const premPkg = (pkgs.premiumRecord ?? pkgs.accounting) as Record<string, unknown> | undefined;
  if (!premPkg || typeof premPkg !== "object") return;

  const snapVals = ("values" in premPkg
    ? (premPkg as { values?: Record<string, unknown> }).values
    : premPkg) as Record<string, unknown> | undefined;
  if (!snapVals || typeof snapVals !== "object") return;

  const stripPfx = (k: string) => {
    const idx = k.indexOf("__");
    return idx >= 0 ? k.slice(idx + 2) : k;
  };

  const snapMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(snapVals)) {
    if (v === undefined || v === null || v === "") continue;
    snapMap.set(stripPfx(k), v);
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
    grossPremiumCents: structuredColumns.grossPremiumCents ?? null,
    netPremiumCents: structuredColumns.netPremiumCents ?? null,
    clientPremiumCents: structuredColumns.clientPremiumCents ?? null,
    agentCommissionCents: structuredColumns.agentCommissionCents ?? null,
    commissionRate: structuredColumns.commissionRate ?? null,
    extraValues: Object.keys(extraValues).length > 0 ? extraValues : null,
    updatedBy: userId,
    updatedAt: new Date().toISOString(),
  };

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
