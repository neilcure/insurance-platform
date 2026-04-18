/**
 * Validation + normalisation of parsed import rows against a flow schema.
 * Pure functions — no DB access. Returns per-row errors for UI display.
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
  errors: RowError[];
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

function validateField(
  field: ImportFieldDef,
  raw: unknown,
): { value: unknown; error: string | null } {
  const isEmpty =
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");

  // The post-loop "required" check in validateRows is category-aware.
  // Don't double-report Required here for empty cells.
  if (isEmpty) return { value: null, error: null };

  // Entity-picker / agent-picker: just hold the reference value here. The
  // actual existence check happens at commit time (see entity-resolver.ts).
  if (field.entityPicker) {
    return { value: asString(raw), error: null };
  }

  switch (field.inputType) {
    case "number":
    case "currency":
    case "negative_currency": {
      const s = asString(raw).replace(/,/g, "");
      const n = Number(s);
      if (!Number.isFinite(n)) return { value: null, error: `Not a number: "${s}"` };
      return { value: n, error: null };
    }

    case "boolean":
    case "checkbox": {
      const s = asString(raw).toLowerCase();
      if (TRUTHY.has(s)) return { value: true, error: null };
      if (FALSY.has(s)) return { value: false, error: null };
      return { value: null, error: `Expected true/false, got "${s}"` };
    }

    case "date": {
      const d = parseDate(raw);
      if (!d) return { value: null, error: `Invalid date "${asString(raw)}" — use DD/MM/YYYY` };
      return { value: formatDateDDMMYYYY(d), error: null };
    }

    case "select":
    case "radio": {
      const s = asString(raw);
      if (field.options.length === 0) return { value: s, error: null };
      const lower = s.toLowerCase();
      const match = field.options.find(
        (o) => (o.value ?? "").toLowerCase() === lower || (o.label ?? "").toLowerCase() === lower,
      );
      if (!match) {
        const allowed = field.options.map((o) => o.value).join(", ");
        return { value: null, error: `"${s}" not in [${allowed}]` };
      }
      return { value: match.value, error: null };
    }

    case "multi_select": {
      // Comma- or semicolon-separated list of allowed option values
      const s = asString(raw);
      if (!s) return { value: [], error: null };
      const parts = s.split(/[,;|]+/).map((p) => p.trim()).filter(Boolean);
      if (field.options.length === 0) return { value: parts, error: null };
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
        return { value: null, error: `Unknown values [${bad.join(", ")}] — allowed: [${allowed}]` };
      }
      return { value: matched, error: null };
    }

    case "email": {
      const s = asString(raw);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        return { value: null, error: `Invalid email "${s}"` };
      }
      return { value: s, error: null };
    }

    default:
      return { value: asString(raw), error: null };
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
  const categoryOptionsByPkg = new Map<string, Set<string>>();
  for (const pkg of schema.packages) {
    const selector = pkg.fields.find((f) => f.virtual?.kind === "category");
    if (selector) {
      categorySelectorByPkg.set(pkg.key, selector);
      categoryOptionsByPkg.set(
        pkg.key,
        new Set(pkg.categoryOptions.map((c) => c.value.toLowerCase())),
      );
    }
  }

  return rows.map((row) => {
    const errors: RowError[] = [];
    const cleaned: Record<string, unknown> = {};

    for (const [colId, raw] of Object.entries(row.values)) {
      const field = fieldByColumnId.get(colId);
      if (!field) continue;
      const { value, error } = validateField(field, raw);
      if (error) errors.push({ column: colId, message: error });
      if (value !== null && value !== undefined && value !== "") {
        cleaned[colId] = value;
      }
    }

    // ---- Category enforcement (strict) ----
    // For each package with a category selector:
    //   * Identify the row's selected category
    //   * Drop / fail any value the user wrote into a column that doesn't apply
    //     to that category
    //   * Skip "required" check for fields whose category doesn't match
    const rowCategoryByPkg = new Map<string, string>();
    for (const [pkgKey, selector] of categorySelectorByPkg) {
      const id = fieldColumnId(selector);
      const v = cleaned[id];
      if (typeof v === "string" && v.length > 0) {
        rowCategoryByPkg.set(pkgKey, v.toLowerCase());
      }
    }

    for (const f of fields) {
      if (f.categories.length === 0) continue;
      const selectedCat = rowCategoryByPkg.get(f.pkg);
      const fieldCats = f.categories.map((c) => c.toLowerCase());
      const id = fieldColumnId(f);
      const hasValue = cleaned[id] !== undefined && cleaned[id] !== "";
      if (!selectedCat) continue; // missing-selector error reported below
      if (!fieldCats.includes(selectedCat) && hasValue) {
        errors.push({
          column: id,
          message: `Field only applies when ${f.pkg} type is one of [${f.categories.join(", ")}], but row type is "${selectedCat}". Leave this column blank.`,
        });
        delete cleaned[id];
      }
    }

    // ---- Boolean-child gating (strict) ----
    // A boolean-child column can only be filled when its parent boolean
    // is set to the matching branch.
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
        errors.push({
          column: id,
          message: `Only fill this column when "${f.virtual.parentLabel}" is ${f.virtual.branch === "true" ? "yes" : "no"}.`,
        });
        delete cleaned[id];
      }
    }

    // ---- Option-child gating (strict) ----
    // An option-child column can only be filled when its parent select
    // equals the option value that triggers it.
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
      // Compare loosely as strings (validateField normalises selects to option.value)
      const got = parentVal === undefined || parentVal === null ? "" : String(parentVal).toLowerCase();
      const expected = f.virtual.optionValue.toLowerCase();
      if (got !== expected) {
        errors.push({
          column: id,
          message: `Only fill this column when "${f.virtual.parentLabel}" = "${f.virtual.optionLabel}" (${f.virtual.optionValue}).`,
        });
        delete cleaned[id];
      }
    }

    // ---- Required-field check (category-aware) ----
    for (const f of fields) {
      if (!f.required) continue;
      // Conditional children are never auto-required — their requirement depends
      // on the parent's value, which is checked in the gating passes above.
      if (f.virtual?.kind === "boolean_child" || f.virtual?.kind === "option_child") continue;
      // If the field is category-restricted, only require it when the row
      // matches one of its categories
      if (f.categories.length > 0) {
        const selectedCat = rowCategoryByPkg.get(f.pkg);
        if (!selectedCat) continue;
        const fieldCats = f.categories.map((c) => c.toLowerCase());
        if (!fieldCats.includes(selectedCat)) continue;
      }
      const id = fieldColumnId(f);
      if (cleaned[id] === undefined && !errors.some((e) => e.column === id)) {
        errors.push({ column: id, message: "Required" });
      }
    }

    return { excelRow: row.excelRow, values: cleaned, errors };
  });
}
