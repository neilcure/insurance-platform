/**
 * Public barrel for the i18n module — CLIENT-SAFE entry point.
 *
 * Exports everything that can run in either a server or client
 * component (types, the pure-data resolvers, and the React
 * provider).
 *
 * For SERVER-ONLY helpers (`getLocale`), import from
 * `@/lib/i18n/server`. We keep them in a separate file because
 * `lib/i18n/locale.ts` uses `import "server-only"`, which would
 * throw at module-load time if pulled into a client bundle.
 */

export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  SUPPORTED_LOCALES,
  coerceLocale,
  type Locale,
  type TranslatableOption,
  type TranslationBlock,
} from "./types";

export {
  tStatic,
  tDynamic,
  tDynamicOption,
  tDynamicBooleanChild,
  tDynamicRepeatableField,
} from "./resolve";

export { I18nProvider, useLocale, useSetLocale, useT } from "./provider";
