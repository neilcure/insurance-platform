/**
 * Adds a child "Model" select field to every option of:
 *   - commake (Make for commvehicle)
 *   - solomake (Make for solo / motorcycle)
 *
 * Mirrors the exact shape used by the existing pcar `make` field
 * (`form_options.id = 163`), so the import template & cascading
 * dropdown UI work identically across all three vehicle categories.
 *
 * The script is IDEMPOTENT: if an option already has a child
 * field whose label looks like "Model" (case-insensitive), it is
 * left untouched. Pre-existing Model option lists are preserved.
 *
 * Run with:
 *   node --env-file=.env.local scripts/add-model-child-to-make-fields.mjs
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

const TARGET_FIELDS = [
  { id: 293, value: "commake", category: "commvehicle" },
  { id: 294, value: "solomake", category: "solo" },
];

const MODEL_CHILD_TEMPLATE = {
  label: "Model",
  inputType: "select",
  options: [],
};

function hasModelChild(option) {
  if (!Array.isArray(option.children)) return false;
  return option.children.some(
    (c) => typeof c?.label === "string" && c.label.trim().toLowerCase() === "model",
  );
}

let totalAdded = 0;
let totalSkipped = 0;

for (const target of TARGET_FIELDS) {
  const [row] = await sql`SELECT id, value, label, meta FROM form_options WHERE id = ${target.id}`;
  if (!row) {
    console.warn(`[skip] field id=${target.id} (${target.value}) not found`);
    continue;
  }

  const meta = row.meta ?? {};
  const options = Array.isArray(meta.options) ? meta.options : [];

  if (options.length === 0) {
    console.log(
      `[noop] ${target.value} (id=${target.id}) has 0 Make options — ` +
        `add motorcycle brands via the UI first, then re-run this script.`,
    );
    continue;
  }

  let added = 0;
  let skipped = 0;
  const nextOptions = options.map((opt) => {
    if (hasModelChild(opt)) {
      skipped++;
      return opt;
    }
    added++;
    return {
      ...opt,
      children: [
        ...(Array.isArray(opt.children) ? opt.children : []),
        { ...MODEL_CHILD_TEMPLATE },
      ],
    };
  });

  if (added === 0) {
    console.log(`[noop] ${target.value}: all ${options.length} Makes already have a Model child.`);
    continue;
  }

  const nextMeta = { ...meta, options: nextOptions };
  await sql`UPDATE form_options SET meta = ${nextMeta}::jsonb WHERE id = ${target.id}`;
  totalAdded += added;
  totalSkipped += skipped;
  console.log(
    `[ok] ${target.value} (id=${target.id}): added Model child to ${added} Make(s), ` +
      `skipped ${skipped} that already had one.`,
  );
}

console.log(
  `\nDone. Added Model child to ${totalAdded} Make option(s), skipped ${totalSkipped}.`,
);

await sql.end();
