/**
 * Converts a validated import row into the JSON payload that
 * POST /api/policies accepts (same shape the wizard uses).
 *
 * Pure function — no DB / no side effects. Keeps the import feature
 * decoupled from the existing policy-create route.
 */
import type { ValidatedRow } from "./validate";
import type { ImportFlowSchema } from "./schema";
import { booleanChildWizardKey, optionChildWizardKey } from "./schema";
import { fieldColumnId } from "./excel";

export type ImportPolicyPayload = {
  flowKey: string;
  insured: Record<string, unknown>;
  packages: Record<string, { category?: string; values: Record<string, unknown> }>;
  policy?: { agentId?: number };
};

/**
 * A reference an import row makes to an entity in another flow.
 * The commit step resolves these via lib/import/entity-resolver.ts.
 */
export type EntityReference = {
  /** Where the value sits in the payload — either insured or a package */
  scope: "insured" | "package";
  /** The package key when scope === "package" */
  pkg?: string;
  /** The original column id (e.g. "policyinfo.insSection") */
  columnId: string;
  /** The full RHF-style field key (e.g. "policyinfo__insSection") */
  fullKey: string;
  /** The flow whose record we need to look up. "__agent__" for users. */
  refFlow: string;
  /** The user-supplied reference value (record number / userNumber) */
  refValue: string;
  /** Mappings to apply: copy `sourceField` from the snapshot → set `targetField` here */
  mappings: Array<{ sourceField: string; targetField: string }>;
};

/**
 * Build the wizard-style payload:
 *   - insured snapshot is collected from `insured__*` and `contactinfo__*` keys
 *   - packages are nested as { [pkg]: { category, values: { [pkg__field]: v } } }
 *
 * The `clientNumber` column under the insured package, if present, is stripped
 * from the snapshot and surfaced as `clientNumber` so the commit step can
 * resolve / auto-create the corresponding client record.
 */
export function buildPolicyPayload(
  row: ValidatedRow,
  schema: ImportFlowSchema,
): {
  payload: ImportPolicyPayload;
  clientNumber?: string;
  agentNumber?: string;
  entityRefs: EntityReference[];
} {
  const flowKey = schema.flowKey;
  const insured: Record<string, unknown> = {};
  const packages: Record<string, { category?: string; values: Record<string, unknown> }> = {};
  const entityRefs: EntityReference[] = [];

  let clientNumber: string | undefined;
  let agentNumber: string | undefined;

  for (const pkg of schema.packages) {
    let category: string | undefined;
    const pkgValues: Record<string, unknown> = {};

    for (const field of pkg.fields) {
      const id = fieldColumnId(field);
      const v = row.values[id];
      if (v === undefined || v === null || v === "") continue;

      // Category selector (real or synthesised) — sets the package's category.
      // Also mirror the insured category onto the insured snapshot so the
      // existing auto-create-client logic (which reads insured.category /
      // insuredType) keeps working.
      if (field.isCategory || field.virtual?.kind === "category") {
        category = String(v);
        if (pkg.key === "insured") {
          insured.category = category;
          insured.insured__category = category;
        }
        continue;
      }

      // Boolean-child virtual columns map to the wizard's RHF key shape:
      //   <pkg>__<parent>__<true|false>__bc<idx>
      if (field.virtual?.kind === "boolean_child") {
        const wizardKey = booleanChildWizardKey(
          pkg.key,
          field.virtual.parentKey,
          field.virtual.branch,
          field.virtual.childIndex,
        );
        pkgValues[wizardKey] = v;
        if (pkg.key === "insured" || pkg.key === "contactinfo") {
          insured[wizardKey] = v;
        }
        continue;
      }

      // Option-child virtual columns map to the wizard's RHF key shape:
      //   <pkg>__<parent>__opt_<value>__sc<idx>
      if (field.virtual?.kind === "option_child") {
        const wizardKey = optionChildWizardKey(
          pkg.key,
          field.virtual.parentKey,
          field.virtual.optionValue,
          field.virtual.childIndex,
        );
        pkgValues[wizardKey] = v;
        if (pkg.key === "insured" || pkg.key === "contactinfo") {
          insured[wizardKey] = v;
        }
        continue;
      }

      // Special pseudo-columns: not part of the policy snapshot
      if (pkg.key === "insured" && field.key === "clientNumber") {
        clientNumber = String(v).trim();
        continue;
      }
      if (pkg.key === "policy" && field.key === "agentNumber") {
        agentNumber = String(v).trim();
        continue;
      }

      const fullKey = field.fullKey; // e.g. "insured__firstName"

      // Entity / agent picker: store raw value AND record a resolution request.
      // The commit step will swap the raw value for the resolved data and
      // populate any mapped target fields.
      if (field.entityPicker) {
        const refValue = String(v).trim();
        if (field.entityPicker.flow === "__agent__") {
          // Agent picker maps onto policy.agentId — surface as agentNumber.
          if (!agentNumber) agentNumber = refValue;
          continue; // don't pollute snapshot with the raw user-number
        }
        const inInsuredScope = pkg.key === "insured" || pkg.key === "contactinfo";
        entityRefs.push({
          scope: inInsuredScope ? "insured" : "package",
          pkg: inInsuredScope ? undefined : pkg.key,
          columnId: id,
          fullKey,
          refFlow: field.entityPicker.flow,
          refValue,
          mappings: field.entityPicker.mappings ?? [],
        });
        // Hold the raw reference in the snapshot for now; resolver overwrites it.
        if (inInsuredScope) insured[fullKey] = refValue;
        pkgValues[fullKey] = refValue;
        continue;
      }

      if (pkg.key === "insured" || pkg.key === "contactinfo") {
        insured[fullKey] = v;
      }

      pkgValues[fullKey] = v;
    }

    if (Object.keys(pkgValues).length > 0 || category) {
      packages[pkg.key] = { category, values: pkgValues };
    }
  }

  // Mirror wizard behaviour: lift insured category onto a top-level key
  const resolvedType =
    insured["insured__category"] ?? insured["insured_category"];
  if (resolvedType) insured.insuredType = resolvedType;

  const payload: ImportPolicyPayload = {
    flowKey,
    insured,
    packages,
  };

  return { payload, clientNumber, agentNumber, entityRefs };
}
