/**
 * Shared types for the table-view-preset feature.
 *
 * Every dashboard table (Policies, Users, Agents, Insurers, Endorsements, ...)
 * uses the same persistence model and dialog UI to manage saved column views.
 * The contract is intentionally minimal so callers can layer their own
 * domain-specific column shape on top of `columns: string[]`.
 *
 * Persistence:
 *   - Server-of-record: app_settings row keyed by `view_presets:user:<id>:<scope>`
 *     (see `app/api/view-presets/route.ts`).
 *   - localStorage fallback when the API is unreachable.
 *
 * See `.cursor/skills/table-view-presets/SKILL.md`.
 */

/** Single saved view definition. `columns` is opaque to the helpers — the
 *  caller decides what each string means (e.g. `_builtin.policyNumber`,
 *  `insured.firstname`, or a static `ColumnKey` enum value). */
export type ViewPreset = {
  id: string;
  name: string;
  columns: string[];
  isDefault: boolean;
  /** Optional — only some tables let users sort per preset. */
  sortKey?: string;
  /** Optional — pairs with sortKey when present. */
  sortDir?: "asc" | "desc";
};

/** Available column option for the editor dialog. */
export type ViewPresetColumnOption = {
  /** Unique opaque path stored on the preset row. */
  path: string;
  label: string;
  /** Optional override for selected-column display label (rare). */
  selectedLabel?: string;
};

/** Group of available columns shown in the editor dialog. Tables with no
 *  meaningful grouping pass a single group. */
export type ViewPresetColumnGroup = {
  groupKey: string;
  groupLabel: string;
  options: ViewPresetColumnOption[];
};

/** Maximum saved views per user per scope. Mirrors the API constraint. */
export const VIEW_PRESETS_MAX = 5;
