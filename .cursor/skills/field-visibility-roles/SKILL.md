---
name: field-visibility-roles
description: Owns the whole contract for "which user_type sees which field / tab / record / amount" across the entire platform — premium fields, accounting tabs, snapshot packages, navigation entries, dashboard tiles, and all other surfaces that hide or expose data based on the logged-in user's role. Covers the user_type enum, the 3 visibility axes (role × policy-scope × field-config), the two-pass premium-tab filter, the legacy `applyDefaultRoleFilter` fallback, the conflation between admin-tab labels and end-user roles, and every known gap (Net Premium leaking to clients, missing broker commission, formula engine has no IF). Use whenever adding a new `user_type`, a new "Show in X tabs" config, a new role-gated UI surface, a new premium field that should be admin-only, or when debugging "user X sees a field they shouldn't / can't see a field they should". This is COMPLEMENTARY to `document-user-rights` (documents only) and `client-policy-scope` (policy list scoping only) — those skills own one slice each, this one owns the platform-wide rule.
---

# Field Visibility & Role-Based Access — the one contract

Hiding or exposing data in this app is decided by the intersection of
**three independent axes**. Get any one wrong and you either (a) leak
something an end-user must not see (Net Premium to a client), or
(b) hide something an admin needs to do their job (a Premium tab going
blank because the field's `premiumContexts` list excluded `policy`).

The contract lives across four files. **No single file holds the
whole rule.** That is why this skill exists.

---

## 1. The three visibility axes

| Axis | Values | Stored where | Owned by |
|---|---|---|---|
| **Role** (who is logged in) | `admin`, `internal_staff`, `accounting`, `agent`, `direct_client`, `service_provider` | `users.user_type` (`userTypeEnum` in `db/schema/core.ts`) | `lib/auth/rbac.ts` + per-route checks |
| **Scope** (can this user see THIS row?) | org-membership / `policies.agentId` / parent-policy ownership | `memberships` + `policies.agent_id` + `clients.user_id` + `cars.extraAttributes.linkedPolicyId` | `lib/policy-access.ts` `canAccessPolicy`, `lib/auth/rbac.ts` `policyScopeWhere`, `lib/auth/active-org.ts` `resolveActiveOrgId` |
| **Field config** (does this field/tab/template apply to this surface?) | `meta.premiumContexts[]`, `meta.audience`, `meta.isAgentTemplate`, `meta.showWhen[]`, `meta.categories[]` | `form_options.meta` (jsonb), `pdf_templates.meta`, `document_templates.meta` | per-config helper (see §3) |

Every visibility decision is a logical AND of the three. Skip any
axis and you ship a bug.

---

## 2. The `user_type` enum

```ts
// db/schema/core.ts
export const userTypeEnum = pgEnum("user_type", [
  "admin",
  "agent",
  "direct_client",      // legacy, still in DB; treated as "client" downstream
  "service_provider",   // legacy, still in DB; treated as "client" downstream
  "internal_staff",     // renamed from insurer_staff
  "accounting",
]);
```

| Role | Org scope | Policy scope | Premium filter (default) | Documents (default) |
|---|---|---|---|---|
| `admin` | global | global | sees everything | client + agent copies |
| `internal_staff` | global | global | sees everything | client + agent copies |
| `accounting` | membership-scoped | membership-scoped | sees everything | client + agent copies |
| `agent` | membership-scoped | only `policies.agent_id = self` (or parent's for endorsements) | sees gross + agent + client, NOT net | client + agent copies for own policies |
| `direct_client` | membership-scoped | only own `clients.user_id = self` | sees fields with `premiumRole === "client"` | client copy ONLY |
| `service_provider` | membership-scoped | same as `direct_client` (legacy) | same as `direct_client` | client copy ONLY |
| any unknown new value | safest defaults | safest defaults | client-only | client copy ONLY |

The "admin-like" group is `["admin", "internal_staff"]` (see
`isAdminLike` in `lib/auth/active-org.ts`). The "scoped" group is
everyone else. Don't reinvent these checks inline — call the helpers.

---

## 3. The four contract files (what each one owns)

| File | Owns | Read it when |
|---|---|---|
| `lib/auth/rbac.ts` | `canCreatePolicy`, `policyScopeWhere`, `userHasOrgAccess`, `assertOrgAccess` | Adding any new write endpoint or list endpoint that needs org-scope filtering |
| `lib/policy-access.ts` | `canAccessPolicy(user, policyId)` — the one canonical "can this user open THIS policy?" | Adding any per-policy endpoint (premiums, documents, snapshot edit, etc.) |
| `lib/auth/active-org.ts` | `resolveActiveOrgId`, `isAdminLike`, `userBelongsTo` | Resolving which `organisationId` a request acts on (NEVER trust `body.organisationId`) |
| `lib/auth/document-audience.ts` | Document audience matrix (client / agent / all) | Documents only — see [`document-user-rights` skill](../document-user-rights/SKILL.md) |
| `lib/accounting-fields.ts` `filterFieldsByContext` | First-pass premium tab filter | Premium tabs / accounting fields |
| `app/api/policies/[id]/premiums/route.ts` `userTypeToContext` + `applyDefaultRoleFilter` | Second-pass role filter on top of the first pass | Premium tabs / accounting fields — **see §4 for the trap** |

---

## 4. Premium fields — the two-pass filter (and its trap)

This is the most subtle surface and the one that has shipped bugs.
Reading `lib/accounting-fields.ts` alone is NOT enough; the route
applies a second filter on top.

```ts
// app/api/policies/[id]/premiums/route.ts
const roleContext = userTypeToContext(user.userType);     // null for admin-like, "agent" / "client" otherwise
let fields = filterFieldsByContext(allFields, context);   // Pass 1: by tab the user is viewing
if (roleContext) {
  const anyFieldHasContexts = allFields.some((f) => f.premiumContexts && f.premiumContexts.length > 0);
  if (anyFieldHasContexts) {
    fields = filterFieldsByContext(fields, roleContext);  // Pass 2a: same helper, by role
  } else {
    fields = applyDefaultRoleFilter(fields, roleContext); // Pass 2b: HARD-CODED legacy fallback
  }
}
```

### What each pass does

- **Pass 1 (`filterFieldsByContext` with the tab context)**: Reads the
  admin's `premiumContexts` checkboxes ("Show in Premium Tabs" — see
  `PREMIUM_CONTEXT_OPTIONS` in `EditPackageFieldClient.tsx`). If the
  field has `premiumContexts: ["agent"]` and the user is on the
  `policy` tab, the field is hidden.
- **Pass 2a (admin has set `premiumContexts` on at least one field)**:
  Re-runs the SAME filter using the user's role-derived context.
  Critically, this means the admin's "Client (Client Premium)"
  checkbox does double duty — it controls BOTH "show on Client tab"
  AND "show to client users".
- **Pass 2b (no field has `premiumContexts` configured)**: Falls back
  to a hard-coded rule:
  - `client` users see fields with `premiumRole === "client"` only
  - `agent` users see all except `premiumRole === "net"`
  This is the ONLY layer that guarantees "Net Premium hidden from
  clients" automatically.

### The trap: configuring `premiumContexts` on any field disables the safety net

The moment one admin clicks the "Show in Premium Tabs" group on
**any** premium field, `applyDefaultRoleFilter` stops running for the
whole list. From that point on, every field's role visibility depends
on whether `Client (Client Premium)` is ticked — including Net
Premium. If the admin keeps `Client` ticked on Net Premium so that
the "Client Premium" tab still renders it, **clients logging in will
also see Net Premium**.

### NEVER do this

```ts
// ❌ Inline role check that bypasses the helper.
if (user.userType === "client" && field.label.toLowerCase().includes("net")) hide();

// ❌ Adding a new role-gated premium tab without updating PREMIUM_CONTEXT_OPTIONS
//    AND userTypeToContext AND applyDefaultRoleFilter together.
```

### ALWAYS do this

```ts
// ✅ Trust the contract. Add the new role (if needed) to:
//   1. db/schema/core.ts userTypeEnum
//   2. userTypeToContext (route)
//   3. applyDefaultRoleFilter (route) — the safety net
//   4. PREMIUM_CONTEXT_OPTIONS (admin UI) if the role is admin-facing
//   5. lib/auth/document-audience.ts (audiencesForRole) if it touches docs
```

---

## 5. Other field surfaces (cross-reference)

| Surface | Filter location | Owned by skill |
|---|---|---|
| **Policy snapshot packages** (Insured, Vehicle, Driver, etc.) | `meta.categories[]` + `meta.showWhen[]` per field; loaded by `loadPackageFieldVariants` and rendered in `PolicySnapshotView` | `multi-variant-fields` |
| **Document templates** (HTML quotation, invoice, receipt) | `meta.audience` per section/field; `audiencesForRole` in `lib/auth/document-audience.ts` | `document-user-rights` |
| **PDF Mail Merge templates** | `meta.audience` on the template + per-placement `field.audience` | `document-user-rights` |
| **Policy list scope** for `direct_client` | `app/api/policies/route.ts` GET — split between plain list and `?linkedPolicyId=` | `client-policy-scope` |
| **Premium tabs / accounting fields** | `meta.premiumContexts[]` + two-pass filter | this skill (§4) |
| **Admin-only navigation entries** | `components/app-sidebar.tsx` per-link `userType` checks | this skill (§7) |
| **Per-action gates** (create policy, invite user, edit org settings) | `lib/auth/rbac.ts` | this skill (§3) |

If your task touches any of the **first four rows**, defer to the
named skill — it owns the contract for that surface. Use this skill
for the platform-wide rules and the premium / sidebar / RBAC
surfaces.

---

## 6. Known gaps and their workarounds (open issues)

These are real footguns, not bugs to fix today. Knowing they exist
prevents surprises.

### 6.1 Net Premium can leak to clients once `premiumContexts` is configured

**Symptom**: A client user sees Net Premium on the Premium tab.
**Why**: Pass 2b (`applyDefaultRoleFilter`) is the ONLY layer that
hides `premiumRole === "net"` from clients automatically. Once an
admin sets `premiumContexts` on any field, that fallback stops
running. The admin's "Client (Client Premium)" checkbox then has to
be UNCHECKED on Net Premium — but that also blanks the Client
Premium admin tab.

**Mitigation today**: Audit Net Premium and any other admin-only
field after configuring `premiumContexts` for the first time. Make
sure `Client` is unticked.

**Proper fix (TODO — must be config-driven, NOT hardcoded)**:
Hardcoding `if (userType === "client" && role === "net") hide()` in
the route is itself an anti-pattern — see the
[`dynamic-config-first` skill](../dynamic-config-first/SKILL.md) §4
which lists `applyDefaultRoleFilter` as a tracked violation.

The proper fix has two parts:

1. **Add `user_type_visibility` to `form_options`** — admin maps each
   `user_type` to an allow-list of `premiumRole` values. Default
   seeds (admin/internal_staff/accounting → `*`, agent → `[client,
   agent, commission]`, direct_client/service_provider → `[client]`)
   match today's hardcoded behaviour but are now editable per tenant.
2. **Add `meta.visibleToRoles?: string[]` per field** — the per-field
   override. If unset, the default from step 1 applies. If set, this
   field's allow-list wins.

`applyDefaultRoleFilter` then becomes a single `await
loadVisibilityFor(userType)` + `fields.filter(allowed.includes)`. No
hardcoded role list. Admin owns the matrix. See `dynamic-config-first`
§3.2 for the exact `form_options` shape.

### 6.2 "Our commission" / broker margin is not modeled

**Symptom**: There's no field for the broker's margin (what the
brokerage keeps). The system tracks `agentCommissionCents` (= what
the agent keeps = `clientPremium − agentPremium`) but not
`brokerCommission`.

**Why**: Two scenarios produce two different formulas, and the
formula engine (`lib/formula.ts`) has no conditional primitive:
- With agent: broker margin = `agentPremium − netPremium`
- Direct client (no agent): broker margin = `clientPremium − netPremium`

**Mitigation today**: Compute it server-side per scenario when
needed (mirror the pattern in `lib/agent-commission.ts`). Don't try
to express it as a single admin-configured formula.

**Proper fix (TODO)**: Either (a) add a `RECEIVABLE` token to the
formula engine that resolves to `agentPremium` when an agent is
present and `clientPremium` otherwise — then a single field with
formula `{receivable} - {npremium}` works for both flows; or (b) add
a dedicated `brokerCommissionCents` DB column + helper. Option (a) is
smaller and aligns with how `receivable` already works in the
receivable-direction logic.

### 6.3 Formula engine has no `IF` / `CASE`

**Symptom**: Admins cannot express "use formula A when X, formula B
otherwise" in `meta.formula`.
**Mitigation today**: Use `meta.showWhen[]` to render two separate
fields and let the showWhen rules pick one. Each field's formula can
be unconditional.
**Proper fix (TODO)**: Tracked under §6.2 — the `RECEIVABLE` keyword
covers the most common case without expanding the formula language.

### 6.4 Endorsement agentId resolution

`canAccessPolicy` falls back to the parent policy's `agent_id` when
the endorsement row has none — see `lib/policy-access.ts` lines
40–48. NEVER drop that fallback. It's also why
`autoCreateAccountingInvoices` calls `resolvePolicyAgent` instead of
reading `policies.agent_id` directly. The parent linkage lives in
`cars.extraAttributes.linkedPolicyId` (may be a string in JSONB —
use `Number()`).

---

## 7. Adding a new role-gated surface (checklist)

When adding any new feature that should hide or expose data based on
role, copy this checklist into your scratchpad and tick each item:

```
[ ] 1. Identify the role(s) that should see it. Map to user_type values.
[ ] 2. Server-side scope: which rows? Use canAccessPolicy / policyScopeWhere /
       userHasOrgAccess from the contract files. NO inline membership lookups.
[ ] 3. Field/tab config: does the surface already use form_options.meta? Add
       a new meta key documented here. Default it to "show everywhere" so
       existing rows aren't silently hidden.
[ ] 4. Apply BOTH the role check AND the field config in the route. Never
       rely on the UI alone (defense-in-depth).
[ ] 5. UI hide layer: the component should not render buttons/tabs the
       server would 403 — UX only, not security.
[ ] 6. Update the §2 matrix and §5 table above with the new surface.
[ ] 7. Verification recipe (§8) — run the SQL + manual smoke test.
```

---

## 8. Verification recipe

Run before merging any change to a contract file or `meta` shape.

### SQL

```sql
-- A. Confirm the user_type enum hasn't drifted from the matrix in §2.
SELECT enumlabel FROM pg_enum
WHERE enumtypid = 'user_type'::regtype
ORDER BY enumsortorder;

-- B. Spot-check fields that have premiumContexts set (these bypass the
--    legacy applyDefaultRoleFilter safety net — see §6.1).
SELECT id, label, value, meta -> 'premiumContexts' AS contexts,
       meta ->> 'premiumRole' AS role
FROM form_options
WHERE group_key = 'premiumRecord_fields'
  AND meta ? 'premiumContexts'
ORDER BY id;

-- C. Find policies whose agent_id is null (endorsements rely on parent —
--    confirm the parent has an agent before assuming visibility).
SELECT p.id, p.policy_number, p.agent_id, c.extra_attributes ->> 'linkedPolicyId' AS parent
FROM policies p
LEFT JOIN cars c ON c.policy_id = p.id
WHERE p.agent_id IS NULL
  AND c.extra_attributes ? 'linkedPolicyId'
LIMIT 20;
```

### Manual UI smoke test

1. Log in as `admin` → open a policy → confirm all expected fields
   render on the Premium tab.
2. Log in as `agent` (the policy's assigned agent) → same policy →
   confirm Net Premium is hidden, Agent Premium is visible.
3. Log in as `direct_client` (linked to that policy's client) →
   same policy → confirm Net Premium is hidden, Client Premium is
   visible.
4. Repeat 2 and 3 for an **endorsement** policy whose `agent_id` is
   null but whose parent has one — agent and client must still see
   the right fields.
5. Toggle one admin-only premium field's `Client (Client Premium)`
   checkbox off, save, refresh in step 3 — that field must disappear
   for the client.

If any step deviates from the matrix in §2, STOP and fix the
contract file BEFORE merging.

---

## 9. The 30-second cheatsheet

| Concern | Pattern | Don't do |
|---|---|---|
| Org-scope on a list endpoint | `policyScopeWhere(user)` from `lib/auth/rbac.ts` | Inline membership join |
| Per-policy access in any policy endpoint | `canAccessPolicy(user, policyId)` from `lib/policy-access.ts` | Re-derive agent / membership rules |
| Resolve which org a request acts on | `resolveActiveOrgId` from `lib/auth/active-org.ts` | Trust `body.organisationId` |
| Map `user_type` to "admin-like" | `isAdminLike(user)` | Check `user.userType === "admin"` only — forgets `internal_staff` |
| Premium tab visibility | `filterFieldsByContext(fields, context)` + role second pass via `userTypeToContext` | Hard-code role checks in the component |
| Net Premium hidden from clients | Today: keep `applyDefaultRoleFilter` running by NOT setting `premiumContexts` on any field, OR uncheck `Client` on Net Premium. See §6.1 for the proper fix. | Assume admin checkboxes alone are enough |
| Documents | Defer to `document-user-rights` skill | Reinvent audience rules inline |
| Policy list scope for `direct_client` | Defer to `client-policy-scope` skill | Reuse plain `/api/policies` for `?linkedPolicyId=` |

If anything above is unclear, the section above has the contract,
the trap, and an executable verification recipe.
