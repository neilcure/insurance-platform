import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions, formOptionGroups } from "@/db/schema/form_options";
import { and, desc, eq, or } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { normalizeKeyLike } from "@/lib/utils";

function isValidPackageKey(v: string): boolean {
  return /^[a-z][a-z0-9_-]{0,127}$/.test(v);
}

function isValidCategoryKey(v: string): boolean {
  return /^[a-z0-9_-]{1,127}$/.test(v);
}

function isValidFieldKey(v: string): boolean {
  // Field keys become RHF names as `${pkg}__${fieldKey}`; reserve "__" for internal separators.
  return /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(v) && !v.includes("__");
}

// Ensure this admin API is always dynamic and never cached
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const groupKey = searchParams.get("groupKey") ?? "declarations";
  const includeInactive = searchParams.get("all") === "true" || searchParams.get("includeInactive") === "true";

  const rows = await db
    .select()
    .from(formOptions)
    .where(
      includeInactive
        ? eq(formOptions.groupKey, groupKey)
        : and(eq(formOptions.groupKey, groupKey), eq(formOptions.isActive, true))
    )
    .orderBy(formOptions.sortOrder, desc(formOptions.id));
  return NextResponse.json(rows, {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json();
  const groupKey = body?.groupKey as string;
  if (!groupKey) {
    return NextResponse.json({ error: "Missing groupKey" }, { status: 400 });
  }
  const gk = String(groupKey ?? "");
  const gkLower = gk.toLowerCase();
  let value = String(body?.value ?? "").trim();

  // Strong key hygiene (prevents later fetch/render mismatches).
  // - packages: used to build group keys like `${pkg}_fields`
  // - *_category: used for filtering and radio selection; canonical lowercase avoids duplicate React keys
  // - *_fields: used to build RHF names `${pkg}__${fieldKey}`; store base fieldKey only
  if (gkLower === "packages") {
    value = normalizeKeyLike(value);
    if (!value || !isValidPackageKey(value)) {
      return NextResponse.json(
        { error: "Invalid package key. Use lowercase letters/numbers and _ or - (e.g. insured, contactinfo, vehicleinfo)." },
        { status: 400 },
      );
    }
  }
  if (gkLower.endsWith("_category")) {
    value = normalizeKeyLike(value);
    if (!value || !isValidCategoryKey(value)) {
      return NextResponse.json(
        { error: "Invalid category key. Use lowercase letters/numbers and _ or - (e.g. company, personal)." },
        { status: 400 },
      );
    }
  }

  // Option A normalization: for `*_fields` groups, store only the base fieldKey (no pkg prefix).
  // Example: for `insured_fields`, normalize `insured__companyName` -> `companyName`.
  try {
    if (gk.toLowerCase().endsWith("_fields")) {
      const pkg = gk.slice(0, -"_fields".length);
      const lowerVal = value.toLowerCase();
      const pkgLower = pkg.toLowerCase();
      const dblPrefix = `${pkgLower}__`;
      const sglPrefix = `${pkgLower}_`;
      if (lowerVal.startsWith(dblPrefix)) value = value.slice(`${pkg}__`.length);
      if (lowerVal.startsWith(sglPrefix)) value = value.slice(`${pkg}_`.length);
      value = value.trim();
    }
  } catch {
    // ignore
  }
  if (!value) {
    return NextResponse.json({ error: "Missing value" }, { status: 400 });
  }

  if (gkLower.endsWith("_fields")) {
    if (!isValidFieldKey(value)) {
      return NextResponse.json(
        { error: 'Invalid field key. Use letters/numbers/underscore only (e.g. companyName, brNumber). Do not include "__".' },
        { status: 400 },
      );
    }
  }

  // Guard against duplicates even if DB unique constraint is missing/not applied.
  const existing = await (async () => {
    // For *_fields groups, also detect legacy prefixed duplicates like `${pkg}_${field}` and `${pkg}__${field}`.
    if (gkLower.endsWith("_fields")) {
      const pkg = gk.slice(0, -"_fields".length);
      const pref1 = `${pkg}_${value}`;
      const pref2 = `${pkg}__${value}`;
      return await db
        .select({ id: formOptions.id })
        .from(formOptions)
        .where(
          and(
            eq(formOptions.groupKey, groupKey),
            or(eq(formOptions.value, value), eq(formOptions.value, pref1), eq(formOptions.value, pref2)),
          ),
        )
        .limit(1);
    }
    return await db
      .select({ id: formOptions.id })
      .from(formOptions)
      .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.value, value)))
      .limit(1);
  })();
  if (existing.length > 0) {
    return NextResponse.json({ error: "A field with this key already exists in this group." }, { status: 409 });
  }
  // ensure group exists
  const [group] = await db
    .insert(formOptionGroups)
    .values({ key: groupKey, label: body?.groupLabel ?? groupKey })
    .onConflictDoNothing()
    .returning();
  // Auto-inherit groupShowWhen from existing group members
  let meta = (body?.meta ?? null) as Record<string, unknown> | null;
  if (gkLower.endsWith("_fields") && meta && typeof meta === "object") {
    const groupName = String(meta.group ?? "").trim();
    if (groupName && !meta.groupShowWhen) {
      const siblings = await db
        .select()
        .from(formOptions)
        .where(eq(formOptions.groupKey, groupKey));
      const existingGsw = siblings
        .map((s) => (s.meta as Record<string, unknown> | null))
        .find((m) => String(m?.group ?? "").trim() === groupName && m?.groupShowWhen);
      if (existingGsw?.groupShowWhen) {
        meta = { ...meta, groupShowWhen: existingGsw.groupShowWhen };
      }
    }
  }

  // create option
  try {
    const [opt] = await db
      .insert(formOptions)
      .values({
        groupKey,
        label: body?.label ?? "",
        value,
        valueType: body?.valueType ?? "boolean",
        sortOrder: Number(body?.sortOrder) || 0,
        isActive: typeof body?.isActive === "boolean" ? body.isActive : true,
        meta,
      })
      .returning();
    return NextResponse.json(opt, { status: 201 });
  } catch (err: unknown) {
    const message = (err as any)?.message ?? "Create failed";
    // Unique violation on (group_key, value)
    if (typeof message === "string" && message.toLowerCase().includes("unique")) {
      return NextResponse.json({ error: "A field with this key already exists in this group." }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
















