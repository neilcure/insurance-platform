// Combined fix:
//   1. Re-add the "Driver Details (Owner)" group gate that the previous
//      script removed. The owner-as-driver section should ONLY render for
//      personal insureds who ticked "with Driving Licence" — for company /
//      personal-without-DL insureds, all drivers belong in the
//      "Add More Drivers? = Yes" repeatable.
//   2. Demote already-imported policies that were wrongly promoted by the
//      old `promoteSingleDriverToOwner` (lib/import/payload.ts). Move data
//      from owner fields → driver__moreDriver__true__c0[0], set moreDriver
//      to true, and clear the owner fields.
//
// The Age field (id 754) keeps its per-field showWhen rule — it's already
// gated to personal+DL via the previous script.
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

// Mirror of DRIVER_SLOT_TO_OWNER_KEY in lib/import/payload.ts. If you ever
// extend that mapping, keep this list in sync.
const SLOT_TO_OWNER = {
  lastName: "lastname",
  firstName: "firstname",
  dob: "ownerBoA",
  dLicense: "ownerDLicence",
  relationship: "relationshiptheOwner",
  occuption: "occuption",
  postion: "ownerPostion",
};

// ---- Step 1: re-add the group gate on lastname (id 432) -------------------
const groupGate = {
  "Driver Details (Owner)": [
    { field: "theOqnwewithDL", values: ["true"], package: "insured" },
  ],
};

console.log("=== Step 1: re-add groupShowWhenMap on id 432 ===");
const before432 = await sql`SELECT meta FROM form_options WHERE id = 432`;
console.log("BEFORE meta.groupShowWhenMap =", JSON.stringify(before432[0]?.meta?.groupShowWhenMap ?? null));
await sql`
  UPDATE form_options
  SET meta = jsonb_set(meta, '{groupShowWhenMap}', ${sql.json(groupGate)}, true)
  WHERE id = 432
`;
const after432 = await sql`SELECT meta FROM form_options WHERE id = 432`;
console.log("AFTER  meta.groupShowWhenMap =", JSON.stringify(after432[0]?.meta?.groupShowWhenMap));

// ---- Step 2: demote wrongly-promoted policies -----------------------------
console.log("\n=== Step 2: demote wrongly-promoted policies ===");
const cars = await sql`
  SELECT c.id AS car_id, c.extra_attributes
  FROM cars c
  WHERE c.extra_attributes::text ILIKE '%driver__lastname%'
`;

let migrated = 0;
const summary = [];

for (const r of cars) {
  const extra = structuredClone(r.extra_attributes ?? {});
  const insured = extra.insuredSnapshot ?? {};
  const driverPkg = extra.packagesSnapshot?.driver;
  if (!driverPkg || typeof driverPkg !== "object") continue;
  const v = driverPkg.values ?? {};

  const cat = String(insured.insured__category ?? insured.insured_category ?? insured.insuredType ?? "")
    .trim().toLowerCase();
  const dlRaw = insured.insured__theOqnwewithDL ?? insured.insured_theoqnwewithdl ?? insured.insured__theoqnwewithdl;
  const hasDL = dlRaw === true || String(dlRaw).trim().toLowerCase() === "true";
  const isPersonalWithDL = cat === "personal" && hasDL;

  // Only demote when the owner section will actually be hidden in the wizard.
  if (isPersonalWithDL) continue;

  const ownerHasData = Object.values(SLOT_TO_OWNER).some((ownerKey) => {
    const val = v[`driver__${ownerKey}`];
    return val !== undefined && val !== null && String(val).trim() !== "";
  });
  if (!ownerHasData) continue;

  const moreDriverVal = v.driver__moreDriver;
  const moreDriverIsTrue = moreDriverVal === true || String(moreDriverVal).trim().toLowerCase() === "true";
  if (moreDriverIsTrue) continue;

  // Build the slot row from owner fields. Any owner key that has no slot
  // counterpart (e.g. driver__idNumber) stays on the snapshot — it's owner-
  // only, but with the group hidden it'll just be invisible. We surface it
  // in the summary so the user can spot data that got orphaned.
  const slotRow = {};
  const orphanedOwnerOnly = {};
  for (const [slotSubKey, ownerSubKey] of Object.entries(SLOT_TO_OWNER)) {
    const ownerKey = `driver__${ownerSubKey}`;
    const val = v[ownerKey];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      slotRow[slotSubKey] = val;
    }
    delete v[ownerKey];
  }
  // Owner-only keys (no slot counterpart) we leave behind only if the user
  // actually populated them. But since the group is hidden, surface them.
  for (const k of Object.keys(v)) {
    if (k.startsWith("driver__") && !["driver__moreDriver", "driver__moreDriver__true__c0"].includes(k)) {
      const isOwnerKey = Object.values(SLOT_TO_OWNER).some((ow) => k === `driver__${ow}`);
      if (!isOwnerKey && /^(driver__lastname|driver__firstname|driver__ownerBoA|driver__ownerDLicence|driver__relationshiptheOwner|driver__occuption|driver__ownerPostion|driver__idNumber)$/.test(k)) {
        const val = v[k];
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          orphanedOwnerOnly[k] = val;
        }
      }
    }
  }

  v.driver__moreDriver = true;
  v.driver__moreDriver__true__c0 = [slotRow];

  extra.packagesSnapshot.driver.values = v;

  await sql`
    UPDATE cars
    SET extra_attributes = ${sql.json(extra)}
    WHERE id = ${r.car_id}
  `;

  migrated++;
  summary.push({
    car_id: r.car_id,
    insuredCat: cat,
    hasDL,
    movedTo: "driver__moreDriver__true__c0[0]",
    slotRow,
    orphanedOwnerOnly: Object.keys(orphanedOwnerOnly).length ? orphanedOwnerOnly : undefined,
  });
}

console.log(`Demoted ${migrated} car(s):`);
for (const s of summary) console.log("  " + JSON.stringify(s));

await sql.end();
console.log("\nDone. Hard-refresh the wizard to see the change.");
