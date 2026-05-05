---
name: pagination
description: Owns the unified pagination story for every dashboard list/table in this app — the API contract (`limit`/`offset`/`total`), the shared `usePagination` hook, the `<Pagination>` UI bar, and the per-page matrix that says exactly which surfaces MUST paginate, which MAY skip it, and which MUST NOT paginate. Use when adding a new list page, when wiring up an API to return paginated rows, when you see "the page is slow with lots of policies / invoices / audit rows", when the user says "the app is missing pagination", or when reviewing a PR that re-implements its own page-bar.
---

# Pagination

Today every dashboard list in this codebase **fetches and renders the entire result set in one shot**. The backend already half-supports pagination (`limit`/`offset` on six API routes), but **no UI surface exposes it** — there is no `<Pagination>` component, no `usePagination` hook, no `total` field in any API response.

This skill is the single contract for fixing that, end to end.

## Architecture (top-down — the target shape)

| Layer | Lives in | Responsibility |
|---|----|----|
| Storage | Existing tables | No change |
| API | `app/api/<entity>/route.ts` (GET) | Accept `limit` (1–MAX, default), `offset` (≥0). Return `{ rows, total, limit, offset }` |
| Types | `lib/pagination/types.ts` | `Paginated<T>`, `PaginationParams`, `PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE` |
| Hook | `lib/pagination/use-pagination.ts` | `usePagination<T>({ url, params, defaultPageSize })` — owns fetch, page index, page size, `total`, `setPage`, `setPageSize`, `refresh` |
| UI bar | `components/ui/pagination.tsx` | Page numbers (mobile shows just prev/next + label), page-size dropdown, "Showing X–Y of Z", responsive collapse |
| Page count badge | reuse `<Badge>` next to card title — "(N)" | — |

## Current state (after the May 2026 rollout)

### Foundation — shipped

- `lib/pagination/types.ts` — `Paginated<T>`, `parsePaginationParams`, `isPaginatedResponse`, `PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`.
- `lib/pagination/use-pagination.ts` — the `usePagination<T>` hook (SSR-seeded first page, stale-response guard, page-size localStorage, optimistic `patchRow` / `removeRow`).
- `components/ui/pagination.tsx` — `<Pagination>` UI bar (responsive, page-size dropdown, numbered pages with `…` truncation).

### Backend — paginated routes

| Route | Returns `{rows,total,limit,offset}`? | Default | Max | Notes |
|----|---|---|---|---|
| `GET /api/policies` | yes (May 2026) | 200 | 500 | `total` via `count(*) over ()` window function across all branches (admin / agent / direct_client / scoped) |
| `GET /api/agents` | yes (May 2026) | 50 | 500 | Per-branch `count(*)` query |
| `GET /api/clients` | yes (May 2026) | 500 | 500 | `total` via `count(*) over ()` window function |
| `GET /api/accounting/invoices` | yes (May 2026) | 50 | 500 | Adds `excludeStatementType=1` and pushes `status` filter server-side (was client-side) |
| `GET /api/admin/audit-log` | yes (May 2026) | 30 | 200 | Adds `offset` support (didn't exist before) |
| `GET /api/imports/batches/[batchId]/rows` | NOT YET — bare array | (none) | 1000 | Tracked for follow-up |
| Every other list route (`/api/agents/[id]/logs`, `/api/agents/[id]/statements`, `/api/policies/[id]/documents`, `/api/policies/[id]/reminders`, `/api/admin/organisations`, etc.) | NOT YET | — | — | LOW priority — narrow / drawer-scoped surfaces |

### Frontend — paginated surfaces

| Surface | Component | Status |
|----|----|----|
| `/dashboard/policies` and `/dashboard/flows/[flow]` | `components/policies/PoliciesTableClient.tsx` | DONE — SSR-seeded first page, hook owns pagination + optimistic deletes |
| `/dashboard/agents` | `components/agents/AgentsTableClient.tsx` | DONE — same pattern |
| `/dashboard/accounting` | `app/(dashboard)/dashboard/accounting/page.tsx` (inline) | DONE — server-side status filter, `excludeStatementType=1` |
| Admin Activity Log (`<AuditLogPanel>`) | `components/admin/AuditLogPanel.tsx` | DONE — pilot for the pattern |
| `/admin/users` | `components/admin/UserSettingsTableClient.tsx` | DEFERRED — page does direct DB queries, no GET API exists yet. List is small today (<100). Add a `/api/admin/users` GET handler before migrating. |
| Imports list + `<BatchReviewClient>` | `app/(dashboard)/dashboard/imports/page.tsx` and the rows panel | DEFERRED — narrow blast radius. Use `usePagination` once `/api/imports/batches/[batchId]/rows` is paginated and `listBatches` exposes `total`. |

### Backwards compatibility

Every consumer that calls a paginated route (e.g. `/api/policies?flow=...`) was updated to tolerate **both** the new shape (`raw.rows`) and the legacy bare array, so deploys don't have to be atomic. New code should always require the new shape via `isPaginatedResponse()`.

### Known antipattern that survived in `<PoliciesTableClient>`

Client-side query / sort still happens locally on the rows for the current page only. This means typing in the search box filters only the visible 50 rows. To fully fix, push search and sort to `/api/policies` and reset `page` to 0 when they change. Tracked for a follow-up.

## When to use

Any one of:

1. Adding a new dashboard list / table page → **start with this skill**.
2. Touching `app/api/<entity>/route.ts` GET handler → ensure `total` and bounded `limit` are returned.
3. Touching a `<*TableClient>` or `<*Panel>` that loops over `rows.map(...)` from an API list → wire it through `usePagination`.
4. Reviewing a PR that adds prev/next buttons or `slice(start, end)` math by hand → reject; use the shared module.
5. Investigating "the page hangs / scrolls forever / is missing old records" complaints.

## The 30-second cheatsheet

| Concern | Pattern | Don't do |
|---|----|----|
| API response shape | `{ rows: T[], total: number, limit: number, offset: number }` | Bare array `T[]` for any list that can grow past one page |
| API `limit` parsing | `Math.min(Math.max(Number(sp.get("limit")) \|\| DEFAULT, 1), MAX)` | Trust raw query string; allow `Infinity` / negative |
| API `total` | One `select count(*)::int` running **with the same WHERE clauses, without limit/offset** | Skip the count when the row list returns < limit (you still need it for "Showing 1–20 of N") |
| Frontend fetch | `usePagination<T>({ url: "/api/x", params: { foo } })` | `useEffect` + `fetch` + manual `setPage` / `setRows` |
| Page-size options | `PAGE_SIZE_OPTIONS = [20, 50, 100, 200]`, default 50 | Hard-coded `pageSize=10` per component |
| Page-size persistence | localStorage key `pagination:size:<scope>` | Reset to default on every mount |
| URL sync (optional) | `?page=N&size=S` via `useSearchParams` | Mutate `window.history` by hand |
| Current-page bounds | Hook clamps to `Math.max(0, Math.ceil(total / size) - 1)` on `total` change | Show "Page 7 of 3" when filters reduce the count |
| Search + pagination | Server-side search via `?q=...` resets to page 0 | Client-side `.filter()` on a paginated page (you'd skip rows that didn't come back from the server) |
| Sort + pagination | Server-side sort via `?sortKey=...&sortDir=...` resets to page 0 | Sort only the current page client-side and call it "sorted" |
| Mobile UI | "Prev / Page X of Y / Next" + size dropdown collapsed under a `Settings2` icon | Render every page number on a 320px screen |
| Empty state | When `total === 0` AND `offset === 0` show empty placeholder; otherwise show "No matches on this page, go back?" | One generic "No data" that hides offset overflow |

## The `Paginated<T>` shape

```ts
// lib/pagination/types.ts
export type Paginated<T> = {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
};

export type PaginationParams = {
  limit: number;
  offset: number;
};

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;
```

## API contract (server side)

Every list endpoint that can return more than ~one screen of rows MUST:

1. Accept `limit` and `offset` query params.
2. Clamp `limit` between `1` and `MAX_PAGE_SIZE` (or a route-specific max).
3. Clamp `offset` to `≥ 0`.
4. Run **two queries** in `Promise.all`: the row select and a `select count(*)::int` over the same WHERE conditions (no limit/offset).
5. Return `{ rows, total, limit, offset }`.

```ts
const MAX = 500;
const DEFAULT = 50;
const url = new URL(request.url);
const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || DEFAULT, 1), MAX);
const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

const [rows, [{ count }]] = await Promise.all([
  db.select({ /* ... */ }).from(table).where(whereExpr).orderBy(/*...*/).limit(limit).offset(offset),
  db.select({ count: sql<number>`count(*)::int` }).from(table).where(whereExpr),
]);

return NextResponse.json({ rows, total: count, limit, offset });
```

### Backwards compatibility

The seven existing endpoints today return a bare array. Switching to `{ rows, total, limit, offset }` is a breaking change. Migrate one route at a time:

1. Pick one route (start with `/api/admin/audit-log` — only one consumer).
2. Update the route to return the new shape.
3. Update every call site in the same PR.
4. Search for `await fetch("/api/<x>")` and `await res.json() as T[]` — both must change.

Do NOT support both shapes via a `format=v2` query flag — that buys nothing and rots fast.

## Required pattern (frontend)

### Minimal example: client-side list

```tsx
"use client";

import * as React from "react";
import { usePagination } from "@/lib/pagination/use-pagination";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from "@/components/ui/table";

type Row = { id: number; name: string };

export default function MyTableClient({ filterFoo }: { filterFoo?: string }) {
  const { rows, total, page, pageSize, setPage, setPageSize, loading, refresh } =
    usePagination<Row>({
      url: "/api/things",
      params: filterFoo ? { foo: filterFoo } : undefined,
      scope: "things",   // for localStorage page-size memory
    });

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </>
  );
}
```

### Initial-rows pattern (server component → client)

Some pages already render rows server-side (e.g. `/dashboard/policies/page.tsx`). Migrate by:

1. Continue passing `initialRows` for the first page (fast first paint, SEO).
2. The client also receives `initialTotal` and `initialPageSize` from the server.
3. `usePagination` accepts `{ initialRows, initialTotal, initialPage: 0 }` and only refetches when the user changes page / size.

```tsx
// Server component
const res = await serverFetch("/api/policies?limit=50&offset=0");
const { rows, total } = (await res.json()) as Paginated<PolicyRow>;
return <PoliciesTableClient initialRows={rows} initialTotal={total} initialPageSize={50} />;
```

```tsx
// Client component
const { rows, total, page, pageSize, setPage, setPageSize } = usePagination<PolicyRow>({
  url: "/api/policies",
  scope: "Policy",
  initialRows,
  initialTotal,
  initialPage: 0,
  initialPageSize,
});
```

## Page / component matrix

The single source of truth for which surfaces need pagination, where, and at what default size.

### MUST paginate (HIGH priority — data grows forever)

| Page | Component(s) | API | Default size | Notes |
|---|----|----|---|---|
| `/dashboard/policies` | `components/policies/PoliciesTableClient.tsx` | `GET /api/policies` | 50 | Already capped at 200 — silently hides old policies today |
| `/dashboard/flows/[flow]` | same component (re-used) | `GET /api/policies?flow=...` | 50 | Same fix as above; preserve `flow` param |
| `/dashboard/accounting` | inline list in `app/(dashboard)/dashboard/accounting/page.tsx` | `GET /api/accounting/invoices` | 50 | Currently caps at 100 silently. Push status filter to server (`?status=...`) so paging works correctly with filter active |
| `/admin/activity-log` | `components/admin/AuditLogPanel.tsx` | `GET /api/admin/audit-log` | 30 | Add `offset` to the route. Mark-all-read still operates globally, not page-scoped |
| `/dashboard/imports` | inline table in `app/(dashboard)/dashboard/imports/page.tsx` | `listBatches()` (lib) | 50 | Convert `listBatches` to `{ rows, total }` and push paging into the page (or extract a `BatchesTableClient`) |
| `/dashboard/imports/[batchId]` | `components/imports/BatchReviewClient.tsx` | `GET /api/imports/batches/[batchId]/rows` | 100 | Endpoint already supports limit/offset. Status filter already in URL — preserve when paging |

### MUST paginate (MEDIUM priority — bounded but can grow)

| Page | Component(s) | API | Default size | Notes |
|---|----|----|---|---|
| `/dashboard/agents` | `components/agents/AgentsTableClient.tsx` | `GET /api/agents` | 50 | Capped at 200 today |
| `/admin/users` | `components/admin/UserSettingsTableClient.tsx` | (server fetch direct from DB in `app/(dashboard)/admin/users/page.tsx`) | 50 | Either route through `/api/admin/users` (currently no GET) or paginate the server query directly |
| `/dashboard/agents/[id]` (Statements tab) | inline in `AgentsTableClient.tsx` drawer | `GET /api/agents/[id]/statements` | 50 | Add `limit`/`offset` to the route |
| `/dashboard/agents/[id]/logs` | drawer panel | `GET /api/agents/[id]/logs` | 50 | Add `limit`/`offset` to the route |
| `/admin/payment-schedules` | `app/(dashboard)/admin/payment-schedules/page.tsx` (inline) | `GET /api/accounting/schedules` | 50 | Add `limit`/`offset` to the route. Linked invoices inside a single schedule are NOT a separate page — collapse-expand stays as is |
| `/clients` (when added) | (planned) | `GET /api/clients` | 50 | Endpoint already supports limit/offset |

### SHOULD paginate (LOW priority — admin / capped data)

| Page | Component(s) | Why optional |
|---|----|----|
| `/admin/policy-settings/policy-statuses` | `PolicyStatusesManager` | One row per status; <30 in practice. Page only if a tenant exceeds ~50 |
| `/admin/policy-settings/document-templates` | `DocumentTemplatesManager` | Same |
| `/admin/policy-settings/workflow-actions` | `WorkflowActionsManager` | Same |
| `/admin/policy-settings/upload-documents` | `UploadDocumentTypesManager` | Same |
| `/admin/policy-settings/[pkg]/fields` | `GenericFieldsManager` | Capped per package, ~50 max |
| `/admin/policy-settings/[pkg]/category` | `GenericCategoryManager` | Tiny |
| `/admin/policy-settings/packages` | `PackagesManager` | Tiny |
| `/admin/policy-settings/flows` | `FlowsManager` | Tiny |
| `/admin/policy-settings/flows/[flow]/steps` | `StepsManager` | Tiny per flow |
| `/admin/policy-settings/pdf-templates` | `PdfTemplateManager` | <100 templates per tenant |
| `/admin/notification-settings`, `/admin/password-policy`, `/admin/client-settings` | various | Settings forms — no list to page |

For these, prefer a search box / filter over pagination. Add pagination only if a tenant breaks 200 rows.

### MUST NOT paginate

| Surface | Why |
|---|----|
| Stats / KPI cards on `/dashboard/accounting`, `/dashboard` | Aggregates, not lists |
| Sidebar (`components/app-sidebar.tsx`) | Static nav |
| Wizard step flows (`/policies/new`, `/dashboard/flows/[flow]/new`) | One row per user-input step; no list semantics |
| `RecordDetailsDrawer` tabs (Workflow, Accounting, Documents, Snapshot) | Per-record, content fits one screen |
| `<TableViewPresetEditor>` saved-views panel | Hard-capped at 5 by `VIEW_PRESETS_MAX` |
| `<EntityPickerDrawer>` / `<AgentPickerDrawer>` | Use **search-as-you-type** instead — load a small bounded result via `?q=...` on each keystroke |
| `<NotesPanel>` (per-record notes) | Already has its own "show all / show last 3" expander |
| Online-users widget, presence banners | Always tiny; capped at ~20 |
| `<DocumentsTab>` per-policy uploaded files | Per-policy, typically <30 files |
| Form-options sub-lists inside an admin manager card | Already capped per group; managers always show full list |

When a surface is in this list, prefer search / filter / lazy expander over a page bar — paging an N=8 list looks broken.

## Pitfalls and what to do

### 1. Returning rows but not `total`

Without `total`, the UI cannot render "Showing 51–100 of 437" and the last page is reachable only by scrolling. Always run the count query.

If the count query is genuinely expensive (millions of rows), use **cursor pagination** (next/prev tokens) and render "Showing 51 results — load more" instead of page numbers. Fall back to `total` for everything else.

### 2. Client-side filter on a paginated page

```ts
// ❌ BAD — only filters the current page
const filtered = rows.filter((r) => r.name.includes(query));

// ✅ GOOD — push the search to the server
const { rows } = usePagination<Row>({
  url: "/api/things",
  params: query ? { q: query } : undefined,
});
```

If you keep client-side filter, pagination becomes meaningless: page 2 might have the row the user is searching for but the filter never sees it.

### 3. Client-side sort on a paginated page

Same problem. Sorting only the current page produces "wrong order across pages". Always sort server-side via `?sortKey=...&sortDir=...` and reset to page 0 on sort change.

### 4. Off-by-one when filters narrow the set

User on page 5, applies a filter that reduces total from 200 to 30. Without bounds-checking they see an empty page 5. The hook MUST clamp `page` to `Math.max(0, Math.ceil(total / size) - 1)` whenever `total` updates.

### 5. Page-size persistence vs. URL sharing

Two valid approaches:

- **localStorage** (per-user memory): chosen page size sticks across sessions on the same machine. Use `pagination:size:<scope>`.
- **URL** (shareable, bookmarkable): `?page=2&size=100`. Useful for /dashboard/policies-style pages where users link to "the same view".

Pick ONE per scope. Mixing both causes "URL says size=20, localStorage says size=100, who wins?" bugs.

### 6. Initial-rows + later refetch

When the server pre-renders page 0, do NOT refetch on mount. Refetch only when `page`, `size`, or `params` change. Otherwise the page double-loads on every navigation.

### 7. Audit log "Mark all read" with pagination

`AuditLogPanel`'s "Mark all read" already operates globally (not page-scoped) via `PATCH /api/admin/audit-log { markAll: true }`. Keep it that way — paging the visible list does NOT change the action's scope.

### 8. Statement / detail tabs that already have a paginated parent

`<RecordDetailsDrawer>` tabs (Documents, Workflow, etc.) live INSIDE a paginated parent (the policies table). Don't double-paginate. The drawer always shows ONE record's full data.

### 9. "Show all" toggles

Tempting but dangerous. A user clicking "Show all" on a 5,000-row table will lock the page. If the dataset is bounded (<200) skip pagination entirely; if unbounded, never offer "Show all".

### 10. SSR pages with `serverFetch`

Server components can't use `usePagination` (it's a hook). Pattern:

```tsx
// Server: render page 0 with the new shape
const res = await serverFetch(`/api/x?limit=${SIZE}&offset=0`);
const { rows, total } = (await res.json()) as Paginated<Row>;
return <MyClient initialRows={rows} initialTotal={total} initialPageSize={SIZE} />;
```

The client takes over after first paint.

## Verification recipe

For any new or refactored list:

1. **Empty state**: `total === 0`, `offset === 0` — render the "No data" placeholder. No page bar.
2. **Single-page**: `total <= pageSize` — page bar still shows "Showing 1–N of N" but Next is disabled. Page-size dropdown still works.
3. **Multi-page**: navigate Next → URL/state reflects new offset; rows update; "Showing 51–100 of 437" updates.
4. **Last page partial**: 437 rows, size 100 → page 4 shows 37 rows, "Showing 401–437 of 437", Next disabled.
5. **Filter narrows past current page**: on page 4, apply a filter that drops total to 50 → hook clamps to page 0; rows visible.
6. **Sort change**: hook resets to page 0; new sort applied server-side.
7. **Page-size change persists**: pick 100, reload → still 100 (via localStorage scope key).
8. **Mobile (<640px)**: page bar shows "Prev / N of M / Next" + a size dropdown that collapses under a Settings2 icon. No row of page numbers.
9. **Direct deep-link** (URL-sync mode only): `?page=3&size=100` on first visit → loads page 3 at size 100, scrolls to top, no flash of page 0.
10. **API contract**: `curl /api/policies?limit=10&offset=20` returns `{"rows":[...10],"total":437,"limit":10,"offset":20}`.

## Reference implementations

Once the shared module is built, two reference call-sites must exist before merging:

- **High-volume, server-fed first paint**: `components/policies/PoliciesTableClient.tsx` (replaces today's `initialRows: PolicyRow[]` with `initialRows + initialTotal + initialPageSize`, drops client-side filter & sort, gains URL sync).
- **Client-only, fetched on mount**: `components/admin/AuditLogPanel.tsx` (smallest blast radius — only one call site, easy to pilot the new contract on).

If your new list looks materially different from both, consult this skill again before adding new patterns to the shared module.

## Out of scope for this skill

- **Infinite scroll** — explicitly not used in this app. Every list uses an explicit page bar.
- **Cursor / keyset pagination** — only worth it when a `count(*)` is too slow. None of the current routes qualify; reach for it only when proven needed and never as the default.
- **GraphQL-style `pageInfo { hasNextPage }`** — not used here; the `total` field is enough.
- **Reusing `<TableViewPresetBar>` for paging** — they're separate concerns. Presets pick *which columns are visible*; pagination picks *which rows are returned*. Both can sit on the same toolbar but neither should render the other.
