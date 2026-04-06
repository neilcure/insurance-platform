import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { formOptions } from "@/db/schema/form_options";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import { sql, eq } from "drizzle-orm";
import { getDisplayNameFromSnapshot } from "@/lib/field-resolver";

export const dynamic = "force-dynamic";

function extractName(carExtra: Record<string, unknown> | null | undefined): string {
  if (!carExtra) return "";
  return getDisplayNameFromSnapshot({
    insuredSnapshot: carExtra.insuredSnapshot as Record<string, unknown> | null | undefined,
    packagesSnapshot: (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>,
  });
}

async function findInsurerFlowKey(): Promise<string | null> {
  try {
    const allFields = await db.select({ value: formOptions.value, meta: formOptions.meta })
      .from(formOptions).where(eq(formOptions.isActive, true));
    for (const f of allFields) {
      const bare = (f.value ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (bare.includes("insurancecompany") || bare.includes("insurer") || bare.includes("insuranceco")) {
        const ep = (f.meta as Record<string, unknown> | null)?.entityPicker as { flow?: string } | undefined;
        if (ep?.flow) return ep.flow;
      }
    }
  } catch { /* ignore */ }
  try {
    const polCols = await getPolicyColumns();
    const result = polCols.hasFlowKey
      ? await db.execute(sql`SELECT 1 FROM "policies" WHERE "flow_key" = 'InsuranceSet' LIMIT 1`)
      : await db.execute(sql`SELECT 1 FROM cars WHERE (extra_attributes)::jsonb ->> 'flowKey' = 'InsuranceSet' LIMIT 1`);
    const rows = Array.isArray(result) ? result : (result as any)?.rows ?? [];
    if (rows.length > 0) return "InsuranceSet";
  } catch { /* ignore */ }
  return null;
}

export async function GET() {
  try {
    const user = await requireUser();
    if (user.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const insurerFlowKey = await findInsurerFlowKey();
    if (!insurerFlowKey) {
      return NextResponse.json([]);
    }

    const polCols = await getPolicyColumns();
    const flowFilter = polCols.hasFlowKey
      ? sql`${policies.flowKey} = ${insurerFlowKey}`
      : sql`(cars.extra_attributes)::jsonb ->> 'flowKey' = ${insurerFlowKey}`;

    const insurerRows = await db
      .select({ policyId: policies.id, carExtra: cars.extraAttributes })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(flowFilter)
      .orderBy(policies.createdAt);

    const result = insurerRows.map((r) => ({
      id: r.policyId,
      name: extractName(r.carExtra as Record<string, unknown> | null) || `Insurance Co. #${r.policyId}`,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
