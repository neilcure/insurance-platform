---
name: policy-calendar-expiry
description: >-
  Owns the full "what counts as overdue / expired / in-progress" contract for
  the Policy Calendar dashboard widget. Covers the two canonical scenarios
  (quotation stuck before start date, completed policy reaching end date),
  the EARLY_STAGE_STATUSES / TERMINAL_STATUSES boundary, bucket routing, date
  extraction, and the API ↔ frontend data flow. Use when editing
  app/api/policies/expiring/route.ts, components/dashboard/policy-expiry-calendar.tsx,
  lib/pdf/synthetic-fields.ts, or when debugging "policy shows in wrong bucket",
  "overdue badge missing", "completed policy not appearing on calendar",
  "quotation policy appears overdue when it shouldn't", or adding a new policy
  lifecycle status.
---

# Policy Calendar — Expiry & Overdue Contract

## The two canonical scenarios

### Scenario 1 — Quotation stuck (overdue)

A policy is **overdue** when ALL of the following are true:

1. Status is still at **early stage** — `quotation_prepared` or `quotation_sent`.
2. Today has reached the **day before** the policy's `startDate`  
   (`daysFromToday <= 1` — "starts tomorrow" is already too late to act).

Logic lives in `bucketForRow` in `components/dashboard/policy-expiry-calendar.tsx`:

```typescript
const EARLY_STAGE_STATUSES = new Set(["quotation_prepared", "quotation_sent"]);

const isEarlyStage = !status || EARLY_STAGE_STATUSES.has(status);
const startDateImminent = row.daysFromToday <= 1; // day-before threshold
if (isEarlyStage && startDateImminent) return "overdue_incomplete";
return "in_progress";
```

Bucket: **`overdue_incomplete`** (red). Badge: `Overdue Xd` / `Starts today` / `Starts tomorrow`.

Policies at quotation stage whose start date is still ≥ 2 days away go to **`in_progress`** (blue, no badge) — not overdue yet, just something to monitor.

### Scenario 2 — Completed policy reaching end date

A policy with a **terminal status** (`policy_issued`, `completed`, `cancelled`, `declined`, `rejected`, `expired`, `closed`) plots on its **`endDate`** and is bucketed by how close/past that date is:

| `daysFromToday` | Bucket | Colour |
|---|---|---|
| `<= 0` | `expired` | Orange |
| `1–7` | `week` | Amber |
| `8–30` | `month` | Yellow |
| `> 30` | `later` | Slate |

### What "in progress" means (NOT overdue)

Statuses beyond quotation stage (e.g. `invoice_prepared`, `invoice_sent`, `payment_received`, `quotation_confirmed`) mean the workflow is progressing normally. These go to **`in_progress`** regardless of date — no urgency badge is shown because the team has acted on the policy.

## Files & responsibilities

| File | Owns |
|---|---|
| `app/api/policies/expiring/route.ts` | DB fetch, date extraction, `isIncompleteStatus`, `daysFromToday` computation, `extraFields` population (incl. synthetic fields) |
| `components/dashboard/policy-expiry-calendar.tsx` | Bucket routing (`bucketForRow`), `EARLY_STAGE_STATUSES`, `BUCKET_DEFS`, row badge rendering, settings panel |
| `lib/pdf/synthetic-fields.ts` | Shared catalog of auto-resolved fields (Display Name, Primary ID, Full Address) used by both the calendar picker and PDF Mail-Merge |

## Key constants

### `TERMINAL_STATUSES` (API — `route.ts`)

```typescript
const TERMINAL_STATUSES = new Set([
  "policy_issued", "cancelled", "declined", "rejected",
  "expired", "completed", "closed",
]);
```

If status is **in** this set → `kind: "renewal"` → plots at `endDate`.  
If status is **not** in this set → `kind: "incomplete"` → plots at `startDate`.

### `EARLY_STAGE_STATUSES` (frontend — `policy-expiry-calendar.tsx`)

```typescript
const EARLY_STAGE_STATUSES = new Set([
  "quotation_prepared",
  "quotation_sent",
]);
```

Only these two statuses can trigger `overdue_incomplete`. Everything else that is `incomplete` goes to `in_progress`.

## Date extraction (`extractDateField` in `route.ts`)

- `startDate`: token list covers `startdate`, `starteddate`, `effectivedate`, `validfrom`, `inceptiondate`, etc.
- `endDate`: token list covers `enddate`, `expirydate`, `expirationdate`, `validto`, `coverend`, etc.

Tokens are normalised (lowercased, separators stripped, domain prefix stripped). First exact match in any package wins; suffix/contains match used as fallback.

**Known limitation**: field names are admin-configured and vary per tenant. The proper fix is `meta.dateRole: "start" | "end"` on `form_options` rows (per `dynamic-config-first` skill). New tokens should NOT be added without also updating this skill.

## Adding a new policy status

When a new status is added:

1. **Is it terminal** (policy fully closed / issued)?  
   → Add to `TERMINAL_STATUSES` in `route.ts`.

2. **Is it early stage** (quotation-level, no invoice yet)?  
   → Add to `EARLY_STAGE_STATUSES` in `policy-expiry-calendar.tsx`.

3. **Otherwise** (invoice sent, payment stage, etc.):  
   → Leave both sets alone — it auto-routes to `in_progress`.

4. Update the table in this skill.

## Overdue threshold rationale

The threshold is `daysFromToday <= 1` (not `<= 0`) because:

> "By the day before coverage starts, the paperwork must be done."

If today is the day before `startDate` and the policy is still at "Quotation Prepared", there is no time left to action it before coverage begins. Showing "Starts tomorrow" as an overdue warning is intentional.

## Verification recipe

To confirm a policy is routed correctly:

1. Open the policy in the dashboard.
2. Note its status and snapshot `startDate` / `endDate`.
3. In the Policy Calendar widget, find the policy in the expected bucket.
4. If missing: check `GET /api/policies/expiring` response — confirm `kind`, `daysFromToday`, `date`, `status` fields.
5. `daysFromToday = startOfDay(anchorDate) - startOfDay(today)` in whole days.

## Timezone contract — `ExpiringRow.date` is a calendar day, NOT an instant

Snapshot dates like `17-06-2027` are calendar days (no time, no
timezone). The API MUST serialize them as a timezone-free
`YYYY-MM-DD` string and the client MUST parse them with the
`parseLocalYMD` helper. Do NOT use `anchorDay.toISOString()` on the
server or `new Date(r.date)` on the client.

The bug being prevented: when the server's timezone differs from
the browser's enough to cross a day boundary (e.g. HK-hosted app
viewed from a US VPS browser), `new Date("2027-06-16T16:00:00.000Z")
.getDate()` returns 16 in PST but 17 in HKT — the calendar dot
appears on the wrong day, the "clicked day" filter misses, and
`localDateRowMapKey` produces inconsistent keys between the
plotting pass and the row-lookup pass.

| Surface | Pattern |
|---|---|
| API response `date` field | `toIsoYmd(anchorDay)` — uses local accessors on a `Date` that's already at local midnight, so the calendar day round-trips verbatim |
| Client deserialization of `r.date` / `closest.date` | `parseLocalYMD(s)` — extracts `YYYY-MM-DD` and builds `new Date(y, m-1, d)` so `.getDate()` is stable across timezones |
| `dateDisplay` / `endDateDisplay` | Already safe — computed on the server with `fmtDateDDMMYYYY` which reads local accessors; no timezone conversion happens |
| `daysFromToday` | Already safe — computed server-side via `diffInDays(anchorDay, today)` on local-midnight Dates and shipped as a plain integer |

If you add a NEW field on `ExpiringRow` that represents a calendar
day, follow the same contract. Never call `.toISOString()` on a
local-midnight `Date` and send it to the browser as a calendar day.

SQL to inspect snapshot dates directly:

```sql
SELECT
  p.policy_number,
  p.status,
  c.extra_attributes->'packagesSnapshot' AS pkgs
FROM policies p
LEFT JOIN cars c ON c.policy_id = p.id
WHERE p.policy_number = 'YOUR-NUMBER';
```
