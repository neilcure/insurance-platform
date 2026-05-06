import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, ssl: "require" });

const actions = [
  {
    group_key: "workflow_actions",
    label: "Send to User",
    value: "send_to_user",
    value_type: "json",
    sort_order: 1,
    is_active: true,
    meta: {
      type: "email",
      icon: "Send",
      description: "Send this record to a user via email notification.",
      requiresInput: true,
      inputPlaceholder: "user@example.com",
      inputLabel: "Email Address",
      buttonLabel: "Send",
    },
  },
  {
    group_key: "workflow_actions",
    label: "Reassign Agent",
    value: "reassign_agent",
    value_type: "json",
    sort_order: 2,
    is_active: true,
    meta: {
      type: "custom",
      icon: "UserPlus",
      description: "Reassign this record to a different agent.",
      requiresInput: true,
      inputPlaceholder: "Optional if you use the dropdown: email, agent #, or user id",
      inputLabel: "Agent",
      buttonLabel: "Reassign",
    },
  },
  {
    group_key: "workflow_actions",
    label: "Add Note",
    value: "add_note",
    value_type: "json",
    sort_order: 3,
    is_active: true,
    meta: {
      type: "note",
      icon: "StickyNote",
      description: "Attach a note to this record.",
      requiresInput: true,
      inputPlaceholder: "Type your note here...",
      inputLabel: "Note",
      buttonLabel: "Save Note",
    },
  },
  {
    group_key: "workflow_actions",
    label: "Duplicate Record",
    value: "duplicate_record",
    value_type: "json",
    sort_order: 4,
    is_active: true,
    meta: {
      type: "duplicate",
      icon: "Copy",
      description: "Create a copy of this record with a new policy number.",
      buttonLabel: "Duplicate",
    },
  },
  {
    group_key: "workflow_actions",
    label: "Export as JSON",
    value: "export_json",
    value_type: "json",
    sort_order: 5,
    is_active: true,
    meta: {
      type: "export",
      icon: "Download",
      description: "Download this record's data as a JSON file.",
      exportFormat: "json",
      buttonLabel: "Download",
    },
  },
];

async function main() {
  for (const action of actions) {
    const existing = await sql`
      SELECT id FROM form_options
      WHERE group_key = ${action.group_key} AND value = ${action.value}
      LIMIT 1
    `;
    if (existing.length > 0) {
      console.log(`${action.label}: already exists, skipped`);
      continue;
    }
    await sql`
      INSERT INTO form_options (group_key, label, value, value_type, sort_order, is_active, meta)
      VALUES (${action.group_key}, ${action.label}, ${action.value}, ${action.value_type}, ${action.sort_order}, ${action.is_active}, ${JSON.stringify(action.meta)}::jsonb)
    `;
    console.log(`${action.label}: created`);
  }
  await sql.end();
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
