---
name: insured-snapshot-dedupe
description: Owns the full contract for keeping `cars.extraAttributes.insuredSnapshot` free of duplicate keys that describe the same logical field but differ only in casing (`insured__ciNumber` vs `insured__cinumber`) or underscore style (`insured__category` vs `insured_category`). Covers the `dedupeInsuredSnapshot` helper at `lib/policies/insured-snapshot-dedupe.ts`, the three defensive layers in the policy wizard, the audit-log symptom (every duplicate appears as "changed from null"), and the one-time cleanup script. Use when editing `app/(dashboard)/dashboard/flows/[flow]/new/page.tsx` (especially `fillFormFromClient`, `fillFormFromRecord`, `saveClientChanges`, `doSubmit`), the policy PATCH route at `app/api/policies/[id]/route.ts`, any code that builds an `insured: {...}` payload, or when debugging "I edited a policy but didn't change insured data, why does the audit say insured changed?".
---

# Preventing duplicate keys in `insuredSnapshot`

A policy's insured data lives at
`cars.extraAttributes.insuredSnapshot` as a flat object whose keys
follow the form_options field naming convention:

```
insured__ciNumber     (double-underscore, camelCase tail)
insured__category
contactinfo__mobile
contactinfo__streetName
insuredType           (top-level metadata)
clientPolicyId        (top-level metadata)
```

The policy wizard (`app/(dashboard)/dashboard/flows/[flow]/new/page.tsx`)
serialises React Hook Form state into `insuredSnapshot` on save by
collecting every form value whose key starts with `insured_` /
`insured__` / `contactinfo_` / `contactinfo__`. That contract makes
the snapshot trivially writable — but it also means any spurious
key in the form state gets persisted as a "real" insured field.

Before the fix, the wizard's "fill form from existing record" helpers
seeded the form with multiple normalised variants of each snapshot key
("just to be safe"). That created phantom keys in form state, which
were then serialised back into the snapshot at save time — the audit
log reported every clone as `null → "value"`, which looked to users
like "you changed insured data" even when they hadn't typed anything.

If your task touches any of the files listed in the frontmatter
`description`, read this skill before writing code.

---

## 1. The anti-pattern (what created the duplicates)

### A. `fillFormFromRecord` — unconditional normalisation

The old code:

```ts
for (const [k, v] of Object.entries(insured)) {
  setVal(k, v);
  if (k.toLowerCase().startsWith("insured_") /* etc. */) {
    const tail = k.toLowerCase().replace(/^insured__?/, "");
    setVal(`insured__${tail}`, v); // ALWAYS sets the lowercased variant
  }
}
```

When the snapshot already contained `insured__ciNumber` (proper
casing), this also set `insured__cinumber` in form state. Both
survived the round-trip back into the DB.

### B. `fillFormFromClient` — single-underscore clone for every key

The old code unconditionally also wrote the single-underscore variant:

```ts
setIfEmpty(`insured__${tail}`, v);
setIfEmpty(`insured_${tail}`, v); // ALWAYS, even if not a registered form field
```

For wizards configured with only `pkg__field` (double-underscore)
fields, this introduced a `pkg_field` clone that PackageBlock never
asked for but `doSubmit` still picked up.

### C. `doSubmit` / `saveClientChanges` — verbatim serialisation

Both functions iterate the form values and copy anything matching
the insured/contact prefix straight into the outgoing payload:

```ts
const insuredSnapshot: Record<string, unknown> = {};
for (const [k, v] of Object.entries(values)) {
  if (lower.startsWith("insured_") || lower.startsWith("insured__")
      || lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")) {
    insuredSnapshot[k] = v; // takes whatever junk is in form state
  }
}
```

The PATCH route at `app/api/policies/[id]/route.ts` then **full-replaces**
`insuredSnapshot` with whatever the client sent (it does NOT merge), so
keys that exist in the snapshot but not in the payload get dropped,
while clone keys that exist in the payload but not previously in the
snapshot get added — and the API records every such "addition" as a
change from `null` in `_audit`.

---

## 2. The fix — defence in three layers

### Layer 1: shared dedupe helper

`lib/policies/insured-snapshot-dedupe.ts` exports
`dedupeInsuredSnapshot(snapshot)` and `findDuplicateInsuredKeys(snapshot)`.
Both apply this normalisation:

```ts
norm(k) = k.toLowerCase()
          .replace(/^(insured|contactinfo)_{1,2}/, "")
          .replace(/_/g, "");
```

Keys that collapse to the same `norm()` are considered duplicates of
each other. The kept key is chosen by:

1. `pkg__field` (double-underscore) beats `pkg_field` (single).
2. When both are double-underscore, the one **preserving original
   casing** beats the all-lowercase clone.
3. Otherwise the first-seen key wins.

Non-prefixed keys (`insuredType`, `clientPolicyId`,
`clientPolicyNumber`) pass through untouched — they never collide
with prefixed keys.

### Layer 2: don't put garbage into form state in the first place

`fillFormFromRecord` and `fillFormFromClient` no longer write the
normalised variant unconditionally. They only set a variant when
that exact key is already registered in the RHF state (i.e.
`PackageBlock` rendered an `<Input>` for it).

```ts
// fillFormFromRecord
const formKeySet = new Set(Object.keys(form.getValues()));
// ...
if (normalized !== k && formKeySet.has(normalized)) {
  setVal(normalized, v);
}

// fillFormFromClient
if (registeredByLower.has(`insured_${tail}`)) {
  setIfEmpty(`insured_${tail}`, v);
}
```

This is the **load-time** guard. If the data being loaded is already
clean, the form state stays clean.

### Layer 3: dedupe on every save (the belt-and-braces)

Both write paths in the wizard run `dedupeInsuredSnapshot` on the
outgoing payload before `fetch(...)`:

- `saveClientChanges` (client-step "Save changes")
- `doSubmit` (final "Submit" / "Update" / "Create endorsement")

This is the **save-time** guard. Even if a future bug or a stale
form state slips a clone past Layer 2, Layer 3 collapses it before
it reaches the DB. The function is idempotent: clean input → clean
output, dirty input → clean output.

### Layer 3b: same dedupe MUST also run on `packagesPayload`

Originally Layer 3 only deduped the `insured` body field. The
audit log surprised us by still showing `insured__cinumber: null →
"X"` entries even after Layer 3 was in place, because the wizard's
package-collection loop ALSO copies every `insured__*` /
`contactinfo__*` form value into `packagesPayload.insured.values`
and `packagesPayload.contactinfo.values`. The PATCH route's audit
diff is generated by `flattenPkg(oldPkgs)` vs `flattenPkg(newPkgs)`
— so duplicate keys leaking into the packages snapshot reappear as
phantom "null → value" audit entries even when `insuredSnapshot`
itself is clean.

Therefore `doSubmit` runs `dedupeInsuredSnapshot` on **three**
objects, not one:

```ts
// (1) the insured body
const deduped = dedupeInsuredSnapshot(insuredSnapshot);
Object.assign(insuredSnapshot, deduped);

// (2) packagesPayload.insured.values
// (3) packagesPayload.contactinfo.values
for (const pkgName of ["insured", "contactinfo"] as const) {
  const pkg = packagesPayload[pkgName];
  if (!pkg || !pkg.values) continue;
  const dedupedPkgValues = dedupeInsuredSnapshot(pkg.values);
  Object.keys(pkg.values).forEach(k => delete pkg.values[k]);
  Object.assign(pkg.values, dedupedPkgValues);
}
```

Do NOT extend this to other packages (driver, vehicleinfo, etc.).
Their keys are produced by `PackageBlock` registration only — there
is no fillFormFromClient-style lowercase-cloner for them, so they
never accumulate duplicates that need collapsing. Applying dedupe
to them risks collapsing legitimately distinct fields whose tails
happen to normalise to the same string.

### Why three layers (and not just one)

| Layer | Catches | Why kept even if the others exist |
|---|---|---|
| **Helper (Layer 1)** | — | Provides a single source of truth for "what counts as a duplicate". Used by Layer 3 AND the cleanup script — divergence here would silently corrupt either side. |
| **Form-fill (Layer 2)** | New duplicates from loading existing records / clients | Prevents the form from telling RHF "this is a new field the user touched", which would otherwise trip dirty/validation/auto-save logic. |
| **Save-time (Layer 3)** | Anything that leaked past Layer 2 | The PATCH route is full-replace, so the snapshot is whatever the client sends. We must not rely on Layer 2 being perfect. |

---

## 3. One-time cleanup of pre-existing data

The fix prevents NEW duplicates. Rows written before the fix still
carry them in TWO places: `insuredSnapshot` and
`packagesSnapshot.{insured,contactinfo}.values`. PLUS the audit
log itself carries pre-existing type-coercion noise that needs a
third cleanup. There are three cleanup scripts:

| Script | Cleans |
|---|---|
| `scripts/cleanup-insured-snapshot-dupes.ts --apply` | `cars.extraAttributes.insuredSnapshot` only |
| `scripts/cleanup-packages-snapshot-dupes.cjs --apply` | `cars.extraAttributes.packagesSnapshot.insured.values` AND `.contactinfo.values`. Also scrubs false `null → value` audit entries whose key was a removed clone. |
| `scripts/cleanup-false-coercion-audits.cjs --apply` | Walks `cars.extraAttributes._audit[].changes` and drops any change whose `from` and `to` are semantically equal under `normalizeForCompare` — e.g. `"true" → true`, `"false" → false`, `"123" → 123`. These were generated when a boolean / numeric field's storage type changed between wizard versions. Run AFTER the other two so the audit array is already trimmed of clone-add entries. |

Run all three. They're idempotent — re-running them after
`--apply` must report 0 affected cars. If not, find the missed
normalisation case and update the relevant helper first (do NOT
special-case the scripts).

```
# dry-runs
npx tsx scripts/cleanup-insured-snapshot-dupes.ts
node scripts/cleanup-packages-snapshot-dupes.cjs
node scripts/cleanup-false-coercion-audits.cjs

# actually apply (run in this order)
npx tsx scripts/cleanup-insured-snapshot-dupes.ts --apply
node scripts/cleanup-packages-snapshot-dupes.cjs --apply
node scripts/cleanup-false-coercion-audits.cjs --apply
```

The packages cleanup script removes false audit entries (where
`from === null` AND the key was a clone that no longer exists),
because those entries make existing policies still appear
"changed" in the UI's "Recent changes in the last 7 days are
highlighted" banner. The coercion cleanup script removes audit
entries where the values are SEMANTICALLY equal under the same
rules as the server's `normalizeForCompare`. The
insured-snapshot cleanup script deliberately preserves
non-coerced historical audit entries — at the time, the
snapshot really did gain those keys.

---

## 3a. Server-side audit-diff comparator (`normalizeForCompare`)

`app/api/policies/[id]/route.ts` generates audit entries by
diffing OLD vs NEW packages and OLD vs NEW insuredSnapshot. The
diff is keyed off the `normalizeForCompare` helper inside the
PATCH handler:

```ts
const normalizeForCompare = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return JSON.stringify(null);
  if (v === true || v === "true") return JSON.stringify(true);
  if (v === false || v === "false") return JSON.stringify(false);
  if (typeof v === "string" && v !== "" && /^-?\d+(\.\d+)?$/.test(v) && !/^-?0\d/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v) return JSON.stringify(n);
  }
  return JSON.stringify(v);
};
```

Why each clause exists:

1. **`null`/`undefined`/`""` → `null`**: an absent field, a null
   field, and an empty string field are all "no value" from the
   user's perspective. A wizard re-save that re-emits `""` for a
   field that was previously `null` must not appear as a change.

2. **`"true" === true` / `"false" === false`**: boolean inputs
   in the wizard sometimes store the string `"true"` (when bound
   as `<input value="true">`) and sometimes store the boolean
   `true` (when bound via `setValueAs: (v) => v === "true"`).
   The two forms have shipped at different times. They are
   semantically identical and must collapse for audit purposes.

3. **Numeric strings → number**: same field rendered as a
   `<select>` (string options) vs a numeric `<Input type=number>`
   can flip between `"2019"` and `2019`. The leading-zero guard
   (`/^-?0\d/`) preserves identifiers like `"08"` for flat /
   floor numbers — those are NOT numerically equal to `8` in the
   domain (a flat number 08 is different from flat number 8 for
   display purposes; the user might re-print labels).

DO NOT extend `normalizeForCompare` to collapse:

- Case-insensitive strings (`"yes"` vs `"YES"`) — these are real
  edits in this app; the user can re-case a field.
- Trimmed strings (`"foo"` vs `" foo "`) — same reason.
- Zero-prefixed strings vs numbers (`"08"` vs `8`) — see (3) above.
- Different array element orders — the wizard preserves order and
  re-ordering is a real intent (e.g. driver priority).

If you change `normalizeForCompare`, ALSO update
`scripts/cleanup-false-coercion-audits.cjs` so they stay in lock-step.
A divergence means the script will miss false entries (or worse,
remove real ones).

---

## 4. 30-second cheatsheet

| Concern | Pattern | Don't do |
|---|---|---|
| Building an outgoing `insured: {...}` payload from form values | `JSON.stringify({ insured: dedupeInsuredSnapshot(snap) })` | Send the raw object straight from `form.getValues()` — clone keys leak into the DB |
| Pre-populating the wizard from an existing record/client | Only set normalised key variants if they are **already registered** in `form.getValues()` | Unconditionally `setVal("insured__" + lower(tail), v)` — that's exactly what created the bug |
| Detecting whether two keys are "the same" insured field | `norm(k) = k.toLowerCase().replace(/^(insured|contactinfo)_{1,2}/, "").replace(/_/g, "")` | Compare with `===` or with prefix-only stripping |
| Picking which of two duplicate keys to keep | `__` beats `_`, then non-lowercase beats all-lowercase | Pick whichever comes first alphabetically — that loses the canonical CamelCase form |
| Cleaning up legacy rows | `scripts/cleanup-insured-snapshot-dupes.ts --apply` | Hand-edit `cars.extra_attributes` SQL — easy to drop a real field by mistake |
| Removing duplicates inline in a new code path | `import { dedupeInsuredSnapshot } from "@/lib/policies/insured-snapshot-dedupe"` | Re-implement the normalisation rules — they must stay in lock-step with the cleanup script |

---

## 5. Where the contract lives (file index)

| File | Role |
|---|---|
| `lib/policies/insured-snapshot-dedupe.ts` | Source of truth for `dedupeInsuredSnapshot` and `findDuplicateInsuredKeys`. **Do not duplicate** in other files. |
| `app/(dashboard)/dashboard/flows/[flow]/new/page.tsx` | `fillFormFromRecord`, `fillFormFromClient`, `saveClientChanges`, `doSubmit` — all four read or call dedupe |
| `app/api/policies/[id]/route.ts` | PATCH handler — full-replaces `insuredSnapshot` with whatever the client sent. Audit log writes here. |
| `scripts/cleanup-insured-snapshot-dupes.ts` | One-time data migration. Safe to re-run; idempotent. |

The PATCH route does NOT call `dedupeInsuredSnapshot` itself. The
contract is: the client (the wizard) sends a clean payload. If a
future caller bypasses the wizard, it must also dedupe before
hitting PATCH, or the issue will return.

> **Hardening idea (not done yet):** add `dedupeInsuredSnapshot` to
> the PATCH route as well, so the server is the last line of
> defence. This was deliberately deferred — see `field-resolver.ts`
> which still relies on prefix fallbacks; aggressively normalising
> server-side may change resolver behaviour for legacy callers
> sending intentional `insured_*` (single-underscore) keys.

---

## 6. Symptoms / how the bug shows up

| Symptom | Likely cause |
|---|---|
| Audit shows `insured__cinumber: null → "X"` (lowercase clone of a CamelCase key) **and** the user swears they only clicked "Save" | `fillFormFromRecord` (Layer 2) regression OR a save path bypassing `dedupeInsuredSnapshot` (Layer 3) |
| Audit shows BOTH `insured__category` and `insured_category` flipping from null | `fillFormFromClient` (Layer 2) regression — single-underscore clone written without checking the form key registry |
| Same value appears twice in `PolicySnapshotView` (e.g. CI Number row shown twice) | Layer 1 (`dedupeInsuredSnapshot`) is not running on display path — that's intentional; only the persistence path dedupes. View should call dedupe too, or rely on cleanup script having run. |
| `_audit` has dozens of "changes" for a record after one save | Likely from BEFORE the fix; rerun `scripts/cleanup-insured-snapshot-dupes.ts --apply` to confirm no new dupes are being created |

---

## 7. Verification recipe

After any change to the four files in §5, run this in one go:

```bash
# 1. Static check: helper is the only place that knows the normalisation rule
rg "replace\(\/\^\(insured\|contactinfo\)" --type ts
#    Expected: exactly ONE match, in lib/policies/insured-snapshot-dedupe.ts

# 2. Static check: no caller defines its own dedupe map
rg "function dedupeInsuredSnapshot" --type ts
#    Expected: exactly ONE match, in the helper file

# 3. DB check: dry-run reports zero duplicates
npx tsx scripts/cleanup-insured-snapshot-dupes.ts
#    Expected: "Rows with duplicate keys: 0"

# 4. Smoke test in the UI
# - Open any policy via /dashboard/flows/<flow>?open=<id>
# - In the wizard, click "Save" without typing anything
# - Open the audit log; the new entry should have 0 changes
#   (NOT "insured__cinumber: null → ...")
```

If step 1 or 2 returns more than one match, someone has re-implemented
the normalisation rule — consolidate it back into the helper before
shipping.

---

## 8. When you genuinely want both `pkg_field` AND `pkg__field`

You don't. They describe the same logical field. If you find yourself
wanting both, the right answer is one of:

1. **Two different fields with different meanings** — give them
   distinct tails (e.g. `insured__contactName` for the primary
   contact and `insured__alternateContactName` for an alt).
2. **A legacy key in old data + a new key in new data** — keep ONE
   in the snapshot and let `lib/field-resolver.ts`'s `prefixedGet`
   /`fuzzyGet` fall back across spellings at read time. That's
   exactly what the resolver was designed for; the snapshot doesn't
   need both.

If a real future case shows up where two prefixed keys with the
same `norm()` represent semantically different data, update
`dedupeInsuredSnapshot` to recognise the discriminator AND update
this skill — don't paper over it with a special case in one caller.
