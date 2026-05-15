---
name: wizard-formula-fields
description: Documents how policy-flow wizard formula fields (`inputType: formula`) evaluate in React Hook Form, mirror other fields, interact with select option VALUE vs LABEL storage, persist into snapshots vs PDF-time resolution, repeatable-row formula scope, and the automatic label lookup for single-placeholder formulas like `{insured_insuredOccupation}`. Use when debugging or implementing formula-driven fields in `PackageBlock`, `lib/formula.ts`, driver/insured mirroring, occupation showing one letter, driving licence copy formulas, or admin field configs that reference `{pkg_field}` / `{pkg__field}` placeholders.
---

# Wizard Formula Fields (`PackageBlock` + `lib/formula.ts`)

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

Admin **`select`** fields store **`meta.options[].value`** in snapshots (often a **short code**). The wizard dropdown shows **`label`**.

A **`formula`** that copies that field correctly produces the **code** (`"A"`). If the formula UI renders a plain `<Input>`, the user sees **`A`** — not truncation, not CSS — **it's the real stored value**.

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
