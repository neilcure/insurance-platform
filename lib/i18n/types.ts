/**
 * Locale identifiers supported by the app.
 *
 * Keep this list small and explicit — every new entry must ship with a
 * matching `messages/<locale>.ts` file AND any required translations
 * inside `form_options.meta.translations.<locale>`. Adding a value
 * here without those two halves silently degrades the UI to English.
 */
export type Locale = "en" | "zh-HK";

/**
 * Default locale used when:
 *   - the request has no `NEXT_LOCALE` cookie
 *   - the user has no `users.profile_meta.locale` preference
 *   - the `Accept-Language` header doesn't contain a Chinese variant
 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * Every locale we know about. Keep this in sync with `Locale`.
 *
 * Anything not in this set is rejected by `coerceLocale` and falls
 * back to `DEFAULT_LOCALE`. The order does not matter at runtime, but
 * we keep `en` first because it is the canonical fallback.
 */
export const SUPPORTED_LOCALES = ["en", "zh-HK"] as const;

/** Cookie key the locale switcher writes to (read by both server + client). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * HTTP request header name the proxy uses to pass the resolved locale
 * to downstream API routes. Routes that need to localize an admin
 * label (e.g. "Hong Kong Only" → "只限香港") read this header instead
 * of repeating the cookie/DB resolution chain themselves.
 */
export const LOCALE_HEADER = "x-locale";

/**
 * Coerce an arbitrary string into a known `Locale`.
 *
 * Accepts case-insensitive variants (`"zh-hk"`, `"ZH-HK"`,
 * `"zh_HK"`) and falls back to `DEFAULT_LOCALE` on any unknown input.
 * Use this at every boundary where untrusted text becomes a locale —
 * cookies, headers, query strings, JSONB values, etc.
 */
export function coerceLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const normalized = value.replace(/_/g, "-").toLowerCase();
  for (const supported of SUPPORTED_LOCALES) {
    if (supported.toLowerCase() === normalized) return supported;
  }
  return DEFAULT_LOCALE;
}

/**
 * Shape of the per-locale block stored on `form_options.meta.translations.<locale>`.
 *
 * All fields are optional — missing entries fall back to the original
 * `label` / option `label` / boolean-child `label` / repeatable-field
 * `label` from the parent row.
 *
 * Indexes are stored as **string** keys (`"0"`, `"1"`) because
 * Postgres serializes JSONB object keys as strings. The resolver
 * normalizes both forms.
 */
export type TranslationBlock = {
  /** Translation for the row's top-level `label`. */
  label?: string;

  /** Translation for `meta.options[].label`, keyed by option `value`. */
  options?: Record<string, string>;

  /**
   * Translation for `meta.booleanChildren.{true,false}[].label`,
   * keyed by branch (`"true"` / `"false"`) then child index as string.
   *
   *   { "true": { "0": "申索次數" } }
   */
  booleanChildren?: {
    true?: Record<string, string>;
    false?: Record<string, string>;
  };

  /**
   * Translation for `meta.repeatable.fields[].label`, keyed by child
   * `key` (NOT index — repeatable child keys are stable identifiers).
   *
   *   { "lastName": "姓氏" }
   */
  repeatable?: Record<string, string>;
};

/**
 * Minimum shape of a `form_options` row that the dynamic resolver
 * needs. Real rows in the DB carry more fields; this is the
 * structural subset every translation helper accepts.
 *
 * `meta.translations` is intentionally typed as `unknown` rather
 * than the strict `Partial<Record<Locale, TranslationBlock>>` so
 * call sites whose local `meta` type stores `translations` loosely
 * (e.g. JSONB-shaped objects, legacy admin editors) don't have to
 * cast every invocation. The resolver does runtime validation in
 * `getTranslationBlock` before reading anything off the value, so
 * the looser type is safe in practice.
 */
export type TranslatableOption = {
  label?: string | null;
  meta?: ({ translations?: unknown } & Record<string, unknown>) | null;
};
