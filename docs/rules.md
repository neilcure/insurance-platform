## Project: Insurance Platform (Next.js App Router) — shadcn/ui-first rules

### 0. Primary Goal
- Build a production-ready insurance backoffice app (Admin/Agent/Client portals) using Next.js App Router + TypeScript + shadcn/ui for all UI.
- Prefer Server Components. Use Client Components only when needed (forms, interactivity).

### 1. UI / Design System
- Use shadcn/ui components for ALL UI elements: buttons, inputs, tables, dialogs, dropdowns, tabs, toasts, etc.
- No custom UI frameworks. Tailwind is allowed but only for layout/spacing and small adjustments.
- Use lucide-react icons only (through shadcn patterns).
- Forms MUST use: react-hook-form + zod + @hookform/resolvers, and shadcn Form components.
- Notifications MUST use: shadcn toast/sonner pattern.

### 2. Architecture
- App Router only. No Pages Router.
- Prefer Server Components for pages; use "use client" only for:
  - forms (react-hook-form)
  - tables with client-side sorting/selection
  - dialogs, dropdown interactions
- Data access via Drizzle in server-only modules:
  - Allowed: `app/api/**`, `app/**/page.tsx` (server), `lib/server/**`, `db/**`
  - Forbidden: calling db from client components.
- Validation:
  - Use Zod schemas in `lib/validation/**`.
  - API and Server Actions must validate with Zod before DB writes.

### 3. Routing & Layout
- Use route groups:
  - `app/(auth)/login`
  - `app/(dashboard)/dashboard`
  - `app/(dashboard)/policies`
  - `app/(dashboard)/policies/new`
  - `app/(dashboard)/policies/[id]`
- Provide a consistent dashboard layout:
  - left Sidebar + top header + content area.
  - Use shadcn Sidebar patterns (or custom with shadcn components only).

### 4. RBAC (Role-based Access Control)
- `userType` values: `admin`, `agent`, `direct_client`, `service_provider`, `insurer_staff`
- Enforce RBAC at:
  - API routes (server)
  - server page loaders (server components)
- Never rely only on client-side hiding.
- Add helpers:
  - `lib/auth/require-user.ts`: returns session user or throws
  - `lib/auth/rbac.ts`: `canAccessPolicy(user, policy)` and `policyQueryScope(user)`

### 5. Database & Queries (Drizzle)
- Use Drizzle ORM + postgres-js driver.
- Keep schemas in `db/schema/*.ts` and export via `db/schema/index.ts`.
- Use transactions for multi-step writes:
  - create policy + cars + coverages, etc.
- For list pages, implement:
  - pagination (limit, offset)
  - filters: policyNo, status, date range
  - plateNo search uses join with cars table.

### 6. UI Pages to Implement (order)
1) Dashboard shell layout (sidebar/header) with role badge  
2) Policies list page: shadcn Table + search input + filters + pagination  
3) New Policy page: shadcn Form + sections (Client / Policy / Cars) + add/remove car rows  
4) Policy detail page: shadcn Tabs (Summary / Vehicles / Payments / Audit)  
5) Seed/dev tooling only in development: `app/api/dev/seed` (POST) gated by `NODE_ENV !== "production"`

### 7. Coding Standards
- Use TypeScript strict types.
- Use absolute imports with `@/` alias.
- Use small reusable components:
  - `components/ui/**` (from shadcn)
  - `components/dashboard/**`
  - `components/policies/**`
- No dead code. If a component is not used, remove it.
- Add loading + empty + error states using shadcn components (Skeleton, Alert).

### 8. Deliverables per change
- Provide code for UI + API + validation schema
- Include minimal tests via manual test steps in comments
- Update any necessary types

### 9. Output Format when coding
- Always show file paths and full file contents for new/changed files.
- Do not omit important imports.
- Prefer incremental commits: one feature per set of changes.

### 10. Team Workflow & Security
- Security:
  - Never hardcode secrets. Use environment variables (`DATABASE_URL`, etc.).
  - `.env.local` must not be committed.
  - Drizzle config reads credentials from env only.
- Windows development:
  - Prefer PowerShell commands on Windows; Bash flags like `mkdir -p` do not work in PowerShell.
  - Use `mkdir -Force -LiteralPath 'dir1','dir2'` when needed.
- Stability:
  - Remember previously fixed issues and avoid regressions.
  - Consider the whole picture before making changes.
  - Make fixes compatible with existing solutions.
  - Keep code easy to read and maintain.

### 11. Proposing or Updating Rules
- Open a PR editing `docs/rules.md`. Summarize the rule change in the PR description.
- For urgent changes, discuss in the PR and merge after one reviewer approves.


### 12. Contact Information display rules (Client & Policy Details)
- Always use the shared helpers in `lib/format/contact-info.ts` for Contact Information labels and ordering.
- Ordering:
  1) Personal Title, Name, Tel, Mobile, Email
  2) Address: Flat Number, Floor Number, Block Number, Block Name, Street Number, Street Name, Property Name, District Name, Area
- Label normalization (examples):
  - `ptitle`/`title` → Personal Title
  - `district`/`districtname` → District Name
  - `flatno`/`flatnumber`, `streetno`/`streetnumber` → Flat/Street Number
- When building or updating details UIs, import:
  - `formatContactLabel(label, key)` for labels
  - `getContactSortWeight(key)` for stable ordering
- This keeps Client Details and Policy Details consistent even if backend keys vary.