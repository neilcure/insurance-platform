## UI Smoothness Rules (No Flash/Flicker)

- Stable component identity:
  - Do not define React components inside other components if they are rendered as JSX.
  - Hoist re-usable blocks to module scope and wrap with `React.memo`.

- Narrow re-renders:
  - Use `react-hook-form`'s `useWatch` for the specific field names that affect a block.
  - Avoid passing changing inline objects/functions as props; memoize when needed.

- Avoid forced remounts:
  - Do not change `key` props unless you intentionally need a full remount.
  - Only include `refreshTick` in keys when you truly need to refetch/remount after external changes.

- Input UX:
  - Disable loud focus effects that look like screen flashes: prefer `focus-visible:ring-0` on radios/checkboxes.
  - For masked inputs (e.g., dates), format in `onChange` without triggering full form resets.

- Data fetching:
  - Cache disabled for admin-config changes is OK; do not refetch on every keystroke or unrelated state change.
  - Scope fetch effects with precise dependencies and guard with `cancelled` flags.
  - Sidebars and navs must NOT re-fetch on every route change. Only refresh on pages that actually mutate configuration (e.g., `/admin/policy-settings/packages`, `/admin/policy-settings/flows`) or when window regains focus/visibility, or when a dedicated custom event is dispatched.
- Persist UI open/closed state:
  - Store sidebar collapsible states in `sessionStorage` so navigation doesn’t reset open groups (e.g., package groups remain expanded when switching between Category and Fields).
- Cache sidebar data:
  - Cache the last loaded package list in `sessionStorage` and hydrate from it instantly on mount to avoid the sidebar appearing empty (closing) and then repopulating after fetch.

## Navigation Rules (Next.js)

- Internal links must use Next.js `Link`:
  - Always use `<Link href="/path">` for client-side navigation inside the app.
  - Never use `<a href="/path">` for internal routes; it causes full page reloads and remounts (sidebar flicker).
  - Keep external links using `<a href="https://...">`.


- Grouping and readability:
  - Use field `meta.group` to group related fields under headers; this reduces visual jumps when content toggles.

- Validation:
  - Prefer inline validation with lightweight regex and avoid expensive computations on every render.

Follow these rules across all pages and components. They are enforced in the policy creation flow and should be reused. 

