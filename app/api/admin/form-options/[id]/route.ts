import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

function normalizeKeyLike(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id: idStr } = await context.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const existing = await db.select().from(formOptions).where(eq(formOptions.id, id)).limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const current = existing[0];

  const body = await request.json();
  const update: any = {};
  if (typeof body.label === "string") update.label = body.label;
  if (typeof body.value === "string") update.value = body.value.trim();
  if (typeof body.sortOrder === "number") update.sortOrder = body.sortOrder;
  if (typeof body.isActive === "boolean") update.isActive = body.isActive;
  if (typeof body.meta === "object") update.meta = body.meta;

  const currentGroupKey = String(current.groupKey ?? "");
  const lowerGroupKey = currentGroupKey.toLowerCase();

  // Package keys are part of groupKey construction (`${pkg}_fields`, `${pkg}_category`), so they must be immutable.
  if (
    currentGroupKey === "packages" &&
    typeof update.value === "string" &&
    update.value &&
    String(update.value).trim() !== String(current.value ?? "").trim()
  ) {
    return NextResponse.json(
      { error: "Package key (value) is immutable. Create a new package instead." },
      { status: 400 },
    );
  }

  // Option A enforcement: keys (`value`) for `*_fields` groups are immutable.
  // Changing them breaks form field names and causes "sometimes editable, sometimes not" client data issues.
  const isFieldsGroup = lowerGroupKey.endsWith("_fields");
  if (
    isFieldsGroup &&
    typeof update.value === "string" &&
    update.value &&
    String(update.value).trim() !== String(current.value ?? "").trim()
  ) {
    return NextResponse.json(
      { error: "Field key (value) is immutable for *_fields groups. Create a new field instead." },
      { status: 400 },
    );
  }

  // Keep category keys canonical (lowercase + underscore) to avoid key collisions after normalization.
  if (lowerGroupKey.endsWith("_category") && typeof update.value === "string" && update.value) {
    update.value = normalizeKeyLike(update.value);
  }

  if (typeof update.value === "string" && update.value && update.value !== current.value) {
    const dup = await db
      .select({ id: formOptions.id })
      .from(formOptions)
      .where(and(eq(formOptions.groupKey, current.groupKey), eq(formOptions.value, update.value), ne(formOptions.id, id)))
      .limit(1);
    if (dup.length > 0) {
      return NextResponse.json({ error: "A field with this key already exists in this group." }, { status: 409 });
    }
  }

  const [row] = await db.update(formOptions).set(update).where(eq(formOptions.id, id)).returning();

  // Propagate groupShowWhen to all fields sharing the same group within this groupKey.
  // Only propagate when groupShowWhen was explicitly included in the saved meta
  // (null = clear, object = set). Absent key = no change to siblings.
  if (update.meta && lowerGroupKey.endsWith("_fields")) {
    const savedMeta = (row?.meta ?? {}) as Record<string, unknown>;
    const groupName = String(savedMeta.group ?? "").trim();
    if (groupName && "groupShowWhen" in savedMeta) {
      const siblings = await db
        .select()
        .from(formOptions)
        .where(and(eq(formOptions.groupKey, currentGroupKey), ne(formOptions.id, id)));
      const gsw = savedMeta.groupShowWhen;
      const isSet = gsw && typeof gsw === "object";
      for (const sib of siblings) {
        const sibMeta = (sib.meta ?? {}) as Record<string, unknown>;
        if (String(sibMeta.group ?? "").trim() !== groupName) continue;
        if (JSON.stringify(sibMeta.groupShowWhen) === JSON.stringify(gsw)) continue;
        const updatedMeta = { ...sibMeta };
        if (isSet) {
          updatedMeta.groupShowWhen = gsw;
        } else {
          delete updatedMeta.groupShowWhen;
        }
        await db.update(formOptions).set({ meta: updatedMeta }).where(eq(formOptions.id, sib.id));
      }
    }
  }

  return NextResponse.json(row ?? null, { status: 200 });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id: idStr } = await context.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const [deleted] = await db.delete(formOptions).where(eq(formOptions.id, id)).returning();
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}


