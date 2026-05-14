"use client";

/**
 * Locale switcher dropdown — sibling of `<ModeToggle>`.
 *
 * Behaviour
 * ---------
 * - Reads the active locale from `<I18nProvider>` so the menu's tick
 *   mark always reflects the language the user is currently seeing.
 * - On selection, POSTs to `/api/me/locale` (which sets the cookie
 *   AND, when signed in, persists to `users.profile_meta.locale`).
 * - Optimistically updates the in-memory React tree via
 *   `useSetLocale`, then calls `router.refresh()` so server
 *   components rerun against the new cookie / `x-locale` header.
 * - Visible labels come from the `messages/<locale>.ts` dictionaries
 *   under the `locale.*` namespace — each language is shown in its
 *   OWN script (English shows "English", Chinese shows "繁體中文")
 *   so a misclicked choice can be reversed without re-translating.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Languages, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SUPPORTED_LOCALES,
  tStatic,
  useLocale,
  useSetLocale,
  type Locale,
} from "@/lib/i18n";

type Props = {
  /** Optional className passed to the trigger `<Button>`. */
  className?: string;
};

export function LocaleSwitcher({ className }: Props) {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const router = useRouter();

  const [pending, setPending] = React.useState<Locale | null>(null);
  const isPending = pending !== null;

  const handleSelect = React.useCallback(
    async (next: Locale) => {
      if (next === locale || isPending) return;
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
        // Re-run server components so the new cookie / x-locale header
        // takes effect for any server-rendered text on the current
        // page (sidebar, breadcrumbs, server-rendered chrome).
        router.refresh();
      } catch (err) {
        console.error("[locale-switcher] network error:", err);
      } finally {
        setPending(null);
      }
    },
    [locale, isPending, router, setLocale],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={tStatic("locale.label", locale, "Language")}
          className={className}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Languages className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs text-neutral-500 dark:text-neutral-400">
          {tStatic("locale.label", locale, "Language")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SUPPORTED_LOCALES.map((code) => {
          const isActive = code === locale;
          // Each entry is intentionally rendered in ITS OWN language so
          // a user accidentally on the wrong locale can still recognise
          // their preferred option ("English" stays English, Chinese
          // shows in Hanzi).
          const label = tStatic(`locale.${code}`, code, code);
          return (
            <DropdownMenuItem
              key={code}
              onSelect={() => {
                void handleSelect(code);
              }}
              className="flex items-center justify-between gap-3"
            >
              <span>{label}</span>
              {isActive ? (
                <Check className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
