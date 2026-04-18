/**
 * Loads the dynamic schema for a flow (steps → packages → fields)
 * from the form_options table. Used by the policy import feature
 * to generate Excel templates and validate uploaded rows.
 *
 * Mirrors the wizard's loading rules:
 *   - Steps may declare inline `packages` and/or an `embeddedFlow` to inline.
 *   - Embedded flows are expanded recursively (with cycle protection).
 *   - Field order matches the wizard's effective render order:
 *       (groupOrder asc, sortOrder asc, id asc).
 *
 * This module is read-only and never mutates wizard behaviour.
 */
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";

/** Input types that are computed by the wizard and must NOT be imported. */
const COMPUTED_INPUT_TYPES = new Set(["formula", "heading", "divider", "info", "spacer"]);

/** Max recursion depth when expanding embedded flows. */
const MAX_FLOW_DEPTH = 5;

/**
 * Each child a select option can reveal when chosen.
 * Mirrors the wizard's `OptionWithChildren` shape.
 */
export type OptionChildMeta = {
  label?: string;
  inputType?: string;
  options?: ImportFieldOption[];
};

export type ImportFieldOption = {
  label?: string;
  value?: string;
  /** Conditional sub-fields to reveal when this option is selected (wizard parity) */
  children?: OptionChildMeta[];
};

export type EntityPickerMappings = Array<{ sourceField: string; targetField: string }>;

export type EntityPickerInfo = {
  /** Flow key the picker references (e.g. "InsuranceSet") */
  flow: string;
  /** Field mappings copied from the picked entity's snapshot */
  mappings: EntityPickerMappings;
  /** Optional human label for the button (UI only, kept for completeness) */
  buttonLabel?: string;
};

export type BooleanChildMeta = {
  label?: string;
  inputType?: string;
  options?: ImportFieldOption[];
};

export type ImportFieldMeta = {
  inputType?: string;
  options?: ImportFieldOption[];
  required?: boolean;
  description?: string;
  placeholder?: string;
  hidden?: boolean;
  repeatable?: unknown;
  subFields?: unknown;
  group?: string | string[];
  groupOrder?: number;
  /** Categories this field is visible under (empty / missing = all categories) */
  categories?: string[];
  /** Conditional sub-fields revealed when the parent boolean is true / false */
  booleanChildren?: {
    true?: BooleanChildMeta[];
    false?: BooleanChildMeta[];
  };
  entityPicker?: {
    flow?: string;
    buttonLabel?: string;
    mappings?: EntityPickerMappings;
  };
} & Record<string, unknown>;

/**
 * Tag put on virtual columns the schema synthesises (category selector,
 * boolean-child fields). The commit step uses this to know which "real"
 * field name to push into the API payload.
 */
export type VirtualField =
  | { kind: "category"; pkg: string }
  | {
      kind: "boolean_child";
      pkg: string;
      parentKey: string; // e.g. "tailgate"
      parentLabel: string; // for human messages
      branch: "true" | "false";
      childIndex: number;
    }
  | {
      kind: "option_child";
      pkg: string;
      parentKey: string; // e.g. "typeOfCover"
      parentLabel: string;
      /** The option value that triggers this child (e.g. "comp") */
      optionValue: string;
      /** The option label (for human messages) */
      optionLabel: string;
      childIndex: number;
    };

export type ImportFieldDef = {
  /** Field key (e.g. "firstName") */
  key: string;
  /** Full form field name (e.g. "insured__firstName") */
  fullKey: string;
  /** Package this field belongs to */
  pkg: string;
  /** Human label */
  label: string;
  /** Underlying type for parsing/validation */
  inputType: string;
  /** True if marked required in form_options meta */
  required: boolean;
  /** Select options (when inputType is "select"/"radio"/"multi_select") */
  options: ImportFieldOption[];
  /** True if the field is the package's "category" selector */
  isCategory: boolean;
  /** True if the field has nested/repeatable config and should be skipped in import */
  unsupported: boolean;
  /** Reason for unsupported flag, surfaced in the template instructions */
  unsupportedReason?: string;
  /** When this field references another flow's record */
  entityPicker?: EntityPickerInfo;
  /**
   * Categories under which this field applies. Empty array means "all".
   * Used by the validator to fail rows that fill off-category data.
   */
  categories: string[];
  /** Marks this as a synthesised column (category selector / boolean child) */
  virtual?: VirtualField;
  /** Composite sort weight (lower = earlier) */
  effectiveOrder: number;
  /** DB row id, used as final stable tiebreaker */
  dbId: number;
};

export type CategoryOption = { value: string; label: string };

export type ImportPackageDef = {
  /** Package key (e.g. "insured", "vehicle") */
  key: string;
  /** Human label */
  label: string;
  /** Wizard step this package was first introduced in (1-based, for grouping) */
  stepNumber: number;
  /** Step label this package was first introduced in */
  stepLabel: string;
  /**
   * Category dropdown options for this package, loaded from
   * `${pkg}_category` in form_options. Empty if the package has no
   * category-filtered fields.
   */
  categoryOptions: CategoryOption[];
  /** Fields belonging to this package, in wizard order (category selector first when present) */
  fields: ImportFieldDef[];
};

export type ImportFlowSchema = {
  flowKey: string;
  flowLabel: string;
  /** Ordered packages used by the flow (de-duplicated, in step order) */
  packages: ImportPackageDef[];
};

function isUnsupportedField(meta: ImportFieldMeta): { unsupported: boolean; reason?: string } {
  if (meta.repeatable) return { unsupported: true, reason: "Repeatable fields are not supported in bulk import" };
  if (Array.isArray(meta.subFields) && meta.subFields.length > 0) {
    return { unsupported: true, reason: "Fields with sub-fields are not supported in bulk import" };
  }
  return { unsupported: false };
}

function normaliseOptions(meta: ImportFieldMeta): ImportFieldOption[] {
  const raw = meta.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is ImportFieldOption => Boolean(o) && typeof o === "object")
    .map((o) => {
      const children = Array.isArray((o as { children?: unknown }).children)
        ? ((o as { children?: OptionChildMeta[] }).children as OptionChildMeta[])
        : undefined;
      return {
        label: typeof o.label === "string" ? o.label : undefined,
        value: typeof o.value === "string" ? o.value : undefined,
        children,
      };
    })
    .filter((o) => Boolean(o.value));
}

function extractEntityPicker(meta: ImportFieldMeta, inputType: string): EntityPickerInfo | undefined {
  // Explicit entity picker meta
  const ep = meta.entityPicker;
  if (ep && typeof ep === "object" && typeof ep.flow === "string" && ep.flow.trim()) {
    const mappings = Array.isArray(ep.mappings)
      ? ep.mappings.filter(
          (m): m is { sourceField: string; targetField: string } =>
            Boolean(m) && typeof m === "object" && typeof (m as Record<string, unknown>).sourceField === "string" && typeof (m as Record<string, unknown>).targetField === "string",
        )
      : [];
    return {
      flow: ep.flow.trim(),
      mappings,
      buttonLabel: typeof ep.buttonLabel === "string" ? ep.buttonLabel : undefined,
    };
  }

  // Implicit: input type is `agent_picker` → references a user (no flow lookup; resolved by userNumber)
  if (inputType === "agent_picker") {
    return { flow: "__agent__", mappings: [] };
  }

  return undefined;
}

async function loadFlowLabel(flowKey: string): Promise<string> {
  const rows = await db
    .select({ label: formOptions.label, value: formOptions.value })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, "flows"), eq(formOptions.value, flowKey)))
    .limit(1);
  return rows[0]?.label ?? flowKey;
}

async function loadPackageLabel(pkgKey: string): Promise<string> {
  const rows = await db
    .select({ label: formOptions.label })
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, "packages"), eq(formOptions.value, pkgKey)))
    .limit(1);
  return rows[0]?.label ?? pkgKey;
}

type StepRow = {
  id: number;
  label: string;
  value: string;
  sortOrder: number;
  meta: { packages?: unknown; embeddedFlow?: unknown } | null;
};

async function loadFlowSteps(flowKey: string): Promise<StepRow[]> {
  const rows = await db
    .select({
      id: formOptions.id,
      label: formOptions.label,
      value: formOptions.value,
      sortOrder: formOptions.sortOrder,
      meta: formOptions.meta,
      isActive: formOptions.isActive,
    })
    .from(formOptions)
    .where(eq(formOptions.groupKey, `flow_${flowKey}_steps`));

  return rows
    .filter((r) => r.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)
    .map((r) => ({
      id: r.id,
      label: r.label,
      value: r.value,
      sortOrder: r.sortOrder ?? 0,
      meta: (r.meta ?? null) as StepRow["meta"],
    }));
}

type PackageOrigin = { pkgKey: string; stepNumber: number; stepLabel: string };

/**
 * Walks a flow recursively, expanding any `embeddedFlow` references, and
 * returns the ordered, de-duplicated list of (package, originStep) pairs.
 */
async function collectPackagesForFlow(
  flowKey: string,
  visitedFlows: Set<string>,
  startingStepNumber: number,
  depth: number,
  /** When set, embedded packages report this label instead of their own step's label */
  stepLabelOverride?: string,
): Promise<{ packages: PackageOrigin[]; nextStepNumber: number }> {
  if (depth > MAX_FLOW_DEPTH || visitedFlows.has(flowKey)) {
    return { packages: [], nextStepNumber: startingStepNumber };
  }
  visitedFlows.add(flowKey);

  const steps = await loadFlowSteps(flowKey);
  const seenPkgs = new Set<string>();
  const out: PackageOrigin[] = [];
  let stepCounter = startingStepNumber;

  for (const step of steps) {
    const meta = step.meta ?? {};
    const inlinePkgs = Array.isArray(meta.packages)
      ? meta.packages.filter((p): p is string => typeof p === "string" && p.length > 0)
      : [];

    const labelForOutput = stepLabelOverride ?? step.label;

    let producedAnyForThisStep = false;

    for (const pkg of inlinePkgs) {
      if (seenPkgs.has(pkg)) continue;
      seenPkgs.add(pkg);
      out.push({ pkgKey: pkg, stepNumber: stepCounter, stepLabel: labelForOutput });
      producedAnyForThisStep = true;
    }

    const embedded = typeof meta.embeddedFlow === "string" ? meta.embeddedFlow.trim() : "";
    if (embedded) {
      // Recurse into the embedded flow, starting at the same step number so
      // its packages stay grouped under the parent step's banner, and force
      // them to display the PARENT step's label (the user is doing policyset,
      // not clientSet, so the banner should say "Choosing Insured Type").
      const startForEmbed = producedAnyForThisStep ? stepCounter + 1 : stepCounter;
      const sub = await collectPackagesForFlow(
        embedded,
        visitedFlows,
        startForEmbed,
        depth + 1,
        labelForOutput,
      );
      for (const p of sub.packages) {
        if (seenPkgs.has(p.pkgKey)) continue;
        seenPkgs.add(p.pkgKey);
        out.push(p);
      }
      stepCounter = Math.max(stepCounter + 1, sub.nextStepNumber);
    } else if (producedAnyForThisStep) {
      stepCounter += 1;
    }
  }

  return { packages: out, nextStepNumber: stepCounter };
}

/**
 * Builds the full virtual column id for a synthesised boolean-child field.
 * Format mirrors the natural template column id pattern (`<pkg>.<key>`)
 * so headers still parse cleanly.
 */
export function booleanChildColumnKey(parentKey: string, branch: "true" | "false", index: number): string {
  return `${parentKey}__${branch === "true" ? "y" : "n"}_bc${index}`;
}

/**
 * RHF / wizard storage path for a boolean child:
 *   <pkg>__<parent>__true__bc<idx>
 * Used by the payload builder so imported policies match wizard-saved ones byte-for-byte.
 */
export function booleanChildWizardKey(pkgKey: string, parentKey: string, branch: "true" | "false", index: number): string {
  return `${pkgKey}__${parentKey}__${branch}__bc${index}`;
}

/**
 * Compact column-id stem for an option child column. Format:
 *   <parent>__o_<sanitisedValue>_sc<idx>
 * The parent.value gets sanitised (a-z0-9_) so it stays safe inside Excel
 * column ids and the parser's reverse-mapping.
 */
export function optionChildColumnKey(parentKey: string, optionValue: string, index: number): string {
  const safe = optionValue.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${parentKey}__o_${safe || "x"}_sc${index}`;
}

/**
 * Wizard / RHF storage path for an option child:
 *   <pkg>__<parent>__opt_<value>__sc<idx>
 * Matches `SelectWithOptionChildren` in components/policies/PackageBlock.tsx.
 */
export function optionChildWizardKey(pkgKey: string, parentKey: string, optionValue: string, index: number): string {
  return `${pkgKey}__${parentKey}__opt_${optionValue}__sc${index}`;
}

function expandOptionChildren(
  pkgKey: string,
  parent: ImportFieldDef,
  startOrder: number,
): { fields: ImportFieldDef[]; nextOrder: number } {
  const out: ImportFieldDef[] = [];
  let order = startOrder;
  if (parent.options.length === 0) return { fields: out, nextOrder: order };

  for (const opt of parent.options) {
    if (!opt.value || !Array.isArray(opt.children) || opt.children.length === 0) continue;
    opt.children.forEach((child, idx) => {
      const childType = String(child?.inputType ?? "string");
      if (COMPUTED_INPUT_TYPES.has(childType)) return;
      if ((child as Record<string, unknown>)?.repeatable) return;
      const subFields = (child as Record<string, unknown>)?.subFields;
      if (Array.isArray(subFields) && subFields.length > 0) return;

      const colKey = optionChildColumnKey(parent.key, opt.value!, idx);
      const childLabel = (child?.label ?? `Sub-field ${idx + 1}`).trim();
      const optHuman = opt.label ?? opt.value!;
      out.push({
        key: colKey,
        fullKey: `${pkgKey}__${colKey}`,
        pkg: pkgKey,
        label: `${parent.label}.${childLabel} (when ${optHuman})`,
        inputType: childType,
        required: false, // child requirements depend on parent value
        options: Array.isArray(child?.options)
          ? child!.options!.map((o) => ({
              label: typeof o.label === "string" ? o.label : undefined,
              value: typeof o.value === "string" ? o.value : undefined,
            })).filter((o) => Boolean(o.value))
          : [],
        isCategory: false,
        unsupported: false,
        // Children share their parent's category visibility
        categories: parent.categories,
        virtual: {
          kind: "option_child",
          pkg: pkgKey,
          parentKey: parent.key,
          parentLabel: parent.label,
          optionValue: opt.value!,
          optionLabel: optHuman,
          childIndex: idx,
        },
        effectiveOrder: order++,
        // Stable synthetic id so duplicates can never collide in sort order
        dbId: parent.dbId * 100000 + idx + 1,
      });
    });
  }

  return { fields: out, nextOrder: order };
}

function expandBooleanChildren(
  pkgKey: string,
  parent: ImportFieldDef,
  meta: ImportFieldMeta,
  startOrder: number,
): { fields: ImportFieldDef[]; nextOrder: number } {
  const out: ImportFieldDef[] = [];
  let order = startOrder;
  if (!meta.booleanChildren) return { fields: out, nextOrder: order };

  for (const branch of ["true", "false"] as const) {
    const arr = Array.isArray(meta.booleanChildren[branch]) ? meta.booleanChildren[branch]! : [];
    arr.forEach((child, idx) => {
      const childType = String(child?.inputType ?? "string");
      if (COMPUTED_INPUT_TYPES.has(childType)) return;
      // Repeatable / sub-fielded children are not safely importable via Excel rows.
      if ((child as Record<string, unknown>)?.repeatable) return;
      const subFields = (child as Record<string, unknown>)?.subFields;
      if (Array.isArray(subFields) && subFields.length > 0) return;

      const colKey = booleanChildColumnKey(parent.key, branch, idx);
      const childLabel = (child?.label ?? `Sub-field ${idx + 1}`).trim();
      out.push({
        key: colKey,
        fullKey: `${pkgKey}__${colKey}`,
        pkg: pkgKey,
        label: `${parent.label}.${childLabel} (${branch === "true" ? "yes" : "no"})`,
        inputType: childType,
        required: false, // child requirements depend on parent state; we never force them
        options: Array.isArray(child?.options)
          ? child!.options!.map((o) => ({
              label: typeof o.label === "string" ? o.label : undefined,
              value: typeof o.value === "string" ? o.value : undefined,
            })).filter((o) => Boolean(o.value))
          : [],
        isCategory: false,
        unsupported: false,
        // Children share their parent's category visibility
        categories: parent.categories,
        virtual: {
          kind: "boolean_child",
          pkg: pkgKey,
          parentKey: parent.key,
          parentLabel: parent.label,
          branch,
          childIndex: idx,
        },
        effectiveOrder: order++,
        dbId: parent.dbId * 1000 + (branch === "true" ? 0 : 500) + idx,
      });
    });
  }

  return { fields: out, nextOrder: order };
}

async function loadPackageCategories(pkgKey: string): Promise<CategoryOption[]> {
  const rows = await db
    .select({
      label: formOptions.label,
      value: formOptions.value,
      sortOrder: formOptions.sortOrder,
      isActive: formOptions.isActive,
    })
    .from(formOptions)
    .where(eq(formOptions.groupKey, `${pkgKey}_category`));

  return rows
    .filter((r) => r.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((r) => ({ value: String(r.value ?? "").trim(), label: r.label ?? r.value ?? "" }))
    .filter((c) => c.value.length > 0);
}

async function loadPackageFields(pkgKey: string): Promise<ImportFieldDef[]> {
  const rows = await db
    .select()
    .from(formOptions)
    .where(and(eq(formOptions.groupKey, `${pkgKey}_fields`), eq(formOptions.isActive, true)));

  // Wizard render order: groupOrder asc, then sortOrder asc, then db id (insertion).
  const sorted = rows.sort((a, b) => {
    const am = (a.meta ?? {}) as ImportFieldMeta;
    const bm = (b.meta ?? {}) as ImportFieldMeta;
    const ag = typeof am.groupOrder === "number" ? am.groupOrder : 0;
    const bg = typeof bm.groupOrder === "number" ? bm.groupOrder : 0;
    if (ag !== bg) return ag - bg;
    const as = a.sortOrder ?? 0;
    const bs = b.sortOrder ?? 0;
    if (as !== bs) return as - bs;
    return a.id - b.id;
  });

  const out: ImportFieldDef[] = [];
  let positional = 0;
  for (const r of sorted) {
    const meta = (r.meta ?? {}) as ImportFieldMeta;
    const inputType = String(meta.inputType ?? "text");
    if (COMPUTED_INPUT_TYPES.has(inputType)) continue;
    if (meta.hidden === true) continue;
    const fieldKey = String(r.value ?? "").trim();
    if (!fieldKey) continue;

    const { unsupported, reason } = isUnsupportedField(meta);
    const entityPicker = extractEntityPicker(meta, inputType);
    const categories = Array.isArray(meta.categories)
      ? meta.categories.filter((c): c is string => typeof c === "string" && c.length > 0)
      : [];

    const parent: ImportFieldDef = {
      key: fieldKey,
      fullKey: `${pkgKey}__${fieldKey}`,
      pkg: pkgKey,
      label: r.label ?? fieldKey,
      inputType,
      required: meta.required === true,
      options: normaliseOptions(meta),
      isCategory: fieldKey === "category",
      unsupported,
      unsupportedReason: reason,
      entityPicker,
      categories,
      effectiveOrder: positional++,
      dbId: r.id,
    };
    out.push(parent);

    // Boolean parents may reveal nested children based on their value.
    // Expand non-repeatable children as virtual columns right after the parent.
    if (
      (inputType === "boolean" || inputType === "checkbox") &&
      meta.booleanChildren &&
      !unsupported
    ) {
      const { fields: kids, nextOrder } = expandBooleanChildren(pkgKey, parent, meta, positional);
      out.push(...kids);
      positional = nextOrder;
    }

    // Select parents may reveal children when a specific option is chosen.
    // (Mirrors PackageBlock's `SelectWithOptionChildren`.)
    if ((inputType === "select" || inputType === "radio") && !unsupported) {
      const { fields: kids, nextOrder } = expandOptionChildren(pkgKey, parent, positional);
      out.push(...kids);
      positional = nextOrder;
    }
  }
  return out;
}

/**
 * Loads the complete schema for a flow.
 * Returns packages in wizard step order, each with its fields in wizard order.
 */
export async function loadFlowImportSchema(flowKey: string): Promise<ImportFlowSchema> {
  const flowLabel = await loadFlowLabel(flowKey);

  const { packages: pkgOrigins } = await collectPackagesForFlow(
    flowKey,
    new Set<string>(),
    1,
    0,
  );

  const packageDefs = await Promise.all(
    pkgOrigins.map(async (origin) => {
      const [label, fields, categoryOptions] = await Promise.all([
        loadPackageLabel(origin.pkgKey),
        loadPackageFields(origin.pkgKey),
        loadPackageCategories(origin.pkgKey),
      ]);

      // If any field is category-filtered, prepend a synthesised category
      // selector column so the user can declare which type each row is.
      const hasCategoryFilteredField = fields.some((f) => f.categories.length > 0);
      const enrichedFields: ImportFieldDef[] = [];
      if (hasCategoryFilteredField && categoryOptions.length > 0) {
        enrichedFields.push({
          key: "category",
          fullKey: `${origin.pkgKey}__category`,
          pkg: origin.pkgKey,
          label: `${label} Type`,
          inputType: "select",
          required: true,
          options: categoryOptions.map((c) => ({ value: c.value, label: c.label })),
          isCategory: true,
          unsupported: false,
          categories: [],
          virtual: { kind: "category", pkg: origin.pkgKey },
          effectiveOrder: -1,
          dbId: -1,
        });
      }
      enrichedFields.push(...fields);

      return {
        key: origin.pkgKey,
        label,
        stepNumber: origin.stepNumber,
        stepLabel: origin.stepLabel,
        categoryOptions,
        fields: enrichedFields,
      } satisfies ImportPackageDef;
    }),
  );

  // Drop empty packages so the template stays clean
  const packages = packageDefs.filter((p) => p.fields.length > 0);

  return { flowKey, flowLabel, packages };
}

/** Returns all importable fields across all packages, in package then wizard order. */
export function flattenFields(schema: ImportFlowSchema): ImportFieldDef[] {
  const out: ImportFieldDef[] = [];
  for (const p of schema.packages) {
    for (const f of p.fields) {
      if (f.unsupported) continue;
      out.push(f);
    }
  }
  return out;
}
