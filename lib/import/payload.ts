/**
 * Converts a validated import row into the JSON payload that
 * POST /api/policies accepts (same shape the wizard uses).
 *
 * Pure function — no DB / no side effects. Keeps the import feature
 * decoupled from the existing policy-create route.
 */
import type { ValidatedRow } from "./validate";
import type { ImportFlowSchema } from "./schema";
import {
  booleanChildRepeatableWizardKey,
  booleanChildWizardKey,
  optionChildBooleanChildWizardKey,
  optionChildWizardKey,
  repeatableWizardKey,
} from "./schema";
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
    // Buffer for repeatable slot values: parentKey → slotIndex → { subKey: value }
    const repeatableBuffers = new Map<string, Map<number, Record<string, unknown>>>();
    // Buffer for boolean-child-nested repeatable slots:
    //   `${parentKey}__${branch}__c${bcIdx}` → slotIndex → { subKey: value }
    // Distinct from the plain repeatableBuffers so a top-level repeatable and
    // a boolean-nested one with the same parentKey don't collide.
    const boolRepeatableBuffers = new Map<
      string,
      {
        meta: { parentKey: string; branch: "true" | "false"; bcChildIndex: number };
        slots: Map<number, Record<string, unknown>>;
      }
    >();

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
      //   <pkg>__<parent>__<true|false>__c<idx>
      // (Top-level package booleans use `__c<idx>` — see PackageBlock.tsx.
      // The `__bc<idx>` form is only used by BooleanBranchFields for booleans
      // nested under another component, e.g. option-children.)
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
      //   <pkg>__<parent>__opt_<value>__c<idx>
      // (Top-level select option children use `__c<idx>` — see
      // InlineSelectWithChildren.tsx. The `__sc<idx>` form is only for
      // selects nested inside another component, which our import doesn't
      // emit.)
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

      // Third-level chain (option-child boolean → boolean-child) maps to the
      // wizard's nested RHF key:
      //   <pkg>__<parent>__opt_<value>__c<ocIdx>__<true|false>__bc<bcIdx>
      // The middle link uses `__c<ocIdx>` (InlineSelectWithChildren), then
      // BooleanBranchFields adds `__<branch>__bc<bcIdx>` for the leaf.
      if (field.virtual?.kind === "option_child_boolean_child") {
        const wizardKey = optionChildBooleanChildWizardKey(
          pkg.key,
          field.virtual.parentKey,
          field.virtual.optionValue,
          field.virtual.ocChildIndex,
          field.virtual.branch,
          field.virtual.bcChildIndex,
        );
        pkgValues[wizardKey] = v;
        if (pkg.key === "insured" || pkg.key === "contactinfo") {
          insured[wizardKey] = v;
        }
        continue;
      }

      // Collapsed option-child: dispatch to the SAME wizard key shape as
      // option_child, but using the parent's actual value (looked up from the
      // already-cleaned row values).
      if (field.virtual?.kind === "option_child_collapsed") {
        const v2 = field.virtual;
        const parentField = pkg.fields.find((p) => p.key === v2.parentKey);
        if (!parentField) continue;
        const parentVal = row.values[fieldColumnId(parentField)];
        if (parentVal === undefined || parentVal === null || parentVal === "") continue;
        const wizardKey = optionChildWizardKey(
          pkg.key,
          v2.parentKey,
          String(parentVal),
          v2.childIndex,
        );
        pkgValues[wizardKey] = v;
        if (pkg.key === "insured" || pkg.key === "contactinfo") {
          insured[wizardKey] = v;
        }
        continue;
      }

      // Repeatable slot: buffer per-slot, assemble into an array after the loop.
      if (field.virtual?.kind === "repeatable_slot") {
        const v2 = field.virtual;
        let perParent = repeatableBuffers.get(v2.parentKey);
        if (!perParent) {
          perParent = new Map();
          repeatableBuffers.set(v2.parentKey, perParent);
        }
        const slotObj = perParent.get(v2.slotIndex) ?? {};
        slotObj[v2.subKey] = v;
        perParent.set(v2.slotIndex, slotObj);
        continue;
      }

      // Boolean-child repeatable slot: same shape as plain repeatable, but
      // keyed on (parent, branch, bcChildIndex) so we can place the resulting
      // array under the wizard's `__<branch>__c<bcIdx>` key.
      if (field.virtual?.kind === "boolean_child_repeatable_slot") {
        const v2 = field.virtual;
        const groupKey = `${v2.parentKey}__${v2.branch}__c${v2.bcChildIndex}`;
        let entry = boolRepeatableBuffers.get(groupKey);
        if (!entry) {
          entry = {
            meta: {
              parentKey: v2.parentKey,
              branch: v2.branch,
              bcChildIndex: v2.bcChildIndex,
            },
            slots: new Map(),
          };
          boolRepeatableBuffers.set(groupKey, entry);
        }
        const slotObj = entry.slots.get(v2.slotIndex) ?? {};
        slotObj[v2.subKey] = v;
        entry.slots.set(v2.slotIndex, slotObj);
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

    // Flush any repeatable buffers — wizard storage shape is an array of
    // per-slot objects under `${pkg}__${parentKey}`. We sort by slot index and
    // drop trailing empty slots; the validator already enforced "no holes".
    for (const [parentKey, perParent] of repeatableBuffers) {
      const orderedSlots = [...perParent.entries()].sort((a, b) => a[0] - b[0]);
      const items: Record<string, unknown>[] = [];
      for (const [, obj] of orderedSlots) {
        if (Object.keys(obj).length === 0) continue;
        items.push(obj);
      }
      if (items.length === 0) continue;
      const wizardKey = repeatableWizardKey(pkg.key, parentKey);
      pkgValues[wizardKey] = items;
      if (pkg.key === "insured" || pkg.key === "contactinfo") {
        insured[wizardKey] = items;
      }
    }

    // Flush boolean-child-nested repeatable buffers. Same array shape as a
    // plain repeatable, but stored under the boolean-child wizard key so the
    // wizard's `SubFieldRepeatable name="<pkg>__<parent>__<branch>__c<bcIdx>"`
    // hydrates correctly.
    for (const entry of boolRepeatableBuffers.values()) {
      const orderedSlots = [...entry.slots.entries()].sort((a, b) => a[0] - b[0]);
      const items: Record<string, unknown>[] = [];
      for (const [, obj] of orderedSlots) {
        if (Object.keys(obj).length === 0) continue;
        items.push(obj);
      }
      if (items.length === 0) continue;
      const wizardKey = booleanChildRepeatableWizardKey(
        pkg.key,
        entry.meta.parentKey,
        entry.meta.branch,
        entry.meta.bcChildIndex,
      );
      pkgValues[wizardKey] = items;
      if (pkg.key === "insured" || pkg.key === "contactinfo") {
        insured[wizardKey] = items;
      }
    }

    if (Object.keys(pkgValues).length > 0 || category) {
      packages[pkg.key] = { category, values: pkgValues };
    }
  }

  // Mirror wizard behaviour: lift insured category onto a top-level key
  const resolvedType =
    insured["insured__category"] ?? insured["insured_category"];
  if (resolvedType) insured.insuredType = resolvedType;

  // Driver-package auto-promotion: when the user filled the "Add More
  // Drivers?" repeatable but left the OWNER driver fields empty, treat the
  // first slot as the owner so the resulting snapshot matches a wizard-built
  // policy byte-for-byte. See `promoteSingleDriverToOwner` for full rules.
  // Only runs when the insured is personal-with-DL — for company / no-DL
  // insureds, the "owner-as-driver" concept doesn't apply and the data must
  // stay in the slot so it renders as Driver 1, 2, … in the repeatable.
  promoteSingleDriverToOwner(packages, insured);

  const payload: ImportPolicyPayload = {
    flowKey,
    insured,
    packages,
  };

  return { payload, clientNumber, agentNumber, entityRefs };
}

/**
 * Maps the additional-driver slot sub-keys onto the equivalent OWNER driver
 * field keys. Sourced from the live `driver_fields` form_options rows
 * (slot keys live under `moreDriver.booleanChildren.true[0].repeatable.fields`,
 * owner keys are the top-level driver fields).
 *
 * Only keys present in BOTH sides are listed — owner-only fields like
 * `idNumber` and slot-only fields like `dExperience` have no counterpart
 * and are intentionally excluded.
 */
const DRIVER_SLOT_TO_OWNER_KEY: Record<string, string> = {
  lastName: "lastname",
  firstName: "firstname",
  dob: "ownerBoA",
  dLicense: "ownerDLicence",
  relationship: "relationshiptheOwner",
  occuption: "occuption",
  postion: "ownerPostion",
};

/**
 * If the import row filled the "Add More Drivers?" repeatable as a single
 * entry while leaving every OWNER driver field empty, promote that one entry
 * into the owner fields so the resulting snapshot matches the wizard's
 * common shape (owner = sole driver, `moreDriver = false`).
 *
 * Why this matters:
 *   - The driver package has TWO sets of "Last Name / First Name / DoB / …"
 *     columns in the import template — one for the owner, one for additional
 *     drivers. Users frequently fill the second set when they meant the first
 *     because the labels overlap (the pattern was reported twice).
 *   - The wizard always stores the owner under the top-level keys
 *     (`driver__lastname`, `driver__firstname`, …); having the import use a
 *     different shape made the policy detail screen render the same data
 *     under ugly nested labels.
 *
 * Safety guards (any failed guard short-circuits):
 *   - Insured must be personal AND have ticked "with Driving Licence"
 *     (otherwise the owner-as-driver concept doesn't apply — see below).
 *   - Package must be `driver` and use the standard `moreDriver` boolean key.
 *   - The slot array must have exactly ONE entry (multi-driver imports keep
 *     the original shape — those legitimately ARE multiple drivers).
 *   - Every owner field that has a slot counterpart must currently be empty
 *     (we never overwrite admin-supplied owner data).
 *
 * The personal-with-DL guard is critical: for company insureds (who can't
 * drive) and personal insureds without a DL, the "Driver Details (Owner)"
 * group is hidden in the wizard via groupShowWhenMap. Promoting slot data
 * into owner fields for those policies would orphan the data — it would be
 * stored on the snapshot but invisible in every UI surface. Keeping the
 * data in the slot lets it render as Driver 1, 2, … in the repeatable.
 *
 * Slot-only sub-fields (e.g. `dExperience`, which has no owner counterpart)
 * are dropped silently — they're rare and were almost always entered by
 * accident. If we ever need a corresponding owner field, the mapping table
 * above is the single place to extend.
 */
function promoteSingleDriverToOwner(
  packages: Record<string, { category?: string; values: Record<string, unknown> }>,
  insured: Record<string, unknown>,
): void {
  const driver = packages.driver;
  if (!driver) return;
  const v = driver.values;

  const insuredCat = String(
    insured.insured__category ?? insured.insured_category ?? insured.insuredType ?? "",
  ).trim().toLowerCase();
  const dlRaw =
    insured.insured__theOqnwewithDL ??
    insured.insured_theoqnwewithdl ??
    insured.insured__theoqnwewithdl;
  const hasDL = dlRaw === true || String(dlRaw).trim().toLowerCase() === "true";
  if (insuredCat !== "personal" || !hasDL) return;

  const slotKey = "driver__moreDriver__true__c0";
  const slot = v[slotKey];
  if (!Array.isArray(slot) || slot.length !== 1) return;
  const entry = slot[0] as Record<string, unknown>;
  if (!entry || typeof entry !== "object") return;

  const ownerKeysToFill = Object.values(DRIVER_SLOT_TO_OWNER_KEY).map(
    (k) => `driver__${k}`,
  );
  for (const k of ownerKeysToFill) {
    const cur = v[k];
    if (cur !== undefined && cur !== null && cur !== "") return;
  }

  for (const [slotSubKey, ownerSubKey] of Object.entries(DRIVER_SLOT_TO_OWNER_KEY)) {
    const sv = entry[slotSubKey];
    if (sv === undefined || sv === null || sv === "") continue;
    v[`driver__${ownerSubKey}`] = sv;
  }

  v["driver__moreDriver"] = false;
  delete v[slotKey];
}
