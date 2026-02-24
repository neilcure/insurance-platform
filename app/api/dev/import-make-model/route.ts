import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

type ImportBody = {
  groupKey?: string;
  fieldValue?: string;
  csv?: string;
  modelChildLabel?: string;
};

function parseCsvToMap(csv: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!csv) return map;
  const lines = String(csv)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return map;
  const header = lines[0]?.toLowerCase?.() ?? "";
  const hasHeader = header.includes("make") && header.includes("model");
  const rows = hasHeader ? lines.slice(1) : lines;
  for (const line of rows) {
    // Simple CSV: assumes no quoted commas
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const make = (parts[0] ?? "").trim();
    const model = (parts[1] ?? "").trim();
    if (!make || !model) continue;
    const set = map.get(make) ?? new Set<string>();
    set.add(model);
    map.set(make, set);
  }
  return map;
}

export async function POST(request: Request) {
  const me = await requireUser();
  if (me.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as ImportBody;
  const groupKey = String(body.groupKey ?? "vehicle_fields");
  const fieldValue = String(body.fieldValue ?? "make");
  const csv = String(body.csv ?? "");
  const modelChildLabel = String(body.modelChildLabel ?? "Model");
  if (!csv) {
    return NextResponse.json({ error: "Missing csv" }, { status: 400 });
  }

  const map = parseCsvToMap(csv);
  if (map.size === 0) {
    return NextResponse.json({ error: "No Make/Model pairs detected in CSV" }, { status: 400 });
  }

  // Find the field row by groupKey + value
  const [row] = await db
    .select()
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.value, fieldValue)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: `Field not found for groupKey=${groupKey} value=${fieldValue}` }, { status: 404 });
  }

  // Build options with child "Model" select
  const options = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
    .map(([make, models]) => ({
      label: make,
      value: make,
      children: [
        {
          label: modelChildLabel,
          inputType: "select",
          options: Array.from(models)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
            .map((m) => ({ label: m, value: m })),
        },
      ],
    }));

  const prevMeta = (row.meta as Record<string, unknown> | null) ?? {};
  const nextMeta = {
    ...prevMeta,
    inputType: "select",
    // Do not force selectDisplay; leave user's choice if present
    options,
  };

  const [updated] = await db
    .update(formOptions)
    .set({ meta: nextMeta })
    .where(eq(formOptions.id, row.id))
    .returning();

  return NextResponse.json(
    {
      ok: true,
      id: updated?.id ?? row.id,
      groupKey,
      fieldValue,
      makes: options.length,
      modelsTotal: options.reduce((acc, o) => acc + ((o.children?.[0]?.options?.length as number) || 0), 0),
    },
    { status: 200 }
  );
}

