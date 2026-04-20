/**
 * Seeds `solomake` (Make for solo / motorcycles, vehicleinfo_fields, id=294)
 * with brands and their child Model option lists, mirroring the exact shape
 * used by `make` (pcar, id=163) and `commake` (commvehicle, id=293).
 *
 * Source data: scripts/data/motorcycle-make-model.json
 *   (curated from manufacturer lineups commonly registered in HK,
 *   verified against current 2025-2026 web listings — see file header)
 *
 * Behavior — IDEMPOTENT and NON-DESTRUCTIVE:
 *   • Existing Makes are preserved; their existing Model options are merged
 *     with the dataset (dedup by case-insensitive value).
 *   • Existing child fields with non-"Model" labels are left alone.
 *   • New Makes are appended in the order they appear in the JSON.
 *   • Re-running adds nothing if the data is already present.
 *
 * Run with:
 *   node --env-file=.env.local scripts/seed-solomake-models.mjs
 *
 * To seed a different field (e.g. commake), pass --field=commake.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIELD_TARGETS = {
  solomake: { id: 294, category: "solo" },
  commake: { id: 293, category: "commvehicle" },
  make: { id: 163, category: "pcar" },
};

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const fieldKey = args.field ?? "solomake";
const target = FIELD_TARGETS[fieldKey];
if (!target) {
  console.error(`Unknown --field=${fieldKey}. Allowed: ${Object.keys(FIELD_TARGETS).join(", ")}`);
  process.exit(1);
}

const dataPath = resolve(__dirname, "data", "motorcycle-make-model.json");
const dataset = JSON.parse(readFileSync(dataPath, "utf8"));
const incomingMakes = (dataset.makes ?? []).filter((m) => m.make && m.make !== "Other");

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

const [row] = await sql`SELECT id, value, label, meta FROM form_options WHERE id = ${target.id}`;
if (!row) {
  console.error(`Field id=${target.id} (${fieldKey}) not found.`);
  await sql.end();
  process.exit(1);
}

const meta = row.meta ?? {};
const existingOptions = Array.isArray(meta.options) ? meta.options : [];

const slug = (s) => String(s ?? "").trim().toLowerCase();
const optByKey = new Map(existingOptions.map((o) => [slug(o.value ?? o.label), o]));

let makesAdded = 0;
let makesUpdated = 0;
let modelsAdded = 0;

const finalOptions = [...existingOptions];

for (const incoming of incomingMakes) {
  const key = slug(incoming.make);
  const existing = optByKey.get(key);

  const incomingModelOpts = (incoming.models ?? []).map((m) => ({ label: m, value: m }));

  if (!existing) {
    const newOpt = {
      label: incoming.make,
      value: incoming.make,
      children: [
        { label: "Model", inputType: "select", options: incomingModelOpts },
      ],
    };
    finalOptions.push(newOpt);
    optByKey.set(key, newOpt);
    makesAdded++;
    modelsAdded += incomingModelOpts.length;
    continue;
  }

  const childIdx = Array.isArray(existing.children)
    ? existing.children.findIndex(
        (c) => typeof c?.label === "string" && c.label.trim().toLowerCase() === "model",
      )
    : -1;

  let modelChild =
    childIdx >= 0
      ? existing.children[childIdx]
      : { label: "Model", inputType: "select", options: [] };

  const existingModelOpts = Array.isArray(modelChild.options) ? modelChild.options : [];
  const modelKey = new Set(existingModelOpts.map((o) => slug(o.value ?? o.label)));
  let added = 0;
  for (const m of incomingModelOpts) {
    const k = slug(m.value);
    if (modelKey.has(k)) continue;
    existingModelOpts.push(m);
    modelKey.add(k);
    added++;
  }

  if (added === 0 && childIdx >= 0) continue;

  modelChild = { ...modelChild, options: existingModelOpts };
  const nextChildren = Array.isArray(existing.children) ? [...existing.children] : [];
  if (childIdx >= 0) nextChildren[childIdx] = modelChild;
  else nextChildren.push(modelChild);
  existing.children = nextChildren;
  if (added > 0) {
    makesUpdated++;
    modelsAdded += added;
  }
}

if (makesAdded === 0 && makesUpdated === 0) {
  console.log(`[noop] ${fieldKey}: dataset already fully present (no changes).`);
  await sql.end();
  process.exit(0);
}

const nextMeta = { ...meta, options: finalOptions };
await sql`UPDATE form_options SET meta = ${nextMeta}::jsonb WHERE id = ${target.id}`;

console.log(
  `[ok] ${fieldKey} (id=${target.id}): added ${makesAdded} new Make(s), ` +
    `updated ${makesUpdated} existing Make(s) with new Models, ` +
    `${modelsAdded} new Model option(s) total.`,
);
console.log(`     Total Makes now: ${finalOptions.length}.`);

await sql.end();
