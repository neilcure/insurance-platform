---
name: dynamic-config-first
description: Owns the platform-wide rule that admin-facing lists, dropdowns, role rules, premium roles, premium contexts, DB column suggestions, and any other "what options exist" choice MUST be admin-configurable through `form_options` (or the schema introspected via a single registry) — NEVER a hand-typed React array, hand-typed `Record<string, string>` mapping, or a hand-coded `if (userType === ... && role === ...)` branch. Tracks the existing violations (`DB_COLUMN_OPTIONS`, `PREMIUM_CONTEXT_OPTIONS`, `PREMIUM_ROLE_OPTIONS`, `COLUMN_TO_SUGGESTED_ROLE`, `applyDefaultRoleFilter`, `userTypeToContext`, `isPremiumPkg`, `USER_TYPE_LABELS`, `SYNTHETIC_FIELDS_BY_SOURCE`, `PACKAGE_COLOR_MAP`, `BUILT_IN_SECTION_TEMPLATES`, etc.), and provides the migration recipe for replacing each. Use whenever adding a new dropdown to an admin editor, a new role-gated rule, a new "Show in X" or "Visible to" config, a new premium concept (role / context / column), a new colour map, a new synthetic field list, OR when reviewing a PR that introduces another `const FOO = [ ... ]` of admin-facing options. This skill exists because `insurance-platform-architecture.mdc` codifies the principle but the codebase has accumulated violations.
---

# Dynamic Config First — no hardcoded admin lists

This app's whole architecture is "everything an admin would want to
change lives in `form_options`, NOT in code". When you hand-type a
React array of options you:

1. Lock that decision into a deploy cycle (admins can't change it).
2. Bake one tenant's choices (e.g. HK-only `levyCents`,
   `stampDutyCents`, `discountCents`) into the codebase as if they
   apply to everyone.
3. Force the same list to be duplicated in 3+ files (the actual
   pattern in `EditPackageFieldClient.tsx` /
   `NewPackageFieldClient.tsx` / `GenericFieldsManager.tsx`).
4. Re-introduce the "label substring matching" anti-pattern — see
   `insurance-platform-architecture.mdc` §"What NOT to do" #20.

**The rule, full stop:** anything an admin might add, remove,
rename, reorder, or scope to a tenant lives in `form_options`. Code
reads it. UI reads it. Filters read it. Period.

---

## 1. The two legitimate sources

| Source | What it owns | Read via |
|---|---|---|
| `form_options` table | Roles, contexts, statuses, packages, fields, document templates, anything an admin can edit | `/api/form-options?groupKey=…` (client) or `db.select().from(formOptions).where(eq(groupKey, ...))` (server) |
| `db/schema/*.ts` | DB column structure (cannot be admin-mutated without a migration) | A single registry module — see §3.1 |

Anything else (a hand-typed `const FOO = [ ... ]` of admin-facing
options, a `Record<string, string>` label map, a `function isFooPkg`
hardcoded list, a `userType === "X"` role rule with no fallback to
config) is a **violation** and needs an entry in §4.

---

## 2. The contract

When you add a new admin-facing concept, decide first:

```
   ┌─────────────────────────────────────────┐
   │ Could a tenant ever want this different?│
   └─────────────────────┬───────────────────┘
                         │
              ┌──── yes ─┴─── no ────┐
              │                      │
              ▼                      ▼
   form_options row(s)       OK to keep in code
   with a stable groupKey    BUT centralise in
   and per-row meta          a single registry
                             module — never duplicate
                             across components
```

If the answer is "I dunno" → assume **yes** and put it in
`form_options`. The cost of moving it later is much higher than the
cost of one extra DB row today.

---

## 3. Approved patterns

### 3.1 Schema-derived registry (for things truly bound to columns)

DB columns can't be admin-managed (would require live migrations).
But the LIST of available columns shouldn't be re-typed in every
React component. Build one registry module:

```ts
// lib/accounting-columns.ts (proposed)
import { policyPremiums } from "@/db/schema/premiums";

export type AccountingColumn = {
  value: string;          // physical column name, e.g. "netPremiumCents"
  label: string;          // display label for the dropdown
  type: "cents" | "rate" | "string";
  /**
   * Optional locale tag. Tenants can hide columns that don't apply
   * (e.g. HK-only `levyCents` for a non-HK tenant). The registry
   * declares the column EXISTS in the schema; whether it's exposed
   * in the admin UI is decided by tenant-scoped form_options.
   */
  locale?: "hk" | "global";
};

export const ACCOUNTING_COLUMNS: AccountingColumn[] = [ ... ];
```

Then every component reads `ACCOUNTING_COLUMNS`. ONE place to fix.

### 3.2 form_options group_key (for everything else)

```
groupKey: "premium_roles"
  rows:
    { value: "client",     label: "Client Premium",    sortOrder: 1, meta: { suggestedColumns: ["clientPremiumCents", "grossPremiumCents"] } }
    { value: "agent",      label: "Agent Premium",     sortOrder: 2, meta: { suggestedColumns: ["agentPremiumCents"] } }
    { value: "net",        label: "Net Premium",       sortOrder: 3, meta: { suggestedColumns: ["netPremiumCents"], adminOnly: true } }
    { value: "commission", label: "Commission",        sortOrder: 4, meta: { suggestedColumns: ["agentCommissionCents"] } }

groupKey: "premium_contexts"
  rows:
    { value: "policy",       label: "Policy",                       sortOrder: 1 }
    { value: "collaborator", label: "Collaborator (Premium Payable)", sortOrder: 2 }
    { value: "insurer",      label: "Insurance Company",            sortOrder: 3 }
    { value: "client",       label: "Client",                       sortOrder: 4 }
    { value: "agent",        label: "Agent",                        sortOrder: 5 }

groupKey: "user_type_visibility"
  rows:
    { value: "admin",         label: "Admin",         meta: { allowedPremiumRoles: "*" } }
    { value: "internal_staff",label: "Internal Staff",meta: { allowedPremiumRoles: "*" } }
    { value: "accounting",    label: "Accounting",    meta: { allowedPremiumRoles: "*" } }
    { value: "agent",         label: "Agent",         meta: { allowedPremiumRoles: ["client", "agent", "commission"] } }
    { value: "direct_client", label: "Direct Client", meta: { allowedPremiumRoles: ["client"] } }
    { value: "service_provider", label: "Service Provider", meta: { allowedPremiumRoles: ["client"] } }
```

Then `applyDefaultRoleFilter` becomes:

```ts
async function applyDefaultRoleFilter(fields, userType) {
  const visibilityRow = await getFormOption("user_type_visibility", userType);
  const allowed = visibilityRow?.meta?.allowedPremiumRoles ?? ["client"]; // safest default
  if (allowed === "*") return fields;
  return fields.filter((f) => !f.premiumRole || allowed.includes(f.premiumRole));
}
```

NO hardcoded role list in code. Admin owns the matrix.

### 3.3 Per-field override (when admin wants a specific exception)

`meta.visibleToRoles?: string[]` on the field row. If unset, the
default from §3.2 applies. If set, this field's allow-list wins.

---

## 4. Violations to migrate (audit trail)

Each row below is a **today** violation. Order them by impact when
picking what to fix next; don't try to fix all at once.

| # | Violation | File(s) | Proposed dynamic source |
|---|---|---|---|
| 1 | `DB_COLUMN_OPTIONS` (Gross / Net / Levy / Stamp Duty / Discount / Commission Rate / Currency …) hand-typed in 2+ React components | `EditPackageFieldClient.tsx` L13–25, `NewPackageFieldClient.tsx` L18–30 | `lib/accounting-columns.ts` registry (§3.1). Optional locale flag for HK columns. |
| 2 | `PREMIUM_CONTEXT_OPTIONS` (Policy / Collaborator / Insurer / Client / Agent) hand-typed | `EditPackageFieldClient.tsx` L26–32, `NewPackageFieldClient.tsx` L31–37 | `form_options` `premium_contexts` (§3.2) |
| 3 | `PREMIUM_ROLE_OPTIONS` hand-typed | `EditPackageFieldClient.tsx` L33–39, `NewPackageFieldClient.tsx` L38–44 | `form_options` `premium_roles` (§3.2) |
| 4 | `COLUMN_TO_SUGGESTED_ROLE` hand-typed | `EditPackageFieldClient.tsx` L40–46, `NewPackageFieldClient.tsx` L45–51 | `form_options.premium_roles[*].meta.suggestedColumns[]` (§3.2) |
| 5 | `isPremiumPkg = (p) => p === "premiumRecord" \|\| p === "accounting"` hardcoded | `EditPackageFieldClient.tsx` L47, `NewPackageFieldClient.tsx` L52 | `form_options.packages[*].meta.isPremium` flag |
| 6 | `applyDefaultRoleFilter` hardcoded role rules | `app/api/policies/[id]/premiums/route.ts` L311–327 | `form_options` `user_type_visibility` (§3.2) + per-field `meta.visibleToRoles` (§3.3) |
| 7 | `userTypeToContext` hardcoded role → context map | `app/api/policies/[id]/premiums/route.ts` L299–303 | Derived from `user_type_visibility.meta.defaultContext` or first `allowedPremiumRoles` entry |
| 8 | `levyCents`, `stampDutyCents`, `discountCents`, `commissionRate` HK-only columns in schema | `db/schema/premiums.ts` L23–26 | Document as locale-specific in the registry. Long-term: move HK-only to `extra_values` JSONB; keep only universally-applicable columns in the schema. |
| 9 | `USER_TYPE_LABELS` hand-typed | `components/admin/AuditLogPanel.tsx` L24 | `form_options` `user_types` (one row per enum value, with admin-editable label) — does NOT widen the enum, only renames it |
| 10 | `SYNTHETIC_FIELDS_BY_SOURCE`, `HANDLED_FIELD_KEYS_BY_SOURCE`, `PACKAGE_COLOR_MAP`, `PACKAGE_FALLBACK_COLORS`, `BUILT_IN_SECTION_TEMPLATES` | `components/admin/pdf-templates/PdfTemplateEditor.tsx` | Mostly derive from `form_options.packages[*].meta` (color, synthetic fields). `BUILT_IN_SECTION_TEMPLATES` could move to `form_options` `pdf_template_section_presets`. |
| 11 | `SOURCES`, `FORMATS`, `SOURCE_COLORS` hand-typed | `components/admin/FieldResolverDiagPanel.tsx` L56–66 | This is a dev-diagnostic panel; lower priority. Still: derive `SOURCES` from `form_options.packages` + the well-known non-package sources (policy, agent, client, organisation, accounting, …) which themselves should live in a registry. |

When you fix one, **delete its row from this table** in the same PR.
The audit trail is the source of truth for "how dynamic-first are we
right now".

---

## 5. NEVER do these

```ts
// ❌ Hand-typed admin-facing list duplicated across files.
const PREMIUM_ROLE_OPTIONS = [
  { value: "client", label: "Client Premium" },
  { value: "agent",  label: "Agent Premium" },
  { value: "net",    label: "Net Premium" },
];

// ❌ Hardcoded role rule with no config fallback.
if (userType === "client" && field.premiumRole === "net") return null;

// ❌ Hardcoded "is this a premium package?" check.
const isPremiumPkg = (p) => p === "premiumRecord" || p === "accounting";

// ❌ Re-typing schema columns in a React component.
const DB_COLUMN_OPTIONS = [
  { value: "grossPremiumCents", label: "Gross Premium" },
  ...
];

// ❌ Adding "just one more" entry to an existing hardcoded list because
//    "it's the same pattern as the others". You're growing the violation.
```

---

## 6. ALWAYS do these

```ts
// ✅ Read the list from form_options at component mount.
const { data: roles } = useFormOptions("premium_roles");
return (
  <select>
    {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
  </select>
);

// ✅ Apply a role rule via admin-configured visibility map.
const visibility = await loadFormOptionsByGroup("user_type_visibility");
const allowed = visibility.find((r) => r.value === user.userType)?.meta?.allowedPremiumRoles;
fields = filterByAllowedRoles(fields, allowed);

// ✅ Derive "is premium package" from the package row's meta.
const pkg = await loadFormOption("packages", pkgKey);
if (pkg?.meta?.isPremium) { ... }

// ✅ Read DB columns from a single registry.
import { ACCOUNTING_COLUMNS } from "@/lib/accounting-columns";
return <select>{ACCOUNTING_COLUMNS.map(c => <option ... />)}</select>;
```

---

## 7. Adding a new admin-facing concept (decision tree)

```
1. Could a tenant ever rename, reorder, scope, or disable this?
   yes → form_options group, with a new admin UI to edit it
   no  → does it map to a DB column / enum?
         yes → registry module, single source of truth
         no  → it probably IS tenant-configurable; revisit step 1

2. Will any code branch on its value?
   yes → store the SEMANTIC tag in meta (e.g. premiumRole), branch on
         that — never on label.includes(...)
   no  → just need display? labels are fine in form_options

3. Will it interact with role-based visibility?
   yes → also add a row to user_type_visibility config (or add a
         meta.visibleToRoles override on the field)
   no  → done.
```

---

## 8. Verification recipe

Before merging any PR that adds an admin-facing list:

```bash
# A. No new hand-typed admin-facing arrays.
rg "^const \w+_OPTIONS\s*=\s*\[" --type ts components/admin/ | grep -v node_modules
rg "^const \w+_BY_SOURCE\s*=\s*\{" --type ts components/admin/ | grep -v node_modules

# B. No new userType === "..." branches in routes/lib (config-fallback expected).
rg 'user(?:Type|_type)\s*===\s*"' --type ts app/api lib | grep -v "active-org\|policy-access\|rbac\|require-user"
```

If either turns up a NEW match, the PR needs to either (a) move the
list into `form_options` / a registry, or (b) add an explicit row to
the §4 audit table with a clear migration path. No new untracked
violations.

---

## 9. The 30-second cheatsheet

| Concern | Pattern | Don't do |
|---|---|---|
| New dropdown in an admin editor | Read from `form_options` group | `const FOO_OPTIONS = [ ... ]` in the component |
| New role / context / status / package type | New `form_options` group_key + admin UI to edit it | Hardcode in code; admins can't change it |
| Branch on a config value | Use `meta.<semanticTag>` | `label.includes("client")` / `key === "main"` |
| Map DB column → suggested role | `meta.suggestedColumns[]` on the role row | `Record<string, string>` in 3 React files |
| "Is this a premium package?" | `package.meta.isPremium` | `key === "premiumRecord" \|\| key === "accounting"` |
| Role-based visibility | `user_type_visibility.meta.allowedPremiumRoles` + per-field `meta.visibleToRoles` | `applyDefaultRoleFilter` hardcoded `if/else` |
| HK-specific columns (Levy / Stamp Duty / Discount) | Tag locale in registry; tenant-scoped form_options decide visibility | Schema-level columns assumed to apply to every tenant |
| Adding "one more" entry to an existing hardcoded list | Migrate the list to `form_options` first, THEN add the entry | Grow the violation |

If this skill says "no" and a feature feels easier with a hardcoded
list, the feature is a smell. Move the list first.
