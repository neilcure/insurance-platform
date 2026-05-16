---
name: wizard-formula-fields
description: Documents how policy-flow wizard formula fields (`inputType: formula`) evaluate in React Hook Form, mirror other fields, interact with select option VALUE vs LABEL storage, persist into snapshots vs PDF-time resolution, repeatable-row formula scope, and the automatic label lookup for single-placeholder formulas like `{insured_insuredOccupation}`. ALSO documents the dedicated `inputType: "mirror"` shortcut (added 2026-05) which is the preferred path for ANY plain "this field equals another field" use case — admins should NOT reach for `inputType: "formula"` with a single `{pkg_field}` placeholder anymore. Use when debugging or implementing formula-driven fields in `PackageBlock`, `lib/formula.ts`, driver/insured mirroring, occupation showing one letter, driving licence copy formulas, or admin field configs that reference `{pkg_field}` / `{pkg__field}` placeholders.
---

# Wizard Formula Fields (`PackageBlock` + `lib/formula.ts`)

## 0. Mirror vs Formula — pick the right tool first

> **TL;DR — if you're tempted to author `{pkg_field}` as a formula, use `inputType: "mirror"` instead.**

| Use case | Pick |
|---|---|
| `driver Occupation = insured Occupation` | **`mirror`** ✓ |
| `driving licence = insured ID number` | **`mirror`** ✓ |
| `policyEnd = policyStart + 364` | `formula` |
| `levy = grossPremium * 0.001` | `formula` |
| `age = YEARS_BETWEEN(insured__dob, TODAY)` | `formula` |
| `expiryWarning = TODAY + 30` | `formula` |

`inputType: "mirror"` (see `MirrorField` in `PackageBlock.tsx`,
`MirrorSource` in `lib/types/form.ts`, and the
`MirrorSourceEditor` admin component) is a dedicated, stripped-down
passthrough with **no formula parsing**, **no math semantics**, and
**no preserve-on-edit behaviour**. The admin picks the source
package + field from dropdowns; the wizard always renders read-only
and always writes the source value into RHF. This eliminates the
entire class of "mirror mode vs arithmetic mode" footguns that
plagued the `formula` path (see §3c).

**One-time migration** `scripts/migrate-formula-to-mirror.ts`
converts any pre-existing `formula` row whose `meta.formula` is a
single `{pkg_field}` placeholder into the new shape:

```jsonc
// before
{ "inputType": "formula", "formula": "{insured_idNumber}" }
// after
{ "inputType": "mirror", "mirrorSource": { "package": "insured", "field": "idNumber" } }
```

Dry-run first, then `--apply`. Idempotent.

The rest of this skill still documents the `formula` path because
admins may still legitimately need it for math, and existing rows
that are NOT single-placeholder still go through `FormulaField`.

---


End-user confusion usually sounds like: **"Formula copies the value but I only see `A` / `T`"**, **"Driving licence should equal ID — formula does nothing in extra drivers"**, or **"PDF is wrong / wizard looks wrong."** Those are **different layers**. This skill is the **live wizard** layer only.

## Scope boundaries (do not mix concerns)

| Surface | Module | Formulas re-evaluated? |
|---|-----|-----|
| Policy wizard (flows `/dashboard/flows/.../new`, `/policies/new`) | `components/policies/PackageBlock.tsx` + `@/lib/formula` | **Yes** — `evaluateFormula` runs on RHF state |
| PDF / mail-merge / email bodies | `lib/field-resolver.ts`, `lib/pdf/**` | **No** — snapshot values only; see shared-field-resolver rule |

If the wizard looks correct but PDF shows a slug/code, fix **resolver / template**, not `evaluateFormula`.

---

## 1. Core engine — `lib/formula.ts`

- **`resolveFieldValue(key, formValues, pkg?)`** — resolves `{placeholders}` to strings from flat RHF keys (`insured__x`, `insured_x`, package-scoped variants, fuzzy suffix match).
- **`evaluateFormula(formula, formValues, pkg?)`** — dates, `*_BETWEEN`, numeric pipeline, and **single-placeholder passthrough**: a formula that is exactly `{someKey}` (trimmed) returns the resolved string **without** forcing numeric coercion. This is how ID/name mirrors work.

Unsupported in formulas: arbitrary string concatenation (`{a}{b}`), conditionals — admins expect Excel-like behaviour but only the documented branches exist.

### 1.1 Case tolerance contract (critical — do not break)

Admin-authored formulas frequently use a mixed-case package prefix
(`{Insured_insuredOccuption}`), while RHF form keys and snapshot keys
are always stored with the **canonical lowercase** package prefix
(`insured__insuredOccuption`). `form_options` enforces lowercase package
keys via `normalizeKeyLike`, so the *only* correct stored shape is
lowercase.

`resolveFieldValue` MUST therefore:

1. Try the formula's case **as written** (preserves the contract for any
   legacy hand-authored keys that genuinely differ in case).
2. Also try **`prefix.toLowerCase()` + the rest unchanged** (so
   `Insured_x` matches `insured__x`).
3. As a last-resort, do a **normalized whole-key match**: lowercase +
   collapse `__` → `_` on BOTH sides. `{Insured_insuredOccuption}` →
   `insured_insuredoccuption` matches form key
   `insured__insuredOccuption` → `insured_insuredoccuption`.

The pre-fix suffix-only fallback (`fk.split("__").pop()` vs
`key.toLowerCase()`) was insufficient: for keys with an embedded
underscore the suffix never matched the full key, so formulas silently
resolved to `""` and the driver field kept whatever stale text was
previously typed in (commonly **the first letter** of the source value,
e.g. `"C"` for `"COACH (PING PONG)"`).

**Verification snippet** (run after any edit to `resolveFieldValue`):

```ts
import { evaluateFormula } from "@/lib/formula";
const v = evaluateFormula("{Insured_insuredOccuption}", {
  insured__insuredOccuption: "COACH (PING PONG)",
}, "driver");
console.assert(v === "COACH (PING PONG)", "case-insensitive prefix broken");
```

---

## 2. Where formulas render — `PackageBlock.tsx`

### Top-level / boolean-branch `FormulaField`

- Subscribes via `form.watch` and writes computed values into RHF so they land in **`packagesSnapshot`** (and related snapshot shapes) on save.
- Accepts optional **`meta.options`** on the field row; when present, the control shows the **option LABEL** while RHF still holds the **stored VALUE** (short code). Important for selects whose `value` is `"A"` and label is `"Accountant"`.

### Automatic label lookup (single-variable formulas)

When **`meta.options` is omitted** but the formula is exactly **`{sourcePkg_sourceField}`** or **`{sourcePkg__sourceField}`** (single brace pair, trimmed):

1. Parse `sourcePkg` + tail field key from the placeholder.
2. Fetch **`form_options` group `{sourcePkg}_fields`** via **`getFormOptionsGroup`** (`lib/form-options-cache.ts`).
3. Find the row whose **`value`** equals one of the **candidate tails** derived from the placeholder (e.g. `insuredOccupation` → also `occupation` via `expandRedundantPackageFieldRef` in `lib/formula.ts` — same expansion used by `resolveFieldValue`).
4. Read **`meta.options`** from that row — same shape as admin select options `{ value, label }[]`.
5. Use those options to map stored code → label for **display only**.

This avoids admins duplicating option lists on every derived formula field (typical case: **driver Occupation** = `{insured_insuredOccupation}`).

**Limitations**

- Only applies to **single-placeholder** formulas (not `{a} + {b}`).
- Source package must use the standard **`${pkg}_fields`** group key (insured → `insured_fields`).
- If the source field is not a select / has no `meta.options`, behaviour falls back to a plain text input (raw code visible).

### Repeatable rows — `RepeatableFormulaCell`

Formulas inside **`inputType: repeatable`** child rows used to evaluate with **row-only** values, so `{insured__hkid}` / `{insured_hkid}` resolved to **empty** — mirrored fields stayed blank or stale.

**Contract today**: evaluate with **`{ ...form.getValues(), ...rowVals }`** — row keys win on collisions — and subscribe to **`form.watch`** so changes on the insured step propagate into row formulas.

Without persisting into RHF, PDF placements that rely on snapshot keys under repeatable rows would stay empty (resolver does not re-run wizard formulas).

---

## 3. Select VALUE vs LABEL (why "one letter" happens)

There are **TWO** distinct ways a formula field ends up showing a
single letter — diagnose which one applies before "fixing":

### 3a. Source is a SELECT with short-coded `meta.options[].value`

Admin **`select`** fields store **`meta.options[].value`** in snapshots (often a **short code**). The wizard dropdown shows **`label`**.

A **`formula`** that copies that field correctly produces the **code** (`"A"`). If the formula UI renders a plain `<Input>`, the user sees **`A`** — not truncation, not CSS — **it's the real stored value**.

### 3b. Source is a TEXT input + formula has a case-mismatched prefix (THE TRAP)

`form_options.value` for the source field is `inputType: "string"`,
**no options**, and the snapshot holds the full free-text value
(e.g. `"COACH (PING PONG)"`). But the driver/dependent formula is
authored as `{Insured_insuredOccuption}` (**capital I**), while the
form key is `insured__insuredOccuption` (lowercase). Pre-§1.1 the
case-sensitive resolver returned `""`, the formula did nothing on
re-render, and the previously-editable `FormulaField` kept whatever
text had been typed into it earlier — usually **the first letter of
the source value** because that's what the user inadvertently
captured during the wizard's first save.

### 3c. Mirror mode vs Arithmetic mode (THE OTHER TRAP)

`FormulaField` and `RepeatableFormulaCell` have to handle TWO
fundamentally different uses of an `inputType: "formula"` field:

|              | Mirror (`{singleRef}`)                | Arithmetic (`{a} + {b}`, `YEARS_BETWEEN(...)`) |
|--------------|---------------------------------------|------------------------------------------------|
| Display      | Read-only (user can't type)           | Editable (user may hand-tweak)                 |
| Stale data   | MUST be overwritten                   | MUST be preserved                              |
| Watch dedup  | Compare to **current form value**     | Compare to `lastFormula.current`               |

Both fields branch on `/^\{[^{}]+\}$/.test(trimmed.formula)`:
- mirror → call `syncMirror` / `sync(true)` on mount AND on every
  `form.watch` tick, comparing the computed value against the
  current stored value. If they drift, force-write.
- arithmetic → original behaviour (`!current` guard on initial,
  `lastFormula.current` dedup on watch).

**Why this matters** (concrete bug chain):
1. User picks an existing client to start a new policy.
2. Wizard pre-fills both `insured__insuredOccuption =
   "ELECTRICAL ENGINEERING"` AND, from the SAME client's previous
   policy, `driver__occuption = "T"`.
3. Without the mirror branch, the formula sees `current = "T"`
   (non-empty), skips the fill, and the watch dedup on
   `lastFormula.current` blocks the watch from ever correcting it.
4. User sees `"T"` in driver Occupation even though source is
   `"ELECTRICAL ENGINEERING"` — exact bug the user reported.

**`shouldDirty` flag** — mirror sync uses `shouldDirty: false`
because the user did not edit this field. Marking dirty would
fire the wizard's "unsaved changes" prompt the first time someone
opens an existing policy.

**Diagnostic SQL** (replace policy id):

```sql
SELECT
  extra_attributes->'insuredSnapshot'->>'insured__insuredOccuption' AS source,
  extra_attributes->'packagesSnapshot'->'driver'->'values'->>'driver__occuption' AS driver
FROM cars WHERE policy_id = 426;
-- BAD:  source = "COACH (PING PONG)"  driver = "C"
-- GOOD: source = "COACH (PING PONG)"  driver = "COACH (PING PONG)"
```

**Code fix lives in §1.1** (always lowercase the package prefix when
matching). **Data repair** is `scripts/backfill-driver-occupation.ts`
— conservative, idempotent, only overwrites when the driver value is
empty / a clear case-insensitive prefix of the source.

**Fix paths** (in order of preference):

1. **Automatic lookup** (above) when the formula is a single mirror from another package field with options.
2. **Duplicate `meta.options`** onto the formula field in admin (legacy / explicit).
3. **Change the source select** so `value` === human text (tenant trade-off; affects all consumers of that code).

**CreatableSelect** path uses label lookup for display (`components/ui/creatable-select.tsx`); plain formula fields needed the option map above.

---

## 4. Admin authoring cheatsheet

| Goal | Formula example | Notes |
|---|-----|-----|
| Mirror insured scalar | `{insured_insuredOccupation}` | Use single underscore between pkg and key if that matches RHF keys; `__` variants tolerated by `resolveFieldValue` |
| Mirror package field | `{vehicleinfo_registrationNumber}` | Key must exist in flat form state |
| Today's date | `TODAY` | See `evaluateFormula` branches |

**Do not** assume PDF will "run the same formula" — templates read snapshots.

---

## 5. File index

| Piece | Location |
|-----|----|
| Formula evaluation | `lib/formula.ts` |
| Wizard rendering + persistence | `components/policies/PackageBlock.tsx` — `FormulaField`, `RepeatableFormulaCell` |
| Cached form_options fetch | `lib/form-options-cache.ts` — `getFormOptionsGroup` |
| Snapshot resolution (PDF/dashboard display elsewhere) | `lib/field-resolver.ts` — **`translateOptionValue`** / variants |

---

## 6. Verification recipe

1. **Wizard**: Pick insured occupation with a known **code ≠ label**; open dependent formula field (e.g. driver step). Expect **label** in read-only display; inspect RHF / payload — **value** should remain code unless tenant changed select storage.
2. **Repeatable driver row**: Set formula `{insured__primaryId}` or insured ID field key tenant uses; confirm cell updates when insured ID changes **without** opening the repeatable row editor first.
3. **PDF**: If PDF shows code, open **`field-resolver`** path for that snapshot key — wizard-only fixes will not apply.

---

## 7. Related skills / rules

- **Shared field resolver** (`.cursor/rules/shared-field-resolver.mdc`) — PDF/snapshot resolution, not live formulas.
- **Multi-variant fields** (`.cursor/skills/multi-variant-fields/SKILL.md`) — cascading / repeatable **snapshot key** shapes; overlaps when formulas target package fields with variants.
