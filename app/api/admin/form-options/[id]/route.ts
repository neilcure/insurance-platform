import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq, ne } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { normalizeKeyLike } from "@/lib/utils";
import { invalidateServerFormOptionsGroup } from "@/lib/server-form-options-cache";

function deriveValue(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

type OptLike = { label?: string; value?: string; children?: ChildLike[]; [k: string]: unknown };
type ChildLike = { label?: string; options?: OptLike[]; booleanChildren?: Record<string, ChildLike[]>; [k: string]: unknown };

function fixOptionValues(opts: OptLike[]): OptLike[] {
  return opts
    .filter((o) => (o.label ?? "").trim() !== "" || (o.value ?? "").trim() !== "")
    .map((o) => {
      const fixed = { ...o };
      if ((fixed.value ?? "").trim() === "" && (fixed.label ?? "").trim() !== "") {
        fixed.value = deriveValue(fixed.label!);
      }
      if (Array.isArray(fixed.children)) {
        fixed.children = fixed.children.map((c) => fixChildOptions(c));
      }
      return fixed;
    });
}

function fixChildOptions(child: ChildLike): ChildLike {
  const c = { ...child };
  if (Array.isArray(c.options)) {
    c.options = fixOptionValues(c.options);
  }
  if (c.booleanChildren && typeof c.booleanChildren === "object") {
    const bc = { ...c.booleanChildren };
    for (const branch of ["true", "false"]) {
      if (Array.isArray(bc[branch])) {
        bc[branch] = bc[branch].map((sub: ChildLike) => fixChildOptions(sub));
      }
    }
    c.booleanChildren = bc;
  }
  return c;
}

/** `typeof null === "object"` — never treat null as a meta payload */
function isJsonObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function sanitizeMetaOptions(meta: Record<string, unknown>): void {
  if (Array.isArray(meta.options)) {
    meta.options = fixOptionValues(meta.options as OptLike[]);
  }
  if (meta.booleanChildren && typeof meta.booleanChildren === "object") {
    const bc = { ...(meta.booleanChildren as Record<string, ChildLike[]>) };
    for (const branch of ["true", "false"]) {
      if (Array.isArray(bc[branch])) {
        bc[branch] = bc[branch].map((c) => fixChildOptions(c));
      }
    }
    meta.booleanChildren = bc;
  }
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
  const update: Record<string, unknown> = {};
  if (typeof body.label === "string") update.label = body.label;
  if (typeof body.value === "string") update.value = body.value.trim();
  if (typeof body.sortOrder === "number") update.sortOrder = body.sortOrder;
  if (typeof body.isActive === "boolean") update.isActive = body.isActive;

  const currentGroupKey = String(current.groupKey ?? "");
  const lowerGroupKey = currentGroupKey.toLowerCase();

  /** Only accept real objects — omitting `meta` leaves DB unchanged; `null` does NOT wipe JSONB */
  if ("meta" in body) {
    if (isJsonObject(body.meta)) {
      const incoming = { ...(body.meta as Record<string, unknown>) };
      // Packages: shallow-merge into existing meta so partial PATCHes / client gaps
      // never drop unrelated keys (`translations`, `icon`, etc.).
      const merged =
        currentGroupKey === "packages"
          ? { ...(((current.meta ?? {}) as Record<string, unknown>) ?? {}), ...incoming }
          : incoming;
      sanitizeMetaOptions(merged);
      update.meta = merged;
    }
    // Explicit null / array / primitives: ignore (preserve stored meta).
  }

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
  invalidateServerFormOptionsGroup(currentGroupKey);

  // When a flow key is renamed, cascade to its steps group_key
  if (
    currentGroupKey === "flows" &&
    typeof update.value === "string" &&
    update.value !== current.value &&
    current.value
  ) {
    const oldStepsKey = `flow_${current.value}_steps`;
    const newStepsKey = `flow_${update.value}_steps`;
    await db
      .update(formOptions)
      .set({ groupKey: newStepsKey })
      .where(eq(formOptions.groupKey, oldStepsKey));
    invalidateServerFormOptionsGroup(oldStepsKey);
    invalidateServerFormOptionsGroup(newStepsKey);
  }

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
  if (deleted.groupKey) invalidateServerFormOptionsGroup(deleted.groupKey);
  return NextResponse.json({ ok: true }, { status: 200 });
}

/**
 * Add or remove an option from meta.options for a select/multi_select field.
 *
 * For top-level options: { action, label, value }
 * For child options:     { action, label, value, childPath: { parentOptionValue, childIndex } }
 */
export async function POST(
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

  const body = await request.json();
  const action = String(body.action ?? "add");

  const existing = await db.select().from(formOptions).where(eq(formOptions.id, id)).limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const current = existing[0];
  const meta = (current.meta ?? {}) as Record<string, unknown>;
  const inputType = String(meta.inputType ?? "");
  if (inputType !== "select" && inputType !== "multi_select") {
    return NextResponse.json({ error: "Field is not a select/multi_select type" }, { status: 400 });
  }

  const currentOptions = Array.isArray(meta.options) ? (meta.options as { label?: string; value?: string; children?: Record<string, unknown>[] }[]) : [];

  const childPath = body.childPath as { parentOptionValue?: string; childIndex?: number } | undefined;
  const isChildOp = childPath && typeof childPath.parentOptionValue === "string" && typeof childPath.childIndex === "number";

  // --- Child option operations (nested inside meta.options[].children[].options) ---
  if (isChildOp) {
    const parentIdx = currentOptions.findIndex((o) => o.value === childPath.parentOptionValue);
    if (parentIdx < 0) {
      return NextResponse.json({ error: "Parent option not found" }, { status: 404 });
    }
    const parent = currentOptions[parentIdx];
    const children = Array.isArray(parent.children) ? parent.children : [];
    const cIdx = childPath.childIndex!;
    if (cIdx < 0 || cIdx >= children.length) {
      return NextResponse.json({ error: "Child index out of range" }, { status: 400 });
    }
    const child = children[cIdx] as Record<string, unknown>;
    const childOpts = Array.isArray(child.options) ? (child.options as { label?: string; value?: string }[]) : [];

    if (action === "remove") {
      const removeValue = String(body.value ?? "").trim();
      if (!removeValue) {
        return NextResponse.json({ error: "value is required for remove" }, { status: 400 });
      }
      const filtered = childOpts.filter((o) => o.value !== removeValue);
      if (filtered.length === childOpts.length) {
        return NextResponse.json({ error: "Option not found" }, { status: 404 });
      }
      const updatedChild = { ...child, options: filtered };
      const updatedChildren = [...children];
      updatedChildren[cIdx] = updatedChild;
      const updatedParent = { ...parent, children: updatedChildren };
      const updatedOptions = [...currentOptions];
      updatedOptions[parentIdx] = updatedParent;
      const updatedMeta = { ...meta, options: updatedOptions };
      await db.update(formOptions).set({ meta: updatedMeta }).where(eq(formOptions.id, id));
      if (current.groupKey) invalidateServerFormOptionsGroup(current.groupKey);
      const [updated] = await db.select().from(formOptions).where(eq(formOptions.id, id)).limit(1);
      return NextResponse.json({ removed: body.value, field: updated }, { status: 200 });
    }

    // add to child
    const label = String(body.label ?? "").trim();
    if (!label) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    const value = String(body.value ?? label).trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!value) {
      return NextResponse.json({ error: "Could not derive a valid value key" }, { status: 400 });
    }
    if (childOpts.some((o) => o.value === value)) {
      return NextResponse.json({ option: { label, value }, message: "Option already exists" }, { status: 200 });
    }
    const newOpt = { label, value };
    const updatedChild = { ...child, options: [...childOpts, newOpt] };
    const updatedChildren = [...children];
    updatedChildren[cIdx] = updatedChild;
    const updatedParent = { ...parent, children: updatedChildren };
    const updatedOptions = [...currentOptions];
    updatedOptions[parentIdx] = updatedParent;
    const updatedMeta = { ...meta, options: updatedOptions };
    await db.update(formOptions).set({ meta: updatedMeta }).where(eq(formOptions.id, id));
    if (current.groupKey) invalidateServerFormOptionsGroup(current.groupKey);
    const [updated] = await db.select().from(formOptions).where(eq(formOptions.id, id)).limit(1);
    return NextResponse.json({ option: newOpt, field: updated }, { status: 200 });
  }

  // --- Top-level option operations ---
  if (action === "remove") {
    const removeValue = String(body.value ?? "").trim();
    if (!removeValue) {
      return NextResponse.json({ error: "value is required for remove" }, { status: 400 });
    }
    const filtered = currentOptions.filter((o) => o.value !== removeValue);
    if (filtered.length === currentOptions.length) {
      return NextResponse.json({ error: "Option not found" }, { status: 404 });
    }
    const updatedMeta = { ...meta, options: filtered };
    await db.update(formOptions).set({ meta: updatedMeta }).where(eq(formOptions.id, id));
    if (current.groupKey) invalidateServerFormOptionsGroup(current.groupKey);
    const [updated] = await db.select().from(formOptions).where(eq(formOptions.id, id)).limit(1);
    return NextResponse.json({ removed: removeValue, field: updated }, { status: 200 });
  }

  // Default action: add
  const label = String(body.label ?? "").trim();
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  const value = String(body.value ?? label)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
  if (!value) {
    return NextResponse.json({ error: "Could not derive a valid value key" }, { status: 400 });
  }

  if (currentOptions.some((o) => o.value === value)) {
    return NextResponse.json({ option: { label, value }, message: "Option already exists" }, { status: 200 });
  }

  // If existing options have children, clone the children structure with empty options
  // so child fields (e.g. Model under Make) appear for the new option too.
  const donor = currentOptions.find((o) => Array.isArray(o.children) && o.children.length > 0);
  let childrenTemplate: Record<string, unknown>[] | undefined;
  if (donor && Array.isArray(donor.children)) {
    childrenTemplate = (donor.children as Record<string, unknown>[]).map((c) => {
      const clone: Record<string, unknown> = { ...c, options: [] };
      return clone;
    });
  }

  const newOption: Record<string, unknown> = { label, value };
  if (childrenTemplate) newOption.children = childrenTemplate;

  // Use read-modify-write to include children structure
  const updatedMeta = { ...meta, options: [...currentOptions, newOption] };
  await db.update(formOptions).set({ meta: updatedMeta }).where(eq(formOptions.id, id));
  if (current.groupKey) invalidateServerFormOptionsGroup(current.groupKey);

  const [updated] = await db.select().from(formOptions).where(eq(formOptions.id, id)).limit(1);

  return NextResponse.json({ option: { label, value }, field: updated }, { status: 200 });
}
