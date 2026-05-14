---
name: i18n
description: Owns the full contract for how multi-language support works in this app — the `lib/i18n` unified resolver (`tStatic` for hardcoded UI text + `tDynamic` for admin-edited `form_options.label`), the `messages/<locale>.ts` static dictionaries, the `meta.translations.<locale>` JSONB shape, the `<TranslationsEditor>` admin component, the locale-resolution chain (cookie → `users.profile_meta.locale` → `Accept-Language` → `en`), the `<I18nProvider>` + `useT()` / `useLocale()` hooks, and the explicit "PDFs / emails / WhatsApp / user-entered data stay English" boundary. Use when adding any new user-facing string in `app/(dashboard)/**` or `components/**`, when adding a new admin-configurable list whose labels appear in the dashboard UI, when wiring `tDynamic` into a new consumer of `form_options`, when adding a new admin editor that needs the `<TranslationsEditor>` panel, or when debugging "language switcher doesn't update X / X still renders in English / X renders raw key / X breaks the column case transform".
---

# i18n Unified Resolver

This codebase has a custom, home-grown i18n stack — NOT `next-intl`. The
core idea is "one resolver, two pipelines" so admin-configurable
labels and hardcoded UI strings flow through the same mental model.

If your task touches **any** user-facing string in
`app/(dashboard)/**`, any `<Label>` / `<CardTitle>` / button text,
any new admin editor for `form_options`, or you're diagnosing a
"language switcher doesn't translate X" bug, **read this skill in
full before writing code**.

## Scope (locked — see `.cursor/plans/i18n_unified_resolver_*.plan.md`)

**IN scope** — translate to all locales:

- App component strings (sidebar, breadcrumbs, buttons, dialogs,
  page titles, toasts, validation messages, empty states)
- `form_options.label` for packages, fields, statuses, workflow
  actions, document types
- `form_options.meta.options[].label` (dropdown option labels)
- `form_options.meta.booleanChildren.{true,false}[].label`
- `form_options.meta.repeatable.fields[].label`
- Common dialog buttons (`confirmDialog` / `alertDialog` /
  `promptDialog` use the locale-resolved Cancel / Confirm / OK /
  Delete labels by default — do NOT pass `cancelLabel: "取消"` etc.
  inline)

**OUT of scope** — stays English regardless of locale:

- Anything inside `lib/pdf/**` and any code path that produces a PDF
- Email subjects / bodies (`lib/email.ts` callers)
- WhatsApp body templates and `wa.me?text=` URLs
- Document share-link landing pages
- User-entered snapshot values, insured names, addresses, dedupe
  identifiers, audit log "changes" payloads
- Currency / number / date formatting (delegated to `Intl.*` which
  is already locale-neutral via the `Intl.NumberFormat` constructor;
  do NOT pass `locale` to formatters that should stay
  HK-conventional regardless of UI language)
- Backend log lines, error stack traces, dev-only diagnostic panels

When in doubt: if the string would appear in a PDF / email / share
link or contain user-entered content, leave it English.

## The 30-second cheatsheet

| Need | Pattern | Don't do |
|---|---|---|
| Hardcoded UI string in JSX | `t = useT(); t("section.key", "English fallback")` | `<span>Confirm</span>` |
| Hardcoded UI string in server component | `tStatic("section.key", await getLocale(), "English fallback")` | Hardcode the literal |
| Admin-edited label from `form_options` | `tDynamic({ label: row.label, meta: row.meta }, locale)` | `String(row.label ?? "")` |
| Admin-edited label inside a column with `labelCase` | `applyCase(tDynamic(row, locale), row.meta?.labelCase)` — translate FIRST | `applyCase(row.label, ...)` then translate |
| Admin-edited dropdown option label | `tDynamicOption(field, optionValue, locale, fallbackLabel)` | Lookup `meta.options[].label` directly |
| Admin-edited boolean-child label | `tDynamicBooleanChild(field, branch, idx, locale, fallback)` | Read `meta.booleanChildren[branch][idx].label` directly |
| Admin-edited repeatable child label | `tDynamicRepeatableField(field, childKey, locale, fallback)` | Read `meta.repeatable.fields[].label` directly |
| Add an admin editor for `meta.translations` | Drop `<TranslationsEditor value=... onChange=... sourceLabel=... options=... />` next to the `Label` input | Hand-roll a per-locale text input grid |
| Confirm / cancel / delete / OK button | Use `confirmDialog` / `alertDialog` from `global-dialogs.tsx` (auto-localized) | Render your own Dialog with hardcoded "Cancel" |
| Read locale on the server | `await getLocale()` from `@/lib/i18n/server` | Inline cookie + header parsing |
| Read locale on the client | `useLocale()` from `@/lib/i18n` | Inline cookie parsing |

## Locale resolution chain

A request acquires its locale in this order — first match wins:

1. `NEXT_LOCALE` cookie set by the locale switcher
2. `users.profile_meta.locale` for the signed-in user
3. `Accept-Language` request header containing a `zh*` variant → `zh-HK`
4. Default → `en`

Implementation lives in:

- `proxy.ts` — sets the `x-locale` request header so API routes can
  inspect the locale without re-running the chain
- `lib/i18n/locale.ts` — server-side `getLocale()` (uses
  `next/headers` cookies + headers; marked `import "server-only"`)
- `lib/i18n/provider.tsx` — `<I18nProvider>` hydrates the client
  context from a server-rendered prop
- `app/api/me/locale/route.ts` — POST handler that writes both the
  cookie and `users.profile_meta.locale` so the choice survives
  across devices

## Static vs Dynamic — pick the right resolver

There are TWO kinds of translatable strings, and they go through
DIFFERENT resolvers. Mixing them up will look like it works in
English then fail silently in Chinese.

### Static (`tStatic` / `useT`)

Use for any string that lives in code:

- Sidebar items, breadcrumbs, page titles, button labels
- Section headings, validation toasts, empty-state messages
- Aria labels, tooltips, placeholder text

The dictionary lives in `messages/en.ts` (canonical shape) and
`messages/zh-HK.ts` (and any future locale). The English file
defines the `Messages` type — the `zh-HK` file uses
`DeepPartial<Messages>` so missing leaves transparently fall back
to English.

```tsx
"use client";
import { useT } from "@/lib/i18n";

export function MyButton() {
  const t = useT();
  return <Button>{t("common.save", "Save")}</Button>;
}
```

```tsx
import { tStatic } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export default async function MyServerPage() {
  const locale = await getLocale();
  return <h1>{tStatic("dashboard.title", locale, "Dashboard")}</h1>;
}
```

The second argument to `t()` and the third argument to `tStatic()`
is the English fallback. Always pass it — that way the UI keeps
working even if the dictionary key is missing or misspelled.

### Dynamic (`tDynamic*` family)

Use for ANY string that came out of `form_options` (or any other
admin-edited row that follows the same `meta.translations` shape).
The resolver reads `option.meta.translations.<locale>.label` and
falls back to `option.label` automatically.

```tsx
"use client";
import { tDynamic, useLocale } from "@/lib/i18n";

const locale = useLocale();
const visibleLabel = tDynamic({ label: row.label, meta: row.meta }, locale);
```

For nested labels:

| Helper | What it returns |
|---|---|
| `tDynamic(option, locale)` | `option.label` translated |
| `tDynamicOption(field, optionValue, locale, fallback)` | One entry from `field.meta.options[]`, keyed by `value` |
| `tDynamicBooleanChild(field, branch, idx, locale, fallback)` | `field.meta.booleanChildren.{true,false}[idx].label` |
| `tDynamicRepeatableField(field, childKey, locale, fallback)` | `field.meta.repeatable.fields[]` keyed by stable `key` |

All four helpers tolerate `null` / `undefined` / non-object meta.

## Composition with `field-label-case` skill

The `applyCase` (or `applyLabelCase` / `applyCaseToText`) helpers
that implement `meta.labelCase` MUST run **after** translation, not
before. Otherwise the cased English label gets translated and the
admin's "Title Case" preference is lost — or worse, "KWAN SIU MAN"
ends up as "保險範圍" without the case being honoured (Chinese has
no case so the upper / lower transform is a no-op, which is exactly
the right behaviour after translation).

```tsx
// ❌ BAD — case applied to English source, then translation
const display = tDynamic({ label: applyCase(row.label, mode), meta: row.meta }, locale);

// ✅ GOOD — translate FIRST, case AFTER
const display = applyCase(tDynamic(row, locale), row.meta?.labelCase);
```

This composition order is enforced in:

- `components/policies/PoliciesTableClient.tsx` (column header build loop)
- `components/policies/PackageBlock.tsx` (`displayLabel` + `CategoryTabs`)
- `components/policies/PolicySnapshotView.tsx` (`loadFieldMeta` builds the
  `fm.labels` map with the translated value)
- `app/(dashboard)/policies/new/page.tsx` (wizard `displayLabel` + category tab)
- `components/policies/InsuredStep.tsx` (per-field labels)

If you add a NEW consumer of `form_options.label`, mirror the same
ordering — translate first, case last.

## The `meta.translations` data shape

Every translatable `form_options` row stores its locale variants in
the same place — `meta.translations.<locale>`:

```json
{
  "label": "Coverage Area",
  "meta": {
    "labelCase": "title",
    "options": [
      { "value": "hkonly", "label": "Hong Kong Only" },
      { "value": "worldwide", "label": "Worldwide" }
    ],
    "booleanChildren": {
      "true":  [{ "label": "Claims Count" }],
      "false": []
    },
    "repeatable": {
      "fields": [{ "key": "lastName", "label": "Last Name" }]
    },
    "translations": {
      "zh-HK": {
        "label": "保險範圍",
        "options": { "hkonly": "只限香港", "worldwide": "全球" },
        "booleanChildren": { "true": { "0": "申索次數" } },
        "repeatable": { "lastName": "姓氏" }
      }
    }
  }
}
```

Notes:

- `options` is keyed by **option value**, not index, so reorders in
  admin don't break translations.
- `booleanChildren.{true,false}` is keyed by **string-stringified
  child index** because Postgres serializes JSONB object keys as
  strings.
- `repeatable` is keyed by the child's stable **key**, NOT index —
  the resolver matches on the stable identifier so an admin can
  reorder repeatable rows safely.
- Empty / missing entries fall back to the source English label.
  Never persist an empty string — `<TranslationsEditor>` deletes
  empty entries before calling `onChange`.

No DB migration needed. `meta` is already JSONB on every
`form_options` row.

## The `<TranslationsEditor>` admin component

`components/admin/i18n/TranslationsEditor.tsx` is the ONE place that
admins edit `meta.translations`. It is fully controlled — the
parent owns `meta.translations` and updates it via the `onChange`
callback. Drop it next to the row's "Label" input in any admin
editor.

```tsx
import { TranslationsEditor } from "@/components/admin/i18n/TranslationsEditor";
import type { Locale, TranslationBlock } from "@/lib/i18n";

<TranslationsEditor
  value={(form.meta?.translations ?? null) as Partial<Record<Locale, TranslationBlock>> | null}
  sourceLabel={form.label}
  options={form.meta?.options}
  booleanChildren={form.meta?.booleanChildren}
  repeatable={form.meta?.repeatable?.fields}
  hint="Leave a row blank to fall back to English."
  onChange={(next) => updateMeta("translations", next as never)}
/>
```

Already wired into:

- `components/admin/generic/EditPackageFieldClient.tsx`
- `components/admin/generic/NewPackageFieldClient.tsx`
- `components/admin/generic/GenericFieldsManager.tsx`
- `components/admin/documents/PolicyStatusesManager.tsx`
- `components/admin/documents/WorkflowActionsManager.tsx`
- `components/admin/documents/UploadDocumentTypesManager.tsx`

Add it to any future editor whose row's label is rendered in the
dashboard UI. Skip it for editors whose labels only appear in PDFs
/ emails — translations there would be wasted bytes.

## What stays exactly the same

To keep the rollout reversible, the following surfaces are
deliberately untouched and MUST remain English-only:

- `lib/pdf/**` — entire tree
- `lib/field-resolver.ts` — used by both dashboard AND PDF; the
  dashboard wraps its output with `tDynamic` at the consumer layer
  instead, so the resolver itself stays locale-blind
- `lib/document-delivery/**`
- All currency / date / number formatting (the `lib/format/date.ts`
  helpers, `Intl.NumberFormat` calls inside accounting code)
- All API contracts, file URLs, document share tokens, audit log
  payloads, and user-entered data display

If you need to localize one of these on purpose, it's a scope
change — re-read the plan first.

## Adding a new locale

1. Add the locale code to `SUPPORTED_LOCALES` in
   `lib/i18n/types.ts` and to the `Locale` union type.
2. Create `messages/<locale>.ts` mirroring the structure of
   `messages/en.ts` (use `DeepPartial<Messages>` like
   `messages/zh-HK.ts`).
3. Add the locale display name to `LOCALE_DISPLAY` in
   `components/admin/i18n/TranslationsEditor.tsx` so admins can
   translate `form_options` rows into it.
4. Add an entry to the locale switcher (`components/ui/locale-switcher.tsx`)
   so end users can pick it.
5. Optionally add a server-side `Accept-Language` heuristic in
   `lib/i18n/locale.ts` if browser default detection should
   recognise the new locale.

That's it. No database migration is needed — `meta.translations`
is open-ended JSONB.

## Adding a new translatable surface

If you're adding a brand-new admin-configurable list that should
appear in the dashboard:

1. Define a `meta` shape that includes
   `translations?: Partial<Record<Locale, TranslationBlock>>` (or
   reuse an existing type).
2. Render the dashboard label via
   `tDynamic({ label: row.label, meta: row.meta }, useLocale())`.
3. If you compose with `applyLabelCase`, translate FIRST then
   case (per the `field-label-case` skill).
4. Drop `<TranslationsEditor>` next to the row's "Label" input in
   the admin editor.
5. If the row also has dropdown options / boolean-branch children
   / repeatable child fields, pass them to `<TranslationsEditor>`
   so admins can translate the nested labels too.

## Verification recipe

When you change anything in this stack, manually verify:

1. Open the dashboard in English. Note the label / button text in
   question.
2. Open the locale switcher in the dashboard header. Pick
   `zh-HK`. The page should re-render WITHOUT a hard navigation,
   and the string should switch to its translation (or stay
   English if you haven't added one — that's the graceful
   fallback).
3. Refresh the page. The locale should persist via the
   `NEXT_LOCALE` cookie.
4. Open a different browser session, sign in as the same user,
   and confirm `users.profile_meta.locale` carries the choice
   across devices.
5. Open a policy, render the PDF. The PDF MUST stay English even
   when the dashboard is Chinese — that's the scope boundary.
6. Click any `confirmDialog` / `alertDialog` button. The default
   Cancel / Confirm / OK / Delete buttons should appear in the
   active locale.
7. As an admin, open one of the editors above, expand the new
   "Translations" panel, and add a Chinese label. Save. Re-open
   the dashboard in `zh-HK`. The new label should appear.

## Skill-level invariants

- Never write `<span>some text</span>` in `app/(dashboard)/**` —
  always wrap with `t(...)` or `tStatic(...)` and add a key.
- Never call any `tDynamic*` helper from `lib/pdf/**`.
- Never call `applyCase` BEFORE `tDynamic` — composition order is
  fixed.
- Never store an empty-string translation; either omit the key or
  delete it via `<TranslationsEditor>`'s "Clear" button.
- Never hardcode locale checks (`if (locale === "zh-HK")`) in
  business logic. The whole point of the resolver is that callers
  don't care which locale they're in.
- Never skip the English fallback argument when calling `t(...)` /
  `tStatic(...)` — it's the safety net for missing keys.
