// Standalone smoke test for the import template generator.
// Run with:  npx tsx scripts/smoke-test-import-template.ts
//
// Generates a template using a representative mock schema (including
// edge cases: comma-in-option, quote-in-option, entity-picker reference,
// agent-picker, and a multi-section flow), then re-loads it and exercises
// the parser against a hand-edited workbook.

import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

import { buildImportTemplate, parseImportWorkbook, fieldColumnId } from "../lib/import/excel";
import type { ImportFlowSchema, ImportFieldDef, ImportPackageDef } from "../lib/import/schema";
import { validateRows } from "../lib/import/validate";
import { buildPolicyPayload } from "../lib/import/payload";

function field(
  pkg: string,
  key: string,
  label: string,
  inputType: string,
  overrides: Partial<ImportFieldDef> = {},
): ImportFieldDef {
  return {
    key,
    fullKey: `${pkg}__${key}`,
    pkg,
    label,
    inputType,
    required: false,
    options: [],
    isCategory: false,
    unsupported: false,
    categories: [],
    effectiveOrder: 0,
    dbId: 0,
    ...overrides,
  };
}

function pack(
  key: string,
  label: string,
  stepNumber: number,
  stepLabel: string,
  fields: ImportFieldDef[],
  categoryOptions: ImportPackageDef["categoryOptions"] = [],
): ImportPackageDef {
  return { key, label, stepNumber, stepLabel, fields, categoryOptions };
}

const schema: ImportFlowSchema = {
  flowKey: "policyset",
  flowLabel: "Policy Set",
  packages: [
    pack(
      "insured",
      "Insured",
      1,
      "Choosing Insured Type",
      [
        // Synthesised category selector (mirrors what loadFlowImportSchema injects)
        field("insured", "category", "Insured Type", "select", {
          required: true,
          isCategory: true,
          options: [
            { label: "Personal", value: "personal" },
            { label: "Company", value: "company" },
          ],
          virtual: { kind: "category", pkg: "insured" },
          effectiveOrder: -1,
          dbId: -1,
        }),
        // Personal-only field
        field("insured", "firstName", "First Name", "text", {
          required: true,
          categories: ["personal"],
        }),
        // Company-only field
        field("insured", "companyName", "Company Name", "text", {
          required: true,
          categories: ["company"],
        }),
        // Applies to both categories
        field("insured", "country", 'Country (or "Region")', "select", {
          options: [
            { label: "Hong Kong", value: "hk" },
            { label: "Hong Kong, China", value: "hkc" }, // unsafe (comma) — must be skipped from dropdown
            { label: 'My "Country"', value: "qc" },      // unsafe (quote) — must be skipped from dropdown
          ],
        }),
      ],
      [
        { value: "personal", label: "Personal" },
        { value: "company", label: "Company" },
      ],
    ),
    pack("contactinfo", "Contact Info", 1, "Choosing Insured Type", [
      field("contactinfo", "email", "Email", "email"),
      field("contactinfo", "tel", "Tel", "number"),
    ]),
    pack("policyinfo", "Policy Info", 2, "Choosing Insurance Type", [
      field("policyinfo", "insSection", "Insurance Company", "string", {
        entityPicker: {
          flow: "InsuranceSet",
          mappings: [
            { sourceField: "insco__name", targetField: "policyinfo__insSectionName" },
          ],
        },
      }),
      field("policyinfo", "agentPick", "Agent", "agent_picker", {
        entityPicker: { flow: "__agent__", mappings: [] },
      }),
      field("policyinfo", "startedDate", "Started Date", "date", { required: true }),
      field("policyinfo", "grossPremium", "Gross Premium", "currency"),
      // Boolean parent (synthesised children for both branches)
      field("policyinfo", "hpowner", "HP Owner?", "boolean"),
      field("policyinfo", "hpowner__y_bc0", "HP Owner?.HP Company (yes)", "text", {
        virtual: { kind: "boolean_child", pkg: "policyinfo", parentKey: "hpowner", parentLabel: "HP Owner?", branch: "true", childIndex: 0 },
      }),
      field("policyinfo", "hpowner__n_bc0", "HP Owner?.Reason (no)", "text", {
        virtual: { kind: "boolean_child", pkg: "policyinfo", parentKey: "hpowner", parentLabel: "HP Owner?", branch: "false", childIndex: 0 },
      }),
      // Select parent with option-children: TPO has none, COMP reveals "Sum Insured"
      field("policyinfo", "typeOfCover", "Type of Cover", "select", {
        required: true,
        options: [
          { label: "Third Party Only", value: "tpo" },
          { label: "Comprehensive", value: "comp", children: [{ label: "Sum Insured", inputType: "currency" }] },
        ],
      }),
      field("policyinfo", "typeOfCover__o_comp_sc0", "Type of Cover.Sum Insured (when Comprehensive)", "currency", {
        virtual: {
          kind: "option_child",
          pkg: "policyinfo",
          parentKey: "typeOfCover",
          parentLabel: "Type of Cover",
          optionValue: "comp",
          optionLabel: "Comprehensive",
          childIndex: 0,
        },
      }),
    ]),
  ],
};

async function main() {
  const buf = await buildImportTemplate(schema);
  writeFileSync("./scripts/_smoke-template.xlsx", buf);
  console.log(`Wrote ./scripts/_smoke-template.xlsx (${buf.length} bytes)`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  console.log("Sheets:", wb.worksheets.map((w) => w.name));

  const policies = wb.getWorksheet("Policies")!;
  const dvModel =
    (policies as unknown as { dataValidations?: { model?: Record<string, unknown> } })
      .dataValidations?.model ?? {};
  console.log(`Data-validation entries (after exceljs round-trip): ${Object.keys(dvModel).length}`);
  console.log("DV addresses:", Object.keys(dvModel));

  const totalCols = schema.packages.reduce((sum, p) => sum + p.fields.length, 0);
  console.log("\nRow 1 (section banners) — merged across packages:");
  for (let c = 1; c <= totalCols; c++) {
    const v = policies.getRow(1).getCell(c).value;
    if (v) console.log(`  col ${c}: ${v}`);
  }

  console.log("\nRow 2 (labels):");
  for (let c = 1; c <= totalCols; c++) {
    console.log(`  col ${c}: ${policies.getRow(2).getCell(c).value}`);
  }
  console.log("\nRow 3 (technical ids):");
  for (let c = 1; c <= totalCols; c++) {
    console.log(`  col ${c}: ${policies.getRow(3).getCell(c).value}`);
  }
  console.log("\nRow 4 (example):");
  for (let c = 1; c <= totalCols; c++) {
    console.log(`  col ${c}: ${policies.getRow(4).getCell(c).value}`);
  }

  // Build a column-id → column-number map from the technical-id row
  const colByField: Record<string, number> = {};
  policies.getRow(3).eachCell((cell, c) => {
    colByField[String(cell.value ?? "")] = c;
  });

  // Look up by stable field key (insulates the test from index shifts)
  const findField = (pkgKey: string, key: string): ImportFieldDef => {
    const pkg = schema.packages.find((p) => p.key === pkgKey)!;
    return pkg.fields.find((f) => f.key === key)!;
  };
  const setCell = (rowNum: number, pkgKey: string, key: string, value: unknown) => {
    const f = findField(pkgKey, key);
    const c = colByField[fieldColumnId(f)];
    if (c) policies.getRow(rowNum).getCell(c).value = value as never;
  };

  // Row 5 — well-formed COMPANY row
  setCell(5, "insured", "category", "company");
  setCell(5, "insured", "companyName", "Acme Ltd");
  setCell(5, "policyinfo", "insSection", "INS-0001");
  setCell(5, "policyinfo", "agentPick", "AG001");
  setCell(5, "policyinfo", "startedDate", "31/12/2026");
  setCell(5, "policyinfo", "grossPremium", 1234.56);
  setCell(5, "policyinfo", "hpowner", "yes");
  setCell(5, "policyinfo", "hpowner__y_bc0", "Acme Finance");
  setCell(5, "policyinfo", "typeOfCover", "comp");
  setCell(5, "policyinfo", "typeOfCover__o_comp_sc0", 250000);
  // intentionally do NOT fill hpowner__n_bc0 — should be silently dropped

  // Row 6 — BAD row: company picked but personal field filled, plus boolean child mismatch,
  // plus option-child filled when parent select doesn't match
  setCell(6, "insured", "category", "company");
  setCell(6, "insured", "firstName", "John"); // off-category — should fail
  setCell(6, "policyinfo", "startedDate", "31/12/2026");
  setCell(6, "policyinfo", "hpowner", "no");
  setCell(6, "policyinfo", "hpowner__y_bc0", "wrong branch"); // mismatch — should fail
  setCell(6, "policyinfo", "typeOfCover", "tpo");
  setCell(6, "policyinfo", "typeOfCover__o_comp_sc0", 999999); // wrong option — should fail

  const buf2 = await wb.xlsx.writeBuffer();
  const parsed = await parseImportWorkbook(Buffer.from(buf2 as ArrayBuffer), schema);
  console.log(`\nParsed columns (${parsed.columns.length}):`, parsed.columns);
  console.log("Unknown columns:", parsed.unknownColumns);
  console.log("Missing columns:", parsed.missingColumns);
  console.log("Data rows:", JSON.stringify(parsed.rows, null, 2));

  console.log("\n--- Validator output ---");
  const validated = validateRows(parsed.rows, schema);
  for (const row of validated) {
    console.log(`Row ${row.excelRow}: ${row.errors.length} error(s)`);
    for (const e of row.errors) console.log(`  • [${e.column ?? "row"}] ${e.message}`);
  }

  console.log("\n--- Payload (row 5, the good one) ---");
  const goodRow = validated.find((r) => r.excelRow === 5);
  if (goodRow) {
    const built = buildPolicyPayload(goodRow, schema);
    console.log(JSON.stringify(built, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
