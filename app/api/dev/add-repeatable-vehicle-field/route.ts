import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions, formOptionGroups } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function upsertRepeatable() {
  // Ensure group exists
  await db
    .insert(formOptionGroups)
    .values({ key: "vehicle_fields", label: "Vehicle Fields" })
    .onConflictDoNothing();

  const meta = {
    inputType: "repeatable",
    repeatable: {
      itemLabel: "Accessory",
      min: 1,
      max: 4,
      fields: [
        { label: "Name", value: "name", inputType: "string", required: true },
        { label: "Cost", value: "cost", inputType: "number" },
        {
          label: "Type",
          value: "type",
          inputType: "select",
          options: [
            { label: "Electrical", value: "electrical" },
            { label: "Body", value: "body" },
          ],
        },
      ],
    },
  } as const;

  // If accessories already exists, update it; otherwise create it
  const existing = await db
    .select()
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, "vehicle_fields"), eq(formOptions.value, "accessories")))
    .limit(1);

  if (existing.length > 0) {
    const [row] = existing;
    const [updated] = await db
      .update(formOptions)
      .set({
        label: "Accessories",
        valueType: "string",
        sortOrder: Number(row.sortOrder ?? 999),
        isActive: true,
        meta: meta as any,
      })
      .where(and(eq(formOptions.groupKey, "vehicle_fields"), eq(formOptions.value, "accessories")))
      .returning();
    return updated ?? row;
  }

  const [inserted] = await db
    .insert(formOptions)
    .values({
      groupKey: "vehicle_fields",
      label: "Accessories",
      value: "accessories",
      valueType: "string",
      sortOrder: 999,
      isActive: true,
      meta: meta as any,
    })
    .onConflictDoNothing()
    .returning();
  return inserted ?? null;
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }
  try {
    const row = await upsertRepeatable();
    return NextResponse.json({ ok: true, row }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET() {
  // Convenience for quick testing
  return POST();
}

