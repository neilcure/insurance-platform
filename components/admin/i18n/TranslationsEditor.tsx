"use client";

/**
 * Reusable admin editor for `form_options.meta.translations`.
 *
 * Mounted next to the regular "Label" input on every admin row that
 * appears in the dashboard UI (package fields, insured fields,
 * statuses, workflow actions, document/upload types, …). Lets an
 * admin enter localized variants for the row's:
 *
 *  - Top-level `label`
 *  - Each `meta.options[]` option, keyed by option `value`
 *  - Each `meta.booleanChildren.{true,false}[]` child, keyed by
 *    branch + child index
 *  - Each `meta.repeatable.fields[]` child, keyed by child `key`
 *
 * The component is fully controlled — it doesn't fetch, debounce, or
 * persist on its own. The parent owns `meta.translations` and
 * receives an updated copy via `onChange`. That keeps it compatible
 * with both "save the whole row in one PATCH" editors (Edit/New
 * PackageFieldClient) and "save per row inline" editors (Generic
 * StatusesManager / WorkflowActionsManager / etc.).
 *
 * Falls back gracefully on malformed JSON: every helper tolerates
 * `null`, `undefined`, or non-object inputs so old rows without a
 * `translations` block continue to render the original English label.
 */

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Languages, ChevronDown, ChevronRight } from "lucide-react";
import {
  SUPPORTED_LOCALES,
  type Locale,
  type TranslationBlock,
} from "@/lib/i18n";

/** Display name for each locale shown in the editor heading. */
const LOCALE_DISPLAY: Record<Locale, string> = {
  en: "English",
  "zh-HK": "繁體中文 (香港)",
};

/**
 * Locales that admins can actually translate INTO.
 *
 * `en` is the source of truth (admins type the original label in
 * English) so it never appears in the editor — only non-English
 * locales do.
 */
const TRANSLATABLE_LOCALES: Locale[] = SUPPORTED_LOCALES.filter(
  (l): l is Locale => l !== "en",
) as Locale[];

/** Minimal description of an option row that we want to translate. */
export type EditableOption = {
  value?: string;
  label?: string;
};

/** Minimal description of a boolean-branch child we want to translate. */
export type EditableBooleanChild = {
  label?: string;
};

/** Minimal description of a repeatable child field we want to translate. */
export type EditableRepeatableField = {
  key?: string;
  value?: string;
  label?: string;
};

/**
 * Full set of translatable items the parent passes in.
 *
 * Anything left undefined / empty is hidden — the editor only renders
 * the sections that are actually configurable on this row.
 */
export type TranslationsEditorProps = {
  /** Current `meta.translations` blob (whole object — all locales). */
  value: Partial<Record<Locale, TranslationBlock>> | null | undefined;
  /** Callback fired whenever ANY translation changes. Always returns
   *  a fresh shallow copy so the parent can `setForm({...form, meta: { ...meta, translations: next }})`. */
  onChange: (next: Partial<Record<Locale, TranslationBlock>>) => void;
  /** Original English label — shown as placeholder so admins know
   *  what they're translating. */
  sourceLabel?: string;
  /** Optional list of selectable options to translate. */
  options?: EditableOption[];
  /** Optional boolean branch children. */
  booleanChildren?: {
    true?: EditableBooleanChild[];
    false?: EditableBooleanChild[];
  };
  /** Optional repeatable child fields. */
  repeatable?: EditableRepeatableField[];
  /** Whether the panel starts open. Defaults to `false` (collapsed)
   *  to keep dialogs compact for admins who never translate. */
  defaultOpen?: boolean;
  /** Optional helper text under the toggle. */
  hint?: string;
};

/** Safely read the per-locale block from a translations blob. */
function getBlock(
  value: TranslationsEditorProps["value"],
  locale: Locale,
): TranslationBlock {
  if (!value || typeof value !== "object") return {};
  const block = (value as Record<string, unknown>)[locale];
  return block && typeof block === "object" ? (block as TranslationBlock) : {};
}

/** Trim then drop empty / whitespace-only strings so we never persist
 *  meaningless `""` values into JSONB. */
function nullIfBlank(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Update one locale block, dropping it entirely if it becomes empty. */
function patchLocale(
  current: TranslationsEditorProps["value"],
  locale: Locale,
  updater: (block: TranslationBlock) => TranslationBlock,
): Partial<Record<Locale, TranslationBlock>> {
  const next: Partial<Record<Locale, TranslationBlock>> = {
    ...(current && typeof current === "object" ? current : {}),
  };
  const updated = updater(getBlock(current, locale));
  const isEmpty =
    !updated ||
    ((!updated.label || updated.label.trim() === "") &&
      (!updated.options || Object.keys(updated.options).length === 0) &&
      (!updated.booleanChildren ||
        ((!updated.booleanChildren.true ||
          Object.keys(updated.booleanChildren.true).length === 0) &&
          (!updated.booleanChildren.false ||
            Object.keys(updated.booleanChildren.false).length === 0))) &&
      (!updated.repeatable || Object.keys(updated.repeatable).length === 0));
  if (isEmpty) {
    delete next[locale];
  } else {
    next[locale] = updated;
  }
  return next;
}

export function TranslationsEditor({
  value,
  onChange,
  sourceLabel,
  options,
  booleanChildren,
  repeatable,
  defaultOpen = false,
  hint,
}: TranslationsEditorProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  // Compute a quick "is anything translated yet?" signal so the
  // toggle can show a count badge — admins see at a glance which
  // rows still need translation work.
  const translatedLocaleCount = React.useMemo(() => {
    if (!value || typeof value !== "object") return 0;
    let count = 0;
    for (const locale of TRANSLATABLE_LOCALES) {
      const block = getBlock(value, locale);
      if (
        block.label?.trim() ||
        (block.options && Object.keys(block.options).length > 0) ||
        (block.booleanChildren &&
          ((block.booleanChildren.true && Object.keys(block.booleanChildren.true).length > 0) ||
            (block.booleanChildren.false && Object.keys(block.booleanChildren.false).length > 0))) ||
        (block.repeatable && Object.keys(block.repeatable).length > 0)
      ) {
        count++;
      }
    }
    return count;
  }, [value]);

  const totalLocales = TRANSLATABLE_LOCALES.length;

  return (
    <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        <span className="inline-flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Languages className="h-3.5 w-3.5" />
          Translations
          {translatedLocaleCount > 0 ? (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              {translatedLocaleCount}/{totalLocales}
            </span>
          ) : null}
        </span>
        {hint && open ? (
          <span className="hidden text-[11px] font-normal text-neutral-500 sm:inline dark:text-neutral-400">
            {hint}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="space-y-4 border-t border-neutral-200 px-3 py-3 dark:border-neutral-800">
          {TRANSLATABLE_LOCALES.map((locale) => {
            const block = getBlock(value, locale);
            return (
              <section
                key={locale}
                className="space-y-2 rounded-md bg-neutral-50/70 p-2 dark:bg-neutral-900/40"
              >
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {LOCALE_DISPLAY[locale]} ({locale})
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
                    onClick={() => {
                      onChange(patchLocale(value, locale, () => ({})));
                    }}
                  >
                    Clear
                  </Button>
                </div>

                <div className="grid gap-1">
                  <Label className="text-[11px]">Label</Label>
                  <Input
                    value={block.label ?? ""}
                    placeholder={sourceLabel ?? ""}
                    onChange={(e) => {
                      const trimmed = nullIfBlank(e.target.value);
                      onChange(
                        patchLocale(value, locale, (b) => {
                          const next: TranslationBlock = { ...b };
                          if (trimmed === undefined) {
                            delete next.label;
                          } else {
                            next.label = trimmed;
                          }
                          return next;
                        }),
                      );
                    }}
                  />
                </div>

                {Array.isArray(options) && options.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    <Label className="text-[11px]">Option labels</Label>
                    <div className="grid gap-1">
                      {options.map((opt) => {
                        const val = String(opt.value ?? "").trim();
                        if (!val) return null;
                        return (
                          <div key={val} className="flex items-center gap-2">
                            <span className="w-32 shrink-0 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                              {opt.label ?? val}
                            </span>
                            <Input
                              className="h-8 text-xs"
                              value={block.options?.[val] ?? ""}
                              placeholder={opt.label ?? val}
                              onChange={(e) => {
                                const trimmed = nullIfBlank(e.target.value);
                                onChange(
                                  patchLocale(value, locale, (b) => {
                                    const nextOptions: Record<string, string> = {
                                      ...(b.options ?? {}),
                                    };
                                    if (trimmed === undefined) {
                                      delete nextOptions[val];
                                    } else {
                                      nextOptions[val] = trimmed;
                                    }
                                    const next: TranslationBlock = { ...b };
                                    if (Object.keys(nextOptions).length === 0) {
                                      delete next.options;
                                    } else {
                                      next.options = nextOptions;
                                    }
                                    return next;
                                  }),
                                );
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {(["true", "false"] as const).map((branch) => {
                  const branchChildren = booleanChildren?.[branch] ?? [];
                  if (!Array.isArray(branchChildren) || branchChildren.length === 0) {
                    return null;
                  }
                  return (
                    <div key={branch} className="space-y-1 pt-1">
                      <Label className="text-[11px]">
                        Boolean ({branch === "true" ? "Yes" : "No"}) child labels
                      </Label>
                      <div className="grid gap-1">
                        {branchChildren.map((child, idx) => {
                          const childKey = String(idx);
                          return (
                            <div key={`${branch}-${idx}`} className="flex items-center gap-2">
                              <span className="w-32 shrink-0 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                                {child.label ?? `Child ${idx + 1}`}
                              </span>
                              <Input
                                className="h-8 text-xs"
                                value={block.booleanChildren?.[branch]?.[childKey] ?? ""}
                                placeholder={child.label ?? ""}
                                onChange={(e) => {
                                  const trimmed = nullIfBlank(e.target.value);
                                  onChange(
                                    patchLocale(value, locale, (b) => {
                                      const branches = {
                                        ...(b.booleanChildren ?? {}),
                                      } as TranslationBlock["booleanChildren"];
                                      const branchMap: Record<string, string> = {
                                        ...(branches?.[branch] ?? {}),
                                      };
                                      if (trimmed === undefined) {
                                        delete branchMap[childKey];
                                      } else {
                                        branchMap[childKey] = trimmed;
                                      }
                                      const nextBranches = {
                                        ...branches,
                                        [branch]:
                                          Object.keys(branchMap).length > 0
                                            ? branchMap
                                            : undefined,
                                      } as TranslationBlock["booleanChildren"];
                                      const next: TranslationBlock = { ...b };
                                      if (
                                        nextBranches &&
                                        ((nextBranches.true && Object.keys(nextBranches.true).length > 0) ||
                                          (nextBranches.false && Object.keys(nextBranches.false).length > 0))
                                      ) {
                                        next.booleanChildren = {
                                          ...(nextBranches.true ? { true: nextBranches.true } : {}),
                                          ...(nextBranches.false ? { false: nextBranches.false } : {}),
                                        };
                                      } else {
                                        delete next.booleanChildren;
                                      }
                                      return next;
                                    }),
                                  );
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {Array.isArray(repeatable) && repeatable.length > 0 ? (
                  <div className="space-y-1 pt-1">
                    <Label className="text-[11px]">Repeatable child labels</Label>
                    <div className="grid gap-1">
                      {repeatable.map((child, idx) => {
                        const stableKey = String(child.key ?? child.value ?? "").trim();
                        if (!stableKey) return null;
                        return (
                          <div key={`${stableKey}-${idx}`} className="flex items-center gap-2">
                            <span className="w-32 shrink-0 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                              {child.label ?? stableKey}
                            </span>
                            <Input
                              className="h-8 text-xs"
                              value={block.repeatable?.[stableKey] ?? ""}
                              placeholder={child.label ?? stableKey}
                              onChange={(e) => {
                                const trimmed = nullIfBlank(e.target.value);
                                onChange(
                                  patchLocale(value, locale, (b) => {
                                    const nextRep: Record<string, string> = {
                                      ...(b.repeatable ?? {}),
                                    };
                                    if (trimmed === undefined) {
                                      delete nextRep[stableKey];
                                    } else {
                                      nextRep[stableKey] = trimmed;
                                    }
                                    const next: TranslationBlock = { ...b };
                                    if (Object.keys(nextRep).length === 0) {
                                      delete next.repeatable;
                                    } else {
                                      next.repeatable = nextRep;
                                    }
                                    return next;
                                  }),
                                );
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
