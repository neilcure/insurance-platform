---
name: table-view-presets
description: Owns the unified "Saved Views" / "Edit View" / column-preset feature used across every dashboard table (Policies, Users, future Agents/Insurers/Clients/Endorsements). Covers the API at `/api/view-presets`, the `useTableViewPresets` hook, the `<TableViewPresetBar>` and `<TableViewPresetEditor>` components, the per-table scope key, and the rules every new dashboard table MUST follow. Use when adding column presets to a new table, adding a new column source to an existing table, debugging "presets not loading / not persisting / wrong default applied", or when reviewing a PR that re-implements its own preset dropdown / dialog.
---

# Table View Presets

Every dashboard table in this app supports user-saved column views ("Edit View" / "New View" / "Set Up Columns"). The feature is **fully shared** — backend, hook, bar, and dialog. New tables MUST use the shared module.

## Architecture (top-down)

| Layer | Lives in | Responsibility |
|---|----|----|
| Storage | `app_settings` row keyed `view_presets:user:<userId>:<scope>` | Per-user, per-scope JSON array of `ViewPreset` |
| API | `app/api/view-presets/route.ts` (GET, PUT) | Auth via `requireUser`, enforces max 5 |
| Types | `lib/view-presets/types.ts` | `ViewPreset`, `ViewPresetColumnGroup`, `VIEW_PRESETS_MAX = 5` |
| Hook | `lib/view-presets/use-table-view-presets.ts` | API + localStorage fallback, `upsertPreset`, `deletePreset`, `setDefault`, `activePreset` |
| UI bar | `components/ui/table-view-preset-bar.tsx` | Saved-Views dropdown + Edit/New buttons |
| UI editor | `components/ui/table-view-preset-editor.tsx` | The whole dialog (name, optional sort, columns, default toggle, saved-views panel) |

## When to use

Adding column presets to a new dashboard table:

1. Pick a unique `scope` string (e.g. `agents`, `clients`, `insurers`).
2. Call `useTableViewPresets({ scope })` once at the top of your client component.
3. Place `<TableViewPresetBar />` in your toolbar — pass `presets`, `activePresetId`, `setActivePresetId`, `activePreset`, `onEditActive`, `onNew`.
4. Mount `<TableViewPresetEditor />` once at the bottom of the component, pass it your local draft state and `onSave` handler.
5. When the user saves, call `upsertPreset(...)` from the hook.

## The 30-second cheatsheet

| Concern | Pattern | Don't do |
|---|----|----|
| Persistence | `useTableViewPresets({ scope })` | Re-roll fetch + localStorage in your component |
| Max views | Hook enforces `VIEW_PRESETS_MAX` (5) and toasts on overflow | Hard-code `if (presets.length >= 5) ...` |
| Default flag | Hook auto-promotes first preset to default; demotes others on `isDefault: true` upsert | Manually rewrite the array to balance defaults |
| Active preset on first load | Hook auto-selects default once API responds | Set `activePresetId` from a non-loaded list |
| Bar layout | `<TableViewPresetBar>` (dropdown + Edit + New) | Re-render Settings2 + DropdownMenu + Button rows inline |
| Editor dialog | `<TableViewPresetEditor>` with `columnGroups` | Build your own Dialog with up/down buttons |
| Per-preset sort | Pass `sortControls` to the editor; preset stores `sortKey` / `sortDir` | Store sort in a separate `app_settings` key |
| Sort not stored on preset | Omit `sortControls` (e.g. PoliciesTable derives sort from active columns) | Force every table into the sortKey/sortDir model |
| Column whitelist | Pass `normalizePreset` to the hook to drop unknown column keys | Trust API payload blindly when columns are an enum |
| Static field list | One group with `groupLabel: ""` (header is hidden) | Force a fake group label like "Columns" |
| Dynamic field list | Multiple groups with real labels (e.g. "General", "Insured", per-package) | Flatten everything into one big alphabetical list |
| Column hard cap | `maxColumns={N}` on the editor | Inline `if (prev.length >= 4) return prev` |

## The `ViewPreset` shape

```ts
type ViewPreset = {
  id: string;          // "preset_<timestamp>"
  name: string;        // user-typed
  columns: string[];   // opaque to the hook — caller decides format
  isDefault: boolean;
  sortKey?: string;    // optional, only stored when sortControls passed
  sortDir?: "asc" | "desc";
};
```

`columns` is an opaque `string[]`. Two valid conventions in this codebase:

- **Path strings** (PoliciesTable): `"_builtin.policyNumber"`, `"insured.firstname"`, `"pkg.vehicleinfo.make"`.
- **Enum keys** (UserSettings): `"number"`, `"email"`, `"name"`.

Pick one and stay consistent within a single scope. Never mix — the editor has no way to distinguish them.

## Required pattern (minimal example)

```tsx
"use client";

import * as React from "react";
import { useTableViewPresets } from "@/lib/view-presets/use-table-view-presets";
import type { ViewPreset, ViewPresetColumnGroup } from "@/lib/view-presets/types";
import { TableViewPresetBar } from "@/components/ui/table-view-preset-bar";
import { TableViewPresetEditor } from "@/components/ui/table-view-preset-editor";

const ALL_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
];

export default function MyTableClient() {
  const {
    presets, activePresetId, setActivePresetId, activePreset,
    upsertPreset, deletePreset,
  } = useTableViewPresets({ scope: "my-table" });

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ViewPreset | null>(null);
  const [draftName, setDraftName] = React.useState("");
  const [draftColumns, setDraftColumns] = React.useState<string[]>([]);

  const columnGroups: ViewPresetColumnGroup[] = [{
    groupKey: "all", groupLabel: "",
    options: ALL_COLUMNS.map(c => ({ path: c.key, label: c.label })),
  }];

  function openNew() {
    setEditing(null);
    setDraftName(`View ${presets.length + 1}`);
    setDraftColumns([]);
    setOpen(true);
  }

  function openEdit(p: ViewPreset) {
    setEditing(p);
    setDraftName(p.name);
    setDraftColumns([...p.columns]);
    setOpen(true);
  }

  function save() {
    const next = upsertPreset(editing
      ? { ...editing, name: draftName, columns: draftColumns }
      : { id: `preset_${Date.now()}`, name: draftName, columns: draftColumns, isDefault: presets.length === 0 });
    if (next) {
      setActivePresetId(next.id);
      setOpen(false);
    }
  }

  return (
    <>
      <TableViewPresetBar
        presets={presets}
        activePresetId={activePresetId}
        activePreset={activePreset}
        onSelect={setActivePresetId}
        onEditActive={() => activePreset && openEdit(activePreset)}
        onNew={openNew}
      />

      {/* ...your table renders activePreset.columns... */}

      <TableViewPresetEditor
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        draftName={draftName}
        setDraftName={setDraftName}
        draftColumns={draftColumns}
        setDraftColumns={setDraftColumns}
        columnGroups={columnGroups}
        savedViewsPanel={editing ? undefined : { presets, onEdit: openEdit, onDelete: deletePreset }}
        onSave={save}
      />
    </>
  );
}
```

## Scope key conventions

`scope` is a single string. Use a stable, lowercase, dash/underscore-free identifier. Existing keys:

| Page | Scope |
|---|---|
| `app/(dashboard)/dashboard/policies/page.tsx` | `"Policy"` (entityLabel) |
| `app/(dashboard)/dashboard/flows/[flow]/page.tsx` | the flow's entityLabel (e.g. `"Endorsement"`) |
| `app/(dashboard)/admin/users/page.tsx` | `"admin-user-settings"` |

When adding a new page that shares the same logical table view as an existing one, **use the same scope** so the user's saved views follow them.

## Pitfalls and what to do

### 1. Re-implementing the dialog

If you find yourself writing `<Dialog>` with `ChevronUp` / `ChevronDown` arrows for column reordering, stop. That dialog already exists. Use `<TableViewPresetEditor>`.

### 2. Re-implementing fetch + localStorage

If you find yourself writing `fetch("/api/view-presets?scope=...")` followed by `try { localStorage.setItem(...) } catch {}`, stop. Use `useTableViewPresets`.

### 3. Hard-coded column whitelist

When your `columns` are a fixed enum (not free-form paths), pass `normalizePreset` to the hook. This protects you against:

- Old presets saved with columns that no longer exist
- Manual edits to `app_settings`
- Schema drift between deploys

Example: `components/admin/UserSettingsTableClient.tsx`'s `normalizePreset` filters columns against `ALL_COLUMNS`.

### 4. Per-preset sort vs. global sort

PoliciesTable does NOT store sort on the preset — sort comes from the active column list. UserSettingsTable DOES. Both are valid.

- If your table's sort options depend on the active columns, omit `sortControls` from the editor.
- If your table has a fixed sort menu (e.g. "Created Date / Email / User #"), pass `sortControls` so the user can save their preferred sort.

### 5. Default toggle vs. implicit default

If your editor only opens via the bar's "New View" button (no other entry point), omit `defaultToggle` — the hook auto-marks the first preset as default. PoliciesTable does this.

If users can create a new preset that is intentionally non-default while other presets exist, pass `defaultToggle`. UserSettingsTable does this.

### 6. Default group label

When you have a single group (no meaningful subdivision), pass `groupLabel: ""`. The editor will hide the sticky group header. Don't pass `"All"` or `"Columns"` — they read awkwardly.

### 7. Saved Views panel

The "Saved Views" list inside the editor (with Edit / Delete / Set Default per row) is meant for **new-preset mode**, so the user can manage their existing views without leaving the dialog. Pass `savedViewsPanel` only when `editing === null`:

```tsx
savedViewsPanel={editing ? undefined : { presets, onEdit, onDelete, onSetDefault }}
```

## Verification recipe

For any new or refactored table:

1. **Fresh user, empty presets**: bar shows only "Set Up View" / "Set Up Columns". Click → editor opens with no `editing`. Save → preset becomes active default.
2. **Multiple presets**: dropdown shows all, with `default` badge on one. Active preset matches the highlighted item. Switching changes columns.
3. **Edit current**: click "Edit" on bar → editor opens with `editing` set. Update → row updates without creating duplicate.
4. **Delete current**: in saved-views panel inside editor (only visible when creating). After delete, default flag re-balances to first remaining preset.
5. **Limit**: try to create a 6th preset → toast "Maximum 5 views allowed", nothing persisted.
6. **Offline**: simulate API failure → presets still save to localStorage and are restored on next mount until the API is reachable.
7. **DB inspection**: `SELECT key, value FROM app_settings WHERE key LIKE 'view_presets:user:<id>:%';` shows JSON arrays only, max length 5.

## Reference implementations

- Free-form path columns + dynamic groups: `components/policies/PoliciesTableClient.tsx`
- Fixed enum columns + per-preset sort + explicit default toggle: `components/admin/UserSettingsTableClient.tsx`

If your new table looks materially different from both, consult this skill again before adding new patterns to the shared module.
