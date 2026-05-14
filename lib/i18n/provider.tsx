"use client";

import * as React from "react";

import { tStatic } from "./resolve";
import { DEFAULT_LOCALE, type Locale } from "./types";

type I18nContextValue = {
  /** Current resolved locale for the browser session. */
  locale: Locale;

  /**
   * Set the locale for the rest of the page lifetime. Persistence
   * (cookie + DB) is handled by `<LocaleSwitcher>` calling
   * `/api/me/locale` — this setter only re-renders the React tree.
   */
  setLocale: (next: Locale) => void;
};

const I18nContext = React.createContext<I18nContextValue | null>(null);

/**
 * Wrap the app with the resolved server locale. Mounted exactly
 * once in `app/layout.tsx`. Nested layouts MUST NOT mount another
 * `<I18nProvider>` — child components rely on the context being
 * the top-most one.
 */
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocale] = React.useState<Locale>(initialLocale);

  React.useEffect(() => {
    setLocale(initialLocale);
  }, [initialLocale]);

  const value = React.useMemo<I18nContextValue>(
    () => ({ locale, setLocale }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Read the current locale from any client component.
 *
 * Falls back to `DEFAULT_LOCALE` when no provider is mounted (which
 * should only happen in tests / Storybook / accidental imports
 * outside the dashboard tree).
 */
export function useLocale(): Locale {
  return React.useContext(I18nContext)?.locale ?? DEFAULT_LOCALE;
}

/**
 * Imperative locale setter. Writes-through to the cookie/DB are the
 * caller's responsibility — typically `<LocaleSwitcher>` POSTs to
 * `/api/me/locale` then calls this to update the in-memory tree.
 */
export function useSetLocale(): (next: Locale) => void {
  const ctx = React.useContext(I18nContext);
  return React.useMemo(
    () =>
      ctx?.setLocale ??
      (() => {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn(
            "[i18n] useSetLocale called without an <I18nProvider>; ignoring.",
          );
        }
      }),
    [ctx],
  );
}

/**
 * Convenience hook: returns a `t(key, fallback?, params?)` function
 * bound to the current locale. Use this anywhere we render
 * hardcoded UI strings inside a client component.
 *
 *   const t = useT();
 *   <Button>{t("common.save")}</Button>
 */
export function useT(): (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
) => string {
  const locale = useLocale();
  return React.useCallback(
    (key, fallback, params) => tStatic(key, locale, fallback, params),
    [locale],
  );
}
