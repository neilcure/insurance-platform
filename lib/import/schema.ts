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

/**
 * Input types that don't accept user input via Excel.
 *
 *   - "formula": value is computed (e.g. endDate = startedDate + 364). We DO
 *     want these in the schema so the payload builder can evaluate them at
 *     import time (mirroring what the wizard's <FormulaField /> does on save),
 *     but the template MUST NOT show a column for them — they're handled by
 *     `unsupported: true, unsupportedReason: "Computed automatically"` in
 *     loadPackageFields, which excel.ts already filters out of column emission.
 *
 *   - "heading"/"divider"/"info"/"spacer": pure UI scaffolding, never stored.
 *     These are dropped entirely from the schema.
 */
const PRESENTATIONAL_INPUT_TYPES = new Set(["heading", "divider", "info", "spacer"]);
const COMPUTED_INPUT_TYPES = new Set(["formula", "heading", "divider", "info", "spacer"]);

/** Max recursion depth when expanding embedded flows. */
const MAX_FLOW_DEPTH = 5;

/**
 * Default number of "slots" a repeatable field gets in the import template
 * when its `max` is 0 (unlimited) or not specified. Three slots are the sweet
 * spot — handles the vast majority of policies (drivers, named insureds,
 * compensation items, etc.) without bloating the template.
 */
export const DEFAULT_REPEAT_SLOTS = 3;

/**
 * Hard ceiling on the number of slot columns generated per repeatable field,
 * even if the admin configures a `max` larger than this. Keeps the template
 * readable and the data-validation count under Excel's practical limits.
 */
export const MAX_REPEAT_SLOTS = 10;

/**
 * Threshold for collapsing same-shape children across many parent options
 * into a single column. When 2+ options share a child at the same index with
 * the same (label, inputType), we emit ONE collapsed column instead of N.
 *
 * Set to 2 so any duplicated shape collapses; lone option-children (e.g.
 * comp → Sum Insured) keep their explicit `(if=comp)` column.
 */
const COLLAPSE_OPTION_CHILD_THRESHOLD = 2;

/**
 * Each child a select option can reveal when chosen.
 * Mirrors the wizard's `OptionWithChildren` shape.
 *
 * `booleanChildren` is the third level of the conditional chain — when the
 * option-child itself is a boolean, it can reveal further fields based on
 * its yes/no answer (e.g. cover=tpo → "Own Vehicle Damage?" → "Estimate Value").
 */
export type OptionChildMeta = {
  label?: string;
  inputType?: string;
  options?: ImportFieldOption[];
  booleanChildren?: {
    true?: BooleanChildMeta[];
    false?: BooleanChildMeta[];
  };
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
  /**
   * When the boolean's branch reveals a repeatable list (e.g. "Add more
   * drivers? yes → [drivers list]"), the repeatable config lives here.
   * Schema expansion turns this into one virtual cell per slot × sub-field.
   */
  repeatable?: unknown;
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
  /** Formula expression for inputType="formula" fields. Evaluated at save-time. */
  formula?: string;
  /** Per-field conditional rules — field is hidden when these fail. */
  showWhen?: ShowWhenRule | ShowWhenRule[];
  /** Per-group conditional rules — entire group hidden when these fail. */
  groupShowWhen?: GroupShowWhenRule | GroupShowWhenRule[];
  /** Map of group label → groupShowWhen rules; takes precedence over `groupShowWhen`. */
  groupShowWhenMap?: Record<string, GroupShowWhenRule | GroupShowWhenRule[]>;
  /** Combination logic for groupShowWhen rules; defaults to "and". */
  groupShowWhenLogic?: "and" | "or";
  /** Per-group logic override map. */
  groupShowWhenLogicMap?: Record<string, "and" | "or">;
} & Record<string, unknown>;

/**
 * Per-field conditional. Mirrors `evaluateShowWhen` in PackageBlock.tsx.
 * Field is shown only when EVERY rule passes.
 */
export type ShowWhenRule = {
  /** Other package whose values gate visibility. Required. */
  package: string;
  /** Required category (or one of). Empty = no category constraint. */
  category?: string | string[];
  /** Optional field-value gate within the other package. */
  field?: string;
  fieldValues?: string[];
  /** Optional gate on a child of `field` (e.g. "coverType__opt_tpo__c0"). */
  childKey?: string;
  childValues?: string[];
};

/**
 * Per-group conditional. Mirrors the gsw evaluator in PackageBlock.tsx
 * (around line 1418). Group is shown only when rules pass per `logic`.
 *
 * Note: uses `field`/`values` (NOT `fieldValues`) — rule shape differs from
 * showWhen for historical reasons.
 */
export type GroupShowWhenRule = {
  /** Package whose values gate the group. Defaults to the field's own pkg. */
  package?: string;
  field?: string;
  values?: string[];
  childKey?: string;
  childValues?: string[];
};

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
    }
  | {
      /**
       * Third-level conditional: a boolean field that lives under a select's
       * option-child, revealed when both the parent select matches `optionValue`
       * AND the option-child boolean equals the matching `branch`.
       *
       * Example chain: `coverType=tpo` → "Own Vehicle Damage Cover?" (yes) →
       * "Estimate Value". The first link is the parent select, the second is
       * an `option_child` (boolean), the third is this kind.
       */
      kind: "option_child_boolean_child";
      pkg: string;
      /** Outer select parent key (e.g. "coverType") */
      parentKey: string;
      parentLabel: string;
      /** Option value of the outer select that activates the chain */
      optionValue: string;
      optionLabel: string;
      /** Index of the option-child (the boolean) within `option.children` */
      ocChildIndex: number;
      /** Label of the option-child (for human messages) */
      ocLabel: string;
      /** Which boolean branch reveals this child */
      branch: "true" | "false";
      /** Index within the boolean branch's children */
      bcChildIndex: number;
    }
  | {
      /**
       * "Collapsed" option child: when many parent options share a child at the
       * same index with the same (label, inputType), the template emits ONE
       * column for the group instead of one per option. The validator looks up
       * the right child meta at row-validation time based on the parent's value.
       *
       * Example: `Make` has 50 options, each with children=[{label:"Model",
       * inputType:"select", options:[...models for that make]}]. Without this,
       * we'd emit 50 "Model" columns; with this, just one "Make.Model" column
       * whose dropdown is suppressed (per-option model lists differ).
       */
      kind: "option_child_collapsed";
      pkg: string;
      parentKey: string;
      parentLabel: string;
      childIndex: number;
      childLabel: string;
      childInputType: string;
      /** Map of parent.option.value (lowercased) → child meta for that option */
      perOption: Record<string, { label?: string; options?: ImportFieldOption[] }>;
      /** All parent option values that contribute to this collapsed column (lowercased) */
      triggeringOptionValues: string[];
    }
  | {
      /**
       * One sub-field cell in a repeatable's "slot N". The template generates
       * up to MAX_REPEAT_SLOTS sets of sub-field columns per repeatable; the
       * payload step groups them back into the wizard's array shape:
       *   pkgValues[`${pkg}__${parentKey}`] = [{ subKey: v, ... }, ...]
       */
      kind: "repeatable_slot";
      pkg: string;
      parentKey: string;
      parentLabel: string;
      slotIndex: number; // 0-based
      slotsTotal: number;
      itemLabel: string; // e.g. "Driver"
      subKey: string; // e.g. "name"
      subLabel: string;
      subInputType: string;
      subOptions?: ImportFieldOption[];
      /** Sub-field declared as required by the repeatable config */
      subRequired: boolean;
      /** Repeatable.min — at least this many slots must be filled */
      minSlots: number;
      /** Repeatable.max as configured (0 = unlimited; capped at MAX_REPEAT_SLOTS for template) */
      maxSlots: number;
    }
  | {
      /**
       * One sub-field cell in slot N of a repeatable nested INSIDE a top-level
       * boolean's branch. Mirrors `repeatable_slot` plus the boolean-parent
       * gating context. Validator gates on the parent boolean's value, then
       * applies the same slot-ordering / min-slots / sub-required rules as a
       * plain repeatable. Payload key:
       *   pkgValues[`${pkg}__${parentKey}__${branch}__c${bcChildIndex}`] =
       *     [{ subKey: v, ... }, ...]
       */
      kind: "boolean_child_repeatable_slot";
      pkg: string;
      /** Outer boolean's key (e.g. "moreDriver") */
      parentKey: string;
      parentLabel: string;
      /** Branch (true/false) that reveals this repeatable */
      branch: "true" | "false";
      /** Index of the boolean child within `booleanChildren[branch]` */
      bcChildIndex: number;
      /** Boolean-child label (for human messages, e.g. "Driver Information") */
      bcLabel: string;
      slotIndex: number; // 0-based
      slotsTotal: number;
      itemLabel: string;
      subKey: string;
      subLabel: string;
      subInputType: string;
      subOptions?: ImportFieldOption[];
      subRequired: boolean;
      minSlots: number;
      maxSlots: number;
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
  /**
   * Formula expression (only set when inputType="formula"). Evaluated at
   * import-commit time so the snapshot mirrors what the wizard's
   * <FormulaField /> would have written.
   */
  formula?: string;
  /**
   * Mirror source (only set when inputType="mirror"). Resolved at
   * import-commit time so the snapshot mirrors what the wizard's
   * <MirrorField /> would have written. See `lib/types/form.ts`
   * `MirrorSource`.
   */
  mirrorSource?: { package: string; field: string };
  /** Group label this field belongs to (for groupShowWhen lookups). */
  group?: string;
  /** Per-field show condition; gating dropped when these fail. */
  showWhen?: ShowWhenRule[];
  /** Per-group show condition; the entire group is gated when these fail. */
  groupShowWhen?: GroupShowWhenRule[];
  /** Combination logic for groupShowWhen ("and" default). */
  groupShowWhenLogic?: "and" | "or";
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

/**
 * Normalise per-field showWhen meta to a clean array. Accepts a single rule,
 * an array of rules, or null/undefined. Drops malformed entries silently —
 * the wizard does the same.
 */
function normaliseShowWhen(raw: unknown): ShowWhenRule[] | undefined {
  if (raw == null) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: ShowWhenRule[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const pkg = typeof o.package === "string" ? o.package.trim() : "";
    if (!pkg) continue; // showWhen requires a package anchor
    out.push({
      package: pkg,
      category: typeof o.category === "string" || Array.isArray(o.category) ? (o.category as string | string[]) : undefined,
      field: typeof o.field === "string" ? o.field : undefined,
      fieldValues: Array.isArray(o.fieldValues) ? o.fieldValues.filter((v): v is string => typeof v === "string") : undefined,
      childKey: typeof o.childKey === "string" ? o.childKey : undefined,
      childValues: Array.isArray(o.childValues) ? o.childValues.filter((v): v is string => typeof v === "string") : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Normalise groupShowWhen meta to an array. Accepts single rule or array.
 * Note: rule shape uses `field`/`values` (not `fieldValues`) — different from
 * showWhen but matches what the wizard's gsw evaluator expects.
 */
function normaliseGroupShowWhen(raw: unknown): GroupShowWhenRule[] | undefined {
  if (raw == null) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: GroupShowWhenRule[] = [];
  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    out.push({
      package: typeof o.package === "string" ? o.package : undefined,
      field: typeof o.field === "string" ? o.field : undefined,
      values: Array.isArray(o.values) ? o.values.filter((v): v is string => typeof v === "string") : undefined,
      childKey: typeof o.childKey === "string" ? o.childKey : undefined,
      childValues: Array.isArray(o.childValues) ? o.childValues.filter((v): v is string => typeof v === "string") : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

function isUnsupportedField(meta: ImportFieldMeta): { unsupported: boolean; reason?: string } {
  // NOTE: repeatables are now supported via slot expansion (see expandRepeatable).
  // We only mark them unsupported later if the slot expansion produces zero importable
  // sub-field columns (e.g. all sub-fields are themselves nested repeatables).
  if (Array.isArray(meta.subFields) && meta.subFields.length > 0) {
    return { unsupported: true, reason: "Fields with sub-fields are not supported in bulk import" };
  }
  return { unsupported: false };
}

/**
 * Reads a `RepeatableConfig` (or `RepeatableConfig[]`) off the field meta.
 * Mirrors `getRepeatable()` in components/policies/PackageBlock.tsx so the
 * import template uses the same effective config the wizard does.
 */
type RepeatableConfigShape = {
  itemLabel?: string;
  min?: number;
  max?: number;
  fields?: Array<{
    label?: string;
    value?: string;
    inputType?: string;
    options?: ImportFieldOption[];
    required?: boolean;
  }>;
};

function getRepeatableConfig(meta: ImportFieldMeta): RepeatableConfigShape | null {
  const raw = meta.repeatable;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "object" && first !== null ? (first as RepeatableConfigShape) : null;
  }
  return typeof raw === "object" && raw !== null ? (raw as RepeatableConfigShape) : null;
}

function normaliseOptions(meta: ImportFieldMeta): ImportFieldOption[] {
  const raw = meta.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is ImportFieldOption => Boolean(o) && typeof o === "object")
    .map((o) => {
      const rawChildren = Array.isArray((o as { children?: unknown }).children)
        ? ((o as { children?: OptionChildMeta[] }).children as OptionChildMeta[])
        : undefined;
      // Preserve booleanChildren on each option-child so the schema can expand
      // the third-level chain (option_child > boolean_child).
      const children: OptionChildMeta[] | undefined = rawChildren?.map((c) => {
        const bc = (c as { booleanChildren?: unknown }).booleanChildren;
        const booleanChildren =
          bc && typeof bc === "object"
            ? (bc as { true?: BooleanChildMeta[]; false?: BooleanChildMeta[] })
            : undefined;
        return {
          label: typeof c?.label === "string" ? c.label : undefined,
          inputType: typeof c?.inputType === "string" ? c.inputType : undefined,
          options: Array.isArray(c?.options) ? c.options : undefined,
          booleanChildren,
        };
      });
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
 * RHF / wizard storage path for a TOP-LEVEL package boolean child:
 *   <pkg>__<parent>__true__c<idx>
 *
 * Mirrors `PackageBlock.tsx` which registers boolean children of top-level
 * package booleans via `${nameBase}__${branch}__c${cIdx}` (NOT `__bc`).
 * The `__bc` form is used only by `BooleanBranchFields` for booleans that are
 * themselves nested inside another component (option-children, etc.) — see
 * `optionChildBooleanChildWizardKey` below.
 */
export function booleanChildWizardKey(pkgKey: string, parentKey: string, branch: "true" | "false", index: number): string {
  return `${pkgKey}__${parentKey}__${branch}__c${index}`;
}

/**
 * RHF / wizard storage path for a REPEATABLE field nested inside a top-level
 * package boolean's branch:
 *   <pkg>__<parent>__<true|false>__c<bcIdx>
 *
 * Same key shape as `booleanChildWizardKey`, but the stored VALUE is an array
 * of `{subKey: value}` objects (the SubFieldRepeatable storage shape). The
 * wizard renders this via `SubFieldRepeatable name={nameBase__branch__c{idx}}`
 * — see `PackageBlock.tsx` ≈ line 1880.
 */
export function booleanChildRepeatableWizardKey(
  pkgKey: string,
  parentKey: string,
  branch: "true" | "false",
  bcIndex: number,
): string {
  return `${pkgKey}__${parentKey}__${branch}__c${bcIndex}`;
}

/**
 * Compact column-id stem for a slot cell of a repeatable nested inside a
 * boolean's branch. Format:
 *   <parent>__<y|n>_c<bcIdx>_r<slot1Based>_<subKey>
 *
 * Distinct from the plain `boolean_child` stem (`__y_bc<idx>` etc.) so the
 * parser's reverse map can identify it cleanly.
 */
export function booleanChildRepeatableSlotColumnKey(
  parentKey: string,
  branch: "true" | "false",
  bcIndex: number,
  slotNumber1Based: number,
  subKey: string,
): string {
  const safeSub = subKey.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${parentKey}__${branch === "true" ? "y" : "n"}_c${bcIndex}_r${slotNumber1Based}_${safeSub || "x"}`;
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
 * Wizard / RHF storage path for an option child of a TOP-LEVEL select field:
 *   <pkg>__<parent>__opt_<value>__c<idx>
 *
 * Matches `InlineSelectWithChildren` (components/policies/InlineSelectWithChildren.tsx),
 * which is what `PackageBlock.tsx` renders for top-level select fields and
 * registers each option-child via `${nameBase}__opt_${current}__c${cIdx}`.
 *
 * The `__sc<idx>` form (in `SelectWithOptionChildren`) is reserved for selects
 * that are themselves nested INSIDE another component (boolean/option child
 * branches). Our import schema only emits `option_child` virtuals for top-level
 * select fields, so we always want the `__c<idx>` form here.
 */
export function optionChildWizardKey(pkgKey: string, parentKey: string, optionValue: string, index: number): string {
  return `${pkgKey}__${parentKey}__opt_${optionValue}__c${index}`;
}

/**
 * Compact column id stem for a third-level conditional cell — a boolean
 * child that lives under a select option-child. Format:
 *   <parent>__o_<sanitisedValue>_sc<ocIdx>__<y|n>_bc<bcIdx>
 * Mirrors the natural pattern so headers still parse cleanly.
 */
export function optionChildBooleanChildColumnKey(
  parentKey: string,
  optionValue: string,
  ocChildIndex: number,
  branch: "true" | "false",
  bcChildIndex: number,
): string {
  const safe = optionValue.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${parentKey}__o_${safe || "x"}_sc${ocChildIndex}__${branch === "true" ? "y" : "n"}_bc${bcChildIndex}`;
}

/**
 * Wizard / RHF storage path for a third-level conditional value:
 *   <pkg>__<parent>__opt_<value>__c<ocIdx>__<true|false>__bc<bcIdx>
 *
 * Matches `InlineSelectWithChildren` → `BooleanBranchFields` chaining (i.e.
 * the option-child boolean is registered with `__c<ocIdx>`, then its branch
 * children are registered with `__bc<bcIdx>` by `BooleanBranchFields`).
 * Imports must serialise byte-for-byte the same as wizard-saved policies, so
 * the middle link uses `__c` (NOT `__sc`).
 */
export function optionChildBooleanChildWizardKey(
  pkgKey: string,
  parentKey: string,
  optionValue: string,
  ocChildIndex: number,
  branch: "true" | "false",
  bcChildIndex: number,
): string {
  return `${pkgKey}__${parentKey}__opt_${optionValue}__c${ocChildIndex}__${branch}__bc${bcChildIndex}`;
}

/**
 * Compact column id stem for a "collapsed" option child column. Uses the
 * child's index + sanitised label so it stays stable across template
 * regenerations:
 *   <parent>__sc<idx>_<sanitisedChildLabel>
 */
export function optionChildCollapsedColumnKey(parentKey: string, childIndex: number, childLabel: string): string {
  const safe = childLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${parentKey}__sc${childIndex}_${safe || "x"}`;
}

/**
 * Wizard / RHF storage path for a repeatable field:
 *   <pkg>__<parent>
 * The value is an array of objects keyed by sub-field key. See
 * `SubFieldRepeatable` in components/policies/PackageBlock.tsx.
 */
export function repeatableWizardKey(pkgKey: string, parentKey: string): string {
  return `${pkgKey}__${parentKey}`;
}

/**
 * Compact column id stem for one sub-field cell in slot N (1-based) of a
 * repeatable field:
 *   <parent>__r<slotNumber>_<subKey>
 */
export function repeatableSlotColumnKey(parentKey: string, slotNumber1Based: number, subKey: string): string {
  return `${parentKey}__r${slotNumber1Based}_${subKey}`;
}

/**
 * Expands a select / radio parent's option children into virtual columns.
 *
 * Two modes per child index:
 *   • If 2+ parent options share a child at the same index with the same
 *     (label, inputType), emit ONE collapsed column (`option_child_collapsed`).
 *     This avoids the Make→Model bloat where 50 options each declare a "Model"
 *     child with per-make option lists.
 *   • Otherwise, fall back to per-option columns (`option_child`) tagged with
 *     `(if=<value>)` so the user knows which parent value triggers each.
 */
function expandOptionChildren(
  pkgKey: string,
  parent: ImportFieldDef,
  startOrder: number,
): { fields: ImportFieldDef[]; nextOrder: number } {
  const out: ImportFieldDef[] = [];
  let order = startOrder;
  if (parent.options.length === 0) return { fields: out, nextOrder: order };

  // Bucket children by (childIndex, normalisedLabel, inputType) so we can
  // detect groups that should collapse.
  type PerOptionInfo = {
    label?: string;
    options: ImportFieldOption[];
    rawOptValue: string;
    optHuman: string;
    /** Preserved for third-level expansion when this option-child is boolean */
    booleanChildren?: { true?: BooleanChildMeta[]; false?: BooleanChildMeta[] };
  };
  type Bucket = {
    childIndex: number;
    label: string; // canonical label (first one we saw)
    inputType: string;
    /** option.value (lowercased) → child meta */
    perOption: Map<string, PerOptionInfo>;
  };
  const buckets = new Map<string, Bucket>();

  for (const opt of parent.options) {
    if (!opt.value || !Array.isArray(opt.children) || opt.children.length === 0) continue;
    opt.children.forEach((child, idx) => {
      const childType = String(child?.inputType ?? "string");
      if (COMPUTED_INPUT_TYPES.has(childType)) return;
      if ((child as Record<string, unknown>)?.repeatable) return;
      const subFields = (child as Record<string, unknown>)?.subFields;
      if (Array.isArray(subFields) && subFields.length > 0) return;

      const childLabel = (child?.label ?? `Sub-field ${idx + 1}`).trim();
      const bucketKey = `${idx}|${childLabel.toLowerCase()}|${childType}`;
      const optKey = String(opt.value).toLowerCase();
      const optHuman = opt.label ?? opt.value!;
      const childOptions: ImportFieldOption[] = Array.isArray(child?.options)
        ? child!.options!.map((o) => ({
            label: typeof o.label === "string" ? o.label : undefined,
            value: typeof o.value === "string" ? o.value : undefined,
          })).filter((o) => Boolean(o.value))
        : [];

      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = {
          childIndex: idx,
          label: childLabel,
          inputType: childType,
          perOption: new Map(),
        };
        buckets.set(bucketKey, bucket);
      }
      bucket.perOption.set(optKey, {
        label: childLabel,
        options: childOptions,
        rawOptValue: opt.value!,
        optHuman,
        booleanChildren: child?.booleanChildren,
      });
    });
  }

  // Emit columns: collapsed for big buckets, per-option for small ones.
  // We sort buckets by childIndex so columns appear in the same order the
  // wizard reveals them (top-down).
  const orderedBuckets = [...buckets.values()].sort((a, b) => a.childIndex - b.childIndex);

  for (const bucket of orderedBuckets) {
    const optionCount = bucket.perOption.size;

    if (optionCount >= COLLAPSE_OPTION_CHILD_THRESHOLD) {
      // Single collapsed column for this bucket
      const colKey = optionChildCollapsedColumnKey(parent.key, bucket.childIndex, bucket.label);
      const triggeringOptionValues: string[] = [];
      const perOption: Record<string, { label?: string; options?: ImportFieldOption[] }> = {};
      for (const [optKey, info] of bucket.perOption) {
        triggeringOptionValues.push(optKey);
        perOption[optKey] = { label: info.label, options: info.options };
      }
      out.push({
        key: colKey,
        fullKey: `${pkgKey}__${colKey}`,
        pkg: pkgKey,
        label: `${parent.label}.${bucket.label}`,
        inputType: bucket.inputType,
        required: false, // requirement depends on parent's value
        options: [], // no global option list — varies per parent value
        isCategory: false,
        unsupported: false,
        categories: parent.categories,
        virtual: {
          kind: "option_child_collapsed",
          pkg: pkgKey,
          parentKey: parent.key,
          parentLabel: parent.label,
          childIndex: bucket.childIndex,
          childLabel: bucket.label,
          childInputType: bucket.inputType,
          perOption,
          triggeringOptionValues,
        },
        effectiveOrder: order++,
        dbId: parent.dbId * 100000 + bucket.childIndex + 1,
      });
    } else {
      // Single option triggers this child — keep the explicit per-option column
      for (const [, info] of bucket.perOption) {
        const colKey = optionChildColumnKey(parent.key, info.rawOptValue, bucket.childIndex);
        out.push({
          key: colKey,
          fullKey: `${pkgKey}__${colKey}`,
          pkg: pkgKey,
          label: `${parent.label}.${bucket.label} (when ${info.optHuman})`,
          inputType: bucket.inputType,
          required: false,
          options: info.options,
          isCategory: false,
          unsupported: false,
          categories: parent.categories,
          virtual: {
            kind: "option_child",
            pkg: pkgKey,
            parentKey: parent.key,
            parentLabel: parent.label,
            optionValue: info.rawOptValue,
            optionLabel: info.optHuman,
            childIndex: bucket.childIndex,
          },
          effectiveOrder: order++,
          dbId: parent.dbId * 100000 + bucket.childIndex * 1000 + 1,
        });

        // Third-level chain: when the option-child is itself a boolean with
        // booleanChildren, emit one column per branch-child so the user can
        // capture the deepest conditional value (e.g. coverType=tpo →
        // "Own Vehicle Damage Cover?" yes → "Estimate Value").
        // NB: deeper-than-3 chains (e.g. boolean-child → option-child → ...)
        // aren't expanded here; the wizard doesn't render them either.
        if (bucket.inputType === "boolean" && info.booleanChildren) {
          for (const branch of ["true", "false"] as const) {
            const branchArr = Array.isArray(info.booleanChildren[branch])
              ? info.booleanChildren[branch]!
              : [];
            branchArr.forEach((bc, bcIdx) => {
              const bcType = String(bc?.inputType ?? "string");
              if (COMPUTED_INPUT_TYPES.has(bcType)) return;
              if ((bc as Record<string, unknown>)?.repeatable) return;
              const bcSubFields = (bc as Record<string, unknown>)?.subFields;
              if (Array.isArray(bcSubFields) && bcSubFields.length > 0) return;

              const bcLabel = (bc?.label ?? `Sub-field ${bcIdx + 1}`).trim();
              const chainColKey = optionChildBooleanChildColumnKey(
                parent.key,
                info.rawOptValue,
                bucket.childIndex,
                branch,
                bcIdx,
              );
              const bcOptions: ImportFieldOption[] = Array.isArray(bc?.options)
                ? bc!.options!
                    .map((o) => ({
                      label: typeof o.label === "string" ? o.label : undefined,
                      value: typeof o.value === "string" ? o.value : undefined,
                    }))
                    .filter((o) => Boolean(o.value))
                : [];
              out.push({
                key: chainColKey,
                fullKey: `${pkgKey}__${chainColKey}`,
                pkg: pkgKey,
                label: `${parent.label}.${bucket.label}.${bcLabel} (when ${info.optHuman} / ${branch === "true" ? "yes" : "no"})`,
                inputType: bcType,
                required: false,
                options: bcOptions,
                isCategory: false,
                unsupported: false,
                categories: parent.categories,
                virtual: {
                  kind: "option_child_boolean_child",
                  pkg: pkgKey,
                  parentKey: parent.key,
                  parentLabel: parent.label,
                  optionValue: info.rawOptValue,
                  optionLabel: info.optHuman,
                  ocChildIndex: bucket.childIndex,
                  ocLabel: bucket.label,
                  branch,
                  bcChildIndex: bcIdx,
                },
                effectiveOrder: order++,
                // Keep ids stable & distinct from other virtuals on the same parent:
                // outer parent * big + childIdx * 1k + branch flag * 100 + bcIdx + 1
                dbId:
                  parent.dbId * 1_000_000 +
                  bucket.childIndex * 1000 +
                  (branch === "true" ? 100 : 200) +
                  bcIdx +
                  1,
              });
            });
          }
        }
      }
    }
  }

  return { fields: out, nextOrder: order };
}

/**
 * Expands a `repeatable` parent into N "slot" columns × M sub-fields.
 *
 *   N = clamp(config.max || DEFAULT_REPEAT_SLOTS, 1, MAX_REPEAT_SLOTS)
 *
 * Each cell is a `repeatable_slot` virtual; the validator enforces slot
 * ordering (no holes) and `min`, and the payload step groups them back into
 * the wizard's array shape.
 *
 * If the repeatable has zero importable sub-fields, returns an empty list and
 * `unsupportedReason` so the caller can mark the parent as unsupported.
 */
function expandRepeatable(
  pkgKey: string,
  parent: ImportFieldDef,
  meta: ImportFieldMeta,
  startOrder: number,
): { fields: ImportFieldDef[]; nextOrder: number; unsupportedReason?: string } {
  const out: ImportFieldDef[] = [];
  let order = startOrder;

  const cfg = getRepeatableConfig(meta);
  if (!cfg) return { fields: out, nextOrder: order, unsupportedReason: "Repeatable config missing" };

  const subFields = Array.isArray(cfg.fields) ? cfg.fields : [];

  // Drop sub-fields that are themselves nested-repeatable / sub-fielded /
  // computed — we can't safely flatten those into Excel cells.
  const importableSubs = subFields.filter((sf) => {
    if (!sf || typeof sf !== "object") return false;
    if (typeof sf.value !== "string" || !sf.value.trim()) return false;
    const itype = String(sf.inputType ?? "string");
    if (COMPUTED_INPUT_TYPES.has(itype)) return false;
    if ((sf as Record<string, unknown>).repeatable) return false;
    const innerSubs = (sf as Record<string, unknown>).subFields;
    if (Array.isArray(innerSubs) && innerSubs.length > 0) return false;
    return true;
  });

  if (importableSubs.length === 0) {
    return { fields: out, nextOrder: order, unsupportedReason: "Repeatable has no importable sub-fields" };
  }

  const rawMin = Number.isFinite(Number(cfg.min)) ? Number(cfg.min) : 0;
  const rawMax = Number.isFinite(Number(cfg.max)) ? Number(cfg.max) : 0;
  const minSlots = Math.max(0, rawMin);
  const slotsTotal = Math.min(
    MAX_REPEAT_SLOTS,
    Math.max(1, rawMax > 0 ? rawMax : DEFAULT_REPEAT_SLOTS, minSlots),
  );
  const itemLabel = String(cfg.itemLabel ?? "Item").trim() || "Item";

  for (let slot = 0; slot < slotsTotal; slot++) {
    importableSubs.forEach((sf, subIdx) => {
      const subKey = String(sf.value).trim();
      const subLabel = (sf.label ?? subKey).trim();
      const subType = String(sf.inputType ?? "string");
      const subOptions: ImportFieldOption[] = Array.isArray(sf.options)
        ? sf.options
            .map((o) => ({
              label: typeof o.label === "string" ? o.label : undefined,
              value: typeof o.value === "string" ? o.value : undefined,
            }))
            .filter((o) => Boolean(o.value))
        : [];
      const subRequired = sf.required === true;

      const colKey = repeatableSlotColumnKey(parent.key, slot + 1, subKey);
      out.push({
        key: colKey,
        fullKey: `${pkgKey}__${colKey}`,
        pkg: pkgKey,
        label: `${parent.label} #${slot + 1} ${subLabel}`,
        inputType: subType,
        // Required-ness is enforced by the validator's slot-aware logic, never
        // by the plain "required" check, so we leave this false here.
        required: false,
        options: subOptions,
        isCategory: false,
        unsupported: false,
        categories: parent.categories,
        virtual: {
          kind: "repeatable_slot",
          pkg: pkgKey,
          parentKey: parent.key,
          parentLabel: parent.label,
          slotIndex: slot,
          slotsTotal,
          itemLabel,
          subKey,
          subLabel,
          subInputType: subType,
          subOptions,
          subRequired,
          minSlots,
          maxSlots: rawMax,
        },
        effectiveOrder: order++,
        // Stable synthetic id: parent * big + slot * 100 + subIdx
        dbId: parent.dbId * 1_000_000 + slot * 1000 + subIdx + 1,
      });
    });
  }

  return { fields: out, nextOrder: order };
}

/**
 * Expands a `repeatable` configured INSIDE a top-level boolean's branch into
 * slot × sub-field virtual cells (`boolean_child_repeatable_slot`).
 *
 * Mirrors `expandRepeatable` for the slot count + sub-field selection rules
 * so behaviour stays consistent (default 3 slots, hard cap MAX_REPEAT_SLOTS,
 * skip nested-repeatable / sub-fielded / computed sub-fields).
 *
 * If the nested repeatable produces zero importable sub-fields, returns an
 * empty list — caller silently skips it.
 */
function expandBooleanChildRepeatable(
  pkgKey: string,
  parent: ImportFieldDef,
  branch: "true" | "false",
  bcIndex: number,
  child: BooleanChildMeta,
  startOrder: number,
): { fields: ImportFieldDef[]; nextOrder: number } {
  const out: ImportFieldDef[] = [];
  let order = startOrder;

  // Reuse the same RepeatableConfig parser by wrapping the meta-shaped child
  // in an `ImportFieldMeta`-like view (we only care about `.repeatable` here).
  const cfg = getRepeatableConfig({ repeatable: child.repeatable } as ImportFieldMeta);
  if (!cfg) return { fields: out, nextOrder: order };

  const subFields = Array.isArray(cfg.fields) ? cfg.fields : [];
  const importableSubs = subFields.filter((sf) => {
    if (!sf || typeof sf !== "object") return false;
    if (typeof sf.value !== "string" || !sf.value.trim()) return false;
    const itype = String(sf.inputType ?? "string");
    if (COMPUTED_INPUT_TYPES.has(itype)) return false;
    if ((sf as Record<string, unknown>).repeatable) return false; // no double-nesting
    const innerSubs = (sf as Record<string, unknown>).subFields;
    if (Array.isArray(innerSubs) && innerSubs.length > 0) return false;
    return true;
  });

  if (importableSubs.length === 0) return { fields: out, nextOrder: order };

  const rawMin = Number.isFinite(Number(cfg.min)) ? Number(cfg.min) : 0;
  const rawMax = Number.isFinite(Number(cfg.max)) ? Number(cfg.max) : 0;
  const minSlots = Math.max(0, rawMin);
  const slotsTotal = Math.min(
    MAX_REPEAT_SLOTS,
    Math.max(1, rawMax > 0 ? rawMax : DEFAULT_REPEAT_SLOTS, minSlots),
  );
  const itemLabel = String(cfg.itemLabel ?? "Item").trim() || "Item";
  const bcLabel = (child.label ?? `Item ${bcIndex + 1}`).trim();
  const branchWord = branch === "true" ? "yes" : "no";

  for (let slot = 0; slot < slotsTotal; slot++) {
    importableSubs.forEach((sf, subIdx) => {
      const subKey = String(sf.value).trim();
      const subLabel = (sf.label ?? subKey).trim();
      const subType = String(sf.inputType ?? "string");
      const subOptions: ImportFieldOption[] = Array.isArray(sf.options)
        ? sf.options
            .map((o) => ({
              label: typeof o.label === "string" ? o.label : undefined,
              value: typeof o.value === "string" ? o.value : undefined,
            }))
            .filter((o) => Boolean(o.value))
        : [];
      const subRequired = sf.required === true;

      const colKey = booleanChildRepeatableSlotColumnKey(parent.key, branch, bcIndex, slot + 1, subKey);
      out.push({
        key: colKey,
        fullKey: `${pkgKey}__${colKey}`,
        pkg: pkgKey,
        label: `${parent.label}.${bcLabel} #${slot + 1} ${subLabel} (${branchWord})`,
        inputType: subType,
        // Slot-aware required handling lives in the validator; never auto-required.
        required: false,
        options: subOptions,
        isCategory: false,
        unsupported: false,
        // Conditional cells share the parent's category visibility
        categories: parent.categories,
        virtual: {
          kind: "boolean_child_repeatable_slot",
          pkg: pkgKey,
          parentKey: parent.key,
          parentLabel: parent.label,
          branch,
          bcChildIndex: bcIndex,
          bcLabel,
          slotIndex: slot,
          slotsTotal,
          itemLabel,
          subKey,
          subLabel,
          subInputType: subType,
          subOptions,
          subRequired,
          minSlots,
          maxSlots: rawMax,
        },
        effectiveOrder: order++,
        // Synthetic stable id: parent * big + branch flag + bcIdx*10k + slot*1k + subIdx
        dbId:
          parent.dbId * 10_000_000 +
          (branch === "true" ? 1_000_000 : 5_000_000) +
          bcIndex * 10_000 +
          slot * 1000 +
          subIdx +
          1,
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

      // NEW: Repeatable nested inside a boolean's branch (e.g. "Add more
      // drivers? yes → list of drivers"). Expand into slot × sub-field cells
      // so admins can capture multi-driver / multi-item data via Excel.
      const childRepeatable = (child as { repeatable?: unknown })?.repeatable;
      if (childRepeatable) {
        const sub = expandBooleanChildRepeatable(pkgKey, parent, branch, idx, child, order);
        if (sub.fields.length > 0) {
          out.push(...sub.fields);
          order = sub.nextOrder;
        }
        // If the nested repeatable produced zero importable cells (e.g. all
        // sub-fields are themselves nested-repeatable), we silently skip it.
        // The instructions sheet still mentions the parent boolean.
        return;
      }

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
    // Drop pure-presentational fields (heading/divider/info/spacer) entirely —
    // they have no value to import, evaluate, or gate. Formula fields fall
    // through (excluded only from the template via the `unsupported` flag),
    // because the payload builder needs them to compute end-date / issue-date.
    if (PRESENTATIONAL_INPUT_TYPES.has(inputType)) continue;
    if (meta.hidden === true) continue;
    const fieldKey = String(r.value ?? "").trim();
    if (!fieldKey) continue;

    const isFormula = inputType === "formula";
    const isMirror = inputType === "mirror";
    const { unsupported: unsupportedRaw, reason: reasonRaw } = isUnsupportedField(meta);
    // Mark formulas / mirrors as unsupported so the template generator
    // skips them (excel.ts filters on `f.unsupported`), but still expose
    // them in the schema so the payload builder can resolve / compute
    // their values.
    const unsupported = isFormula || isMirror ? true : unsupportedRaw;
    const reason = isFormula
      ? "Computed automatically by formula"
      : isMirror
        ? "Mirrors another field automatically"
        : reasonRaw;
    const entityPicker = extractEntityPicker(meta, inputType);
    const categories = Array.isArray(meta.categories)
      ? meta.categories.filter((c): c is string => typeof c === "string" && c.length > 0)
      : [];

    // Normalise show/groupShowWhen meta into arrays for ergonomic consumers.
    // The wizard accepts both single-rule and array forms — we mirror that.
    const showWhen = normaliseShowWhen(meta.showWhen);
    const groupLabel = typeof meta.group === "string"
      ? meta.group
      : Array.isArray(meta.group)
        ? meta.group.find((g): g is string => typeof g === "string") ?? undefined
        : undefined;
    // groupShowWhenMap takes precedence (matches PackageBlock.tsx's gsw resolver).
    // Use a ternary instead of `groupLabel && ...` so an empty-string groupLabel
    // doesn't leak through the `??` chain (empty string is falsy but not nullish,
    // which would widen the result type to include "" — see TS build #1438).
    const rawGsw =
      (groupLabel ? meta.groupShowWhenMap?.[groupLabel] : undefined)
      ?? meta.groupShowWhen
      ?? null;
    const groupShowWhen = normaliseGroupShowWhen(rawGsw);
    const groupShowWhenLogic: "and" | "or" =
      (groupLabel ? meta.groupShowWhenLogicMap?.[groupLabel] : undefined)
      ?? meta.groupShowWhenLogic
      ?? "and";

    const isRepeatable = inputType === "repeatable" || Boolean(meta.repeatable);

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
      formula: isFormula && typeof meta.formula === "string" ? meta.formula : undefined,
      mirrorSource:
        isMirror && meta.mirrorSource && typeof (meta.mirrorSource as { package?: unknown }).package === "string" && typeof (meta.mirrorSource as { field?: unknown }).field === "string"
          ? {
              package: String((meta.mirrorSource as { package: string }).package),
              field: String((meta.mirrorSource as { field: string }).field),
            }
          : undefined,
      group: groupLabel,
      showWhen,
      groupShowWhen,
      groupShowWhenLogic,
    };

    // Repeatables: expand into slot columns INSTEAD of emitting the parent.
    // The parent has no single Excel cell — its value is an array.
    if (isRepeatable && !unsupported) {
      const { fields: slots, nextOrder, unsupportedReason: rr } = expandRepeatable(pkgKey, parent, meta, positional);
      if (slots.length === 0) {
        // No importable sub-fields — surface as an unsupported parent so the
        // instructions sheet still mentions it.
        out.push({ ...parent, unsupported: true, unsupportedReason: rr ?? "Repeatable has no importable sub-fields" });
        continue;
      }
      out.push(...slots);
      positional = nextOrder;
      continue;
    }

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
