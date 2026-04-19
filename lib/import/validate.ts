/**
 * Validation + normalisation of parsed import rows against a flow schema.
 * Pure functions — no DB access. Returns per-row errors + warnings for UI display.
 *
 * Two-tier severity model (single mode — staging review handles the rest):
 *
 *   • errors   — block commit until fixed or row skipped. Reserved for issues
 *                that would write malformed data to live tables: bad numbers,
 *                bad dates, missing required fields, collapsed-option-child
 *                with no parent value (the dispatch literally cannot run).
 *
 *   • warnings — surfaced in the review UI but DO NOT block commit. Used for
 *                things the admin should look at but that the system can still
 *                process safely: unknown select values (kept as raw strings),
 *                off-category data, conditional-gating violations, malformed
 *                emails, repeatable-slot order/min-slot violations.
 *
 * Rationale: every import goes through the staging review screen anyway, so
 * the admin always has a chance to inspect / fix / bulk-skip rows before
 * committing. Hard errors are reserved for things the commit step physically
 * cannot handle.
 */
import { fieldColumnId } from "./excel";
import type { ParsedImportRow } from "./excel";
import type { ImportFieldDef, ImportFlowSchema } from "./schema";
import { flattenFields } from "./schema";

export type RowError = {
  /** Column id (e.g. "insured.firstName"), or null for row-level errors */
  column: string | null;
  message: string;
};

export type ValidatedRow = {
  excelRow: number;
  /** Cleaned values keyed by column id */
  values: Record<string, unknown>;
  /** Hard errors — block commit until fixed or row skipped */
  errors: RowError[];
  /** Soft warnings — informational only, do NOT block commit */
  warnings: RowError[];
};

const TRUTHY = new Set(["true", "yes", "y", "1"]);
const FALSY = new Set(["false", "no", "n", "0"]);

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = asString(v);
  if (!s) return null;
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    ) {
      return d;
    }
    return null;
  }
  // ISO yyyy-mm-dd or anything Date can parse
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) return iso;
  return null;
}

function formatDateDDMMYYYY(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

type FieldIssue = { message: string; severity: "error" | "warning" };
type FieldValidation = { value: unknown; issue: FieldIssue | null };

function err(message: string): FieldIssue { return { message, severity: "error" }; }
function warn(message: string): FieldIssue { return { message, severity: "warning" }; }

function validateField(field: ImportFieldDef, raw: unknown): FieldValidation {
  const isEmpty =
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");

  // The post-loop "required" check in validateRows is category-aware.
  // Don't double-report Required here for empty cells.
  if (isEmpty) return { value: null, issue: null };

  // Entity-picker / agent-picker: just hold the reference value here. The
  // actual existence check happens at commit time (see entity-resolver.ts).
  if (field.entityPicker) {
    return { value: asString(raw), issue: null };
  }

  // Collapsed option-children: defer validation entirely — we don't know the
  // valid option list until we see the parent's value. The post-loop pass in
  // validateRows handles type + option validation.
  if (field.virtual?.kind === "option_child_collapsed") {
    return { value: asString(raw), issue: null };
  }

  switch (field.inputType) {
    case "number":
    case "currency":
    case "negative_currency": {
      // Bad numbers stay as errors — silently shipping garbage numeric data
      // would corrupt premium / sum-insured calculations.
      const s = asString(raw).replace(/,/g, "");
      const n = Number(s);
      if (!Number.isFinite(n)) return { value: null, issue: err(`Not a number: "${s}"`) };
      return { value: n, issue: null };
    }

    case "boolean":
    case "checkbox": {
      const s = asString(raw).toLowerCase();
      if (TRUTHY.has(s)) return { value: true, issue: null };
      if (FALSY.has(s)) return { value: false, issue: null };
      // Keep raw text + warn — admin can fix in review.
      return { value: asString(raw), issue: warn(`Expected true/false, got "${s}" (kept as-is)`) };
    }

    case "date": {
      // Bad dates stay as errors — corruption risk.
      const d = parseDate(raw);
      if (!d) return { value: null, issue: err(`Invalid date "${asString(raw)}" — use DD/MM/YYYY`) };
      return { value: formatDateDDMMYYYY(d), issue: null };
    }

    case "select":
    case "radio": {
      const s = asString(raw);
      if (field.options.length === 0) return { value: s, issue: null };
      const lower = s.toLowerCase();
      const match = field.options.find(
        (o) => (o.value ?? "").toLowerCase() === lower || (o.label ?? "").toLowerCase() === lower,
      );
      if (!match) {
        const allowed = field.options.map((o) => o.value).join(", ");
        // Keep the user's raw value; the admin can normalise it during review.
        return { value: s, issue: warn(`Unknown value "${s}" — allowed: [${allowed}]`) };
      }
      return { value: match.value, issue: null };
    }

    case "multi_select": {
      const s = asString(raw);
      if (!s) return { value: [], issue: null };
      const parts = s.split(/[,;|]+/).map((p) => p.trim()).filter(Boolean);
      if (field.options.length === 0) return { value: parts, issue: null };
      const matched: string[] = [];
      const bad: string[] = [];
      for (const p of parts) {
        const lo = p.toLowerCase();
        const m = field.options.find(
          (o) => (o.value ?? "").toLowerCase() === lo || (o.label ?? "").toLowerCase() === lo,
        );
        if (m && m.value) matched.push(m.value);
        else bad.push(p);
      }
      if (bad.length > 0) {
        const allowed = field.options.map((o) => o.value).join(", ");
        return {
          value: [...matched, ...bad],
          issue: warn(`Unknown values [${bad.join(", ")}] — allowed: [${allowed}]`),
        };
      }
      return { value: matched, issue: null };
    }

    case "email": {
      const s = asString(raw);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        return { value: s, issue: warn(`Looks like a malformed email "${s}"`) };
      }
      return { value: s, issue: null };
    }

    default:
      return { value: asString(raw), issue: null };
  }
}

export function validateRows(
  rows: ParsedImportRow[],
  schema: ImportFlowSchema,
): ValidatedRow[] {
  const fields = flattenFields(schema);
  const fieldByColumnId = new Map(fields.map((f) => [fieldColumnId(f), f]));

  // Per-package: which packages have a category selector and what their valid options are
  const categorySelectorByPkg = new Map<string, ImportFieldDef>();
  for (const pkg of schema.packages) {
    const selector = pkg.fields.find((f) => f.virtual?.kind === "category");
    if (selector) categorySelectorByPkg.set(pkg.key, selector);
  }

  return rows.map((row) => {
    const errors: RowError[] = [];
    const warnings: RowError[] = [];
    const cleaned: Record<string, unknown> = {};

    /** Add an issue to either errors[] or warnings[] based on its severity. */
    const pushIssue = (column: string | null, issue: FieldIssue): void => {
      const target = issue.severity === "error" ? errors : warnings;
      target.push({ column, message: issue.message });
    };

    for (const [colId, raw] of Object.entries(row.values)) {
      const field = fieldByColumnId.get(colId);
      if (!field) continue;
      const { value, issue } = validateField(field, raw);
      if (issue) pushIssue(colId, issue);
      if (value !== null && value !== undefined && value !== "") {
        cleaned[colId] = value;
      }
    }

    // ---- Resolve each row's selected category per package ----
    const rowCategoryByPkg = new Map<string, string>();
    for (const [pkgKey, selector] of categorySelectorByPkg) {
      const id = fieldColumnId(selector);
      const v = cleaned[id];
      if (typeof v === "string" && v.length > 0) {
        rowCategoryByPkg.set(pkgKey, v.toLowerCase());
      }
    }

    // ---- Off-category data (warning) ----
    // Keep the raw value so the admin can decide what to do (move to the
    // right column, re-classify the row's category, or just accept it).
    for (const f of fields) {
      if (f.categories.length === 0) continue;
      const selectedCat = rowCategoryByPkg.get(f.pkg);
      if (!selectedCat) continue;
      const fieldCats = f.categories.map((c) => c.toLowerCase());
      const id = fieldColumnId(f);
      const hasValue = cleaned[id] !== undefined && cleaned[id] !== "";
      if (!fieldCats.includes(selectedCat) && hasValue) {
        pushIssue(
          id,
          warn(`Off-category data: only applies when ${f.pkg} type is [${f.categories.join(", ")}] (row type "${selectedCat}").`),
        );
      }
    }

    // ---- Boolean-child gating (warning) ----
    for (const f of fields) {
      if (f.virtual?.kind !== "boolean_child") continue;
      const id = fieldColumnId(f);
      const hasValue = cleaned[id] !== undefined && cleaned[id] !== "";
      if (!hasValue) continue;

      const parentField = fields.find(
        (p) => p.pkg === f.virtual!.pkg && p.key === (f.virtual as { parentKey: string }).parentKey,
      );
      if (!parentField) continue;
      const parentVal = cleaned[fieldColumnId(parentField)];
      const expected = f.virtual.branch === "true";
      if (parentVal !== expected) {
        pushIssue(
          id,
          warn(`Only fill this column when "${f.virtual.parentLabel}" is ${f.virtual.branch === "true" ? "yes" : "no"}.`),
        );
      }
    }

    // ---- Option-child gating (warning) ----
    for (const f of fields) {
      if (f.virtual?.kind !== "option_child") continue;
      const id = fieldColumnId(f);
      const hasValue = cleaned[id] !== undefined && cleaned[id] !== "";
      if (!hasValue) continue;

      const parentField = fields.find(
        (p) => p.pkg === f.virtual!.pkg && p.key === (f.virtual as { parentKey: string }).parentKey,
      );
      if (!parentField) continue;
      const parentVal = cleaned[fieldColumnId(parentField)];
      const got = parentVal === undefined || parentVal === null ? "" : String(parentVal).toLowerCase();
      const expected = f.virtual.optionValue.toLowerCase();
      if (got !== expected) {
        pushIssue(
          id,
          warn(`Only fill this column when "${f.virtual.parentLabel}" = "${f.virtual.optionLabel}" (${f.virtual.optionValue}).`),
        );
      }
    }

    // ---- Option-child > Boolean-child gating (warning) ----
    // Three-level chain: outer select must = optionValue AND the option-child
    // boolean must equal the matching branch. Enforced as warnings so admins
    // can rescue rows where the chain was filled out of sync.
    for (const f of fields) {
      if (f.virtual?.kind !== "option_child_boolean_child") continue;
      const id = fieldColumnId(f);
      const hasValue = cleaned[id] !== undefined && cleaned[id] !== "";
      if (!hasValue) continue;

      const v = f.virtual;
      const outerParent = fields.find((p) => p.pkg === v.pkg && p.key === v.parentKey);
      if (!outerParent) continue;
      const outerVal = cleaned[fieldColumnId(outerParent)];
      const outerGot =
        outerVal === undefined || outerVal === null ? "" : String(outerVal).toLowerCase();
      const outerExpected = v.optionValue.toLowerCase();
      if (outerGot !== outerExpected) {
        pushIssue(
          id,
          warn(
            `Only fill this column when "${v.parentLabel}" = "${v.optionLabel}" (${v.optionValue}).`,
          ),
        );
        continue;
      }

      // Find the middle link — the option-child boolean column at ocChildIndex
      // for this parent + optionValue. Match by virtual key shape (the column
      // id is generated from the same helper).
      const middleField = fields.find(
        (p) =>
          p.virtual?.kind === "option_child" &&
          p.virtual.pkg === v.pkg &&
          p.virtual.parentKey === v.parentKey &&
          p.virtual.optionValue === v.optionValue &&
          p.virtual.childIndex === v.ocChildIndex,
      );
      if (!middleField) continue;
      const middleVal = cleaned[fieldColumnId(middleField)];
      const branchExpected = v.branch === "true";
      if (middleVal !== branchExpected) {
        pushIssue(
          id,
          warn(
            `Only fill this column when "${v.ocLabel}" is ${v.branch === "true" ? "yes" : "no"}.`,
          ),
        );
      }
    }

    // ---- Collapsed option-child dispatch ----
    // For columns that collapse the same-shape sub-field across many parent
    // options, look up the parent's chosen value and validate the cell against
    // THAT option's allowed list.
    for (const f of fields) {
      if (f.virtual?.kind !== "option_child_collapsed") continue;
      const id = fieldColumnId(f);
      const raw = cleaned[id];
      const hasValue = raw !== undefined && raw !== null && raw !== "";
      if (!hasValue) continue;

      const v = f.virtual;
      const parentField = fields.find((p) => p.pkg === v.pkg && p.key === v.parentKey);
      if (!parentField) continue;
      const parentVal = cleaned[fieldColumnId(parentField)];
      const parentKeyLower =
        parentVal === undefined || parentVal === null ? "" : String(parentVal).toLowerCase();

      if (!parentKeyLower) {
        // Hard error — the dispatch literally cannot run without the parent.
        pushIssue(id, err(`Cannot fill "${f.label}" without choosing "${v.parentLabel}" first.`));
        continue;
      }

      // The parent value must be one of the options that contributes a child
      // at this index — otherwise no sub-field is revealed by the wizard.
      if (!v.triggeringOptionValues.includes(parentKeyLower)) {
        pushIssue(
          id,
          warn(`"${v.parentLabel}" = "${parentVal}" does not have a "${v.childLabel}" sub-field.`),
        );
        continue;
      }

      // Validate against this specific parent-option's child meta.
      const childMeta = v.perOption[parentKeyLower];
      const childAsField: ImportFieldDef = {
        ...f,
        inputType: v.childInputType,
        options: childMeta?.options ?? [],
        virtual: undefined, // re-validate as a "real" field of that type
      };
      const { value, issue } = validateField(childAsField, raw);
      if (issue) {
        pushIssue(id, issue);
        if (issue.severity === "error") delete cleaned[id];
        else if (value !== null && value !== undefined && value !== "") cleaned[id] = value;
      } else if (value !== null && value !== undefined && value !== "") {
        cleaned[id] = value;
      } else {
        delete cleaned[id];
      }
    }

    // ---- Boolean-child REPEATABLE gating (warning) ----
    // For nested-repeatable cells inside a boolean's branch: any value is only
    // meaningful when the parent boolean equals the gating branch. Mirrors the
    // plain boolean_child gating so admins can rescue rows post-import.
    for (const f of fields) {
      if (f.virtual?.kind !== "boolean_child_repeatable_slot") continue;
      const id = fieldColumnId(f);
      const hasValue = cleaned[id] !== undefined && cleaned[id] !== null && cleaned[id] !== "";
      if (!hasValue) continue;

      const v = f.virtual;
      const parentField = fields.find((p) => p.pkg === v.pkg && p.key === v.parentKey);
      if (!parentField) continue;
      const parentVal = cleaned[fieldColumnId(parentField)];
      const expected = v.branch === "true";
      if (parentVal !== expected) {
        pushIssue(
          id,
          warn(
            `Only fill ${v.bcLabel} slots when "${v.parentLabel}" is ${v.branch === "true" ? "yes" : "no"}.`,
          ),
        );
      }
    }

    // ---- Repeatable-slot grouping (warnings) ----
    // Group all repeatable_slot AND boolean_child_repeatable_slot columns by
    // parent, check:
    //   • Slots are filled IN ORDER (no holes — slot N filled but N-1 empty)
    //   • The number of filled slots ≥ minSlots
    //   • Each filled slot has all sub-fields marked subRequired
    //
    // For boolean-gated repeatables we ONLY enforce min-slots when the gating
    // branch is actually selected — otherwise an "unselected" repeatable would
    // wrongly demand min items. Order + sub-required still apply whenever any
    // cell of the group is filled (so admins are warned about messy data
    // regardless of gating).
    type SlotGroupKey = string; // `${pkg}__${parentKey}` or `${pkg}__${parentKey}__bc${branch}_${bcIdx}`
    type SlotInfo = {
      parent: {
        pkg: string;
        parentKey: string;
        parentLabel: string;
        itemLabel: string;
        minSlots: number;
        slotsTotal: number;
        /** Set when this group is gated by a boolean's branch. */
        booleanGate?: { branch: "true" | "false"; bcLabel: string };
      };
      slots: Map<number, Array<{ field: ImportFieldDef; hasValue: boolean; columnId: string }>>;
    };
    const slotGroups = new Map<SlotGroupKey, SlotInfo>();

    for (const f of fields) {
      if (
        f.virtual?.kind !== "repeatable_slot" &&
        f.virtual?.kind !== "boolean_child_repeatable_slot"
      ) {
        continue;
      }
      const v = f.virtual;
      const isGated = v.kind === "boolean_child_repeatable_slot";
      const groupKey = isGated
        ? `${v.pkg}__${v.parentKey}__bc${v.branch}_${v.bcChildIndex}`
        : `${v.pkg}__${v.parentKey}`;
      let group = slotGroups.get(groupKey);
      if (!group) {
        group = {
          parent: {
            pkg: v.pkg,
            parentKey: v.parentKey,
            parentLabel: v.parentLabel,
            itemLabel: v.itemLabel,
            minSlots: v.minSlots,
            slotsTotal: v.slotsTotal,
            booleanGate: isGated
              ? { branch: v.branch, bcLabel: v.bcLabel }
              : undefined,
          },
          slots: new Map(),
        };
        slotGroups.set(groupKey, group);
      }
      const id = fieldColumnId(f);
      const hasValue = cleaned[id] !== undefined && cleaned[id] !== null && cleaned[id] !== "";
      const arr = group.slots.get(v.slotIndex) ?? [];
      arr.push({ field: f, hasValue, columnId: id });
      group.slots.set(v.slotIndex, arr);
    }

    for (const group of slotGroups.values()) {
      const filledSlotIndexes: number[] = [];
      for (let i = 0; i < group.parent.slotsTotal; i++) {
        const cells = group.slots.get(i) ?? [];
        if (cells.some((c) => c.hasValue)) filledSlotIndexes.push(i);
      }

      // Slot ordering: indexes must be a contiguous prefix [0,1,2,...,k]
      let firstHole = -1;
      for (let i = 0; i < group.parent.slotsTotal; i++) {
        const cells = group.slots.get(i) ?? [];
        const filled = cells.some((c) => c.hasValue);
        if (!filled) {
          let laterFilled = false;
          for (let j = i + 1; j < group.parent.slotsTotal; j++) {
            const later = group.slots.get(j) ?? [];
            if (later.some((c) => c.hasValue)) { laterFilled = true; break; }
          }
          if (laterFilled) { firstHole = i; break; }
        }
      }
      if (firstHole >= 0) {
        const offendingSlotIdx = filledSlotIndexes.find((s) => s > firstHole);
        const reportCol =
          offendingSlotIdx !== undefined
            ? (group.slots.get(offendingSlotIdx) ?? [])[0]?.columnId ?? null
            : null;
        pushIssue(
          reportCol,
          warn(`${group.parent.parentLabel}: fill ${group.parent.itemLabel} #${firstHole + 1} before #${(offendingSlotIdx ?? firstHole) + 1}. Slots must be in order with no gaps.`),
        );
      }

      // Min-slot enforcement
      // For boolean-gated repeatables, only enforce when the gating branch is
      // actually selected on the row — otherwise an unselected branch would
      // wrongly demand min items.
      let minSlotsActive = group.parent.minSlots > 0;
      if (minSlotsActive && group.parent.booleanGate) {
        const parentField = fields.find(
          (p) => p.pkg === group.parent.pkg && p.key === group.parent.parentKey,
        );
        const parentVal = parentField ? cleaned[fieldColumnId(parentField)] : undefined;
        const expected = group.parent.booleanGate.branch === "true";
        if (parentVal !== expected) minSlotsActive = false;
      }
      if (minSlotsActive && filledSlotIndexes.length < group.parent.minSlots) {
        const firstColOfFirstSlot = (group.slots.get(0) ?? [])[0]?.columnId ?? null;
        const where = group.parent.booleanGate
          ? `${group.parent.parentLabel}.${group.parent.booleanGate.bcLabel}`
          : group.parent.parentLabel;
        pushIssue(
          firstColOfFirstSlot,
          warn(`${where}: at least ${group.parent.minSlots} ${group.parent.itemLabel}(s) required (got ${filledSlotIndexes.length}).`),
        );
      }

      // Sub-field "required within filled slot"
      for (const slotIdx of filledSlotIndexes) {
        const cells = group.slots.get(slotIdx) ?? [];
        for (const c of cells) {
          const sv = c.field.virtual!;
          if (sv.kind !== "repeatable_slot" && sv.kind !== "boolean_child_repeatable_slot") continue;
          if (!sv.subRequired) continue;
          if (!c.hasValue) {
            pushIssue(c.columnId, warn(`Required for filled ${sv.itemLabel} #${slotIdx + 1}.`));
          }
        }
      }
    }

    // ---- Required-field check (category-aware, hard error) ----
    for (const f of fields) {
      if (!f.required) continue;
      // Conditional children + repeatable slots are never auto-required —
      // their requirement is handled by the gating / slot passes above.
      if (
        f.virtual?.kind === "boolean_child" ||
        f.virtual?.kind === "option_child" ||
        f.virtual?.kind === "option_child_boolean_child" ||
        f.virtual?.kind === "option_child_collapsed" ||
        f.virtual?.kind === "repeatable_slot" ||
        f.virtual?.kind === "boolean_child_repeatable_slot"
      ) continue;
      // If the field is category-restricted, only require it when the row
      // matches one of its categories.
      if (f.categories.length > 0) {
        const selectedCat = rowCategoryByPkg.get(f.pkg);
        if (!selectedCat) continue;
        const fieldCats = f.categories.map((c) => c.toLowerCase());
        if (!fieldCats.includes(selectedCat)) continue;
      }
      const id = fieldColumnId(f);
      if (
        cleaned[id] === undefined &&
        !errors.some((e) => e.column === id) &&
        !warnings.some((e) => e.column === id)
      ) {
        // Required stays an error — committing a row without a required
        // field would create a malformed policy. Admin must fix or skip.
        errors.push({ column: id, message: "Required" });
      }
    }

    return { excelRow: row.excelRow, values: cleaned, errors, warnings };
  });
}
