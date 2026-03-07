import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

// Ensure this route is always dynamic and never cached
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  await requireUser();
  const { searchParams } = new URL(request.url);
  const groupKey = searchParams.get("groupKey") ?? "declarations";
  const rows = await db
    .select({
      id: formOptions.id,
      groupKey: formOptions.groupKey,
      label: formOptions.label,
      value: formOptions.value,
      valueType: formOptions.valueType,
      meta: formOptions.meta,
      sortOrder: formOptions.sortOrder,
      isActive: formOptions.isActive,
    })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.isActive, true)))
    .orderBy(formOptions.sortOrder);
  // Only return public fields (no isActive for clients if needed)
  const data = rows.map((r) => ({
    id: r.id,
    label: r.label,
    value: r.value,
    valueType: r.valueType,
    meta: r.meta,
    sortOrder: r.sortOrder,
  }));
  return NextResponse.json(data, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}








