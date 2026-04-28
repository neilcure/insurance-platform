---
name: multi-variant-fields
description: Implements and debugs the full admin → wizard → snapshot → field-resolver → PDF template pipeline for ALL non-trivial form_options shapes — same-label variants, cascading 2–3 level dependent fields, boolean-branch children, nested repeatables, select option label translation, and tenant-specific ID fallbacks. Owns every deterministic snapshot key contract (`__opt_<v>__c<i>`, `__true__c<i>` / `__false__c<i>`, `__r<N>__`), by-label routing, category gating, the Auto badge, smart boolean→child routing, and option-value→label rendering. Use when editing form_options config, the policy wizard form names, `lib/pdf/build-context.ts`, `lib/field-resolver.ts`, `components/admin/pdf-templates/PdfTemplateEditor.tsx`, or when debugging why a PDF placement renders empty / shows raw "true" or a slug like "hkonly" / shows wrong driver row / doesn't expand a repeatable.
---

# Multi-Variant, Cascading, Branch-Child & Repeatable Admin Fields

This skill encodes the contract for the patterns that together cause most
"why is this PDF field empty / showing raw value / wrong row?" bugs in
this codebase:

1. **Same-label variants** — multiple `form_options` rows share a label
   (e.g. "Make") but are scoped to different categories.
2. **Cascading children** — an option of one field exposes nested fields
   (e.g. each `Make` option has a `Model` child).
3. **Synthetic computed fields** — Display Name, Primary ID, Full Address.
4. **Boolean-branch children** — a boolean field with `meta.booleanChildren.{true,false}[]`
   exposing nested fields whose snapshot key is `${parent}__${branch}__c${idx}`.
5. **Repeatable rows** — admin fields with `inputType: "repeatable"` that
   the wizard stores as arrays; PDF placements address them via
   `${parentKey}__r${index}__${childKey}`.
6. **Select option label translation** — the snapshot stores option
   `value` (e.g. `"hkonly"`); the PDF must render the option `label`
   (e.g. `"Hong Kong Only"`).

The pipeline crosses 5 files and has FOUR non-obvious key formats:

| Pattern | Snapshot key shape | Where wired |
|---|---|---|
| Cascading child | `${pkg}__${parent}__opt_${optValue}__c${idx}` | `loadPackageFieldVariants` |
| Boolean-branch child | `${pkg}__${parent}__${branch}__c${idx}` | `loadPackageFieldVariants` (Pattern D) + `resolvePackage` smart route |
| Repeatable row | `${pkg}__${parent}` is array → row N field via `${parent}__r${N}__${childKey}` | `resolvePackage` `__r<N>__` regex |
| Boolean-branch repeatable | `${parent}__${branch}__c${idx}` is array → `${parent}__${branch}__c${idx}__r${N}__${childKey}` | combination of the above two |

Get any single layer wrong and the value silently resolves to "" / `"true"` / a raw slug.

---

## The 5-layer pipeline

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Admin config         form_options rows (group_key=*_fields)│
│    └─ meta.categories   ["pcar"], ["solo"], ["commvehicle"]   │
│    └─ meta.options[].children   nested 2nd-level fields       │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. Wizard form names    app/(dashboard)/policies/new/page.tsx │
│    Top level:    `${pkg}__${fieldKey}`                        │
│    Cascading:    `${pkg}__${parentKey}__opt_${val}__c${idx}`  │
│                                              ↑ single `c`     │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. Snapshot stored      cars.extra_attributes                 │
│    .insuredSnapshot                                           │
│    .packagesSnapshot[pkg].values  (keys keep `${pkg}__` prefix)│
│    .packagesSnapshot[pkg].category   ← THE category for gating│
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. Field resolver       lib/field-resolver.ts                 │
│    resolveByLabelVariant — picks variant matching pkg category│
│    resolveInsuredPrimaryId — falls through ID key aliases     │
│    Tries: key, ${pkg}__${key}, ${pkg}_${key}, normalised      │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. PDF template editor  components/admin/pdf-templates/...    │
│    buildPackageSectionTemplate emits ONE Auto entry           │
│    SectionField.synthetic: true → green "Auto" badge          │
└──────────────────────────────────────────────────────────────┘
```

---

## Pattern A: Same-label variants (e.g. 3× "Make")

### Symptom
Admin defines "Make" three times, each scoped to a different vehicle
category. Without intervention, the PDF editor would show "Make", "Make",
"Make" and admins would have to pick the right one per policy type.

### Contract

**Admin config (form_options)** — three rows, same label, different `categories`:

```json
{ "id": 163, "value": "make",     "label": "Make", "meta": { "categories": ["pcar"]        } }
{ "id": 293, "value": "commake",  "label": "Make", "meta": { "categories": ["commvehicle"] } }
{ "id": 294, "value": "solomake", "label": "Make", "meta": { "categories": ["solo"]        } }
```

**PDF placement** uses the synthetic by-label key:

```text
fieldKey = "__byLabel__make"   ← built by buildByLabelKey(label)
```

**Resolver** (`resolveByLabelVariant`) ranks variants:

1. Variants whose `categories` include the policy's `packagesSnapshot[pkg].category`
2. Variants with empty `categories` (un-scoped fallbacks)
3. Anything else

For each ranked variant, tries `fuzzyGet(vals, key)`, then
`fuzzyGet(vals, '${pkg}__${key}')`, then `fuzzyGet(vals, '${pkg}_${key}')`.
First non-empty wins.

**Editor UI** — `buildPackageSectionTemplate` emits ONE Auto entry plus the
raw category-scoped variants under "More fields":

```text
adminSectionFields:
  • Make [Auto]                       ← synthetic: true, fieldKey: __byLabel__make
  • Make [pcar]                       ← raw variant, fieldKey: make
  • Make [commvehicle]                ← raw variant, fieldKey: commake
  • Make [solo]                       ← raw variant, fieldKey: solomake
```

### When you add a new category
1. Insert the new `form_options` row with the same label and `meta.categories: ["newcat"]`.
2. **Nothing else changes.** The resolver and editor pick it up automatically.

---

## Pattern B: Cascading children (e.g. Make → Model)

### Symptom
"Model" should change based on which "Make" is picked. Each Make option
has its own Model dropdown. There is no top-level `model` field.

### Contract

**Admin config** lives inside the parent's options:

```json
{
  "id": 293,
  "value": "commake",
  "label": "Make",
  "meta": {
    "categories": ["commvehicle"],
    "options": [
      {
        "value": "Hyundai", "label": "Hyundai",
        "children": [
          { "label": "Model", "inputType": "select", "options": [...] }
        ]
      },
      ...
    ]
  }
}
```

**Wizard form name** (`app/(dashboard)/policies/new/page.tsx` ~line 121):

```typescript
const name = `${nameBase}__opt_${current ?? "none"}__c${cIdx}`;
//            ${pkg}__${parentKey}        ${optionValue}    ${childIdx}
```

**THIS IS THE KILLER**: the suffix is single `__c${idx}`, NOT `__sc${idx}`.
Getting this wrong means every cascading child silently fails to resolve.

**Snapshot key** (after the wizard saves the policy):

```text
packagesSnapshot.vehicleinfo.values:
  "vehicleinfo__commake": "Hyundai"
  "vehicleinfo__commake__opt_Hyundai__c0": "H-1 A/T Euro 6"
                                       ↑ single c, child index
```

**`lib/pdf/build-context.ts` `loadPackageFieldVariants`** must emit one virtual
`PackageFieldVariant` per `(parent option × child)` pair:

```typescript
// For each form_options row, walk meta.options[*].children[*]
out[pkg].push({
  key: `${parentKey}__opt_${optValue}__c${childIdx}`,  // ← single c
  label: childLabel,                                    // e.g. "Model"
  categories,                                           // inherits parent's
});
```

**Resolver** then picks whichever variant has data via the same by-label
algorithm — for `__byLabel__model` against a `commvehicle` policy, it ranks
all `commake__opt_*__c0` variants first, tries `fuzzyGet` on each (with the
package-prefix variants), and returns the first hit.

**Editor UI** — child labels are added as virtual `DynamicAdminField`
entries flagged `isChildOption: true`. `buildPackageSectionTemplate`
promotes ONE Auto entry for the group; child variants are NEVER listed
under "More fields" because their per-option keys can't be placed directly:

```text
adminSectionFields:
  • Model [Auto]   ← synthetic: true, fieldKey: __byLabel__model
                    (no individual Model variants under "More fields")
```

### When you add a new cascading dropdown
1. Add the child to each parent option's `children: [...]` array (use
   `scripts/add-model-child-to-make-fields.mjs` as a template).
2. The wizard auto-renders it (it walks `children`).
3. Build context auto-emits variants (it also walks `children`).
4. Editor auto-shows the Auto entry (it discovers child labels).
5. **Nothing else changes.**

### 3+ levels (children of children)

The same recursive walk applies. When a child option also defines
`children`, the form name extends:

```text
${pkg}__${parentKey}__opt_${val1}__c${idx1}__opt_${val2}__c${idx2}
```

Today only `app/(dashboard)/policies/new/page.tsx` walks deeper than 2
levels. If you add 3-level support to `build-context.ts`, recurse through
`option.children[i].options[j].children[k]` and concatenate the same
suffix pattern. Don't invent a new separator.

---

## Pattern C: Synthetic computed fields (Display Name, Primary ID, Full Address)

These are NOT admin-configured. They're hard-coded in the resolver and
shown as Auto entries:

```typescript
// lib/field-resolver.ts
const PERSONAL_ID_KEYS = ["idNumber", "hkid", "idCard", "id_card", "identityNumber"];
const COMPANY_ID_KEYS  = ["brNumber", "ciNumber", "crNumber", "businessNumber", "companyId"];
```

When a tenant uses a different ID field name, **add it to the fallback
chain**, don't hard-code it. Same principle as `displayName`:
personal → `lastName + firstName`, company → `companyName`.

**Editor declaration** — must include `synthetic: true` so the green Auto
badge shows (otherwise admins can't tell it auto-routes):

```typescript
const SYNTHETIC_FIELDS_BY_SOURCE = {
  insured: [
    { label: "Display Name", fieldKey: "displayName", defaultOn: true, synthetic: true },
    { label: "Primary ID",   fieldKey: "primaryId",   defaultOn: true, synthetic: true },
  ],
  // ...
};
```

---

## Pattern D: Boolean-branch children (smart routing)

### Symptom
Admin places a boolean field like "No Claims Bonus (Discount)" on the
PDF and gets `"true"` / `"false"` rendered instead of the chosen
sub-option label (e.g. `"Fleet"`, `"50"`, `"New Purchase"`). The
underlying value is in a NESTED field that the wizard names with a
`__true__c0` / `__false__c0` suffix.

### Contract

**Admin config** — boolean parent with branch children, often selects:

```json
{
  "value": "vehiclencb",
  "label": "No Claims Bonus (Discount)",
  "meta": {
    "inputType": "boolean",
    "booleanChildren": {
      "true":  [{ "label": "", "inputType": "select", "options": [
        { "value": "10", "label": "10" }, ..., { "value": "fleet", "label": "Fleet" }
      ]}],
      "false": [{ "label": "If No, Please give details", "inputType": "select", "options": [
        { "value": "withClaimsR", "label": "with Claim Record", "children": [...] },
        { "value": "new_purchase", "label": "New Purchase" }
      ]}]
    }
  }
}
```

**Wizard form name** for branch children
(`app/(dashboard)/policies/new/page.tsx` ~line 822):

```typescript
const name = `${nameBase}__${branch}__c${cIdx}`;
//            ${pkg}__${parent}     "true"|"false"   childIndex
```

**Snapshot key**:

```text
packagesSnapshot.pastinsdata.values:
  "pastinsdata__vehiclencb": "true"
  "pastinsdata__vehiclencb__true__c0": "fleet"   ← the actual answer
```

**`loadPackageFieldVariants`** (build-context.ts) MUST emit a variant
per branch child carrying the child's `meta.options` so the resolver can
translate the stored value:

```typescript
out[pkg].push({
  key: `${parentKey}__${branch}__c${childIdx}`,   // exactly the wizard's key
  label: childLabel || parentLabel,
  categories,
  options: branchOptionPairs.length > 0 ? branchOptionPairs : undefined,
});
```

**Resolver smart routing** (`resolvePackage` in `field-resolver.ts`):
when the parent's `direct` value is `"true"` / `"false"`, look up
`${key}__${branch}__c0` in the same `vals`, and return that translated
through the matching variant's options.

```typescript
const directIsBool = direct === "true" || direct === "false"
  || direct === true || direct === false;
if (directIsBool) {
  const branch = String(direct);
  const childKey = `${key}__${branch}__c0`;
  const childRaw = fuzzyGet(vals, childKey)
    ?? fuzzyGet(vals, `${packageName}__${childKey}`)
    ?? fuzzyGet(vals, `${packageName}_${childKey}`);
  if (childRaw !== undefined && childRaw !== null && childRaw !== "") {
    const childVariant = findVariantForKey(
      ctx?.packageFieldVariants?.[packageName],
      childKey,
    );
    return translateOptionValue(childRaw, childVariant);
  }
}
```

This covers index `c0` (the common case). Multi-child branches
(`c1`, `c2`, …) require explicit per-child placements; the picker
loader for `PdfTemplateEditor.tsx` already exposes nested
**repeatable** children inside boolean branches but does NOT expose
nested non-repeatable children — they're reachable only via smart
routing of the parent boolean.

### When you add a new boolean-branch child
1. Add it to `meta.booleanChildren.{true,false}[]` in the admin field.
2. The wizard auto-renders it (it walks `booleanChildren`).
3. Build context auto-emits a variant (Pattern D loader).
4. Resolver smart-routes the parent boolean to it for `c0`.
5. **Nothing else changes** for the common single-child case.

---

## Pattern E: Repeatable rows (`__r<N>__`)

### Symptom
The wizard shows an "Add another driver" / "Add Item" button. Snapshot
stores an array. PDF placement of the parent renders garbage like
`"[object Object],[object Object]"` because the resolver returned the
whole array.

### Contract

**Admin config** — `inputType: "repeatable"` with `meta.repeatable.fields[]`:

```json
{
  "value": "drivers",
  "label": "Drivers",
  "meta": {
    "inputType": "repeatable",
    "repeatable": {
      "itemLabel": "Driver",
      "max": 4,
      "fields": [
        { "label": "Last Name",  "value": "lastName",  "inputType": "string" },
        { "label": "First Name", "value": "firstName", "inputType": "string" },
        { "label": "Date of Birth", "value": "dob",    "inputType": "date" }
      ]
    }
  }
}
```

**Wizard form name** for each row
(`app/(dashboard)/policies/new/page.tsx` ~line 908):

```typescript
const childName = `${name}.${rIdx}.${cf?.value ?? `c${ccIdx}`}`;
//                  ${pkg}__${parent}  rowIndex   childKey
```

RHF stores this as a NESTED ARRAY (because of the dot-paths), so the
top-level top-of-form key after submit is just `${pkg}__${parent}` =
the array. The aggregator strips the `${pkg}__` prefix → snapshot key
is `${parent}` and value is `[{lastName, firstName, dob}, …]`.

**Snapshot**:

```text
packagesSnapshot.driverinfo.values:
  "drivers": [
    { "lastName": "Hung", "firstName": "Wai Yip", "dob": "1977-01-06" },
    { "lastName": "Chan", "firstName": "Tai Man", "dob": "1985-02-16" },
    ...
  ]
```

**Resolver** (`resolvePackage` in `field-resolver.ts`) detects the
synthetic per-row key `${parent}__r${N}__${childKey}` via regex:

```typescript
const repMatch = key.match(/^(.+?)__r(\d+)__(.+)$/);
if (repMatch) {
  const [, parentKey, idxStr, childKey] = repMatch;
  const arr = fuzzyGet(vals, parentKey)
    ?? fuzzyGet(vals, `${packageName}__${parentKey}`)
    ?? fuzzyGet(vals, `${packageName}_${parentKey}`);
  if (Array.isArray(arr)) {
    const row = arr[Number(idxStr)];
    if (row && typeof row === "object") {
      return fuzzyGet(row as Record<string, unknown>, childKey) ?? "";
    }
  }
  return "";   // ← missing row renders blank, by design
}
```

Returns `""` for missing rows so unfilled slots silently render blank.
This is the "no data → no show" UX guarantee for multi-row PDF columns
(Driver 1 / 2 / 3 / 4).

**Editor UI** (`PdfTemplateEditor.tsx` `buildPackageSectionTemplate`):
expands repeatable parents into one entry per (slot × child sub-field)
using a per-template `meta.repeatableSlots` (default 4, capped to 1–20):

```text
adminSectionFields (under "More fields"):
  Driver 1 — Last Name     fieldKey: drivers__r0__lastName
  Driver 1 — First Name    fieldKey: drivers__r0__firstName
  ...
  Driver 4 — Date of Birth fieldKey: drivers__r3__dob
```

Slot count is configurable per template via the **"Repeatable slots"**
input in the Settings drawer. PATCH `/api/pdf-templates/[id]` accepts
`repeatableSlots` and clamps it to 1–20.

---

## Pattern F: Select option value → label translation

### Symptom
A select field stores `"hkonly"` / `"fleet"` / `"comp"` in the snapshot.
The PDF renders the raw slug instead of the human-readable label.

### Contract

**Variant carries options** — `PackageFieldVariant.options?: { value, label }[]`
is populated by `loadPackageFieldVariants` from `meta.options[]` (and
from each cascading child's nested options, and from each
boolean-branch child's options).

**Resolver translates** via `translateOptionValue(raw, variant)` which
handles:

- Single string values (`"hkonly"` → `"Hong Kong Only"`)
- Arrays (multi-select) — joins translated labels with `", "`
- Comma-separated strings — splits, translates each, rejoins
- Pass-through when no matching option (free-form fields, slugs not in the list)

Applied at:

1. `resolvePackage` direct path — after `fuzzyGet` finds the value.
2. `resolvePackage` smart-boolean route — for branch child values.
3. `resolveByLabelVariant` — for `__byLabel__<slug>` placements.

### When a tenant adds a new option to an existing select
**Nothing to do.** The variant is rebuilt from `meta.options[]` on every
PDF render — new options translate automatically.

---

## Pattern G: Repeatable inside a boolean branch

### Symptom
"Add More Drivers?" boolean → when YES, a repeatable list of additional
drivers appears in the wizard. PDF needs to render Driver 2/3/4 columns
from this nested repeatable.

### Contract — combines Patterns D and E

**Snapshot keys**:

```text
packagesSnapshot.driver.values:
  "moreDriver": "true"
  "moreDriver__true__c0": [
    { "lastName": "...", "firstName": "...", "dob": "..." },   // Driver 2
    { "lastName": "...", "firstName": "...", "dob": "..." },   // Driver 3
    ...
  ]
```

**Editor loader** (`PdfTemplateEditor.tsx`) walks
`meta.booleanChildren.{true,false}[*]` looking for nested repeatable
children, and emits a synthetic `DynamicAdminField` with:

- `value: ${parentValue}__${branch}__c${cIdx}` (the wizard's branch key)
- `repeatableChildren` populated from the nested `repeatable.fields`
- `repeatableItemLabel` from `repeatable.itemLabel`

`buildPackageSectionTemplate` then expands it into per-slot entries
with the **combined** key:

```text
fieldKey: moreDriver__true__c0__r0__lastName
                       ↑ branch child       ↑ row N + child
```

**Resolver** matches the `__r<N>__` regex (Pattern E) — the parentKey
captured is `moreDriver__true__c0`, which `fuzzyGet` then finds as the
array in `vals`.

### When you add a new boolean-branch repeatable
1. Define `meta.booleanChildren.true: [{ inputType: "repeatable", repeatable: {...} }]`.
2. Editor loader auto-emits the synthetic admin field.
3. Picker auto-expands per-slot entries (slot count from template settings).
4. Resolver auto-handles `__r<N>__` lookup against the branch-key array.
5. **Nothing else changes.**

---

## Verification recipe

When debugging "field X is empty in PDF preview", run a one-shot diagnostic
against the live DB. Template:

```javascript
// scripts/tmp-diag-<thing>.mjs
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

// 1. PDF template placements
const [tpl] = await sql`
  SELECT id, label, meta FROM form_options
  WHERE id = ${TEMPLATE_ID} AND group_key = 'pdf_merge_templates'
`;
console.log("placements:", tpl.meta.fields.filter(f => /target/i.test(f.label)));

// 2. Form options for the package (variants + cascading children)
const rows = await sql`
  SELECT id, value, label, meta FROM form_options
  WHERE group_key = 'vehicleinfo_fields' AND is_active = true
`;
// inspect categories + meta.options[*].children

// 3. Policy snapshot — what keys actually exist
const [car] = await sql`SELECT extra_attributes FROM cars WHERE policy_id = ${POLICY_ID}`;
console.log("snapshot keys:", Object.keys(car.extra_attributes.packagesSnapshot.vehicleinfo.values));

await sql.end();
```

Run with `node --env-file=.env.local scripts/tmp-diag-<thing>.mjs`.

For end-to-end resolver verification:

```typescript
// scripts/tmp-verify-<thing>.ts
import { buildMergeContext } from "../lib/pdf/build-context";
import { resolveFieldValue } from "../lib/pdf/resolve-data";

const result = await buildMergeContext(POLICY_ID);
console.log(resolveFieldValue(
  { id: "x", source: "package", packageName: "vehicleinfo",
    fieldKey: "__byLabel__model", format: "text" } as never,
  result.ctx,
));
```

Run with `npx tsx scripts/tmp-verify-<thing>.ts` after exporting
`DATABASE_URL` from `.env.local`.

Always **delete the tmp scripts when done** — they belong in `scripts/tmp-*`.

---

## Common mistakes (cheatsheet)

| Mistake | Symptom | Fix |
|---|---|---|
| Used `__sc${idx}` in build-context.ts | Cascading child resolves empty | Use `__c${idx}` (single c) |
| Placed `commake` directly on PDF instead of `__byLabel__make` | Make resolves only for commvehicle policies, empty for car/motorcycle | Replace with the Auto entry |
| Hard-coded `brNumber` in resolveInsuredPrimaryId | Empty for tenants using `ciNumber` etc. | Use the fallback-chain pattern |
| Forgot `synthetic: true` on declaration | Auto badge missing in editor; admins confused | Add the flag |
| Added new category but didn't restart dev | Old admin fields cached | Hard-refresh; Turbopack picks up server-side after rebuild |
| Skipped category match in resolveByLabelVariant ranking | Picked wrong variant for some policies | Always rank by `pkgCategory` first, fall back to un-scoped |
| Saved snapshot key without `${pkg}__` prefix | Resolver's `${pkg}__${key}` fallback misses | Wizard always prefixes; if you bypass it, prefix yourself |
| Resolver returned raw select slug (`hkonly`, `fleet`) | PDF shows `"hkonly"` instead of `"Hong Kong Only"` | Ensure variant has `options[]` (Pattern F); apply `translateOptionValue` after `fuzzyGet` and inside `resolveByLabelVariant` |
| Boolean parent placed on PDF, render is `"true"` / `"false"` instead of chosen sub-option | Boolean has `meta.booleanChildren` but smart routing missing | Add the `__${branch}__c0` lookup branch in `resolvePackage` (Pattern D). Also load child variants in `loadPackageFieldVariants`. |
| Repeatable parent placed on PDF, render is `[object Object],[object Object]` | `resolvePackage` returned the whole array | Use `__r<N>__<child>` synthetic key (Pattern E) — placements come from `buildPackageSectionTemplate` per-slot expansion, NOT direct parent key |
| `loadPackageFieldVariants` skipped boolean-branch children | Pattern D smart route resolves but options don't translate | Variant lookup misses → translation no-ops. Walk `meta.booleanChildren.{true,false}[]` and emit a variant per child with its `options` |
| Editor picker doesn't show extra-driver entries | Repeatable is nested under a boolean's `true` branch | The editor loader must walk `meta.booleanChildren.{true,false}[*]` for `inputType: "repeatable"` nodes (NOT just top-level `meta.repeatable`) |
| Picker expanded too many or too few driver slots | Hard-coded slot count | Slot count comes from `meta.repeatableSlots` on the PDF template (default `DEFAULT_REPEATABLE_SLOTS = 4`, capped 1–20 server-side and editor-side) |
| Used `__r<N>__` in form name template | Wizard form crashes / data lost | `__r<N>__` is a synthetic PDF key. The wizard uses dot paths: `${name}.${rIdx}.${childKey}` → snapshot stores an array. The `__r<N>__` regex is resolver-side only |

---

## Reference files

- **Wizard form-name template**: `app/(dashboard)/policies/new/page.tsx`
  - Top-level: `${pkg}__${fieldKey}` (~line 121, ~line 474)
  - Cascading children: `${nameBase}__opt_${val}__c${idx}` (~line 121)
  - Boolean-branch children: `${nameBase}__${branch}__c${idx}` (~line 822, ~line 1043)
  - Repeatable rows: `${name}.${rIdx}.${childKey}` (~line 522, ~line 908) — RHF nested array, NOT a flat key
- **Variant loader**: `lib/pdf/build-context.ts` `loadPackageFieldVariants` — must walk
  - `meta.options[*].children[*]` (cascading) → emit `__opt_${v}__c${i}` variants with options
  - `meta.booleanChildren.{true,false}[*]` (Pattern D) → emit `__${branch}__c${i}` variants with options
- **Resolver routing**: `lib/field-resolver.ts`
  - `resolveByLabelVariant` — by-label aggregation + option label translation
  - `resolvePackage` — direct lookup, `__r<N>__` regex (Pattern E), smart boolean route (Pattern D), option translation (Pattern F)
  - `translateOptionValue` / `findVariantForKey` — Pattern F helpers
  - `resolveInsuredPrimaryId` — tenant fallback chain
- **Editor section/picker emission**: `components/admin/pdf-templates/PdfTemplateEditor.tsx`
  - `buildPackageSectionTemplate` — Auto entry, More fields, repeatable per-slot expansion
  - `SYNTHETIC_FIELDS_BY_SOURCE` — Pattern C declarations (must include `synthetic: true`)
  - DynamicAdminField loader (`flatMap` inside the `useEffect`) — captures cascading + boolean-branch repeatable child schemas
- **Template meta types**: `lib/types/pdf-template.ts` — `PdfTemplateMeta.repeatableSlots`, `DEFAULT_REPEATABLE_SLOTS`
- **PATCH route**: `app/api/pdf-templates/[id]/route.ts` — accepts and clamps `repeatableSlots`
- **Auto badge UI**: `components/admin/pdf-templates/PdfTemplateEditor.tsx` `SectionFieldRow`
- **Existing always-on rule**: `.cursor/rules/shared-field-resolver.mdc` (read this first if not already familiar)
