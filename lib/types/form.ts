export type InputType =
  | "string"
  | "number"
  | "currency"
  | "negative_currency"
  | "percent"
  | "date"
  | "select"
  | "multi_select"
  | "boolean"
  | "repeatable"
  | "formula"
  | "mirror"
  | "list"
  | "agent_picker";

/**
 * Configuration for `inputType: "mirror"` — a dead-simple "this field
 * equals another field" passthrough. NO math, NO formula parsing, NO
 * conditional logic. The field always renders read-only and its value
 * is always the live value of `${package}__${field}` (with the usual
 * case / separator tolerances).
 *
 * Use this INSTEAD of `inputType: "formula"` with a single-placeholder
 * formula like `{insured_idNumber}` — the formula path inherits all
 * the arithmetic-mode footguns (preserve-on-edit semantics, dedup
 * guards, case-sensitive resolution) which broke mirror behaviour in
 * confusing ways. See `.cursor/skills/wizard-formula-fields/SKILL.md`.
 */
export type MirrorSource = {
  /** Source package key, e.g. `"insured"`. Lowercase, matches `form_options.group_key` prefix. */
  package: string;
  /** Source field key (matches `form_options.value` in `${package}_fields`). */
  field: string;
};

export type SelectOption = { label?: string; value?: string; scrollToPackage?: string; scrollToGroup?: string; scrollToField?: string };

export type BooleanBranchChild = {
  label?: string;
  inputType?: string;
  options?: SelectOption[];
  currencyCode?: string;
  decimals?: number;
};

export type ShowWhenRule = {
  package: string;
  category: string | string[];
  field?: string;
  fieldValues?: string[];
  childKey?: string;
  childValues?: string[];
  /** Optional: when true without cross-package deps, hide until `_agentId` is set (advanced / JSON). Prefer `meta.requiresAgent` on the field. */
  requiresAgent?: boolean;
};

export type SelectChild = {
  label?: string;
  inputType?: string;
  options?: SelectOption[];
  currencyCode?: string;
  decimals?: number;
  booleanLabels?: { true?: string; false?: string };
  booleanDisplay?: "radio" | "dropdown";
  booleanChildren?: { true?: BooleanBranchChild[]; false?: BooleanBranchChild[] };
  showWhen?: ShowWhenRule[];
  showWhenLogic?: "and" | "or";
};

export type RepeatableFieldConfig = {
  label?: string;
  value?: string;
  inputType?: string;
  options?: SelectOption[];
};

export type RepeatableConfig = {
  itemLabel?: string;
  min?: number;
  max?: number;
  fields?: RepeatableFieldConfig[];
};
