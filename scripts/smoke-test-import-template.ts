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
      // Select parent with option-children:
      //   COMP → reveals "Sum Insured"          (2-level chain — option_child)
      //   TPO  → reveals "Own Vehicle Damage Cover?" (boolean)
      //              when YES → reveals "Estimate Value" (3-level chain)
      field("policyinfo", "typeOfCover", "Type of Cover", "select", {
        required: true,
        options: [
          {
            label: "Third Party Only",
            value: "tpo",
            children: [
              {
                label: "Own Vehicle Damage Cover?",
                inputType: "boolean",
                booleanChildren: {
                  true: [{ label: "Estimate Value", inputType: "currency" }],
                },
              },
            ],
          },
          { label: "Comprehensive", value: "comp", children: [{ label: "Sum Insured", inputType: "currency" }] },
        ],
      }),
      // Synthesised: COMP option_child (2-level)
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
      // Synthesised: TPO option_child (the boolean middle link)
      field("policyinfo", "typeOfCover__o_tpo_sc0", "Type of Cover.Own Vehicle Damage Cover? (when Third Party Only)", "boolean", {
        virtual: {
          kind: "option_child",
          pkg: "policyinfo",
          parentKey: "typeOfCover",
          parentLabel: "Type of Cover",
          optionValue: "tpo",
          optionLabel: "Third Party Only",
          childIndex: 0,
        },
      }),
      // Synthesised: TPO → yes → Estimate Value (the 3-level chain leaf)
      field("policyinfo", "typeOfCover__o_tpo_sc0__y_bc0", "Type of Cover.Own Vehicle Damage Cover?.Estimate Value (when Third Party Only / yes)", "currency", {
        virtual: {
          kind: "option_child_boolean_child",
          pkg: "policyinfo",
          parentKey: "typeOfCover",
          parentLabel: "Type of Cover",
          optionValue: "tpo",
          optionLabel: "Third Party Only",
          ocChildIndex: 0,
          ocLabel: "Own Vehicle Damage Cover?",
          branch: "true",
          bcChildIndex: 0,
        },
      }),
    ]),

    // ---- Vehicle Info: exercises COLLAPSED option children (Make → Model)
    // The "Make" select has 3 options (Toyota, BMW, Honda) and each one
    // declares a child with label "Model" + per-make option list. The schema
    // would emit 3 separate "Model" columns; the collapser merges them into
    // ONE "Make.Model" column and the validator dispatches per-row.
    pack("vehicleinfo", "Vehicle Info", 3, "Vehicle Details", [
      field("vehicleinfo", "make", "Make", "select", {
        required: true,
        options: [
          { label: "Toyota", value: "toyota" },
          { label: "BMW", value: "bmw" },
          { label: "Honda", value: "honda" },
        ],
      }),
      // Synthesised collapsed option child (mirrors what expandOptionChildren produces)
      field("vehicleinfo", "make__sc0_model", "Make.Model", "select", {
        virtual: {
          kind: "option_child_collapsed",
          pkg: "vehicleinfo",
          parentKey: "make",
          parentLabel: "Make",
          childIndex: 0,
          childLabel: "Model",
          childInputType: "select",
          perOption: {
            toyota: { label: "Model", options: [{ value: "corolla", label: "Corolla" }, { value: "camry", label: "Camry" }] },
            bmw: { label: "Model", options: [{ value: "x3", label: "X3" }, { value: "x5", label: "X5" }] },
            honda: { label: "Model", options: [{ value: "civic", label: "Civic" }, { value: "accord", label: "Accord" }] },
          },
          triggeringOptionValues: ["toyota", "bmw", "honda"],
        },
      }),

      // ---- Repeatable: "Drivers" with min=1, max=4 (template will produce 4 slots)
      // Each slot has 2 sub-fields: name (required), age (optional).
      field("vehicleinfo", "drivers__r1_name", "Drivers #1 Name", "text", {
        virtual: {
          kind: "repeatable_slot", pkg: "vehicleinfo", parentKey: "drivers", parentLabel: "Drivers",
          slotIndex: 0, slotsTotal: 4, itemLabel: "Driver", subKey: "name", subLabel: "Name",
          subInputType: "text", subRequired: true, minSlots: 1, maxSlots: 4,
        },
      }),
      field("vehicleinfo", "drivers__r1_age", "Drivers #1 Age", "number", {
        virtual: {
          kind: "repeatable_slot", pkg: "vehicleinfo", parentKey: "drivers", parentLabel: "Drivers",
          slotIndex: 0, slotsTotal: 4, itemLabel: "Driver", subKey: "age", subLabel: "Age",
          subInputType: "number", subRequired: false, minSlots: 1, maxSlots: 4,
        },
      }),
      field("vehicleinfo", "drivers__r2_name", "Drivers #2 Name", "text", {
        virtual: {
          kind: "repeatable_slot", pkg: "vehicleinfo", parentKey: "drivers", parentLabel: "Drivers",
          slotIndex: 1, slotsTotal: 4, itemLabel: "Driver", subKey: "name", subLabel: "Name",
          subInputType: "text", subRequired: true, minSlots: 1, maxSlots: 4,
        },
      }),
      field("vehicleinfo", "drivers__r2_age", "Drivers #2 Age", "number", {
        virtual: {
          kind: "repeatable_slot", pkg: "vehicleinfo", parentKey: "drivers", parentLabel: "Drivers",
          slotIndex: 1, slotsTotal: 4, itemLabel: "Driver", subKey: "age", subLabel: "Age",
          subInputType: "number", subRequired: false, minSlots: 1, maxSlots: 4,
        },
      }),
      field("vehicleinfo", "drivers__r3_name", "Drivers #3 Name", "text", {
        virtual: {
          kind: "repeatable_slot", pkg: "vehicleinfo", parentKey: "drivers", parentLabel: "Drivers",
          slotIndex: 2, slotsTotal: 4, itemLabel: "Driver", subKey: "name", subLabel: "Name",
          subInputType: "text", subRequired: true, minSlots: 1, maxSlots: 4,
        },
      }),
      field("vehicleinfo", "drivers__r3_age", "Drivers #3 Age", "number", {
        virtual: {
          kind: "repeatable_slot", pkg: "vehicleinfo", parentKey: "drivers", parentLabel: "Drivers",
          slotIndex: 2, slotsTotal: 4, itemLabel: "Driver", subKey: "age", subLabel: "Age",
          subInputType: "number", subRequired: false, minSlots: 1, maxSlots: 4,
        },
      }),
      field("vehicleinfo", "drivers__r4_name", "Drivers #4 Name", "text", {
        virtual: {
          kind: "repeatable_slot", pkg: "vehicleinfo", parentKey: "drivers", parentLabel: "Drivers",
          slotIndex: 3, slotsTotal: 4, itemLabel: "Driver", subKey: "name", subLabel: "Name",
          subInputType: "text", subRequired: true, minSlots: 1, maxSlots: 4,
        },
      }),
      field("vehicleinfo", "drivers__r4_age", "Drivers #4 Age", "number", {
        virtual: {
          kind: "repeatable_slot", pkg: "vehicleinfo", parentKey: "drivers", parentLabel: "Drivers",
          slotIndex: 3, slotsTotal: 4, itemLabel: "Driver", subKey: "age", subLabel: "Age",
          subInputType: "number", subRequired: false, minSlots: 1, maxSlots: 4,
        },
      }),
    ]),

    // ---- "Extras" package: exercises BOOLEAN-CHILD REPEATABLE.
    // Mirrors the real-world `moreDriver` field — a boolean whose YES branch
    // reveals a repeatable list (default 3 slots, min 1 within the gate).
    pack("extras", "Extras", 4, "Extras", [
      // Outer boolean parent
      field("extras", "moreDriver", "Add more drivers?", "boolean"),
      // Slot 1
      field("extras", "moreDriver__y_c0_r1_lastName", "Add more drivers?.Driver Information #1 Last Name (yes)", "text", {
        virtual: {
          kind: "boolean_child_repeatable_slot", pkg: "extras", parentKey: "moreDriver",
          parentLabel: "Add more drivers?", branch: "true", bcChildIndex: 0, bcLabel: "Driver Information",
          slotIndex: 0, slotsTotal: 3, itemLabel: "Driver",
          subKey: "lastName", subLabel: "Last Name", subInputType: "text", subRequired: true,
          minSlots: 1, maxSlots: 3,
        },
      }),
      field("extras", "moreDriver__y_c0_r1_firstName", "Add more drivers?.Driver Information #1 First Name (yes)", "text", {
        virtual: {
          kind: "boolean_child_repeatable_slot", pkg: "extras", parentKey: "moreDriver",
          parentLabel: "Add more drivers?", branch: "true", bcChildIndex: 0, bcLabel: "Driver Information",
          slotIndex: 0, slotsTotal: 3, itemLabel: "Driver",
          subKey: "firstName", subLabel: "First Name", subInputType: "text", subRequired: false,
          minSlots: 1, maxSlots: 3,
        },
      }),
      // Slot 2
      field("extras", "moreDriver__y_c0_r2_lastName", "Add more drivers?.Driver Information #2 Last Name (yes)", "text", {
        virtual: {
          kind: "boolean_child_repeatable_slot", pkg: "extras", parentKey: "moreDriver",
          parentLabel: "Add more drivers?", branch: "true", bcChildIndex: 0, bcLabel: "Driver Information",
          slotIndex: 1, slotsTotal: 3, itemLabel: "Driver",
          subKey: "lastName", subLabel: "Last Name", subInputType: "text", subRequired: true,
          minSlots: 1, maxSlots: 3,
        },
      }),
      field("extras", "moreDriver__y_c0_r2_firstName", "Add more drivers?.Driver Information #2 First Name (yes)", "text", {
        virtual: {
          kind: "boolean_child_repeatable_slot", pkg: "extras", parentKey: "moreDriver",
          parentLabel: "Add more drivers?", branch: "true", bcChildIndex: 0, bcLabel: "Driver Information",
          slotIndex: 1, slotsTotal: 3, itemLabel: "Driver",
          subKey: "firstName", subLabel: "First Name", subInputType: "text", subRequired: false,
          minSlots: 1, maxSlots: 3,
        },
      }),
      // Slot 3
      field("extras", "moreDriver__y_c0_r3_lastName", "Add more drivers?.Driver Information #3 Last Name (yes)", "text", {
        virtual: {
          kind: "boolean_child_repeatable_slot", pkg: "extras", parentKey: "moreDriver",
          parentLabel: "Add more drivers?", branch: "true", bcChildIndex: 0, bcLabel: "Driver Information",
          slotIndex: 2, slotsTotal: 3, itemLabel: "Driver",
          subKey: "lastName", subLabel: "Last Name", subInputType: "text", subRequired: true,
          minSlots: 1, maxSlots: 3,
        },
      }),
      field("extras", "moreDriver__y_c0_r3_firstName", "Add more drivers?.Driver Information #3 First Name (yes)", "text", {
        virtual: {
          kind: "boolean_child_repeatable_slot", pkg: "extras", parentKey: "moreDriver",
          parentLabel: "Add more drivers?", branch: "true", bcChildIndex: 0, bcLabel: "Driver Information",
          slotIndex: 2, slotsTotal: 3, itemLabel: "Driver",
          subKey: "firstName", subLabel: "First Name", subInputType: "text", subRequired: false,
          minSlots: 1, maxSlots: 3,
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

  // Also fill row 5 with the new GOOD vehicle data (collapsed + repeatable):
  setCell(5, "vehicleinfo", "make", "bmw");
  setCell(5, "vehicleinfo", "make__sc0_model", "x5"); // valid for BMW
  setCell(5, "vehicleinfo", "drivers__r1_name", "Alice"); // slot 1 filled
  setCell(5, "vehicleinfo", "drivers__r1_age", 35);
  setCell(5, "vehicleinfo", "drivers__r2_name", "Bob"); // slot 2 filled (in order — OK)
  // slots 3 & 4 empty — fine

  // Row 7 — GOOD: Toyota + Corolla (collapsed dispatch case 2: different parent)
  setCell(7, "insured", "category", "personal");
  setCell(7, "insured", "firstName", "Charlie");
  setCell(7, "policyinfo", "startedDate", "31/12/2026");
  setCell(7, "policyinfo", "typeOfCover", "tpo");
  setCell(7, "vehicleinfo", "make", "toyota");
  setCell(7, "vehicleinfo", "make__sc0_model", "corolla"); // valid for Toyota
  setCell(7, "vehicleinfo", "drivers__r1_name", "Charlie");

  // Row 8 — BAD: BMW + "civic" (Honda's model, not BMW's) → collapsed dispatch fail
  setCell(8, "insured", "category", "personal");
  setCell(8, "insured", "firstName", "Dave");
  setCell(8, "policyinfo", "startedDate", "31/12/2026");
  setCell(8, "policyinfo", "typeOfCover", "tpo");
  setCell(8, "vehicleinfo", "make", "bmw");
  setCell(8, "vehicleinfo", "make__sc0_model", "civic"); // INVALID for BMW
  setCell(8, "vehicleinfo", "drivers__r1_name", "Dave");

  // Row 9 — BAD: collapsed-child filled without parent → should fail
  setCell(9, "insured", "category", "personal");
  setCell(9, "insured", "firstName", "Eve");
  setCell(9, "policyinfo", "startedDate", "31/12/2026");
  setCell(9, "policyinfo", "typeOfCover", "tpo");
  setCell(9, "vehicleinfo", "make__sc0_model", "x5"); // no parent "make" set
  setCell(9, "vehicleinfo", "drivers__r1_name", "Eve");

  // Row 10 — BAD: repeatable slot ORDER violation (slot #1 empty, #2 filled)
  setCell(10, "insured", "category", "personal");
  setCell(10, "insured", "firstName", "Frank");
  setCell(10, "policyinfo", "startedDate", "31/12/2026");
  setCell(10, "policyinfo", "typeOfCover", "tpo");
  setCell(10, "vehicleinfo", "make", "honda");
  setCell(10, "vehicleinfo", "make__sc0_model", "civic");
  // skip drivers #1 entirely
  setCell(10, "vehicleinfo", "drivers__r2_name", "Grace"); // hole → should fail

  // Row 11 — BAD: repeatable MIN violation (no drivers at all, but min=1)
  setCell(11, "insured", "category", "personal");
  setCell(11, "insured", "firstName", "Helen");
  setCell(11, "policyinfo", "startedDate", "31/12/2026");
  setCell(11, "policyinfo", "typeOfCover", "tpo");
  setCell(11, "vehicleinfo", "make", "honda");
  setCell(11, "vehicleinfo", "make__sc0_model", "accord");
  // no drivers — min=1 → should fail

  // Row 12 — GOOD: repeatable with all 3 slots filled in order, age optional
  setCell(12, "insured", "category", "personal");
  setCell(12, "insured", "firstName", "Ivy");
  setCell(12, "policyinfo", "startedDate", "31/12/2026");
  setCell(12, "policyinfo", "typeOfCover", "tpo");
  setCell(12, "vehicleinfo", "make", "honda");
  setCell(12, "vehicleinfo", "make__sc0_model", "accord");
  setCell(12, "vehicleinfo", "drivers__r1_name", "Ivy");
  setCell(12, "vehicleinfo", "drivers__r1_age", 28);
  setCell(12, "vehicleinfo", "drivers__r2_name", "Jack");
  setCell(12, "vehicleinfo", "drivers__r3_name", "Kate"); // age omitted — fine

  // Row 13 — BAD: repeatable filled-slot missing REQUIRED sub-field
  setCell(13, "insured", "category", "personal");
  setCell(13, "insured", "firstName", "Liam");
  setCell(13, "policyinfo", "startedDate", "31/12/2026");
  setCell(13, "policyinfo", "typeOfCover", "tpo");
  setCell(13, "vehicleinfo", "make", "toyota");
  setCell(13, "vehicleinfo", "make__sc0_model", "camry");
  // Slot 1 filled (age) but name (required) missing
  setCell(13, "vehicleinfo", "drivers__r1_age", 40);

  // ---- 3-level conditional chain rows (TPO → Own Vehicle Damage? → Estimate) ----

  // Row 14 — GOOD: full chain, tpo + own_vehicle_damage=yes + estimate filled
  setCell(14, "insured", "category", "personal");
  setCell(14, "insured", "firstName", "Mia");
  setCell(14, "policyinfo", "startedDate", "31/12/2026");
  setCell(14, "policyinfo", "typeOfCover", "tpo");
  setCell(14, "policyinfo", "typeOfCover__o_tpo_sc0", "yes");          // middle = yes
  setCell(14, "policyinfo", "typeOfCover__o_tpo_sc0__y_bc0", 80000);   // leaf
  setCell(14, "vehicleinfo", "make", "honda");
  setCell(14, "vehicleinfo", "make__sc0_model", "civic");
  setCell(14, "vehicleinfo", "drivers__r1_name", "Mia");

  // Row 15 — WARNING: leaf filled but middle says NO (boolean branch mismatch)
  setCell(15, "insured", "category", "personal");
  setCell(15, "insured", "firstName", "Noah");
  setCell(15, "policyinfo", "startedDate", "31/12/2026");
  setCell(15, "policyinfo", "typeOfCover", "tpo");
  setCell(15, "policyinfo", "typeOfCover__o_tpo_sc0", "no");           // middle = no
  setCell(15, "policyinfo", "typeOfCover__o_tpo_sc0__y_bc0", 50000);   // leaf when "no" → warn
  setCell(15, "vehicleinfo", "make", "honda");
  setCell(15, "vehicleinfo", "make__sc0_model", "accord");
  setCell(15, "vehicleinfo", "drivers__r1_name", "Noah");

  // Row 16 — WARNING: leaf filled when OUTER select isn't tpo (chain root mismatch)
  setCell(16, "insured", "category", "personal");
  setCell(16, "insured", "firstName", "Olivia");
  setCell(16, "policyinfo", "startedDate", "31/12/2026");
  setCell(16, "policyinfo", "typeOfCover", "comp");                    // outer = comp, not tpo
  setCell(16, "policyinfo", "typeOfCover__o_comp_sc0", 300000);
  setCell(16, "policyinfo", "typeOfCover__o_tpo_sc0__y_bc0", 50000);   // leaf when outer=comp → warn
  setCell(16, "vehicleinfo", "make", "toyota");
  setCell(16, "vehicleinfo", "make__sc0_model", "corolla");
  setCell(16, "vehicleinfo", "drivers__r1_name", "Olivia");

  // ---- Boolean-child REPEATABLE rows (extras.moreDriver) ----

  // Row 17 — GOOD: gate=yes + slots 1 & 2 filled in order, third blank.
  setCell(17, "insured", "category", "personal");
  setCell(17, "insured", "firstName", "Pat");
  setCell(17, "policyinfo", "startedDate", "31/12/2026");
  setCell(17, "policyinfo", "typeOfCover", "tpo");
  setCell(17, "vehicleinfo", "make", "honda");
  setCell(17, "vehicleinfo", "make__sc0_model", "civic");
  setCell(17, "vehicleinfo", "drivers__r1_name", "Pat");
  setCell(17, "extras", "moreDriver", "yes");
  setCell(17, "extras", "moreDriver__y_c0_r1_lastName", "Smith");
  setCell(17, "extras", "moreDriver__y_c0_r1_firstName", "Sam");
  setCell(17, "extras", "moreDriver__y_c0_r2_lastName", "Lee");

  // Row 18 — GOOD: gate=no, no slot data → quiet (no min-required, no warns).
  setCell(18, "insured", "category", "personal");
  setCell(18, "insured", "firstName", "Quinn");
  setCell(18, "policyinfo", "startedDate", "31/12/2026");
  setCell(18, "policyinfo", "typeOfCover", "tpo");
  setCell(18, "vehicleinfo", "make", "honda");
  setCell(18, "vehicleinfo", "make__sc0_model", "accord");
  setCell(18, "vehicleinfo", "drivers__r1_name", "Quinn");
  setCell(18, "extras", "moreDriver", "no");

  // Row 19 — WARNING: gate=no but slot 1 filled → boolean-gate violation
  // (no min-required warning since the gate is OFF — only the gate warns).
  setCell(19, "insured", "category", "personal");
  setCell(19, "insured", "firstName", "Riley");
  setCell(19, "policyinfo", "startedDate", "31/12/2026");
  setCell(19, "policyinfo", "typeOfCover", "tpo");
  setCell(19, "vehicleinfo", "make", "toyota");
  setCell(19, "vehicleinfo", "make__sc0_model", "corolla");
  setCell(19, "vehicleinfo", "drivers__r1_name", "Riley");
  setCell(19, "extras", "moreDriver", "no");
  setCell(19, "extras", "moreDriver__y_c0_r1_lastName", "Stowaway"); // wrong branch

  // Row 20 — WARNING: gate=yes but slot 2 filled while slot 1 is empty (hole).
  setCell(20, "insured", "category", "personal");
  setCell(20, "insured", "firstName", "Sam");
  setCell(20, "policyinfo", "startedDate", "31/12/2026");
  setCell(20, "policyinfo", "typeOfCover", "tpo");
  setCell(20, "vehicleinfo", "make", "bmw");
  setCell(20, "vehicleinfo", "make__sc0_model", "x5");
  setCell(20, "vehicleinfo", "drivers__r1_name", "Sam");
  setCell(20, "extras", "moreDriver", "yes");
  setCell(20, "extras", "moreDriver__y_c0_r2_lastName", "Skipper"); // hole at slot 1

  const buf2 = await wb.xlsx.writeBuffer();
  const parsed = await parseImportWorkbook(Buffer.from(buf2 as ArrayBuffer), schema);
  console.log(`\nParsed columns (${parsed.columns.length}):`, parsed.columns);
  console.log("Unknown columns:", parsed.unknownColumns);
  console.log("Missing columns:", parsed.missingColumns);
  console.log("Data rows:", JSON.stringify(parsed.rows, null, 2));

  console.log("\n--- Validator output ---");
  const validated = validateRows(parsed.rows, schema);
  for (const row of validated) {
    console.log(`Row ${row.excelRow}: ${row.errors.length} error(s), ${row.warnings.length} warning(s)`);
    for (const e of row.errors) console.log(`  ! [${e.column ?? "row"}] ${e.message}`);
    for (const w of row.warnings) console.log(`  ~ [${w.column ?? "row"}] ${w.message}`);
  }

  console.log("\n--- Payload (row 5, the original good company row + vehicle bits) ---");
  const goodRow = validated.find((r) => r.excelRow === 5);
  if (goodRow) {
    const built = buildPolicyPayload(goodRow, schema);
    console.log(JSON.stringify(built, null, 2));
  }

  console.log("\n--- Payload (row 12, all-good repeatable + collapsed) ---");
  const repGoodRow = validated.find((r) => r.excelRow === 12);
  if (repGoodRow) {
    const built = buildPolicyPayload(repGoodRow, schema);
    console.log(JSON.stringify(built, null, 2));
  }

  console.log("\n--- Payload (row 14, 3-level chain GOOD: tpo→yes→estimate) ---");
  const chainRow = validated.find((r) => r.excelRow === 14);
  if (chainRow) {
    const built = buildPolicyPayload(chainRow, schema);
    console.log(JSON.stringify(built, null, 2));
    // Sanity: the leaf must serialise to the wizard's nested RHF key.
    // Middle link uses __c<ocIdx> (InlineSelectWithChildren), leaf uses
    // __<branch>__bc<bcIdx> (BooleanBranchFields).
    const expected = "policyinfo__typeOfCover__opt_tpo__c0__true__bc0";
    const got = built.payload.packages.policyinfo?.values?.[expected];
    if (got !== 80000) {
      console.log(`!! 3-level chain payload mismatch: ${expected} = ${JSON.stringify(got)} (expected 80000)`);
      process.exitCode = 1;
    } else {
      console.log(`OK: 3-level chain payload key "${expected}" = 80000`);
    }
    // Regression guard: legacy `__sc0` middle key must NOT appear.
    if (
      built.payload.packages.policyinfo?.values?.[
        "policyinfo__typeOfCover__opt_tpo__sc0__true__bc0"
      ] !== undefined
    ) {
      console.log("!! Legacy __sc0 middle key still present — option-child naming-fix incomplete");
      process.exitCode = 1;
    }
  }

  // Row 5 also exercises the TOP-LEVEL boolean child (hpowner=yes → HP Company).
  // The payload key MUST be `__c0`, NOT `__bc0` — that's the convention the
  // wizard registers (PackageBlock uses `${name}__true__c${cIdx}`).
  if (goodRow) {
    const built = buildPolicyPayload(goodRow, schema);
    const expected = "policyinfo__hpowner__true__c0";
    const got = built.payload.packages.policyinfo?.values?.[expected];
    if (got !== "Acme Finance") {
      console.log(`!! Boolean-child payload mismatch: ${expected} = ${JSON.stringify(got)} (expected "Acme Finance")`);
      process.exitCode = 1;
    } else {
      console.log(`OK: boolean-child payload key "${expected}" = "Acme Finance"`);
    }
    // And it must NOT be at the old __bc0 path.
    if (built.payload.packages.policyinfo?.values?.["policyinfo__hpowner__true__bc0"] !== undefined) {
      console.log("!! Legacy __bc0 key still present in payload — wizard naming-fix incomplete");
      process.exitCode = 1;
    }

    // Same row also exercises the 2-level OPTION CHILD (typeOfCover=comp → Sum Insured).
    // Top-level select option children are registered by InlineSelectWithChildren
    // with `__c<idx>`, so the payload key must use `__c0` (NOT the legacy `__sc0`).
    const optExpected = "policyinfo__typeOfCover__opt_comp__c0";
    const optGot = built.payload.packages.policyinfo?.values?.[optExpected];
    if (optGot !== 250000) {
      console.log(`!! Option-child payload mismatch: ${optExpected} = ${JSON.stringify(optGot)} (expected 250000)`);
      process.exitCode = 1;
    } else {
      console.log(`OK: option-child payload key "${optExpected}" = 250000`);
    }
    if (built.payload.packages.policyinfo?.values?.["policyinfo__typeOfCover__opt_comp__sc0"] !== undefined) {
      console.log("!! Legacy __sc0 option-child key still present — naming-fix incomplete");
      process.exitCode = 1;
    }
  }

  console.log("\n--- Payload (row 17, boolean-child REPEATABLE GOOD) ---");
  const boolRepRow = validated.find((r) => r.excelRow === 17);
  if (boolRepRow) {
    const built = buildPolicyPayload(boolRepRow, schema);
    console.log(JSON.stringify(built.payload.packages.extras, null, 2));
    const expected = "extras__moreDriver__true__c0";
    const got = built.payload.packages.extras?.values?.[expected];
    const expectedItems = [
      { lastName: "Smith", firstName: "Sam" },
      { lastName: "Lee" },
    ];
    if (JSON.stringify(got) !== JSON.stringify(expectedItems)) {
      console.log(
        `!! Boolean-child repeatable payload mismatch:\n   key=${expected}\n   got=${JSON.stringify(got)}\n   expected=${JSON.stringify(expectedItems)}`,
      );
      process.exitCode = 1;
    } else {
      console.log(`OK: boolean-child repeatable payload "${expected}" = ${JSON.stringify(got)}`);
    }
  }

  // Severity expectations under the unified single-mode validator:
  //
  //   "clean"   → 0 errors AND 0 warnings   (rows 5, 7, 12)
  //   "error"   → ≥1 error                  (only row 9: collapsed-child
  //                                          filled WITHOUT parent — the
  //                                          dispatch literally cannot run)
  //   "warning" → 0 errors but ≥1 warning   (rows 8, 10, 11, 13 — pure
  //                                          gating / off-category / slot
  //                                          violations are warnings now,
  //                                          since the staging review screen
  //                                          lets the admin inspect them)
  //
  //   Note row 6 is "category=company" but the personal name field is
  //   filled (warning) AND the company-required fields are missing (error),
  //   so it's classified as "error".
  type Severity = "clean" | "error" | "warning";
  const expect = (excelRow: number, severity: Severity) => {
    const r = validated.find((x) => x.excelRow === excelRow);
    if (!r) {
      console.log(`!! Row ${excelRow}: missing from validator output`);
      return false;
    }
    const e = r.errors.length;
    const w = r.warnings.length;
    let pass = false;
    if (severity === "clean") pass = e === 0 && w === 0;
    else if (severity === "error") pass = e >= 1;
    else if (severity === "warning") pass = e === 0 && w >= 1;
    if (!pass) {
      console.log(
        `!! Row ${excelRow}: expected "${severity}", got errors=${e}, warnings=${w}`,
      );
      return false;
    }
    return true;
  };
  const checks = [
    expect(5, "clean"),
    expect(6, "error"),
    expect(7, "clean"),
    expect(8, "warning"),
    expect(9, "error"),
    expect(10, "warning"),
    expect(11, "warning"),
    expect(12, "clean"),
    expect(13, "warning"),
    // 3-level chain assertions:
    expect(14, "clean"),    // full chain consistent
    expect(15, "warning"),  // leaf filled when middle = "no"
    expect(16, "warning"),  // leaf filled when outer ≠ "tpo"
    // Boolean-child REPEATABLE assertions:
    expect(17, "clean"),    // gate=yes, slots in order
    expect(18, "clean"),    // gate=no, no slots filled → silent
    expect(19, "warning"),  // gate=no but a slot was filled
    expect(20, "warning"),  // gate=yes, slot 1 empty but slot 2 filled (hole)
  ];
  console.log(`\nAssertions: ${checks.filter(Boolean).length}/${checks.length} passed`);
  if (checks.some((c) => !c)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
