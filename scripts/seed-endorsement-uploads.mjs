import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

const ENDORSEMENT_TYPES = [
  {
    label: "Endorsement Request Form",
    value: "endorsement_request_form",
    sort_order: 20,
    meta: {
      description: "Signed endorsement request or instruction letter",
      acceptedTypes: ["image/*", "application/pdf"],
      maxSizeMB: 10,
      required: true,
      flows: ["endorsement"],
    },
  },
  {
    label: "Supporting Documents",
    value: "endorsement_supporting_docs",
    sort_order: 21,
    meta: {
      description: "Any supporting documents for the endorsement (e.g. new vehicle registration, ID change proof)",
      acceptedTypes: ["image/*", "application/pdf"],
      maxSizeMB: 10,
      required: false,
      flows: ["endorsement"],
    },
  },
  {
    label: "Endorsement Confirmation",
    value: "endorsement_confirmation",
    sort_order: 22,
    meta: {
      description: "Confirmation from insurer that endorsement has been processed",
      acceptedTypes: ["image/*", "application/pdf"],
      maxSizeMB: 10,
      required: false,
      flows: ["endorsement"],
    },
  },
  {
    label: "Payment Record",
    value: "endorsement_payment_record",
    sort_order: 23,
    meta: {
      description: "Payment proof for endorsement premium",
      acceptedTypes: ["image/*", "application/pdf"],
      maxSizeMB: 10,
      required: false,
      flows: ["endorsement"],
      requirePaymentDetails: true,
    },
  },
];

async function main() {
  // 1) Create endorsement upload types
  for (const tpl of ENDORSEMENT_TYPES) {
    const existing = await sql`
      SELECT id FROM form_options
      WHERE group_key = 'upload_document_types' AND value = ${tpl.value}
      LIMIT 1
    `;
    if (existing.length > 0) {
      console.log(`${tpl.label}: already exists, skipped`);
      continue;
    }
    await sql`
      INSERT INTO form_options (group_key, label, value, value_type, sort_order, is_active, meta)
      VALUES ('upload_document_types', ${tpl.label}, ${tpl.value}, 'json', ${tpl.sort_order}, true, ${JSON.stringify(tpl.meta)}::jsonb)
    `;
    console.log(`${tpl.label}: created`);
  }

  // 2) Get all non-endorsement flow values
  const allFlows = await sql`
    SELECT value FROM form_options WHERE group_key = 'flows'
  `;
  const nonEndorsementFlows = allFlows
    .map((f) => f.value)
    .filter((v) => !v.toLowerCase().includes("endorsement"));

  console.log(`\nNon-endorsement flows: [${nonEndorsementFlows.join(", ")}]`);

  // 3) Restrict existing generic upload types to non-endorsement flows
  const endorsementKeys = new Set(ENDORSEMENT_TYPES.map((t) => t.value));
  const existing = await sql`
    SELECT id, label, value, meta FROM form_options
    WHERE group_key = 'upload_document_types' AND is_active = true
  `;

  for (const row of existing) {
    if (endorsementKeys.has(row.value)) continue;
    const meta = row.meta || {};
    const flows = meta.flows;

    if (!flows || flows.length === 0) {
      if (nonEndorsementFlows.length > 0) {
        await sql`
          UPDATE form_options
          SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{flows}', ${JSON.stringify(nonEndorsementFlows)}::jsonb)
          WHERE id = ${row.id}
        `;
        console.log(`${row.label}: restricted to [${nonEndorsementFlows.join(", ")}]`);
      }
    } else {
      console.log(`${row.label}: already has flow restriction [${flows.join(", ")}], skipped`);
    }
  }

  await sql.end();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
