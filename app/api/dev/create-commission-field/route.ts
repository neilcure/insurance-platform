import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST() {
  const groupKey = "premiumRecord_fields";
  const value = "agentcommission";

  const [existing] = await db
    .select({ id: formOptions.id })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.value, value)))
    .limit(1);

  if (existing) {
    return NextResponse.json({ ok: true, skipped: true, message: "Field already exists", id: existing.id });
  }

  const [created] = await db
    .insert(formOptions)
    .values({
      groupKey,
      label: "Agent Commission",
      value,
      sortOrder: 3,
      isActive: true,
      valueType: "string",
      meta: {
        inputType: "formula",
        formula: "{cpremium} - {apremium}",
        premiumColumn: "agentCommissionCents",
        premiumRole: "commission",
        group: "General Accounting",
        groupOrder: 0,
        currencyCode: "HKD",
        decimals: 2,
        categories: [],
      },
    })
    .returning({ id: formOptions.id });

  return NextResponse.json({ ok: true, created: true, id: created.id });
}
