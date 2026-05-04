---
name: document-user-rights
description: Owns the whole rule for "which user can see / generate / send / receive which document on which policy" across the entire insurance platform. Covers the 4-layer defense-in-depth model (proxy auth → policy scope → audience gate → UI hide), the role × audience matrix, the shared helper at `lib/auth/document-audience.ts`, the PDF Mail Merge audience dropdown, and every server route that touches documents (HTML document templates, PDF mail-merge templates, document-tracking, send-document, documents/email, uploaded-file download). Use whenever adding or editing ANY document-facing code path, adding a new user_type to the enum, adding a new template audience, or debugging "user X can see / can't see / can fetch / can send document Y".
---

# Document user rights — the one contract

Every decision about who can see or act on a document in this app
combines three independent axes:

| Axis | Values | Stored where |
|---|---|---|
| **Role** | `admin`, `internal_staff`, `agent`, `accounting`, `direct_client`, `service_provider` | `users.user_type` (`userTypeEnum` in `db/schema/core.ts`) |
| **Policy scope** | owns / is agent of / has membership in the org | `policies.agent_id`, `memberships`, `clients.user_id` |
| **Audience** | `client`, `agent`, `all` | `meta.isAgentTemplate`, `meta.enableAgentCopy`, `meta.sections[].audience`, `field.audience` |

If you change ANY of the three — new role, new scope rule, new
audience value, new document template shape — you MUST update this
skill, `lib/auth/document-audience.ts`, AND run the verification
recipe at the bottom.

---

## 1. The 4-layer model

```
┌────────────────────────────────────────────────────────────┐
│  Layer 1  Route-level auth                 proxy.ts        │  "is signed in?"
├────────────────────────────────────────────────────────────┤
│  Layer 2  Policy-scope access              canAccessPolicy │  "can see THIS policy?"
├────────────────────────────────────────────────────────────┤
│  Layer 3  Audience gate                    document-audience.ts │  "which COPY?"
├────────────────────────────────────────────────────────────┤
│  Layer 4  UI hide (defense-in-depth)       viewer comps    │  don't render what L3 would reject
└────────────────────────────────────────────────────────────┘
```

Rules:

- **Layer 1** runs automatically for `/api/*` and `/dashboard/*` via
  `proxy.ts`. You don't add it; don't bypass it either.
- **Layer 2** is already wired on most document endpoints via
  `canAccessPolicy` in `lib/policy-access.ts`. If you add a new
  document endpoint, call it.
- **Layer 3** is the piece that used to be missing. It lives in
  `lib/auth/document-audience.ts`. **Important:** this file is deliberately
  free of `@/db` / `policy-access` imports so it stays safe inside client
  bundles. Compose Layer 2 by passing `verifyPolicyScope`:
  `resolveDocumentVisibility(user, policyId, meta, (u, pid) =>
  canAccessPolicy({ id: Number(u.id), userType: u.userType ?? '' }, pid))`.
- **Layer 4** is the UI hide — NEVER relied on for security, but
  required for UX so the user doesn't see buttons that 403.

**Security comes from layers 2 + 3 on the server.** The UI filter is
cosmetic. If you fix a leak by only editing a component, you haven't
fixed it.

---

## 2. Role × Audience matrix

| Role | Client copy | Agent copy | Notes |
|---|---|---|---|
| `admin` | Yes | Yes | |
| `internal_staff` | Yes | Yes | company-wide |
| `accounting` | Yes | Yes | scope still enforced by membership |
| `agent` | Yes | Yes | only policies where `policies.agent_id = user.id` (or parent's for endorsements) |
| `direct_client` | **Yes** | **No** | only own policies (membership) — must NEVER see agent copies |
| `service_provider` | Client-only (safest default) | No | legacy; treat as direct_client-equivalent for safety |
| Unknown / new `user_type` | Client-only (safest default) | No | `normalizeRole` in the helper returns `"other"` which maps to client-only |

The matrix is the single source of truth. Change it only in
`audiencesForRole()` inside `lib/auth/document-audience.ts` — never
re-derive it inline.

---

## 3. Using the helper

### Server routes (Layer 3)

```ts
import { resolveDocumentVisibility } from "@/lib/auth/document-audience";
import { canAccessPolicy } from "@/lib/policy-access";

export async function POST(req, ctx) {
  const user = await requireUser();
  const policyId = Number(...);
  const tpl = await loadTemplate(...);

  const verifyScope = (u: { id: string; userType?: string }, pid: number) =>
    canAccessPolicy({ id: Number(u.id), userType: u.userType ?? "" }, pid);

  const vis = await resolveDocumentVisibility(user, policyId, tpl.meta, verifyScope);
  if (!vis.allowed) {
    return NextResponse.json(
      { error: vis.reason === "scope" ? "Forbidden" : "Forbidden: audience restricted" },
      { status: 403 },
    );
  }

  const requestedAudience = parseAudience(body.audience) ?? "client";
  if (!vis.allowedAudiences.includes(requestedAudience)) {
    return NextResponse.json({ error: "Forbidden: audience" }, { status: 403 });
  }

  // … continue
}
```

**Why you call it even when `canAccessPolicy` already ran:** the
helper does scope for you (so you don't call `canAccessPolicy`
separately) AND adds the audience leg. Single call site, single
answer. If for some reason you've already done scope, you can use
`audienceVisibilityForRole` — the sync, non-DB variant.

### Client viewer (Layer 4)

```ts
import {
  audienceVisibilityForRole,
  filterTemplatesByRole,
} from "@/lib/auth/document-audience";

const visibleTemplates = filterTemplatesByRole(session.user.userType, templates);

const visForThisTpl = audienceVisibilityForRole(session.user.userType, tpl.meta);
const canShowAgentButton = visForThisTpl.allowedAudiences.includes("agent");
```

Scope is implicit — the server never returned a policy the user
can't see, so the viewer never has to re-check it.

### Route handler that accepts a user-provided `audience` string

ALWAYS validate it server-side against `vis.allowedAudiences`. Never
trust `body.audience` on its own. Pattern D in the example above.

---

## 4. Audience-descriptor contract

Both `DocumentTemplateMeta` (HTML templates) and `PdfTemplateMeta`
(PDF mail-merge templates) satisfy the helper's input type:

```ts
type AudienceDescriptor = {
  isAgentTemplate?: boolean;
  enableAgentCopy?: boolean;
  sections?: Array<{ audience?: string | null }>;
};
```

Mapping rule (encoded in `audiencesOfferedBy`):

| Flags | Audiences offered |
|---|---|
| `isAgentTemplate: true` + `enableAgentCopy: false` | `["agent"]` |
| `enableAgentCopy: true` | `["client", "agent"]` |
| both false (or undefined) | `["client"]` |
| any `sections[].audience === "agent"` | adds `"agent"` |
| any `sections[].audience === "client"` | adds `"client"` |

When you add a NEW audience value (e.g. `"insurer"`), extend the
`DocumentAudience` union in the helper, extend the matrix, extend
`audiencesOfferedBy`, and update this file — in one PR.

---

## 5. Admin UI — where each flag is set

| Template kind | Admin page | Audience control |
|---|---|---|
| HTML document templates (quotation, invoice, receipt, statement, credit note) | `/admin/policy-settings/document-templates` → open template → **Document Audience** dropdown | Writes `isAgentTemplate` + `enableAgentCopy` (in `DocumentTemplatesManager.tsx`) |
| PDF Mail Merge templates (uploaded PDFs with field placements) | `/admin/policy-settings/pdf-templates` → open template → **Document Audience** dropdown | Writes `isAgentTemplate` + `enableAgentCopy` (in `PdfTemplateEditor.tsx`) |

The dropdown has three options in both places — Client Only / Client +
Agent / Agent Only — and they map to the flag combinations in the
table in section 4.

Before this skill existed, the PDF editor had no audience control and
`isAgentTemplate` on PDF templates could only be set by JSON import /
server seed. If you find a repo state where the PDF editor doesn't
have the dropdown, restore it — this is the gap that let Hanson /
Dah Sing proposal forms leak to direct_client viewers.

---

## 6. Sites that MUST call the helper

Server routes that return, generate, send, or mutate document state:

- `app/api/pdf-templates/[id]/generate/route.ts`
- `app/api/pdf-templates/[id]/preview/route.ts`
- `app/api/pdf-templates/send-email/route.ts`
- `app/api/policies/[id]/document-tracking/route.ts`
- `app/api/policies/[id]/document-tracking/form-selections/route.ts`
- `app/api/policies/[id]/send-document/route.ts`
- `app/api/policies/[id]/documents/email/route.ts`
- `app/api/policies/[id]/signing-sessions/[token]/resend/route.ts`
- `app/api/accounting/invoices/[id]/document-tracking/route.ts`
- Any NEW endpoint that handles a document template or an audience-flagged artefact.

UI surfaces that render documents:

- `components/policies/tabs/DocumentsTab.tsx` (main viewer)
- `components/agents/AgentDocumentsTab.tsx` (agent statement flow)
- Admin preview surfaces (`DocumentTemplateLivePreview`) — read-only
  previews for admins only, so the helper returns everything; still
  prefer the helper to keep the rule consistent.

---

## 7. 30-second cheatsheet

| Concern | Pattern | Don't do |
|---|---|---|
| "Can user X see template T on policy P?" | `await resolveDocumentVisibility(user, P, T.meta, verifyScope)` — pass `verifyScope` that wraps `canAccessPolicy` | Inline `userType === "admin"` checks |
| "Should this button render for this role?" | `audienceVisibilityForRole(userType, meta)` | Re-read meta and decide in the component |
| "Filter a list of templates for this user" | `filterTemplatesByRole(userType, rows)` | Case-by-case `if (isClientUser) { … }` in the JSX |
| "Caller sent `body.audience` — is it legal?" | Check against `vis.allowedAudiences` | Trust the request |
| Added a new `user_type` enum value | Update `normalizeRole` + matrix + this file + verify | Hope the default lands you somewhere sensible |
| Added a new audience (e.g. `"insurer"`) | Extend `DocumentAudience` union + matrix + `audiencesOfferedBy` + this file | Hard-code the new value in one component |
| Adding a new PDF or HTML template flag that affects audience | Route it through `AudienceDescriptor` so the helper picks it up | Read the flag directly in routes/UI |
| Building a new doc endpoint | Pass `verifyScope` wrapping `canAccessPolicy` into `resolveDocumentVisibility` (+ audience branch) — both layers | Omit `verifyScope`; import `policy-access` from `document-audience.ts` (breaks Next client bundle / Turbopack) |

---

## 8. Common pitfalls

1. **UI-only fixes.** Filtering in `DocumentsTab` alone is NOT a fix.
   A hostile/curious signed-in user can hit the endpoint directly with
   fetch. Always close the route too.
2. **Passing `requestedAudience` without validating.** The client's
   `body.audience` is user input. Validate against
   `vis.allowedAudiences` every time.
3. **Wrapping `canAccessPolicy` but skipping audience.** Scope is
   necessary but not sufficient — a direct_client has scope on their
   own policy but must still be blocked from the agent audience.
4. **Forgetting endorsements.** Endorsements resolve `agent_id` via
   the parent policy (`cars.extraAttributes.linkedPolicyId`).
   `canAccessPolicy` already handles this; don't re-invent the parent
   lookup in your route.
5. **Hard-coding `isAgentTemplate` parsing.** There are three signals
   (`isAgentTemplate`, `enableAgentCopy`, `sections[].audience`) and
   the helper unions them. Always use the helper, never re-derive.
6. **Treating `direct_client` as "no access"**. They DO access the
   policy (their own). They just can't see the agent copy.

---

## 9. Verification recipe

When you land a change to this module or any caller:

1. **Type-check**: `npx tsc -p . --noEmit` — the helper's types catch
   callers that forget to branch on `allowed`.
2. **Manual smoke test matrix** — sign in as each role, navigate to a
   policy that has both client and agent documents, confirm:
   - `admin` / `internal_staff` / `accounting` / `agent` (the policy's
     agent): see both groups + both HTML and PDF agent-flagged
     templates.
   - `direct_client` (linked to the policy's client): see ONLY the
     client group; `AGENT DOCUMENTS` header absent; no `(A)` copies;
     no PDF templates flagged `Agent Only`.
3. **Direct-fetch probe** — from the `direct_client` session, open
   devtools and `fetch("/api/pdf-templates/<agentOnlyId>/generate",
   { method: "POST", ... body: { policyId: <theirPolicy>, audience:
   "agent" } })`. Must return 403. If it returns a PDF, Layer 3 is
   missing on that route.
4. **Spot-check log** — the helper throws with `reason` of `"scope"`
   or `"audience"`; routes returning 403 should include it in the
   error response body so the admin can diagnose without reading the
   server log.

---

## 10. Non-goals

This skill does NOT cover:

- Field-level redaction (e.g. hiding a specific field from a certain
  role on an otherwise-allowed document). That's a finer-grained
  concern — see `PdfFieldMapping.audience` for the existing per-field
  tag, and add a Layer-3.5 rule only if the product requires it.
- Row-level privacy (client A's policy vs client B's policy) — that's
  Layer 2 and lives in `lib/policy-access.ts`.
- Document-level digital signature verification — orthogonal; handled
  by the `/api/sign/[token]` flow.

If a task only touches one of those, this skill is relevant only as
a background reference — you don't need to re-run the verification
recipe.
