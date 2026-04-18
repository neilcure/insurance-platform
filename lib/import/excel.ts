/**
 * Excel template generation and parsing for the policy import feature.
 * Uses the dynamic flow schema (see schema.ts) so the template always
 * matches the current admin-configured field set.
 *
 * Sheet layout ("Policies"):
 *   Row 1 — section banner (merged across the columns of each package),
 *           colour-coded so each step/package group is visually distinct.
 *   Row 2 — human-readable label per column (e.g. "First Name *")
 *   Row 3 — technical column id used by the parser (e.g. "insured.firstName")
 *           DO NOT remove this row; it is the source of truth for parsing.
 *   Row 4 — example row (italic grey, optional to delete)
 *   Row 5+ — user data (capped at 500 data rows by data-validation ranges)
 *
 * The parser is tolerant: it auto-detects the technical-id row anywhere in
 * the first ~6 rows so older templates (label-row only, id-on-row-2, etc.)
 * still upload successfully.
 */
import ExcelJS from "exceljs";
import type { ImportFlowSchema, ImportFieldDef, ImportPackageDef } from "./schema";

const SHEET_DATA = "Policies";
const SHEET_README = "Instructions";

const SECTION_ROW = 1;
const HEADER_LABEL_ROW = 2;
const HEADER_ID_ROW = 3;
const EXAMPLE_ROW = 4;
const FIRST_DATA_ROW = 5;
const MAX_DATA_ROW = FIRST_DATA_ROW + 499; // 500 data rows

/** Pleasant section banner colours, cycled across packages. */
const PACKAGE_COLOURS: Array<{ bg: string; fg: string }> = [
  { bg: "FF1F4E79", fg: "FFFFFFFF" }, // deep blue
  { bg: "FF2E7D32", fg: "FFFFFFFF" }, // green
  { bg: "FF7B1FA2", fg: "FFFFFFFF" }, // purple
  { bg: "FFE65100", fg: "FFFFFFFF" }, // orange
  { bg: "FFAD1457", fg: "FFFFFFFF" }, // pink
  { bg: "FF00838F", fg: "FFFFFFFF" }, // teal
  { bg: "FF455A64", fg: "FFFFFFFF" }, // slate
  { bg: "FF5D4037", fg: "FFFFFFFF" }, // brown
  { bg: "FF424242", fg: "FFFFFFFF" }, // dark grey
];

function colNumberToLetters(col: number): string {
  let n = col;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/**
 * Allowed inside an Excel `"A,B,C"` list-validation formula.
 *
 * Excel's formula parser rejects values that contain characters with
 * syntactic meaning in formulas — this happens even when the value is XML-escaped,
 * because Excel re-parses the literal string against its formula grammar:
 *   "  ,  &  <  >  =  +  -  *  /  (  )  ;  :  !  '  $  %  ^  ?  ~  [  ]  {  }  |  \  `
 * are all unsafe. Accepting only "safe" chars (letters, digits, space and a small set
 * of human-friendly punctuation) avoids the "unreadable content / repaired" warning
 * Excel pops when the dropdown formula it parses doesn't match what it expects.
 *
 * Anything that fails this check is silently dropped from the in-cell dropdown;
 * the value is still listed in the comment + instructions sheet so users know it's allowed.
 */
function isFormulaSafeValue(v: string): boolean {
  return /^[A-Za-z0-9 _.\-#@]+$/.test(v);
}

/** Canonical column id for a field. */
export function fieldColumnId(field: ImportFieldDef): string {
  return `${field.pkg}.${field.key}`;
}

function exampleValueFor(field: ImportFieldDef): string {
  if (field.entityPicker) return ""; // user must enter a real reference
  // Boolean-child / option-child columns: leave blank in the example so it's
  // clear they're conditional and only filled when the parent says so.
  if (field.virtual?.kind === "boolean_child" || field.virtual?.kind === "option_child") return "";
  switch (field.inputType) {
    case "select":
    case "radio": {
      const first = field.options[0];
      return first?.value ?? "";
    }
    case "multi_select":
      return "";
    case "date":
      return "31/12/2026";
    case "number":
    case "currency":
    case "negative_currency":
      return "0";
    case "boolean":
    case "checkbox":
      return "false";
    case "email":
      return "name@example.com";
    case "tel":
    case "phone":
      return "+852 1234 5678";
    default:
      return "";
  }
}

/** Builds the rich note attached to each label cell. */
function buildLabelNote(f: ImportFieldDef): ExcelJS.Comment {
  const texts: { text: string }[] = [
    { text: `${f.label}\n` },
    { text: `Column id: ${fieldColumnId(f)}\n` },
    { text: `Type: ${f.inputType}\n` },
  ];
  if (f.required) texts.push({ text: "Required\n" });

  // Category selector
  if (f.virtual?.kind === "category") {
    texts.push({
      text:
        "ROW TYPE SELECTOR — pick which kind of record this row is.\n" +
        "Each row in this section must specify a value here.\n" +
        "Other columns in this section are validated against this value: rows that\n" +
        "fill columns belonging to a different type will FAIL with a clear error.\n",
    });
  }

  // Boolean child
  if (f.virtual?.kind === "boolean_child") {
    const v = f.virtual;
    const triggerWord = v.branch === "true" ? "yes / true" : "no / false";
    texts.push({
      text:
        `CONDITIONAL — only fill this column when "${v.parentLabel}" is set to ${triggerWord}.\n` +
        `Filling this column when the parent says the opposite will FAIL the row.\n`,
    });
  }

  // Option child (select option's conditional sub-field)
  if (f.virtual?.kind === "option_child") {
    const v = f.virtual;
    texts.push({
      text:
        `CONDITIONAL — only fill this column when "${v.parentLabel}" is set to "${v.optionLabel}" (value: ${v.optionValue}).\n` +
        `Filling it when the parent has any other value will FAIL the row.\n`,
    });
  }

  // Category-restricted regular field
  if (f.categories.length > 0) {
    texts.push({
      text: `Applies only when the row Type is one of: ${f.categories.join(", ")}\n`,
    });
  }

  if (f.entityPicker) {
    if (f.entityPicker.flow === "__agent__") {
      texts.push({
        text:
          "AGENT REFERENCE — enter the agent's user number (e.g. AG001).\n" +
          "Agent must already exist; the row will fail if not found.\n",
      });
    } else {
      texts.push({
        text:
          `REFERENCE — enter the record number from the "${f.entityPicker.flow}" flow.\n` +
          `The record must already exist; this importer will NOT auto-create it.\n` +
          `Add the missing record via the "${f.entityPicker.flow}" flow first, then re-upload.\n`,
      });
    }
  }

  if (f.options.length > 0) {
    texts.push({ text: `\nAllowed: ${f.options.map((o) => o.value).join(", ")}` });
  }
  if (f.unsupported) {
    texts.push({ text: `\nNot importable: ${f.unsupportedReason ?? "unsupported field"}` });
  }
  return { texts };
}

/** Generates the import template workbook for a flow. */
export async function buildImportTemplate(schema: ImportFlowSchema): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GInsurance Platform";
  wb.created = new Date();

  // Build the column layout, package-by-package, in step order.
  type ColumnLayout = {
    field: ImportFieldDef;
    pkg: ImportPackageDef;
    colIndex: number; // 1-based
  };
  type PackageRange = {
    pkg: ImportPackageDef;
    start: number;
    end: number;
    colour: { bg: string; fg: string };
  };

  const columns: ColumnLayout[] = [];
  const ranges: PackageRange[] = [];
  let cursor = 1;

  schema.packages.forEach((pkg, pkgIdx) => {
    const importable = pkg.fields.filter((f) => !f.unsupported);
    if (importable.length === 0) return;
    const start = cursor;
    for (const f of importable) {
      columns.push({ field: f, pkg, colIndex: cursor });
      cursor += 1;
    }
    const end = cursor - 1;
    ranges.push({
      pkg,
      start,
      end,
      colour: PACKAGE_COLOURS[pkgIdx % PACKAGE_COLOURS.length],
    });
  });

  // ----- Instructions sheet -----
  const readme = wb.addWorksheet(SHEET_README);
  readme.columns = [{ width: 110 }];
  const lines = [
    `Policy Import Template — Flow: ${schema.flowLabel} (${schema.flowKey})`,
    "",
    "How to use:",
    "  1. Open the 'Policies' sheet.",
    "  2. Row 1 is a colour-coded SECTION BANNER showing which step/package each",
    "     group of columns belongs to.",
    "  3. Row 2 is the human-readable column label (with '*' for required).",
    "  4. Row 3 is the technical column id used by the importer — DO NOT delete or",
    "     change this row. You may hide it if you find it noisy.",
    "  5. Row 4 is an example row — replace it with your own data, or delete it.",
    "  6. Add one row per policy starting from row 5.",
    "  7. Save as .xlsx and upload via 'Import Excel' on the flow page.",
    "",
    "Field types:",
    "  • Date columns must be in DD/MM/YYYY format (e.g. 31/12/2026).",
    "  • Select columns must use one of the listed values (case-insensitive).",
    "    Valid values appear in the in-cell dropdown when available.",
    "  • Boolean columns accept: true / false / yes / no / 1 / 0.",
    "  • Numeric columns must contain digits only (no currency symbols).",
    "  • Required columns are marked with a '*' in the row 2 header.",
    "",
    "Reference fields (Collaborators, Insurance Companies, Agents):",
    "  • These columns are tagged '(ref)' in the header.",
    "  • Enter the EXISTING record's number (e.g. INS-0001 for an insurance company).",
    "  • If the referenced record does not exist, the row will FAIL with a clear",
    "    error message. The importer will NOT auto-create reference records.",
    "  • Add the missing record via its own flow first, then re-upload.",
    "",
    "Type / category columns (one per package, tagged '(type)'):",
    "  • Each section that has type-specific fields starts with a '... Type' column.",
    "  • Pick one of the allowed values per row (e.g. personal / company).",
    "  • Other columns in the section are tagged with the type(s) they apply to.",
    "  • Filling a column that doesn't apply to the row's type will FAIL the row.",
    "",
    "Boolean conditional fields (tagged '(if yes)' / '(if no)'):",
    "  • Some boolean columns reveal extra fields in the wizard. Those extra fields",
    "    appear here as separate columns with the parent boolean's name in the label.",
    "  • Only fill them when the parent boolean matches the indicated branch.",
    "",
    "Select conditional fields (tagged '(if=<value>)'):",
    "  • Some select columns reveal extra fields when a SPECIFIC option is chosen",
    "    (e.g. 'Type of Cover' = comp → 'Sum Insured' becomes available).",
    "  • Each conditional sub-field appears as its own column tagged with the option",
    "    that triggers it, e.g. 'Type of Cover.Sum Insured (when Comp) (if=comp)'.",
    "  • Only fill them when the parent select equals that option value.",
    "",
    "Client linking:",
    "  • Leave the insured columns filled in — a new client will be auto-created",
    "    from the insured data if no Client Number is provided.",
    "",
    "Sections in this template:",
  ];
  for (const r of ranges) {
    const cats = r.pkg.categoryOptions.length > 0
      ? `   types: [${r.pkg.categoryOptions.map((c) => c.value).join(", ")}]`
      : "";
    lines.push(
      `  • Step ${r.pkg.stepNumber} — ${r.pkg.stepLabel} → package "${r.pkg.label}" (${r.pkg.key}): ${r.end - r.start + 1} columns${cats}`,
    );
  }
  lines.push("", "Field reference (label → column id, type, allowed values / reference):");
  for (const c of columns) {
    const f = c.field;
    const tags: string[] = [];
    if (f.virtual?.kind === "category") tags.push("type-selector");
    if (f.virtual?.kind === "boolean_child") {
      tags.push(`only when ${f.virtual.parentLabel}=${f.virtual.branch === "true" ? "yes" : "no"}`);
    }
    if (f.virtual?.kind === "option_child") {
      tags.push(`only when ${f.virtual.parentLabel}="${f.virtual.optionLabel}" (${f.virtual.optionValue})`);
    }
    if (f.categories.length > 0) tags.push(`for type: ${f.categories.join("|")}`);
    if (f.entityPicker) {
      tags.push(
        f.entityPicker.flow === "__agent__"
          ? "ref: agent userNumber"
          : `ref: ${f.entityPicker.flow} record number`,
      );
    } else if (f.options.length > 0) {
      tags.push(`values: ${f.options.map((o) => o.value).join(" | ")}`);
    }
    const tagSuffix = tags.length > 0 ? `  [${tags.join("; ")}]` : "";
    lines.push(
      `  ${c.pkg.label} → ${f.label} → ${fieldColumnId(f)} [${f.inputType}]${f.required ? " *required" : ""}${tagSuffix}`,
    );
  }
  lines.forEach((l, i) => {
    readme.getCell(i + 1, 1).value = l;
  });
  readme.getCell(1, 1).font = { bold: true, size: 14 };

  // ----- Data sheet -----
  const data = wb.addWorksheet(SHEET_DATA);
  data.views = [{ state: "frozen", xSplit: 0, ySplit: HEADER_ID_ROW }];

  // Section banners (row 1) — merged across each package's column range.
  for (const r of ranges) {
    const startLetter = colNumberToLetters(r.start);
    const endLetter = colNumberToLetters(r.end);
    if (r.start !== r.end) {
      data.mergeCells(`${startLetter}${SECTION_ROW}:${endLetter}${SECTION_ROW}`);
    }
    const cell = data.getCell(SECTION_ROW, r.start);
    cell.value = `Step ${r.pkg.stepNumber} — ${r.pkg.stepLabel}  ›  ${r.pkg.label}`;
    cell.font = { bold: true, size: 11, color: { argb: r.colour.fg } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: r.colour.bg },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      right: { style: "medium", color: { argb: "FFFFFFFF" } },
    };
  }

  // Per-column header rows (label, id, example)
  for (const c of columns) {
    const f = c.field;
    const colIdx = c.colIndex;
    const colour = ranges.find((r) => r.start <= colIdx && colIdx <= r.end)!.colour;
    const col = data.getColumn(colIdx);
    col.width = Math.max(16, Math.min(38, f.label.length + 6));

    // Row 2 — human label (with quick-glance tags)
    const labelCell = data.getCell(HEADER_LABEL_ROW, colIdx);
    let labelText = `${f.label}${f.required ? " *" : ""}`;
    if (f.virtual?.kind === "category") {
      labelText += " (type)";
    } else if (f.virtual?.kind === "boolean_child") {
      labelText += f.virtual.branch === "true" ? " (if yes)" : " (if no)";
    } else if (f.virtual?.kind === "option_child") {
      labelText += ` (if=${f.virtual.optionValue})`;
    }
    if (f.entityPicker) labelText += " (ref)";
    if (f.categories.length > 0 && f.virtual?.kind !== "boolean_child") {
      labelText += ` [${f.categories.join("|")}]`;
    }
    labelCell.value = labelText;
    labelCell.font = { bold: true, size: 10 };
    labelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE8F0FE" },
    };
    labelCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    labelCell.border = {
      bottom: { style: "thin", color: { argb: "FFB6CCE9" } },
      left: { style: "hair", color: { argb: colour.bg } },
    };
    labelCell.note = buildLabelNote(f);

    // Row 3 — technical column id (parser's source of truth)
    const idCell = data.getCell(HEADER_ID_ROW, colIdx);
    idCell.value = fieldColumnId(f);
    idCell.font = { italic: true, size: 9, color: { argb: "FF8896A8" } };
    idCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF7F8FA" },
    };

    // Row 4 — example value
    const exampleCell = data.getCell(EXAMPLE_ROW, colIdx);
    exampleCell.value = exampleValueFor(f);
    exampleCell.font = { italic: true, color: { argb: "FFAFAFAF" } };
  }

  // Range-based data validations (one per column instead of per cell).
  type DataValidationsApi = {
    add: (range: string, validation: ExcelJS.DataValidation) => void;
  };
  const dv = (data as unknown as { dataValidations: DataValidationsApi }).dataValidations;

  // Excel rejects DV blocks with overlapping sqref ranges — dedupe defensively.
  const seenRanges = new Set<string>();
  // Excel also has a 255-char hard cap on the dropdown formula content
  // (including the surrounding quotes).
  const MAX_FORMULA_LEN = 255;
  // Conservative limit for the human-visible "Allowed: ..." error text shown by Excel.
  const MAX_ERROR_LEN = 200;

  for (const c of columns) {
    const f = c.field;
    const colLetter = colNumberToLetters(c.colIndex);
    const range = `${colLetter}${EXAMPLE_ROW}:${colLetter}${MAX_DATA_ROW}`;

    if (seenRanges.has(range)) continue;

    if (f.entityPicker) {
      // Don't restrict via dropdown — values are unknown record numbers — but
      // do attach a clear visible error message guiding the user.
      continue;
    }

    if (f.options.length > 0 && (f.inputType === "select" || f.inputType === "radio")) {
      const safeValues = f.options
        .map((o) => (o.value ?? "").trim())
        .filter((v) => v.length > 0 && isFormulaSafeValue(v));
      if (safeValues.length === 0) continue;
      const formula = `"${safeValues.join(",")}"`;
      if (formula.length > MAX_FORMULA_LEN) continue;
      const errorText = `Allowed: ${safeValues.join(", ")}`.slice(0, MAX_ERROR_LEN);
      dv.add(range, {
        type: "list",
        allowBlank: !f.required,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: "warning",
        errorTitle: "Invalid value",
        error: errorText,
      });
      seenRanges.add(range);
    } else if (f.inputType === "boolean" || f.inputType === "checkbox") {
      dv.add(range, {
        type: "list",
        allowBlank: true,
        formulae: ['"true,false,yes,no"'],
        showErrorMessage: true,
        errorStyle: "warning",
      });
      seenRanges.add(range);
    }
  }

  // Row heights and filter
  data.getRow(SECTION_ROW).height = 26;
  data.getRow(HEADER_LABEL_ROW).height = 30;
  data.getRow(HEADER_ID_ROW).height = 14;
  data.autoFilter = {
    from: { row: HEADER_LABEL_ROW, column: 1 },
    to: { row: HEADER_LABEL_ROW, column: Math.max(1, columns.length) },
  };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export type ParsedImportRow = {
  /** 1-based row number in the Excel sheet (matches Excel's UI) */
  excelRow: number;
  /** Field column id (e.g. "insured.firstName") → raw cell value */
  values: Record<string, unknown>;
};

export type ParsedImportSheet = {
  /** Recognised columns in the order they appeared */
  columns: string[];
  /** Columns present in the upload that are not in the current schema */
  unknownColumns: string[];
  /** Columns required by the schema but missing in the upload */
  missingColumns: string[];
  /** Data rows (excludes the header and any rows fully blank) */
  rows: ParsedImportRow[];
};

function readCellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v;
    if ("text" in v && typeof (v as { text?: unknown }).text === "string") {
      return (v as { text: string }).text;
    }
    if ("result" in v && (v as { result?: unknown }).result !== undefined) {
      return (v as { result: unknown }).result;
    }
    if ("richText" in v && Array.isArray((v as { richText?: unknown[] }).richText)) {
      return (v as { richText: { text?: string }[] }).richText
        .map((r) => r.text ?? "")
        .join("");
    }
    if ("hyperlink" in v && "text" in v) {
      return (v as { text: string }).text;
    }
  }
  return v;
}

function flattenSchemaFields(schema: ImportFlowSchema): ImportFieldDef[] {
  const out: ImportFieldDef[] = [];
  for (const p of schema.packages) {
    for (const f of p.fields) {
      if (!f.unsupported) out.push(f);
    }
  }
  return out;
}

/** Parses an uploaded .xlsx buffer into rows keyed by column id. */
export async function parseImportWorkbook(
  buffer: Buffer,
  schema: ImportFlowSchema,
): Promise<ParsedImportSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const ws = wb.getWorksheet(SHEET_DATA) ?? wb.worksheets[0];
  if (!ws) {
    return { columns: [], unknownColumns: [], missingColumns: [], rows: [] };
  }

  const fields = flattenSchemaFields(schema);
  const knownIds = new Set(fields.map((f) => fieldColumnId(f)));
  const requiredIds = new Set(fields.filter((f) => f.required).map((f) => fieldColumnId(f)));
  const idByLabel = new Map<string, string>();
  for (const f of fields) {
    const base = f.label.trim().toLowerCase();
    idByLabel.set(base, fieldColumnId(f));
    // Cover all combinations of the in-template label suffixes
    const suffixes = [
      "",
      " *",
      " (ref)",
      " * (ref)",
      " (type)",
      " * (type)",
      " (if yes)",
      " (if no)",
    ];
    for (const s of suffixes) idByLabel.set(`${base}${s}`, fieldColumnId(f));
    // Option-child columns add an `(if=<value>)` suffix
    if (f.virtual?.kind === "option_child") {
      idByLabel.set(`${base} (if=${f.virtual.optionValue.toLowerCase()})`, fieldColumnId(f));
    }
  }

  // Auto-detect the technical-id row anywhere in the first 6 rows so we
  // gracefully handle older templates and re-uploads where users may have
  // hidden or reordered the helper rows.
  type Header = { col: number; id: string };
  let headers: Header[] = [];
  let detectedRow = 0;
  let detectedByLabel = false;

  function tryRow(rowNum: number, byLabel: boolean): { hits: number; candidates: Header[] } {
    const row = ws!.getRow(rowNum);
    const candidates: Header[] = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const raw = String(readCellValue(cell) ?? "").trim();
      if (!raw) return;
      const cleaned = raw
        .replace(/\s*\[[^\]]*\]\s*$/, "") // trailing [personal|company]
        .replace(/\s*\(if\s+yes\)\s*$/i, "")
        .replace(/\s*\(if\s+no\)\s*$/i, "")
        .replace(/\s*\(if\s*=\s*[^)]+\)\s*$/i, "") // (if=<value>)
        .replace(/\s*\(type\)\s*$/i, "")
        .replace(/\s*\(ref\)\s*$/i, "")
        .replace(/\s*\*\s*$/, "")
        .trim();
      if (!cleaned) return;
      if (byLabel) {
        const id = idByLabel.get(cleaned.toLowerCase());
        if (id) candidates.push({ col: colNumber, id });
      } else {
        candidates.push({ col: colNumber, id: cleaned });
      }
    });
    const hits = candidates.filter((c) => knownIds.has(c.id)).length;
    return { hits, candidates };
  }

  // First pass: id-style detection across rows 1..6
  for (let r = 1; r <= 6; r++) {
    const { hits, candidates } = tryRow(r, false);
    if (hits > headers.filter((h) => knownIds.has(h.id)).length && hits > 0) {
      headers = candidates;
      detectedRow = r;
      detectedByLabel = false;
    }
  }
  // Fallback: label-style detection if id-style found very few matches
  if (headers.filter((h) => knownIds.has(h.id)).length < 3) {
    for (let r = 1; r <= 6; r++) {
      const { hits, candidates } = tryRow(r, true);
      if (hits > headers.filter((h) => knownIds.has(h.id)).length && hits > 0) {
        headers = candidates;
        detectedRow = r;
        detectedByLabel = true;
      }
    }
  }

  if (detectedRow === 0) {
    return {
      columns: [],
      unknownColumns: [],
      missingColumns: [...requiredIds],
      rows: [],
    };
  }

  // Determine where data starts: skip the header row, the example row (if any),
  // and any subsequent decorative row before real user data.
  const dataStartRow = detectedRow + 1;

  const seenIds = new Set(headers.map((h) => h.id));
  const unknownColumns = headers.filter((h) => !knownIds.has(h.id)).map((h) => h.id);
  const missingColumns = [...requiredIds].filter((id) => !seenIds.has(id));

  const rows: ParsedImportRow[] = [];
  const lastRow = ws.actualRowCount;
  for (let r = dataStartRow; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const values: Record<string, unknown> = {};
    let hasAny = false;
    for (const h of headers) {
      if (!knownIds.has(h.id)) continue;
      const v = readCellValue(row.getCell(h.col));
      if (v !== "" && v !== null && v !== undefined) hasAny = true;
      values[h.id] = v;
    }
    if (!hasAny) continue;
    rows.push({ excelRow: r, values });
  }

  // Drop the example row if it still matches the example values exactly.
  // Example row is wherever it lands relative to the detected header row.
  const example: Record<string, unknown> = {};
  for (const f of fields) example[fieldColumnId(f)] = exampleValueFor(f);
  if (rows.length > 0) {
    const r = rows[0];
    let allMatch = true;
    let matchedColumns = 0;
    for (const [k, v] of Object.entries(r.values)) {
      const ev = String(example[k] ?? "");
      if (ev !== "") matchedColumns += 1;
      if (String(v ?? "") !== ev) { allMatch = false; break; }
    }
    if (allMatch && matchedColumns > 0) rows.shift();
  }

  // Discard any leftover decoration / banner row consumed accidentally
  void detectedByLabel;

  return {
    columns: headers.map((h) => h.id),
    unknownColumns,
    missingColumns,
    rows,
  };
}
