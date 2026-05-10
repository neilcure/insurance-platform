---
name: field-label-case
description: Owns the full contract for how admin-configured `labelCase` (original / upper / lower / title) on `form_options` fields flows through to displayed values — column headers in the policies table, cell values, wizard form labels, package block labels, and the built-in displayName (insured name) column. Use when adding any surface that displays field labels or values derived from `form_options`, when debugging "Name shows UPPER CASE instead of Title Case", when touching `applyLabelCase` / `applyCaseToText`, or when adding a new place that reads `meta.labelCase`.
---

# Field Label Case

## What `labelCase` controls

`form_options` rows for package fields (`${pkg}_fields`) and insured fields (`insured_fields`) carry:

```json
{ "meta": { "labelCase": "original" | "upper" | "lower" | "title" } }
```

This setting drives TWO things:
1. **Label display** — the column header / form field label text
2. **Value display** — the cell value rendered for that field

## The one correct implementation

```typescript
function applyCase(text: string, mode?: "original" | "upper" | "lower" | "title"): string {
  if (!mode || mode === "original") return text;
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  // CRITICAL: toLowerCase() FIRST, then capitalise — without it,
  // "KWAN SIU MAN" stays all-caps because \b\w only touches the first char.
  return text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
```

**Never** write `text.replace(/\b\w/g, ...)` without the leading `text.toLowerCase()` — this is the canonical bug that leaves ALL-CAPS strings unchanged in title mode.

## Where this is implemented (keep all in sync)

| File | Function | Applies to |
|---|---|---|
| `components/policies/PoliciesTableClient.tsx` | `applyCaseToText` | Table cell values + `_builtin.displayName` |
| `components/policies/PoliciesTableClient.tsx` | label build loop (line ~322) | Column header labels |
| `components/policies/PackageBlock.tsx` | `applyLabelCase` | Package block field labels |
| `app/(dashboard)/policies/new/page.tsx` | `applyLabelCase` | Wizard form field labels |

## How `fieldLabelCases` is built in `PoliciesTableClient`

The `useEffect` that fetches `form_options` builds three parallel maps from the same data:

```typescript
// labels: path → transformed label string
// orders: path → sort order number
// cases:  path → "original" | "upper" | "lower" | "title"
```

Every path is registered under THREE key variants per prefix so snapshot key mismatches are tolerated:

```typescript
cases[`${pfx}.${key}`] = effectiveCase;
cases[`${pfx}.${pkg}__${key}`] = effectiveCase;
cases[`${pfx}.${pkg}_${key}`] = effectiveCase;
```

## The built-in `_builtin.displayName` column

`displayName` is a concatenated name computed server-side — it has no direct `form_options` key. Its case is derived at render time by `getDisplayNameCase()`, which scans `fieldLabelCases` for:

```
insured.lastName → insured.lastname → insured.last_name →
insured.firstName → insured.firstname → insured.first_name →
insured.companyName → insured.companyname → insured.company_name
```

Returns the first non-`"original"` case found, or `"original"` if none is set.

## Adding a new surface that displays field values

1. Load `form_options` for the relevant `groupKey` — include `meta` in the type:
   ```typescript
   Array<{ value?: string; label?: string; meta?: { labelCase?: "original" | "upper" | "lower" | "title" } | null }>
   ```
2. Build a `cases: Record<string, "original" | "upper" | "lower" | "title">` map keyed by the same path scheme as above.
3. Apply via `applyCase(text, cases[path])` at render time. Never mutate stored data.

## Rules

- **Display-only** — `labelCase` is a render-time transform. Never write transformed values back to the DB.
- **Sorting and filtering** always use the raw stored value (case-insensitive), never the transformed display value.
- If you change `applyCase` / `applyLabelCase` in ONE file, change ALL files in the table above.
- `meta.labelCase` absent or `"original"` → return `text` unchanged (no transform cost).
