"use client";

/**
 * Locale switcher — same interaction model as `<RowActionMenu>`:
 * desktop = horizontal strip that expands with max-width + opacity (700ms);
 * header sits flush-right so we use the `align="end"` geometry (panel grows LEFT).
 * Mobile = compact vertical panel under the chip (matches RowActionMenu).
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Languages, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SUPPORTED_LOCALES,
  tStatic,
  useLocale,
  useSetLocale,
  type Locale,
} from "@/lib/i18n";

type Props = {
  className?: string;
};

export function LocaleSwitcher({ className }: Props) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const router = useRouter();

  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<Locale | null>(null);
  const isPending = pending !== null;
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
    async (next: Locale) => {
      if (next === locale || isPending) return;
      setOpen(false);
      setPending(next);
      try {
        const res = await fetch("/api/me/locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: next }),
        });
        if (!res.ok) {
          console.error("[locale-switcher] persistence failed:", await res.text());
          return;
        }
        setLocale(next);
        router.refresh();
      } catch (err) {
        console.error("[locale-switcher] network error:", err);
      } finally {
        setPending(null);
      }
    },
    [locale, isPending, router, setLocale],
  );

  const chipLabel = tStatic("locale.label", locale, "Language");

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center", className)}>
      <button
        type="button"
        aria-label={chipLabel}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={isPending}
        onClick={() => !isPending && setOpen((prev) => !prev)}
        className={cn(
          "inline-flex items-center rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium text-neutral-600 shadow-sm outline-none select-none",
          "transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 dark:focus-visible:ring-neutral-600 dark:focus-visible:ring-offset-neutral-950",
          "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700/70",
          isPending && "cursor-not-allowed opacity-50",
          !isPending && "cursor-pointer",
        )}
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Languages className="h-4 w-4 sm:hidden" aria-hidden />
            <span className="hidden max-w-40 truncate sm:inline">{currentLocaleLabel}</span>
          </>
        )}
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
                disabled={isPending}
                onClick={() => {
                  void handleSelect(code);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  "focus:outline-none disabled:pointer-events-none disabled:opacity-50",
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
                disabled={isPending}
                onClick={() => {
                  void handleSelect(code);
                }}
                className={cn(
                  "inline-flex items-center justify-between gap-2 whitespace-nowrap rounded-sm px-2.5 py-1.5 text-left text-xs font-medium transition-colors",
                  "focus:outline-none disabled:pointer-events-none disabled:opacity-50",
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
