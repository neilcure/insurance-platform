---
name: policy-numbering
description: Owns the full pipeline for `policies.policy_number` — the resolution chain (insurer-supplied → covernote → auto-generated), the layered prefix lookup (`flow_prefixes:<orgId>` and `client_number_prefixes:<orgId>` for company/personal), the collision-safe `lib/policy-number.ts` helper, the display-normalization helpers in `lib/policies/policy-number-display.ts`, the bulk-import path, and the endorsement rule. Use when editing `app/api/policies/route.ts`, `lib/policy-number.ts`, `lib/import/batch-service.ts`, anything under `app/(dashboard)/policies/new/`, or when debugging "duplicate policy number" 500s, missing prefixes, surprise prefixes after admin changes, or rapid-fire imports producing collisions.
---

# Policy-number generation, resolution & display

`policies.policy_number` is the canonical user-visible identifier for
every policy and endorsement. It is `NOT NULL UNIQUE` in Postgres
(`db/schema/insurance.ts`). Get the contract wrong and the symptoms
are loud (500 on create) or silent-but-wrong (a tenant's policies all
share the wrong prefix after an admin rename).

This skill captures three things:

1. **Where the number comes from** — the resolution chain.
2. **Where the prefix comes from** — the layered admin-config lookup.
3. **How to keep it collision-safe** — `lib/policy-number.ts`.

If your task touches any of the files in the `description` above,
read this skill before writing code.

---

## 1. Resolution chain (in `app/api/policies/route.ts` POST)

Order matters. The first non-empty value wins:

```
1.  body.policy.insurerPolicyNo       // authoritative insurer ref
2.  body.policy.covernoteNo           // interim insurer covernote
3.  await generatePolicyNumber(prefix) // collision-safe auto path
```

| Source | When used | Caller responsibility |
|---|---|---|
| `insurerPolicyNo` | User typed an insurer policy number | Validate format upstream; collisions return **409** (we surface a clear message — see `isPolicyNumberUniqueViolation`) |
| `covernoteNo` | Insurer issued a covernote first | Same as above |
| Auto-generated | Both above are blank | Use the helper — never `${prefix}-${Date.now()}` inline |

The **legacy POST path** (`policyCreateSchema`) requires the caller to
supply `policyNumber` (it's `z.string().min(1)`); that path does NOT
auto-generate. Don't add silent auto-generation there — it would change
the contract for legacy callers.

### NEVER do this

```ts
// ❌ Same-millisecond collision risk; fails under bulk imports.
const policyNumber = `${prefix}-${Date.now()}`;

// ❌ Bypasses the resolution chain — kills user-supplied numbers.
const policyNumber = await generatePolicyNumber(prefix);
```

### ALWAYS do this

```ts
import { generatePolicyNumber, isPolicyNumberUniqueViolation } from "@/lib/policy-number";

const policyNumber =
  body.policy?.insurerPolicyNo ||
  body.policy?.covernoteNo ||
  (await generatePolicyNumber(recordPrefix));

try {
  await tx.insert(policies).values({ policyNumber, organisationId, ... });
} catch (err) {
  if (isPolicyNumberUniqueViolation(err)) {
    return NextResponse.json(
      { error: "Policy number already exists. Use a different number or leave blank to auto-generate." },
      { status: 409 },
    );
  }
  throw err;
}
```

---

## 2. Where `recordPrefix` comes from (layered, admin-configured)

The prefix used by the auto-generator is computed PER REQUEST through
this chain (also in `app/api/policies/route.ts` POST, ~lines 124–154):

```
                ┌───────────────────────────┐
   default →    │ "POL"                     │
                └─────────────┬─────────────┘
                              │
   per-flow →   ┌─────────────▼─────────────────────────────┐
                │ app_settings.value where key =            │
                │   `flow_prefixes:<organisationId>`        │
                │ → JSON object { [flowKey]: "MOTO", ... }  │
                │ Picks `flowPrefixes[flowKey]` if present  │
                └─────────────┬─────────────────────────────┘
                              │
   client-flow  ┌─────────────▼─────────────────────────────┐
   override →   │ ONLY when flowKey contains "client" AND   │
                │ insuredType is "company" or "personal":   │
                │   app_settings.value where key =          │
                │   `client_number_prefixes:<organisationId>│
                │ → { companyPrefix, personalPrefix }       │
                │ Picks the matching one if non-empty       │
                └───────────────────────────────────────────┘
```

| Setting key | Stored shape | Wins when |
|---|---|---|
| `flow_prefixes:<orgId>` | `{ "<flowKey>": "<prefix>", ... }` | flowKey present in payload |
| `client_number_prefixes:<orgId>` | `{ companyPrefix?: string; personalPrefix?: string }` | flowKey contains "client" AND insuredType is company/personal |

**Multi-tenancy:** Both keys are scoped by `organisationId` suffix.
Resolve `organisationId` via `lib/auth/active-org.ts` `resolveActiveOrgId`
BEFORE looking up the prefix — never trust the request body's
`organisationId` blindly (see `docs/multi-tenancy.md`).

**Endorsements:** Endorsement policies (`flowKey = "endorsement"`) are
SEPARATE `policies` rows with their own `policy_number`. They do NOT
inherit the parent policy's number. The endorsement number uses its
own flow's prefix (or "POL" default). The parent linkage lives in
`cars.extraAttributes.linkedPolicyId`, not in the policy number.

---

## 3. The collision-safe helper (`lib/policy-number.ts`)

```ts
generatePolicyNumber(prefix, tx?): Promise<string>
```

Format: `${safePrefix}-${msTimestamp}-${randomTail4}`
e.g. `POL-1735999999123-X7K2`

Why this shape:
- **`msTimestamp`** keeps numbers human-readable and roughly monotonic
  (helpful when scanning the policies table by date).
- **`randomTail4`** (4 chars from a 31-symbol alphabet — no I/L/O/0/1)
  gives 31⁴ ≈ 923 521 combinations, eliminating the same-millisecond
  collision risk.
- **Pre-flight check** queries `policies.policy_number` for the
  candidate before returning. If taken (essentially impossible), it
  retries up to 20 times.
- **Final fallback** after 20 retries: 8-char tail (31⁸ ≈ 8.5×10¹¹
  combinations). Still graceful, never panics.

The `tx` parameter is optional. Pass it when you want the pre-flight
check to run on the same connection as your eventual INSERT (closes
the microsecond race window between SELECT-and-INSERT). Without `tx`,
the database's `UNIQUE` constraint is still the final guarantee — you
just need `isPolicyNumberUniqueViolation` to catch the rare 23505.

### NEVER do this

```ts
// ❌ "Auto-generate" by hand — bypasses pre-flight + retry.
const num = `${prefix}-${Date.now()}-${Math.random()}`;

// ❌ Trust an arbitrary prefix without falling back to "POL" default.
const num = await generatePolicyNumber(undefined as any);
// → helper handles this, but other callers shouldn't pass undefined
```

### Why mirror `lib/document-number.ts`?

Same problem (race-prone unique number generation), same proven shape:
pre-flight insert, retry on 23505, longer tail as final fallback.
Reusing the pattern means any contributor who's read one understands
the other. Don't reinvent the loop.

---

## 4. Display & normalization (`lib/policies/policy-number-display.ts`)

Premium / statement lines append a single-letter suffix:

```
POLS-1775         ← canonical policy number stored in DB
POLS-1775(a)      ← invoice line / statement display variant
POLS-1775(b)      ← second line variant
```

Always strip with `stripPolicyLineSuffix(num)` before:
- Looking up a policy by number in DB (`eq(policies.policyNumber, ...)`)
- Comparing two numbers for equality
- Building cross-references between accounting and policies

For display in monospace contexts (e.g. tables, code blocks), use
`formatPolicyNumberForDisplay(num)` to normalize "POLS 1775" →
"POLS-1775".

### NEVER do this

```ts
// ❌ DB lookup with a suffixed number — will return zero rows.
const [row] = await db.select().from(policies)
  .where(eq(policies.policyNumber, "POLS-1775(a)")).limit(1);

// ✅ Strip first.
import { stripPolicyLineSuffix } from "@/lib/policies/policy-number-display";
const lookup = stripPolicyLineSuffix(rawValue);
const [row] = await db.select().from(policies)
  .where(eq(policies.policyNumber, lookup)).limit(1);
```

---

## 5. Bulk imports (`lib/import/batch-service.ts`)

Imports POST one row at a time to `/api/policies`, so they go through
the SAME resolution chain and the SAME helper. Concurrency safety is
inherited from `lib/policy-number.ts` — DON'T add an inline shortcut
in the import service.

If the import payload supplies `recordNumber` / `policyNumber`, that
becomes `insurerPolicyNo` upstream and wins position 1 of the chain.
Otherwise position 3 (auto) generates one collision-safe.

### NEVER do this

```ts
// ❌ Pre-generate numbers in the import service to "save a round trip"
// — duplicates the helper logic and re-introduces collisions during
// rapid-fire commits.
for (const row of rows) {
  row.policyNumber = `${prefix}-${Date.now()}-${i}`; // race + non-unique
  await postPolicy(row);
}
```

---

## 6. Verification recipe

When changing anything in this pipeline, sanity-check with:

```sql
-- Confirm no duplicates exist (should always return 0)
SELECT policy_number, COUNT(*) FROM policies
GROUP BY policy_number HAVING COUNT(*) > 1;

-- Inspect the prefix lookup for an org
SELECT key, value FROM app_settings WHERE key LIKE 'flow_prefixes:%' OR key LIKE 'client_number_prefixes:%';

-- Spot-check that auto-generated numbers have the new shape
SELECT policy_number FROM policies
WHERE policy_number ~ '^[A-Z]+-[0-9]{13}-[A-Z2-9]{4,8}$'
ORDER BY id DESC LIMIT 10;
```

Manual UI smoke test:
1. Open two browser tabs, both on `/policies/new`.
2. Fill in identical wizards (same flow, no insurer policy number).
3. Click "Save" in both within the same second.
4. Both should succeed with DIFFERENT auto-generated numbers.
5. Refresh the list — both rows present, both unique.

---

## 7. The 30-second cheatsheet

| Concern | Pattern | Don't do |
|---|---|---|
| Auto-generate a number | `await generatePolicyNumber(prefix)` | `${prefix}-${Date.now()}` |
| Resolve the prefix | Default → `flow_prefixes:<orgId>` → `client_number_prefixes:<orgId>` (client flows + insuredType only) | Hard-code "POL" everywhere |
| User-supplied number conflict | Catch with `isPolicyNumberUniqueViolation` → return 409 | Let the 23505 propagate as 500 |
| Display in tables | `formatPolicyNumberForDisplay(num)` | Show raw `"POLS 1775"` inconsistently |
| DB lookup by number | Strip suffix first via `stripPolicyLineSuffix` | Match `"POLS-1775(a)"` literally |
| Endorsements | Generate their OWN number with their flow's prefix | Reuse parent's policy_number |
| Bulk imports | Same `/api/policies` POST, same helper | Pre-generate in `batch-service.ts` |
| Multi-tenancy | Resolve `organisationId` via `lib/auth/active-org.ts` BEFORE prefix lookup | Trust `body.organisationId` blindly |

If any of the above is unclear, the section above has the contract
plus an executable verification recipe.
