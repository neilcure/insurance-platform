/**
 * Applies the wizard's `showWhen` / `groupShowWhen` rules to an import payload.
 *
 * The wizard's <PackageBlock /> hides fields whose `showWhen` rule fails and
 * entire groups whose `groupShowWhen` rule fails — so when a policy is created
 * via the UI those values never reach the snapshot. Bulk import doesn't run
 * the wizard, so without this module a row with values for hidden fields
 * (e.g. a TPO policy with Section I excess values filled in) would write
 * those values to the snapshot and the policy detail page would surface them.
 *
 * This module mirrors the wizard's evaluator (PackageBlock.tsx, `evaluateShowWhen`
 * + the gsw resolver around line 1418) so the resulting snapshot looks identical
 * whether the user clicked through the wizard or bulk-imported a row.
 */
import type {
  ImportFlowSchema,
  ImportFieldDef,
  ShowWhenRule,
  GroupShowWhenRule,
} from "./schema";
import type { ImportPolicyPayload } from "./payload";
import { fieldColumnId } from "./excel";

/**
 * One field that was stripped because its visibility gate failed.
 * Surfaced to the user as a row note so they know their input wasn't lost
 * silently — it was correctly ignored as not-applicable.
 */
export type GatedFieldNote = {
  pkg: string;
  fieldKey: string;
  fieldLabel: string;
  /** "field" = per-field showWhen failed; "group" = group-level groupShowWhen */
  reason: "field" | "group";
  /** Human-readable summary, e.g. "only applies when coverType ∈ [tpo, comp] AND coverType→Own Damage = true" */
  detail: string;
};

/**
 * Build a flat lookup of every value the row holds, keyed by both the wizard
 * RHF key and the package-prefixed key. The evaluators look up values by
 * `${pkg}__${field}`, so we mirror PackageBlock's `allFormValues` shape.
 */
function flattenPayloadValues(payload: ImportPolicyPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload.insured)) out[k] = v;
  for (const [pkgKey, pkg] of Object.entries(payload.packages)) {
    // Mirror category onto `<pkg>__category` so showWhen rules can read it.
    if (pkg.category) out[`${pkgKey}__category`] = pkg.category;
    for (const [k, v] of Object.entries(pkg.values)) out[k] = v;
  }
  return out;
}

/**
 * Mirrors PackageBlock.tsx::evaluateShowWhen. Field is shown only when
 * EVERY rule passes (logical AND).
 */
function evaluateShowWhen(rules: ShowWhenRule[], values: Record<string, unknown>): boolean {
  for (const rule of rules) {
    const otherPkg = rule.package?.trim();
    if (!otherPkg) continue;

    if (rule.category) {
      const otherCat = String(values[`${otherPkg}__category`] ?? "").trim().toLowerCase();
      const allowed = (Array.isArray(rule.category) ? rule.category : [rule.category])
        .map((c) => String(c ?? "").trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(otherCat)) return false;
    }

    if (rule.field) {
      const fv = String(values[`${otherPkg}__${rule.field}`] ?? "").trim().toLowerCase();
      const allowedVals = (rule.fieldValues ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
      if (allowedVals.length > 0 && !allowedVals.includes(fv)) return false;
    }

    if (rule.childKey && rule.field) {
      const parentVal = String(values[`${otherPkg}__${rule.field}`] ?? "").trim();
      const idxMatch = rule.childKey.match(/[cs]c?(\d+)$/);
      if (idxMatch && parentVal) {
        const childFormKey = `${otherPkg}__${rule.field}__opt_${parentVal}__c${idxMatch[1]}`;
        const cv = String(values[childFormKey] ?? "").trim().toLowerCase();
        const allowedChildVals = (rule.childValues ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
        if (allowedChildVals.length > 0 && !allowedChildVals.includes(cv)) return false;
      } else if (!parentVal) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Mirrors the gsw resolver in PackageBlock.tsx (around line 1418). Note the
 * rule shape uses `field` + `values` (NOT `fieldValues`) — that's the wizard's
 * convention for groupShowWhen and we follow it byte-for-byte.
 *
 * `pkg` is the field's owner package — used as the default rule.package when
 * the rule doesn't specify one.
 */
function evaluateOneGroupRule(
  pkg: string,
  rule: GroupShowWhenRule,
  values: Record<string, unknown>,
): boolean {
  if (!rule.field) return true; // empty/incomplete rule never gates
  const rulePkg = rule.package || pkg;
  const fieldVal = String(values[`${rulePkg}__${rule.field}`] ?? "").trim().toLowerCase();
  const allowed = (rule.values ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(fieldVal)) return false;

  if (rule.childKey) {
    // Wizard skips the child check when the parent's value isn't the option
    // that owns this child (so e.g. a TPO-scoped child rule won't gate a
    // comprehensive policy). We mirror that behaviour exactly.
    const optMatch = rule.childKey.match(/__opt_([^_]+)__c\d+$/);
    const childOwnerOpt = optMatch ? optMatch[1].toLowerCase() : "";
    if (!childOwnerOpt || fieldVal === childOwnerOpt) {
      const childVal = String(values[`${rulePkg}__${rule.childKey}`] ?? "").trim().toLowerCase();
      const childAllowed = (rule.childValues ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);
      if (childAllowed.length > 0 && !childAllowed.includes(childVal)) return false;
    }
  }
  return true;
}

function evaluateGroupShowWhen(
  pkg: string,
  rules: GroupShowWhenRule[],
  logic: "and" | "or",
  values: Record<string, unknown>,
): boolean {
  if (rules.length === 0 || !rules[0]?.field) return true;
  return logic === "or"
    ? rules.some((r) => evaluateOneGroupRule(pkg, r, values))
    : rules.every((r) => evaluateOneGroupRule(pkg, r, values));
}

/**
 * Format a rule list as "field val ∈ [a,b] AND child = [true]" for row notes.
 * Keep it short — this appears in the import review UI alongside the dropped
 * value so the user understands WHY their input was discarded.
 */
function describeShowWhen(rules: ShowWhenRule[]): string {
  return rules
    .map((r) => {
      const parts: string[] = [];
      if (r.category) {
        const cats = Array.isArray(r.category) ? r.category : [r.category];
        parts.push(`${r.package}.category ∈ [${cats.join(", ")}]`);
      }
      if (r.field) parts.push(`${r.package}.${r.field} ∈ [${(r.fieldValues ?? []).join(", ")}]`);
      if (r.childKey) parts.push(`${r.package}.${r.childKey} ∈ [${(r.childValues ?? []).join(", ")}]`);
      return parts.join(" AND ");
    })
    .join(" AND ");
}

function describeGroupShowWhen(rules: GroupShowWhenRule[], logic: "and" | "or", pkg: string): string {
  return rules
    .map((r) => {
      const parts: string[] = [];
      const p = r.package || pkg;
      if (r.field) parts.push(`${p}.${r.field} ∈ [${(r.values ?? []).join(", ")}]`);
      if (r.childKey) parts.push(`${p}.${r.childKey} ∈ [${(r.childValues ?? []).join(", ")}]`);
      return parts.join(" AND ");
    })
    .join(logic === "or" ? " OR " : " AND ");
}

/**
 * Mutates `payload` in place: drops every value whose visibility gate fails.
 * Returns a list of notes so the commit step can surface them to the user
 * (e.g. "5 fields dropped: only applied when coverType is comprehensive").
 *
 * Important: we look up real-field values by their `fullKey` (e.g.
 * `policyinfo__odexcess`). Virtual columns (option-children, repeatable
 * slots, etc.) live under different keys and the wizard already encodes
 * conditional gating into THEIR keys (an option-child only exists when its
 * parent option is chosen), so they don't need this pass.
 */
export function applyConditionalGating(
  payload: ImportPolicyPayload,
  schema: ImportFlowSchema,
): GatedFieldNote[] {
  const flat = flattenPayloadValues(payload);
  const notes: GatedFieldNote[] = [];

  // First, group fields by (pkg, group) so we evaluate each group's gate
  // once instead of per-field. Mirrors how the wizard renders groups.
  type GroupBucket = {
    pkg: string;
    label: string;
    rules: GroupShowWhenRule[];
    logic: "and" | "or";
    fields: ImportFieldDef[];
  };
  const groupBuckets = new Map<string, GroupBucket>();

  for (const pkg of schema.packages) {
    for (const f of pkg.fields) {
      // Skip virtual columns and unsupported fields — they're either gated
      // structurally (option-children) or not in the payload at all.
      if (f.virtual || f.unsupported) continue;
      if (!f.groupShowWhen || f.groupShowWhen.length === 0) continue;
      const groupLabel = f.group ?? "(default)";
      const k = `${pkg.key}::${groupLabel}`;
      let b = groupBuckets.get(k);
      if (!b) {
        b = {
          pkg: pkg.key,
          label: groupLabel,
          rules: f.groupShowWhen,
          logic: f.groupShowWhenLogic ?? "and",
          fields: [],
        };
        groupBuckets.set(k, b);
      }
      b.fields.push(f);
    }
  }

  const droppedKeys = new Set<string>();

  // Drop entire groups whose gate fails.
  for (const bucket of groupBuckets.values()) {
    if (evaluateGroupShowWhen(bucket.pkg, bucket.rules, bucket.logic, flat)) continue;
    const detail = describeGroupShowWhen(bucket.rules, bucket.logic, bucket.pkg);
    for (const f of bucket.fields) {
      if (dropPayloadValue(payload, f)) {
        droppedKeys.add(f.fullKey);
        notes.push({
          pkg: bucket.pkg,
          fieldKey: f.key,
          fieldLabel: f.label,
          reason: "group",
          detail: `Group "${bucket.label}" hidden: ${detail}`,
        });
      }
    }
  }

  // Drop individual fields whose per-field showWhen fails (skip ones already
  // dropped by group gating).
  for (const pkg of schema.packages) {
    for (const f of pkg.fields) {
      if (f.virtual || f.unsupported) continue;
      if (!f.showWhen || f.showWhen.length === 0) continue;
      if (droppedKeys.has(f.fullKey)) continue;
      if (evaluateShowWhen(f.showWhen, flat)) continue;
      if (dropPayloadValue(payload, f)) {
        notes.push({
          pkg: pkg.key,
          fieldKey: f.key,
          fieldLabel: f.label,
          reason: "field",
          detail: `Hidden: ${describeShowWhen(f.showWhen)}`,
        });
      }
    }
  }

  // Re-export the column id so callers can map notes back to row cells.
  // (Imported via fieldColumnId for parity with validate.ts notes.)
  void fieldColumnId;

  return notes;
}

/**
 * Remove the field's value from the payload. Returns true if a value was
 * actually dropped (so we don't emit a "dropped X" note for empty cells).
 */
function dropPayloadValue(payload: ImportPolicyPayload, field: ImportFieldDef): boolean {
  let dropped = false;
  const inInsuredScope = field.pkg === "insured" || field.pkg === "contactinfo";
  if (inInsuredScope && field.fullKey in payload.insured) {
    delete payload.insured[field.fullKey];
    dropped = true;
  }
  const pkgEntry = payload.packages[field.pkg];
  if (pkgEntry && field.fullKey in pkgEntry.values) {
    delete pkgEntry.values[field.fullKey];
    dropped = true;
  }
  return dropped;
}
