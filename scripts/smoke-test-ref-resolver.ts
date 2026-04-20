/**
 * Smoke test for the entity-picker / agent-picker ref-resolution post-pass.
 *
 * The validator itself is pure (no DB), and DB-touching code lives in
 * `attachRefResolutionErrors` + `EntityResolutionCache`. This test mocks
 * the cache so we can run without Postgres but still exercise the
 * end-to-end "validateRows → resolver → row.errors" flow.
 *
 * Severity model: missing refs = HARD ERROR (block commit). Admins fix
 * either by editing master data + re-validating, or by using the inline
 * picker in the staging UI.
 *
 * Run:  npx tsx scripts/smoke-test-ref-resolver.ts
 */
import { validateRows } from "../lib/import/validate";
import {
  attachRefResolutionErrors,
  EntityResolutionCache,
  type ResolvedAgent,
  type ResolvedEntity,
} from "../lib/import/entity-resolver";
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
//  In-memory mock cache — bypasses Postgres entirely
// ---------------------------------------------------------------------------
class MockCache extends EntityResolutionCache {
  constructor(
    private readonly knownAgents: Set<string>,
    private readonly knownEntities: Map<string, Record<string, unknown>>,
  ) {
    super();
  }
  override async resolveAgent(userNumber: string): Promise<ResolvedAgent | null> {
    const trimmed = userNumber.trim();
    if (!this.knownAgents.has(trimmed)) return null;
    return { userId: 1, userNumber: trimmed, displayName: trimmed };
  }
  override async resolveEntity(
    refFlow: string,
    refValue: string,
  ): Promise<ResolvedEntity | null> {
    const flat = this.knownEntities.get(`${refFlow}::${refValue.trim()}`);
    if (!flat) return null;
    return {
      policyId: 1,
      policyNumber: refValue.trim(),
      displayName: refValue.trim(),
      flatSnapshot: flat,
    };
  }
  override async resolveEntitySnapshot(
    refFlow: string,
    refValue: string,
  ): Promise<Record<string, unknown> | null> {
    return this.knownEntities.get(`${refFlow}::${refValue.trim()}`) ?? null;
  }
}

// ---------------------------------------------------------------------------
//  Synthetic schema: one package with three picker columns
// ---------------------------------------------------------------------------
const schema: ImportFlowSchema = {
  flowKey: "policyset",
  flowLabel: "Policy Set",
  packages: [
    {
      key: "policyinfo",
      label: "Policy Info",
      stepNumber: 1,
      stepLabel: "Step 1",
      categoryOptions: [],
      fields: [
        {
          key: "insurer",
          fullKey: "policyinfo__insurer",
          pkg: "policyinfo",
          label: "Insurance Company",
          inputType: "entity_picker",
          required: false,
          options: [],
          isCategory: false,
          unsupported: false,
          categories: [],
          effectiveOrder: 1,
          dbId: 1,
          entityPicker: { flow: "insuranceSet", mappings: [] },
        },
        {
          key: "broker",
          fullKey: "policyinfo__broker",
          pkg: "policyinfo",
          label: "Broker",
          inputType: "entity_picker",
          required: false,
          options: [],
          isCategory: false,
          unsupported: false,
          categories: [],
          effectiveOrder: 2,
          dbId: 2,
          entityPicker: { flow: "collaboratorSet", mappings: [] },
        },
        {
          key: "agent",
          fullKey: "policyinfo__agent",
          pkg: "policyinfo",
          label: "Sales Agent",
          inputType: "agent_picker",
          required: false,
          options: [],
          isCategory: false,
          unsupported: false,
          categories: [],
          effectiveOrder: 3,
          dbId: 3,
          entityPicker: { flow: "__agent__", mappings: [] },
        },
        {
          key: "remark",
          fullKey: "policyinfo__remark",
          pkg: "policyinfo",
          label: "Remark",
          inputType: "text",
          required: false,
          options: [],
          isCategory: false,
          unsupported: false,
          categories: [],
          effectiveOrder: 4,
          dbId: 4,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
//  Mock data — what the cache "finds" in the DB
// ---------------------------------------------------------------------------
const cache = new MockCache(
  new Set(["U-001", "U-002"]),
  new Map([
    ["insuranceSet::INS-AAA", { name: "AAA Insurance" }],
    ["collaboratorSet::COL-001", { name: "Broker One" }],
  ]),
);

// ---------------------------------------------------------------------------
//  Test rows — mix of present, missing, and empty refs
// ---------------------------------------------------------------------------
const rows = [
  // Row 1: all refs known + one extra — should be clean
  {
    excelRow: 2,
    values: {
      "policyinfo.insurer": "INS-AAA",
      "policyinfo.broker": "COL-001",
      "policyinfo.agent": "U-001",
      "policyinfo.remark": "ok",
    },
  },
  // Row 2: insurer missing (unknown number)
  {
    excelRow: 3,
    values: {
      "policyinfo.insurer": "INS-MISSING",
      "policyinfo.broker": "COL-001",
      "policyinfo.agent": "U-002",
    },
  },
  // Row 3: agent missing
  {
    excelRow: 4,
    values: {
      "policyinfo.insurer": "INS-AAA",
      "policyinfo.broker": "COL-001",
      "policyinfo.agent": "U-NOPE",
    },
  },
  // Row 4: empty refs — should NOT raise errors (gating handled elsewhere)
  {
    excelRow: 5,
    values: {
      "policyinfo.remark": "no refs",
    },
  },
  // Row 5: same insurer as row 2 (cache hit path) + missing broker
  {
    excelRow: 6,
    values: {
      "policyinfo.insurer": "INS-MISSING",
      "policyinfo.broker": "COL-NOPE",
      "policyinfo.agent": "U-001",
    },
  },
];

async function main() {
  console.log("Ref-resolver smoke test");
  const validated = validateRows(rows, schema);

  // Sanity: validateRows shouldn't have flagged any of these (all empties allowed)
  for (const v of validated) {
    ok(`row ${v.excelRow}: validateRows produced no errors`, v.errors.length === 0,
       `errors: ${JSON.stringify(v.errors)}`);
  }

  await attachRefResolutionErrors(validated, schema, cache);

  // Row 1: clean
  const r1 = validated[0];
  ok("row 2: all refs resolved → no errors",
     r1.errors.length === 0, `errors: ${JSON.stringify(r1.errors)}`);

  // Row 2: missing insurer
  const r2 = validated[1];
  ok("row 3: missing insurer flagged on policyinfo.insurer",
     r2.errors.some((e) => e.column === "policyinfo.insurer"),
     `errors: ${JSON.stringify(r2.errors)}`);
  ok("row 3: present broker NOT flagged",
     !r2.errors.some((e) => e.column === "policyinfo.broker"));
  ok("row 3: present agent NOT flagged",
     !r2.errors.some((e) => e.column === "policyinfo.agent"));

  // Row 3: missing agent
  const r3 = validated[2];
  ok("row 4: missing agent flagged on policyinfo.agent",
     r3.errors.some(
       (e) => e.column === "policyinfo.agent" && /Agent .* not found/.test(e.message),
     ),
     `errors: ${JSON.stringify(r3.errors)}`);

  // Row 4: empty refs → no errors
  const r4 = validated[3];
  ok("row 5: empty ref cells produce no errors",
     r4.errors.length === 0, `errors: ${JSON.stringify(r4.errors)}`);

  // Row 5: missing insurer (cache hit) AND missing broker
  const r5 = validated[4];
  ok("row 6: missing insurer flagged (cache hit)",
     r5.errors.some((e) => e.column === "policyinfo.insurer"));
  ok("row 6: missing broker flagged",
     r5.errors.some(
       (e) => e.column === "policyinfo.broker" && /not found in flow "collaboratorSet"/.test(e.message),
     ),
     `errors: ${JSON.stringify(r5.errors)}`);
  ok("row 6: present agent NOT flagged",
     !r5.errors.some((e) => e.column === "policyinfo.agent"));

  // Idempotence: a second pass shouldn't double-add the same error.
  const beforeCount = validated.reduce((sum, r) => sum + r.errors.length, 0);
  await attachRefResolutionErrors(validated, schema, cache);
  const afterCount = validated.reduce((sum, r) => sum + r.errors.length, 0);
  ok("re-running resolver doesn't duplicate errors", beforeCount === afterCount,
     `before=${beforeCount}, after=${afterCount}`);

  if (process.exitCode) {
    console.log("\nFAILED");
  } else {
    console.log("\nAll checks passed.");
  }
}

void main();
