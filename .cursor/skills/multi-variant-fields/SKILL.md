---
name: multi-variant-fields
description: Implements and debugs same-label admin field variants (e.g. 3x "Make" scoped to car/motorcycle/commvehicle) and cascading 2-3 level dependent fields (e.g. Make → Model). Covers the full admin → wizard → snapshot → field-resolver → PDF template pipeline including the deterministic snapshot key contract, by-label routing, category gating, the Auto badge, and tenant-specific ID fallback chains. Use when editing form_options config, the policy wizard form names, lib/pdf/build-context.ts, lib/field-resolver.ts, components/admin/pdf-templates/PdfTemplateEditor.tsx, or when debugging why a PDF placement renders empty for some policies but not others.
---

# Multi-Variant & Cascading Admin Fields

This skill encodes the contract for two patterns that together cause most
"why is this PDF field empty?" bugs in this codebase:

1. **Same-label variants** — multiple `form_options` rows share a label
   (e.g. "Make") but are scoped to different categories.
2. **Cascading children** — an option of one field exposes nested fields
   (e.g. each `Make` option has a `Model` child).

The pipeline crosses 5 files and has 2 non-obvious key formats. Get any
single layer wrong and the value silently resolves to "".

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

---

## Reference files

- Wizard form name template: `app/(dashboard)/policies/new/page.tsx` (~line 121)
- Variant loader: `lib/pdf/build-context.ts` `loadPackageFieldVariants`
- Resolver routing: `lib/field-resolver.ts` `resolveByLabelVariant`, `resolvePackage`, `resolveInsuredPrimaryId`
- Editor synthetic emission: `components/admin/pdf-templates/PdfTemplateEditor.tsx` `buildPackageSectionTemplate`, `SYNTHETIC_FIELDS_BY_SOURCE`
- Auto badge UI: `components/admin/pdf-templates/PdfTemplateEditor.tsx` `SectionFieldRow`
- Existing always-on rule: `.cursor/rules/shared-field-resolver.mdc` (read this first if not already familiar)
