/**
 * Smoke test for the staging-area validator + summary aggregator.
 *
 * Pure-logic test — does NOT touch the database, so it's safe to run
 * without an active Neon connection. Builds a synthetic flow schema in
 * memory and feeds it through validateRows / buildBatchSummary, then
 * asserts the expected error/warning counts and summary buckets.
 *
 * Severity model under test:
 *   • errors   — hard-blockers (bad numbers, bad dates, Required, etc.)
 *   • warnings — review-only (unknown selects, malformed emails, etc.)
 *
 * Run:  npx tsx scripts/smoke-test-batch-validation.ts
 */
import { validateRows } from "../lib/import/validate";
import { buildBatchSummary } from "../lib/import/batch-service";
import type { ImportFlowSchema } from "../lib/import/schema";

function ok(name: string, cond: boolean, extra?: string) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
//  Build a tiny synthetic schema (one package, a few field shapes)
// ---------------------------------------------------------------------------
const schema: ImportFlowSchema = {
  flowKey: "policyset",
  flowLabel: "Policy Set",
  packages: [
    {
      key: "vehicleinfo",
      label: "Vehicle",
      stepNumber: 1,
      stepLabel: "Step 1",
      categoryOptions: [],
      fields: [
        {
          key: "make",
          fullKey: "vehicleinfo__make",
          pkg: "vehicleinfo",
          label: "Make",
          inputType: "select",
          required: true,
          options: [
            { label: "Toyota", value: "toyota" },
            { label: "Honda", value: "honda" },
          ],
          isCategory: false,
          unsupported: false,
          categories: [],
          effectiveOrder: 1,
          dbId: 1,
        },
        {
          key: "year",
          fullKey: "vehicleinfo__year",
          pkg: "vehicleinfo",
          label: "Year",
          inputType: "number",
          required: false,
          options: [],
          isCategory: false,
          unsupported: false,
          categories: [],
          effectiveOrder: 2,
          dbId: 2,
        },
        {
          key: "ownerEmail",
          fullKey: "vehicleinfo__ownerEmail",
          pkg: "vehicleinfo",
          label: "Owner email",
          inputType: "email",
          required: false,
          options: [],
          isCategory: false,
          unsupported: false,
          categories: [],
          effectiveOrder: 3,
          dbId: 3,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
//  Test rows
// ---------------------------------------------------------------------------
const rows = [
  // Row 1: clean
  { excelRow: 2, values: { "vehicleinfo.make": "Toyota", "vehicleinfo.year": "2020", "vehicleinfo.ownerEmail": "a@b.com" } },
  // Row 2: unknown Make ("Tesla") — warning, NOT error
  { excelRow: 3, values: { "vehicleinfo.make": "Tesla", "vehicleinfo.year": "2021" } },
  // Row 3: bad number — error (corruption risk)
  { excelRow: 4, values: { "vehicleinfo.make": "Honda", "vehicleinfo.year": "twenty" } },
  // Row 4: bad email — warning
  { excelRow: 5, values: { "vehicleinfo.make": "Honda", "vehicleinfo.ownerEmail": "not-an-email" } },
  // Row 5: missing required Make — error
  { excelRow: 6, values: { "vehicleinfo.year": "2019" } },
];

console.log("--- VALIDATION ---");
const validated = validateRows(rows, schema);
console.log("  per-row errors:", validated.map((r) => r.errors.length));
console.log("  per-row warns: ", validated.map((r) => r.warnings.length));

ok("Row 1 clean (no errors, no warnings)",
  validated[0].errors.length === 0 && validated[0].warnings.length === 0);

ok("Row 2 unknown Make = warning (no error)",
  validated[1].errors.length === 0 && validated[1].warnings.length === 1,
  `errors=${JSON.stringify(validated[1].errors)} warns=${JSON.stringify(validated[1].warnings)}`,
);
ok("Row 2 keeps raw 'Tesla' value", validated[1].values["vehicleinfo.make"] === "Tesla");

ok("Row 3 bad number = error (corruption risk)",
  validated[2].errors.length === 1 && validated[2].warnings.length === 0);

ok("Row 4 bad email = warning",
  validated[3].errors.length === 0 && validated[3].warnings.length === 1);

ok("Row 5 missing required = error",
  validated[4].errors.some((e) => e.message === "Required"));

// ---------------------------------------------------------------------------
//  Aggregator
// ---------------------------------------------------------------------------
console.log("\n--- BATCH SUMMARY ---");
const aggregatorRows = validated.map((r, i) => ({
  errors: r.errors,
  warnings: r.warnings,
  rawValues: rows[i].values,
  status: "pending" as const,
}));
const summary = buildBatchSummary(aggregatorRows, schema, {
  unknownColumns: ["someExtraCol"],
  missingColumns: [],
});
console.log("  unknownValuesByColumn:", JSON.stringify(summary.unknownValuesByColumn, null, 2));
console.log("  missingRequiredByColumn:", JSON.stringify(summary.missingRequiredByColumn, null, 2));
console.log("  otherErrorsByColumn:", JSON.stringify(summary.otherErrorsByColumn, null, 2));
console.log("  otherWarningsByColumn:", JSON.stringify(summary.otherWarningsByColumn, null, 2));

ok("Summary captures unknown Make=Tesla",
  !!summary.unknownValuesByColumn["vehicleinfo.make"] &&
  summary.unknownValuesByColumn["vehicleinfo.make"].samples.includes("Tesla"));
ok("Summary captures missing required Make for row 5",
  !!summary.missingRequiredByColumn["vehicleinfo.make"] &&
  summary.missingRequiredByColumn["vehicleinfo.make"].rowCount === 1);
ok("Summary captures bad year as other error",
  !!summary.otherErrorsByColumn["vehicleinfo.year"]);
ok("Summary captures bad email as other warning",
  !!summary.otherWarningsByColumn["vehicleinfo.ownerEmail"]);
ok("Summary forwards file-level unknown columns",
  summary.unknownColumns.includes("someExtraCol"));

if (process.exitCode) {
  console.log("\n[FAILED]");
  process.exit(process.exitCode);
} else {
  console.log("\n[OK] All assertions passed.");
}
