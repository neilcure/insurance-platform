---
name: accounting-view-reconciliation
description: Owns the rule for how `/dashboard/accounting`, policy-detail Accounting/Agent-Premium tabs, statement drawers, and PDF statements must reconcile receivables, payables, client-direct payments, agent settlements, and commission. The canonical reconciled view is produced by `/api/accounting/statements/by-policy/:policyId?audience=...` and rendered by `<StatementPaymentCard>` — the raw rows in `accounting_invoices` are NOT a ledger by themselves and must NEVER be summed across categories as if they were independent debts. Use when adding/editing any code that displays "Total Due", "Outstanding", "Client Paid Directly", "Agent Paid", "Commission", "Credit to Agent", or when grouping accounting rows by policy.
---

# Accounting view reconciliation

The platform records every accounting event as a row in
`accounting_invoices` + `accounting_payments`. But the **policy
obligation** is NOT the sum of those rows — it's a reconciled view
that knows that a client-direct payment and an agent settlement are
**alternative payment paths** for the SAME obligation, not two
independent debts.

This skill exists because the `/dashboard/accounting` page kept
getting "fixed" in ways that violated the architecture rule
([`insurance-platform-architecture.mdc`](mdc:.cursor/rules/insurance-platform-architecture.mdc)):

> **NEVER** sum client + agent payments as if they're separate debts —
> they settle ONE policy obligation.
>
> Either payer settling their amount = policy fully paid. They are
> alternative paths, NOT additive debts.

If your task touches **any** of the following, STOP and read this
skill before writing code:

- `app/(dashboard)/dashboard/accounting/page.tsx` — anything that
  groups rows or displays per-group totals
- `app/(dashboard)/dashboard/accounting/_lib/invoice-row-meta.ts`
- `app/api/accounting/invoices/route.ts` GET aggregation
- `app/api/accounting/stats/route.ts`
- `components/policies/tabs/PaymentSection.tsx` (per-policy summary)
- `components/policies/tabs/AccountingTab.tsx`
- `components/shared/StatementPaymentCard.tsx`
- `app/api/accounting/statements/by-policy/[policyId]/route.ts`
- `lib/accounting-invoices.ts` `isQuotationOnlyLifecycle` and
  `excludeQuotationOnlyRows`
- Anything on `/dashboard/agents/[id]` that shows "Total Due",
  "Commission", "Outstanding"
- Adding any new dashboard surface that displays per-policy
  receivables / payables totals
- Diagnosing "Agent Settlement row says UNPAID but client paid
  admin directly" / "group banner totals don't match the statement
  drawer" / "outstanding is double-counted on policies with both
  client and agent receivables"

## The 30-second cheatsheet

| Concern | Pattern | Don't do |
|---|---|---|
| Per-policy reconciled summary (Total Due, Outstanding, Client Paid, Agent Paid, Commission, Credit to Agent) | Fetch `/api/accounting/statements/by-policy/:policyId?audience=agent` (or `?audience=client`) and render `<StatementPaymentCard>` | Compute totals client-side by summing row.totalAmountCents and row.paidAmountCents |
| "Is this paid?" derived state per row | Check `wasClientPaidDirectly` BEFORE comparing paid vs total — client-direct rows are PAID even when paid==0 on the row | Map `inv.status === "pending"` → "UNPAID" without consulting `wasClientPaidDirectly` |
| Group total / outstanding in the Accounting table banner | Either fetch the statement OR limit summary to ONE category (e.g. "Total of receivables on this page" — explicitly labeled) | Sum `totalAmountCents` across `client_receivable` + `agent_receivable` + `agent_commission_payable` — that's the same money double-counted |
| Filter orphan rows (no linked policy) | They're typically dead data — give the user a one-click "Hide orphans" filter; never include them in group reconciliation since they can't be reconciled | Show them as UNPAID receivables that need attention |
| Stats card "Outstanding (Receivable)" | Already correct in `/api/accounting/stats` (uses GREATEST(total - paid, 0) on receivable rows only) | Recompute differently in any other view |
| Linking to canonical reconciled view | Use `/dashboard/agents/[id]` (Agent Premium tab) or the per-policy statement drawer for the truth | Reinvent the math in the Accounting page |

## 1. The data model in 5 lines

For a policy with an agent:

```
1 receivable row (entityType=agent OR client, depends on flow) with total=agentPremium
└─ accounting_payments rows hang off it; payer ∈ {client, agent}
1 commission payable row (entityType=agent, direction=payable, premiumType=agent_premium)
   ONLY created when client pays admin directly; total = clientPremium − agentPremium
```

For a policy with **no** agent:

```
1 receivable row (entityType=client) with total=clientPremium
└─ accounting_payments rows; payer=client
```

The architecture rule is: when you see BOTH a client_receivable AND
an agent_receivable for the same policy, they are NOT additive. They
represent the same obligation viewed from two sides. The reconciled
view subtracts one from the other based on which payer actually paid.

## 2. The canonical reconciled view

`/api/accounting/statements/by-policy/:policyId?audience=agent`
(or `?audience=client`) returns:

```ts
{
  statement: {
    activeTotal,            // unpaid premiums still owed
    paidIndividuallyTotal,  // paid premiums (excluding statement-bundled)
    agentPaidTotal,         // total of accounting_payments where payer=agent
    clientPaidTotal,        // total of accounting_payments where payer=client
    summaryTotals: {
      commissionTotal,      // sum of commission payable rows for this policy
    },
    // ...plus enrichedItems[] and policyClients{} for line-item display
  },
}
```

`<StatementPaymentCard>` (in `components/shared/StatementPaymentCard.tsx`)
takes these and renders the canonical block:

```
              credit    debit
Total Due                $X
Client Paid Directly  $Y
Agent Paid           $Z
Commission           $C                  (amber)
─────────────────────────────
Outstanding              $(X − Y − Z)    (red if > 0)
Credit to Agent       $(C − already paid on commission)
```

The math:

- `outstanding = totalDue − clientPaidTotal − agentPaidTotal` (capped at 0)
- `creditToAgent = commissionTotal − amountAlreadyPaidOnCommissionAP` (capped at 0)

These are the SAME numbers shown on:

- `/dashboard/agents/[id]` Agent Premium tab
- The policy-detail Agent Premium / Client Premium drawers
- The statement PDF (rendered through `lib/field-resolver.ts`
  `resolveStatementField`)

If your view shows different numbers, your view is wrong — not the
statement.

## 3. What `wasClientPaidDirectly` means and where it comes from

`wasClientPaidDirectly` is computed in
`app/api/accounting/invoices/route.ts` from the payer rollup:

```ts
clientPayerCount = count of accounting_payments
  WHERE invoiceId IN (this row)
    AND payer = 'client'
    AND status IN ('verified','confirmed','recorded')
wasClientPaidDirectly = clientPayerCount > 0
```

When `wasClientPaidDirectly === true`:

1. The row's `paid > total` is BY DESIGN — the receivable's total is
   the agent net premium, but the client paid the full client premium.
2. The architecture explicitly says "do NOT treat this as overpaid"
   (`computeWarnings` suppresses the warning for these rows).
3. The commission difference (`clientPremium − agentPremium`) is on
   a SEPARATE agent_commission_payable row, NOT a phantom on this row.
4. Any UI showing per-row paid state MUST short-circuit to "PAID" /
   "PAID (CLIENT DIRECT)" BEFORE comparing paid vs total.

Likewise `hasClientDirectSubmitted` means a client payment has been
submitted but not yet verified — show "PENDING VERIFY", NOT "UNPAID".

## 4. Orphan rows (no `policyId`)

Rows where `accounting_invoices.entityPolicyId IS NULL` AND no items
link to a policy are tagged with the `orphan_no_policy` warning.
They typically come from:

- A quote or test policy that was deleted — the auto-created AR row
  was turned into an orphan by the `ON DELETE: SET NULL` foreign key
  on `entity_policy_id` while its `accounting_invoice_items` rows
  were wiped by `ON DELETE: CASCADE`
- A test/dev creation that bypassed `autoCreateAccountingInvoices`
- A schema migration leftover

**Prevention (fixed 2026-05-13)**: the policy DELETE handler in
`app/api/policies/[id]/route.ts` now auto-cancels any open, unpaid
accounting invoices for the policy BEFORE the `db.delete(policies)`
call. This prevents new orphan rows from being created. Rows with a
real verified payment are intentionally left alone (the foreign key
sets them to NULL) because the money trail must be preserved for
audit — an admin must review those manually.

**Reconciliation rule**: orphan rows that DO exist (created before the
fix) can NEVER be reconciled because there is no policy to fetch a
statement for. Therefore:

- They MUST NOT contribute to per-group totals (they aren't in any
  group)
- They SHOULD be hidden by default in user-facing dashboards
  (`hideOrphans` toggle in `/dashboard/accounting`)
- Cleanup of legacy orphans: use `scripts/cleanup-orphan-test-invoices.ts`
  as a template — target specific IDs, include safety guards (must be
  pending, paid=0, no payment rows), dry-run first, then `--apply`

NEVER auto-cancel orphans in a bulk sweep without auditing each row
first — there is no way to be 100% sure a row is not a legitimate
receivable for a policy that was erroneously deleted.

## 5. The five places that MUST show consistent numbers

These five surfaces all display reconciled per-policy accounting
state. They must produce the SAME numbers for the same policy:

| Surface | Path | How |
|---|---|---|
| Agent details page summary card | `/dashboard/agents/[id]` | Calls `/api/accounting/statements/by-policy/:pid?audience=agent` |
| Agent Premium drawer in policy detail | `components/policies/tabs/PaymentSection.tsx` | Same endpoint |
| Client Premium drawer | `components/policies/tabs/PaymentSection.tsx` (audience=client) | Same endpoint |
| Statement PDF | `lib/field-resolver.ts` `resolveStatementField` via `lib/pdf/build-context.ts` `loadStatementByPolicy` | Same endpoint internally |
| **`/dashboard/accounting` records list** | should defer to the same source for per-policy reconciled summaries | TODO: today it computes a naive sum which is *near-right* for single-row policies but *wrong* for policies where client paid directly |

The Accounting records list is the OUTLIER. It shows raw rows because
that's what the user is there to act on (verify a payment, cancel a
row, fix data). But any **per-group summary** it displays must come
from the statement endpoint, not from summing the page's visible
rows.

## 6. Implementation patterns

### 6.1 Per-row "is paid?" badge

Always use this priority order (see
`app/(dashboard)/dashboard/accounting/page.tsx` status badge logic):

```
1. status === "cancelled"           → VOID
2. status === "refunded"             → REFUNDED
3. status === "statement_created"    → BUNDLED  (DO NOT compute paid state — defer to the statement)
4. status === "draft"                → DRAFT
5. totalAmountCents === 0            → ZERO
6. wasClientPaidDirectly             → PAID (CLIENT DIRECT)   ← BEFORE the amount comparison
7. hasClientDirectSubmitted          → PENDING VERIFY
8. paid >= total                     → PAID
9. paid > 0                          → PARTIAL
10. status === "overdue"             → OVERDUE
11. else                             → UNPAID
```

### 6.2 Per-policy group banner totals (Accounting page)

Use ONE of these patterns — never improvise:

**Pattern A (preferred, requires fetch)**: Lazy-fetch the statement
when the group banner mounts:

```tsx
const { totals } = useStatementByPolicy(group.parentPolicyId);
return <StatementSummaryStrip totals={totals} currency={...} />;
```

This is what `<StatementPaymentCard>` consumes. It's the canonical
source of truth.

**Pattern B (fallback, must be labelled)**: If lazy-fetching N
statements is too expensive for a list page, show ONLY the count and
explicitly label totals as "Document totals (not reconciled)":

```tsx
<div title="Document totals — open the policy to see reconciled outstanding">
  Documents: {group.rows.length} · Sum of totals: $X (not reconciled)
</div>
```

NEVER show a "Total / Outstanding" pair in a group banner without
this caveat unless it actually comes from the statement endpoint.

### 6.3 Inferring client-direct status across siblings

For an agent_receivable row in a group where the sibling
client_receivable has `wasClientPaidDirectly === true`, the agent
settlement is ALSO effectively settled. The Accounting page MAY use
this as a fallback for display, but it's not authoritative — the
statement endpoint is. If you go this route, label it explicitly
("Settled via parallel client payment").

## 7. What NOT to do

1. **NEVER** sum `inv.totalAmountCents` across `client_receivable` +
   `agent_receivable` + `agent_commission_payable` and call the
   result a "policy total" — those are the same money viewed from
   three angles.
2. **NEVER** compute a group's "Outstanding" by summing each row's
   `total - paid`. The commission AP row's outstanding is NOT the
   client's debt; it's what admin owes the agent.
3. **NEVER** show "UNPAID" on an orphan agent settlement just because
   `paid === 0`. The user knows the underlying policy was paid via
   client-direct; the data just lacks the link to confirm. Hide
   orphans by default and offer a manual cancel.
4. **NEVER** show "UNPAID" on any row where `wasClientPaidDirectly`
   is true. That row IS paid — the payment is on the row itself, the
   row's total is just smaller than the payment because it's the net.
5. **NEVER** compute commission as a separate "outstanding" amount
   on top of the receivable's outstanding. Commission outstanding is
   ALREADY tracked on the commission AP row's `total - paid`.
6. **NEVER** ship a new dashboard surface that displays per-policy
   accounting state without pointing it at the statement endpoint or
   the agent-detail summary card. Every divergent view is a future
   support ticket where the user says "this page says X but that
   page says Y".
7. **NEVER** mutate the statement endpoint's response shape without
   updating `<StatementPaymentCard>` and `lib/field-resolver.ts`
   `resolveStatementField` together — they're the renderer and the
   PDF resolver, both consume the same `summaryTotals` shape.

## 8. Verification recipe

Before merging changes that touch the Accounting page, verify:

1. Pick a policy where **client paid admin directly** (you can spot
   one by the green "Client paid directly" badge in the row or
   `wasClientPaidDirectly=true` in the API response).
2. Open the Agent Premium drawer on that policy. Note `Outstanding`,
   `Client Paid Directly`, `Commission`.
3. Open `/dashboard/agents/[id]` for the agent. The summary card
   MUST show the same `Total Due`, `Outstanding`, `Commission`.
4. Open the statement PDF (Send Statement → Preview). The PDF MUST
   show the same numbers (rendered via `summaryTotals`).
5. Open `/dashboard/accounting`. The row for that policy MUST NOT
   render as "UNPAID" if the policy is settled. The row's status
   badge MUST say "PAID (CLIENT DIRECT)" or similar.

If any of those four surfaces disagree, the bug is in YOUR change —
not in the others.
