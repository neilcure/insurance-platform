/**
 * Unified i18n resolver — single entry point for every translatable
 * string in the app.
 *
 * Two independent pipelines coexist:
 *
 *   1. STATIC strings (`tStatic`) — hardcoded UI text living in code,
 *      sourced from the `messages/<locale>.ts` dictionaries.
 *
 *   2. DYNAMIC strings (`tDynamic*`) — admin-edited labels living in
 *      `form_options.meta.translations.<locale>`. Falls back to the
 *      original `label` whenever a translation is missing so the
 *      pipeline degrades gracefully.
 *
 * Anything outside these two pipelines (PDF templates, email
 * subjects, audit log payloads, currency/date formatting) is by
 * design English-only — see the i18n plan + `dynamic-config-first`
 * skill for the rationale.
 */

import enMessages from "@/messages/en";
import zhHKMessages from "@/messages/zh-HK";

import {
  DEFAULT_LOCALE,
  type Locale,
  type TranslatableOption,
  type TranslationBlock,
} from "./types";

/** Static dictionaries indexed by locale. New locales register here. */
const STATIC_DICTIONARIES: Record<Locale, unknown> = {
  en: enMessages,
  "zh-HK": zhHKMessages,
};

/**
 * Walk a dotted key path (`"nav.dashboard"`) over a nested object.
 * Returns `undefined` if any step is missing or hits a non-object.
 */
function lookupKey(tree: unknown, path: string): string | undefined {
  if (!tree || typeof tree !== "object") return undefined;
  const parts = path.split(".");
  let cursor: unknown = tree;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

/**
 * Replace `{token}` placeholders in `template` using `params`.
 *
 * Tokens that have no matching key are left untouched (e.g.
 * `"Hello, {name}"` with `{}` returns `"Hello, {name}"`) so missing
 * data is visible in the UI rather than silently disappearing.
 */
function interpolate(
  template: string,
  params: Record<string, string | number> | undefined,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const v = params[key];
      return v === undefined || v === null ? match : String(v);
    }
    return match;
  });
}

/**
 * Resolve a STATIC translation key.
 *
 * Resolution chain:
 *   1. `messages/<locale>.ts` at the requested key
 *   2. `messages/en.ts` at the requested key (canonical fallback)
 *   3. `fallback` argument if provided
 *   4. The key itself (so missing entries are visible in the UI)
 *
 * Examples:
 *   tStatic("nav.dashboard", "zh-HK")             // "主控台"
 *   tStatic("nav.unknown", "zh-HK", "Unknown")    // "Unknown"
 *   tStatic("greeting", "en", undefined, { name: "Ada" }) // "Hello, Ada"
 */
export function tStatic(
  key: string,
  locale: Locale = DEFAULT_LOCALE,
  fallback?: string,
  params?: Record<string, string | number>,
): string {
  const localized = lookupKey(STATIC_DICTIONARIES[locale], key);
  if (typeof localized === "string") return interpolate(localized, params);

  if (locale !== DEFAULT_LOCALE) {
    const enFallback = lookupKey(STATIC_DICTIONARIES[DEFAULT_LOCALE], key);
    if (typeof enFallback === "string") return interpolate(enFallback, params);
  }

  if (typeof fallback === "string") return interpolate(fallback, params);
  return key;
}

/**
 * Read the `meta.translations.<locale>` block from a `form_options`
 * row. Tolerates `null` / `undefined` / non-object meta safely so
 * call sites don't have to defend against malformed JSONB.
 */
function getTranslationBlock(
  option: TranslatableOption | null | undefined,
  locale: Locale,
): TranslationBlock | undefined {
  const meta = option?.meta;
  if (!meta || typeof meta !== "object") return undefined;
  const translations = (meta as { translations?: unknown }).translations;
  if (!translations || typeof translations !== "object") return undefined;
  const block = (translations as Record<string, unknown>)[locale];
  if (!block || typeof block !== "object") return undefined;
  return block as TranslationBlock;
}

/**
 * Resolve a DYNAMIC label for a `form_options` row.
 *
 * Resolution chain:
 *   1. `option.meta.translations[locale].label`
 *   2. `option.label` (original English / source label)
 *   3. Empty string (matches existing behaviour when label is null)
 *
 * Use this anywhere we currently render `option.label` directly.
 */
export function tDynamic(
  option: TranslatableOption | null | undefined,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!option) return "";
  const block = getTranslationBlock(option, locale);
  if (block?.label && typeof block.label === "string") return block.label;
  return option.label ?? "";
}

/**
 * Resolve a DYNAMIC label for a SINGLE option inside `meta.options[]`,
 * keyed by the option's `value` (which is what the snapshot stores).
 *
 * Pass the full parent `field` row so we can read the `translations`
 * block from its meta. The optional `fallbackLabel` is used when no
 * translation exists — typically the option's own English `label`.
 */
export function tDynamicOption(
  field: TranslatableOption | null | undefined,
  optionValue: string,
  locale: Locale = DEFAULT_LOCALE,
  fallbackLabel?: string,
): string {
  const block = getTranslationBlock(field, locale);
  const translated = block?.options?.[optionValue];
  if (typeof translated === "string" && translated.length > 0) return translated;
  return fallbackLabel ?? optionValue;
}

/**
 * Resolve a DYNAMIC label for a single boolean-branch child label
 * (`meta.booleanChildren.{true,false}[childIndex].label`).
 *
 * `branch` is the parent boolean's value, `childIndex` is the
 * position in the branch array.
 */
export function tDynamicBooleanChild(
  field: TranslatableOption | null | undefined,
  branch: "true" | "false",
  childIndex: number,
  locale: Locale = DEFAULT_LOCALE,
  fallbackLabel?: string,
): string {
  const block = getTranslationBlock(field, locale);
  const branchTranslations = block?.booleanChildren?.[branch];
  const translated = branchTranslations?.[String(childIndex)];
  if (typeof translated === "string" && translated.length > 0) return translated;
  return fallbackLabel ?? "";
}

/**
 * Resolve a DYNAMIC label for one repeatable child field
 * (`meta.repeatable.fields[N]`), keyed by the child's stable `key`
 * (NOT by index — the wizard form names use the key, so the
 * translation map should too).
 */
export function tDynamicRepeatableField(
  field: TranslatableOption | null | undefined,
  childKey: string,
  locale: Locale = DEFAULT_LOCALE,
  fallbackLabel?: string,
): string {
  const block = getTranslationBlock(field, locale);
  const translated = block?.repeatable?.[childKey];
  if (typeof translated === "string" && translated.length > 0) return translated;
  return fallbackLabel ?? childKey;
}
