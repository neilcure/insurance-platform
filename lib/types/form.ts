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
  | "list"
  | "agent_picker";

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
