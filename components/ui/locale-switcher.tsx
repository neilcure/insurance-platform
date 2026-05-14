"use client";

/**
 * Locale switcher — same interaction model as `<RowActionMenu>`:
 * desktop = horizontal strip that expands with max-width + opacity (700ms);
 * header sits flush-right so we use the `align="end"` geometry (panel grows LEFT).
 * Mobile = compact vertical panel under the chip (matches RowActionMenu).
 *
 * Performance design
 * ------------------
 * Switching language MUST feel instant. Three things need to happen,
 * but only ONE is on the user's critical path:
 *
 *   1. (critical) Re-render every client component reading
 *      `useLocale()` — handled by `setLocale(next)` synchronously.
 *   2. (background) Set the `NEXT_LOCALE` cookie so the next request
 *      uses the new language — done via `document.cookie` BEFORE the
 *      fetch so any link the user clicks during the round-trip
 *      already sees the new cookie. The route handler later re-sets
 *      the same cookie with stricter attrs (idempotent).
 *   3. (background) Persist to `users.profile_meta.locale` so other
 *      devices / browsers pick the choice up — fired with `keepalive`
 *      so the request survives navigation.
 *
 * The OLD implementation `await`-ed the fetch BEFORE calling
 * `setLocale` — that's why the language used to feel slow: the user
 * was watching the network round-trip on every click.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Languages, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  tStatic,
  useLocale,
  useSetLocale,
  type Locale,
} from "@/lib/i18n";

type Props = {
  className?: string;
};

/** One year — matches the server-side cookie maxAge in `/api/me/locale`. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Write the locale cookie from the browser so navigation made BEFORE
 * the API round-trip resolves still uses the new value. The route
 * handler re-sets the same cookie with the same TTL — that second
 * write is harmless and idempotent.
 *
 * `secure` is only added on HTTPS so localhost dev still works
 * (browsers refuse `Secure` cookies on `http://`).
 */
function writeLocaleCookieClientSide(locale: Locale) {
  if (typeof document === "undefined") return;
  const isHttps = window.location.protocol === "https:";
  document.cookie =
    `${LOCALE_COOKIE}=${encodeURIComponent(locale)}` +
    `; path=/` +
    `; max-age=${COOKIE_MAX_AGE_SECONDS}` +
    `; samesite=lax` +
    (isHttps ? "; secure" : "");
}

export function LocaleSwitcher({ className }: Props) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const currentLocaleLabel = tStatic(`locale.${locale}`, locale, locale);

  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleSelect = React.useCallback(
    (next: Locale) => {
      if (next === locale) return;
      setOpen(false);

      // 1. CRITICAL PATH — re-render every client component consuming
      //    `useLocale()` immediately. The user sees the language flip
      //    in <16 ms.
      setLocale(next);

      // 2. Make navigation safe right now: any link the user clicks
      //    while the fetch is still in flight will already see the
      //    new cookie.
      writeLocaleCookieClientSide(next);

      // 3. Re-fetch server components in the background so any
      //    server-rendered text (sidebar nav from server props, future
      //    server-translated chrome) updates without a full reload.
      //    `router.refresh()` is fire-and-forget by design.
      router.refresh();

      // 4. Background persistence — the route handler re-sets the
      //    cookie with server-side attrs AND writes to
      //    `users.profile_meta` for cross-device sync. We never block
      //    the UI on this; a failure is logged and otherwise silent.
      //    `keepalive: true` lets the request finish even if the user
      //    navigates away immediately after clicking.
      void fetch("/api/me/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
        keepalive: true,
      }).catch((err) => {
        console.error("[locale-switcher] background persistence failed:", err);
      });
    },
    [locale, router, setLocale],
  );

  const chipLabel = tStatic("locale.label", locale, "Language");

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        aria-label={chipLabel}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex cursor-pointer items-center rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium text-neutral-600 shadow-sm outline-none select-none",
          "transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 dark:focus-visible:ring-neutral-600 dark:focus-visible:ring-offset-neutral-950",
          "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700/70",
        )}
      >
        <Languages className="h-4 w-4 sm:hidden" aria-hidden />
        <span className="hidden max-w-40 truncate sm:inline">{currentLocaleLabel}</span>
      </button>

      {/* Desktop — same slide-out as RowActionMenu align="end": grows LEFT toward page centre */}
      <div
        className={cn(
          "absolute top-1/2 right-full z-30 hidden -translate-y-1/2 items-center overflow-hidden transition-all duration-700 ease-in-out sm:flex",
          open ? "mr-2 max-w-[280px] opacity-100" : "mr-0 max-w-0 opacity-0",
        )}
      >
        <div className="flex items-center gap-0 rounded-md border border-neutral-200 bg-neutral-100 p-0.5 shadow-sm dark:border-neutral-700 dark:bg-neutral-800">
          {SUPPORTED_LOCALES.map((code) => {
            const isActive = code === locale;
            const label = tStatic(`locale.${code}`, code, code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => handleSelect(code)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  "focus:outline-none",
                  isActive
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                    : "text-neutral-600 hover:bg-white hover:text-neutral-900 hover:shadow-sm dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100",
                )}
              >
                <span>{label}</span>
                {isActive ? <Check className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile — vertical stack like RowActionMenu */}
      <div
        className={cn(
          "absolute right-0 top-full z-50 mt-1 overflow-hidden transition-all duration-500 ease-in-out sm:hidden",
          open ? "max-h-40 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="flex min-w-44 flex-col rounded-md border border-neutral-200 bg-neutral-100 p-0.5 shadow-md dark:border-neutral-700 dark:bg-neutral-800">
          <div className="px-2 py-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{chipLabel}</div>
          {SUPPORTED_LOCALES.map((code) => {
            const isActive = code === locale;
            const label = tStatic(`locale.${code}`, code, code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => handleSelect(code)}
                className={cn(
                  "inline-flex cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-sm px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                  "focus:outline-none",
                  isActive
                    ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                    : "text-neutral-600 hover:bg-white hover:text-neutral-900 hover:shadow-sm dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100",
                )}
              >
                <span>{label}</span>
                {isActive ? <Check className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
