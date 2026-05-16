/**
 * Computes formula-typed fields for an import payload, mirroring the wizard's
 * <FormulaField /> component (PackageBlock.tsx::FormulaField).
 *
 * Why this is needed: the wizard evaluates formulas in the BROWSER and writes
 * the result back into form state via `form.setValue(name, computed)` — so by
 * the time the policy is POSTed, the snapshot already contains the computed
 * value. Bulk import skips the wizard entirely; without this module the
 * snapshot ships with `endDate`/`issueDate`/`agentcommission` empty and the
 * policy detail page hides those rows.
 *
 * Run AFTER conditional gating so we don't compute formulas that depend on
 * gated-out values.
 */
import { evaluateFormula } from "@/lib/formula";
import type { ImportFlowSchema, ImportFieldDef } from "./schema";
import type { ImportPolicyPayload } from "./payload";

export type ComputedFormulaNote = {
  pkg: string;
  fieldKey: string;
  fieldLabel: string;
  formula: string;
  computedValue: string;
};

/**
 * Walk every formula field in the schema, evaluate it against the current
 * payload values, and inject the result under its wizard RHF key.
 *
 * Mutates `payload` in place. Returns notes describing what was computed
 * (useful for review-screen confirmation; otherwise discardable).
 */
export function evaluateFormulaFields(
  payload: ImportPolicyPayload,
  schema: ImportFlowSchema,
): ComputedFormulaNote[] {
  const notes: ComputedFormulaNote[] = [];

  // Build flat values map identical in shape to wizard's RHF state, so
  // evaluateFormula's `resolveFieldValue` (which prefers `<pkg>__<key>` then
  // fuzzy-suffix matches) returns the same thing the wizard would.
  const flat = flattenForFormula(payload);

  for (const pkg of schema.packages) {
    for (const f of pkg.fields) {
      // Resolve effective expression. For `inputType: "mirror"` we
      // synthesise the equivalent single-placeholder formula so the
      // resolver path is identical — this guarantees bulk import
      // produces the same snapshot value that the wizard's
      // <MirrorField /> writes via setValue.
      const effectiveFormula = f.formula
        ? f.formula
        : f.mirrorSource
          ? `{${f.mirrorSource.package}_${f.mirrorSource.field}}`
          : null;
      if (!effectiveFormula) continue;
      const computed = evaluateFormula(effectiveFormula, flat, pkg.key);
      if (!computed) continue; // mirrors wizard: don't write empty results

      // Persist under the wizard's RHF key shape (same as <FormulaField />:
      // `name={fullKey}` => `${pkg}__${field}`).
      writeFormulaResult(payload, f, computed);
      // Mirror into the flat map so downstream formulas can chain
      // (e.g. a hypothetical formula that references endDate).
      flat[f.fullKey] = computed;

      notes.push({
        pkg: pkg.key,
        fieldKey: f.key,
        fieldLabel: f.label,
        formula: effectiveFormula,
        computedValue: computed,
      });
    }
  }

  return notes;
}

/**
 * Build the input map evaluateFormula consumes. Same shape as flattenPayloadValues
 * in conditional-gates.ts (mirror wizard's `form.getValues()`).
 */
function flattenForFormula(payload: ImportPolicyPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload.insured)) out[k] = v;
  for (const [pkgKey, pkg] of Object.entries(payload.packages)) {
    if (pkg.category) out[`${pkgKey}__category`] = pkg.category;
    for (const [k, v] of Object.entries(pkg.values)) out[k] = v;
  }
  return out;
}

function writeFormulaResult(
  payload: ImportPolicyPayload,
  field: ImportFieldDef,
  computed: string,
): void {
  const inInsuredScope = field.pkg === "insured" || field.pkg === "contactinfo";
  // Ensure the package bucket exists — the wizard always emits the package
  // when a formula resolves, even if the user didn't fill in any other field
  // in it. (Otherwise `endDate` would never be saved for a row that only
  // touches `startedDate`.)
  let pkgEntry = payload.packages[field.pkg];
  if (!pkgEntry) {
    pkgEntry = { values: {} };
    payload.packages[field.pkg] = pkgEntry;
  }
  pkgEntry.values[field.fullKey] = computed;
  if (inInsuredScope) payload.insured[field.fullKey] = computed;
}
