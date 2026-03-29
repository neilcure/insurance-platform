import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { policyPremiums } from "@/db/schema/premiums";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bare = (s: string) =>
  s.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");

const isInsurerKey = (k: string) => {
  const b = bare(k);
  return (
    b.includes("insurancecompany") ||
    b.includes("insurer") ||
    b.includes("insuranceco") ||
    b.includes("inscompany") ||
    b.includes("inssection")
  );
};

function extractInsurerNames(carExtra: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const pkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const data of Object.values(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const vals = (
      "values" in (data as Record<string, unknown>)
        ? (data as { values?: Record<string, unknown> }).values
        : data
    ) as Record<string, unknown> | undefined;
    if (!vals) continue;
    for (const [k, v] of Object.entries(vals)) {
      if (typeof v === "string" && v.trim() && isInsurerKey(k)) {
        names.add(v.trim());
      }
    }
  }
  return [...names];
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const ids = new Set<number>();

    const [carRow, premiumRows] = await Promise.all([
      db
        .select({ extra: cars.extraAttributes })
        .from(cars)
        .where(eq(cars.policyId, policyId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select({
          insurerPolicyId: policyPremiums.insurerPolicyId,
          organisationId: policyPremiums.organisationId,
        })
        .from(policyPremiums)
        .where(eq(policyPremiums.policyId, policyId))
        .catch(() => []),
    ]);

    for (const row of premiumRows) {
      const id =
        (row.insurerPolicyId as number | null) ?? row.organisationId ?? null;
      if (id && Number.isFinite(id) && id > 0) ids.add(id);
    }

    if (carRow) {
      const extra = (carRow.extra ?? {}) as Record<string, unknown>;

      const savedLinkedIds = Array.isArray(extra.entityLinkedPolicyIds)
        ? (extra.entityLinkedPolicyIds as number[])
        : [];
      for (const id of savedLinkedIds) {
        if (Number.isFinite(id) && id > 0) ids.add(id);
      }

      const insurerNames = extractInsurerNames(extra);

      if (insurerNames.length > 0) {
        const polCols = await getPolicyColumns();
        const flowFilter = polCols.hasFlowKey
          ? sql`${policies.flowKey} = 'InsuranceSet'`
          : sql`(${cars.extraAttributes})::jsonb ->> 'flowKey' = 'InsuranceSet'`;

        const insurerRecords = await db
          .select({
            policyId: policies.id,
            carExtra: cars.extraAttributes,
          })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .where(flowFilter);

        for (const rec of insurerRecords) {
          const recExtra = (rec.carExtra ?? {}) as Record<string, unknown>;
          const recName = extractRecordName(recExtra);
          if (recName && insurerNames.some((n) => namesMatch(n, recName))) {
            ids.add(rec.policyId);
          }
        }
      }
    }

    return NextResponse.json({ insurerPolicyIds: [...ids] });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

function extractRecordName(
  carExtra: Record<string, unknown>,
): string | null {
  const norm = (k: string) =>
    k
      .replace(/^[a-zA-Z0-9]+__?/, "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");

  const scanForName = (obj: Record<string, unknown>): string => {
    for (const [k, v] of Object.entries(obj)) {
      const n = norm(k);
      const s = String(v ?? "").trim();
      if (!s) continue;
      if (
        /companyname|organisationname|orgname|fullname|displayname|coname|collconame|^name$/.test(
          n,
        )
      )
        return s;
    }
    let first = "",
      last = "";
    for (const [k, v] of Object.entries(obj)) {
      const n = norm(k);
      const s = String(v ?? "").trim();
      if (!s) continue;
      if (!last && /lastname|surname/.test(n)) last = s;
      if (!first && /firstname|fname/.test(n)) first = s;
    }
    return first || last ? [last, first].filter(Boolean).join(" ") : "";
  };

  const insured = (carExtra.insuredSnapshot ?? null) as Record<
    string,
    unknown
  > | null;
  if (insured && typeof insured === "object") {
    const name = scanForName(insured);
    if (name) return name;
  }

  const pkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const data of Object.values(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const vals = (
      "values" in (data as Record<string, unknown>)
        ? (data as { values?: Record<string, unknown> }).values
        : data
    ) as Record<string, unknown> | undefined;
    if (!vals) continue;
    const name = scanForName(vals);
    if (name) return name;
  }
  return null;
}

function namesMatch(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .trim();
  return normalize(a) === normalize(b);
}
