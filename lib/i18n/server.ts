/**
 * Server-only barrel for the i18n module.
 *
 * Use this entry point from server components, route handlers, and
 * server actions when you need `getLocale()`. Client components
 * MUST NOT import from this file — `lib/i18n/locale.ts` registers
 * `server-only` which throws at module-load time in a client bundle.
 *
 * For client-safe exports (types, `tStatic`, `tDynamic`,
 * `<I18nProvider>`, `useLocale`, `useT`), import from `@/lib/i18n`.
 */

import "server-only";

export { getLocale } from "./locale";
