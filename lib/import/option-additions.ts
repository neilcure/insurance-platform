/**
 * Add new options to a flow's `form_options` configuration on behalf of the
 * import staging-area review screen.
 *
 * Three cases are supported:
 *
 *   1. Plain select / radio field
 *      → append to `meta.options` of the field's `form_options` row.
 *
 *   2. Category selector (synthesised, virtual.kind === "category")
 *      → append to the package's `<pkg>_category` group (separate row).
 *
 *   3. Collapsed option-child (virtual.kind === "option_child_collapsed")
 *      e.g. Make → Model in a vehicle flow.
 *      → find the parent field's row, drill into the matching parent option's
 *        `children[childIndex].options`, and append there. The parent option
 *        must already exist (admins should add the new Make first, then the
 *        Model — the route accepts an ordered list so the two writes are
 *        sequenced correctly).
 *
 * All three cases are de-duped: existing values are skipped, not duplicated.
 *
 * Heads-up: this mutates `meta` JSONB in place via Drizzle's update — there's
 * no separate audit table for option changes today. If/when one is added,
 * piping `addedBy` (currently dropped) is a one-liner.
 */
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";
import { loadFlowImportSchema, flattenFields, type ImportFieldDef } from "./schema";
import { fieldColumnId } from "./excel";

export type AdditionInput = {
  columnId?: string;
  parentValue?: string;
  values?: Array<{ value?: string; label?: string }>;
};

type CleanAddition = {
  columnId: string;
  parentValue?: string;
  values: Array<{ value: string; label: string }>;
};

function clean(additions: AdditionInput[]): CleanAddition[] {
  const out: CleanAddition[] = [];
  for (const a of additions) {
    const colId = String(a.columnId ?? "").trim();
    if (!colId) continue;
    const values: Array<{ value: string; label: string }> = [];
    for (const v of a.values ?? []) {
      const value = String(v?.value ?? "").trim();
      if (!value) continue;
      const label = String(v?.label ?? value).trim() || value;
      values.push({ value, label });
    }
    if (values.length === 0) continue;
    const entry: CleanAddition = { columnId: colId, values };
    if (a.parentValue !== undefined && a.parentValue !== null) {
      const pv = String(a.parentValue).trim();
      if (pv) entry.parentValue = pv;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Apply a list of option additions for a given flow.
 * Returns the total number of options actually written (skips duplicates).
 *
 * Additions are applied in order — important when the caller is doing the
 * Make/Model atomic flow (add Make first, THEN Model under that Make).
 */
export async function addOptionsForBatch(
  flowKey: string,
  rawAdditions: AdditionInput[],
): Promise<number> {
  const additions = clean(rawAdditions);
  if (additions.length === 0) return 0;

  // We re-load the schema once at the start so we can resolve every column
  // up front. After the writes the in-memory schema is stale, but the
  // caller (route) immediately re-validates using a freshly loaded schema.
  const schema = await loadFlowImportSchema(flowKey);
  const fieldByColId = new Map(flattenFields(schema).map((f) => [fieldColumnId(f), f]));

  let added = 0;
  for (const addition of additions) {
    const field = fieldByColId.get(addition.columnId);
    if (!field) {
      throw new Error(`Unknown column "${addition.columnId}" in flow "${flowKey}"`);
    }

    if (field.virtual?.kind === "category") {
      added += await addToCategoryGroup(field, addition.values);
      continue;
    }

    if (field.virtual?.kind === "option_child_collapsed") {
      if (!addition.parentValue) {
        throw new Error(
          `Adding to collapsed column "${addition.columnId}" requires "parentValue"`,
        );
      }
      added += await addToCollapsedChild(field, addition.parentValue, addition.values);
      continue;
    }

    if (
      (field.inputType === "select" ||
        field.inputType === "radio" ||
        field.inputType === "multi_select") &&
      !field.virtual
    ) {
      added += await addToFieldOptions(field, addition.values);
      continue;
    }

    throw new Error(
      `Cannot add options to "${addition.columnId}" — only select / radio / multi-select / collapsed-child fields are supported`,
    );
  }
  return added;
}

// ---------------------------------------------------------------------------
//  Per-case helpers
// ---------------------------------------------------------------------------

/** Append new options to a regular select/radio field's `meta.options`. */
async function addToFieldOptions(
  field: ImportFieldDef,
  values: Array<{ value: string; label: string }>,
): Promise<number> {
  const groupKey = `${field.pkg}_fields`;
  const [row] = await db
    .select()
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.value, field.key)))
    .limit(1);
  if (!row) {
    throw new Error(`form_options row not found for ${groupKey}/${field.key}`);
  }
  const meta = ((row.meta as Record<string, unknown> | null) ?? {}) as {
    options?: Array<{ value?: string; label?: string }>;
  } & Record<string, unknown>;

  const opts: Array<{ value: string; label?: string }> = Array.isArray(meta.options)
    ? meta.options.map((o) => ({
        value: String(o?.value ?? "").trim(),
        label: typeof o?.label === "string" ? o.label : undefined,
      }))
    : [];

  const existing = new Set(opts.map((o) => o.value.toLowerCase()).filter(Boolean));
  let added = 0;
  for (const v of values) {
    if (existing.has(v.value.toLowerCase())) continue;
    opts.push({ value: v.value, label: v.label });
    existing.add(v.value.toLowerCase());
    added++;
  }
  if (added === 0) return 0;

  const nextMeta = { ...meta, options: opts };
  await db
    .update(formOptions)
    .set({ meta: nextMeta })
    .where(eq(formOptions.id, row.id));
  return added;
}

/** Insert new option rows into a `<pkg>_category` group. */
async function addToCategoryGroup(
  field: ImportFieldDef,
  values: Array<{ value: string; label: string }>,
): Promise<number> {
  const groupKey = `${field.pkg}_category`;
  const existing = await db
    .select({ value: formOptions.value })
    .from(formOptions)
    .where(eq(formOptions.groupKey, groupKey));
  const present = new Set(existing.map((r) => String(r.value ?? "").toLowerCase()));

  // Compute the next sortOrder so new categories appear at the end.
  const maxSortRow = existing.length;
  let added = 0;
  const toInsert: Array<typeof formOptions.$inferInsert> = [];
  for (const v of values) {
    if (present.has(v.value.toLowerCase())) continue;
    toInsert.push({
      groupKey,
      label: v.label,
      value: v.value,
      sortOrder: maxSortRow + added,
      isActive: true,
      valueType: "string",
    });
    present.add(v.value.toLowerCase());
    added++;
  }
  if (toInsert.length > 0) {
    await db.insert(formOptions).values(toInsert);
  }
  return added;
}

/**
 * Append new child options under a specific parent option of a collapsed
 * select-with-children column (Make/Model and similar shapes).
 */
async function addToCollapsedChild(
  field: ImportFieldDef,
  parentValueRaw: string,
  values: Array<{ value: string; label: string }>,
): Promise<number> {
  if (field.virtual?.kind !== "option_child_collapsed") {
    throw new Error("Internal: addToCollapsedChild called on non-collapsed field");
  }
  const v = field.virtual;
  const parentKey = v.parentKey;
  const childIndex = v.childIndex;
  const childLabel = v.childLabel;
  const childInputType = v.childInputType;

  const groupKey = `${field.pkg}_fields`;
  const [row] = await db
    .select()
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, groupKey), eq(formOptions.value, parentKey)))
    .limit(1);
  if (!row) {
    throw new Error(`form_options row not found for ${groupKey}/${parentKey}`);
  }

  const meta = ((row.meta as Record<string, unknown> | null) ?? {}) as {
    options?: Array<{
      value?: string;
      label?: string;
      children?: Array<{
        label?: string;
        inputType?: string;
        options?: Array<{ value?: string; label?: string }>;
      }>;
    }>;
  } & Record<string, unknown>;

  const opts = Array.isArray(meta.options) ? [...meta.options] : [];
  const targetLower = parentValueRaw.toLowerCase();
  const parentIdx = opts.findIndex(
    (o) => String(o?.value ?? "").toLowerCase() === targetLower,
  );
  if (parentIdx < 0) {
    throw new Error(
      `Parent option "${parentValueRaw}" not found on field "${field.virtual.parentLabel}". Add it as an option first.`,
    );
  }

  const parentOption = { ...opts[parentIdx] };
  const children = Array.isArray(parentOption.children) ? [...parentOption.children] : [];

  // Make sure the slot at childIndex exists (left-pad with placeholder
  // children if a previous index was somehow missing — shouldn't happen
  // for valid Make/Model data but better safe than crash).
  while (children.length <= childIndex) {
    children.push({ label: childLabel, inputType: childInputType, options: [] });
  }
  const childMeta = { ...children[childIndex] };
  childMeta.label = childMeta.label ?? childLabel;
  childMeta.inputType = childMeta.inputType ?? childInputType;
  const childOpts = Array.isArray(childMeta.options) ? [...childMeta.options] : [];

  const existing = new Set(
    childOpts.map((o) => String(o?.value ?? "").toLowerCase()).filter(Boolean),
  );
  let added = 0;
  for (const valueObj of values) {
    if (existing.has(valueObj.value.toLowerCase())) continue;
    childOpts.push({ value: valueObj.value, label: valueObj.label });
    existing.add(valueObj.value.toLowerCase());
    added++;
  }
  if (added === 0) return 0;

  childMeta.options = childOpts;
  children[childIndex] = childMeta;
  parentOption.children = children;
  opts[parentIdx] = parentOption;

  const nextMeta = { ...meta, options: opts };
  await db
    .update(formOptions)
    .set({ meta: nextMeta })
    .where(eq(formOptions.id, row.id));
  return added;
}
