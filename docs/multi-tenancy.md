# Multi-tenancy & data isolation

This document captures the **contract** that every API route and server
action must follow when reading or writing tenant-scoped data. There is
no Postgres RLS in this project — isolation is enforced **only** by the
application layer, so missing one of these rules silently leaks data
across organisations.

## Tenant model

- The tenant unit is `organisations` (1 row per insurance brokerage / insurer).
- Users are linked to organisations via the `memberships` table:
  `memberships(userId, organisationId, role)` with a composite PK.
- A user may belong to **multiple** organisations.
- `clients` is the only major business table that has **no**
  `organisationId` column today. Tenant scope for a client is derived
  via the policies that reference it.

## Roles

| `users.user_type` | Scope | Notes |
|---|---|---|
| `admin` | All organisations | Acts globally; `policyScopeWhere` returns no filter. |
| `internal_staff` | All organisations | Same as admin for read scope, narrower in some write paths. |
| `agent` | Own policies (`agent_id = user.id`) | May also be a member of one or more orgs. |
| `accounting` | Memberships only | Sees policies in their org(s). |
| `direct_client` | Linked client only | Sees policies whose `client_id.user_id = user.id`. |
| `service_provider` | Memberships only | Same as `accounting` for org scope. |

The full read scope is encoded in `lib/auth/rbac.ts` (`policyScopeWhere`)
and `lib/policy-access.ts` (`canAccessPolicy` for single-record checks).

## Required checks for every route

### Read endpoints

1. Call `requireUser()` (from `lib/auth/require-user`) at the top of the handler.
2. **For list endpoints** — apply `policyScopeWhere(user)` to the query
   (or its equivalent for non-policy tables). Always join through
   `memberships` for non-admin users.
3. **For detail endpoints** — call `canAccessPolicy({ id, userType }, policyId)`
   before returning the row.

### Write endpoints

1. Call `requireUser()`.
2. Resolve the target `organisationId` **explicitly** from the request
   body / query — do **not** silently fall back to "first membership"
   or "first org in DB" (this was the bug that motivated this doc).
3. Call `assertOrgAccess(user, organisationId)` from `lib/auth/rbac.ts`
   before any insert/update. `admin` and `internal_staff` bypass; everyone
   else must hold a `memberships` row.
4. For policy-scoped writes (e.g. `documentTracking`, `cars`,
   `policy_premiums`) call `canAccessPolicy` to confirm the user can
   touch this specific policy.

### Concurrent writes

`policies.documentTracking` is a JSONB blob mutated by many flows
(client document tracking, signing, send-document, accounting). Always
mutate it through `lib/document-tracking/atomic-update.ts` —
**never** read-modify-write inline. The helper wraps the read+update in
a transaction with `SELECT … FOR UPDATE` so concurrent edits serialize
instead of clobbering each other's fields.

## Common anti-patterns to avoid

```ts
// ❌ Silent fallback to first membership / first org
const orgId = body.organisationId
  ?? (await db.select(...).from(memberships).limit(1))?.[0]?.organisationId
  ?? (await db.select(...).from(organisations).limit(1))?.[0]?.id;

// ✅ Explicit resolve + assert
const orgId = Number(body.organisationId);
if (!Number.isFinite(orgId) || orgId <= 0) {
  return NextResponse.json({ error: "organisationId is required" }, { status: 400 });
}
await assertOrgAccess(user, orgId); // throws if forbidden
```

```ts
// ❌ Inline read-modify-write of documentTracking
const [row] = await db.select({ dt: policies.documentTracking })...;
const next = { ...row.dt, [key]: value };
await db.update(policies).set({ documentTracking: next })...;

// ✅ Atomic helper
import { updateDocumentTracking } from "@/lib/document-tracking/atomic-update";
await updateDocumentTracking(policyId, (current) => ({
  ...current,
  [key]: value,
}));
```

```ts
// ❌ Trusting client-supplied organisationId without verifying membership
await db.insert(policies).values({ ...body, organisationId: body.orgId });

// ✅ Verify first
await assertOrgAccess(user, body.orgId);
await db.insert(policies).values({ ...body, organisationId: body.orgId });
```

## Why no Postgres RLS?

Row-level security in Postgres is a strong second line of defence, but
turning it on across 30+ tables with multiple roles is a high-risk
migration that needs:

- A per-table policy authored and tested.
- A per-request `SET LOCAL` of the active org / user (which `postgres.js`
  pooled connections need extra care for).
- A migration plan for every existing query.

We have intentionally deferred RLS until those constraints have a real
budget. The application-level checks above are the contract until then.
