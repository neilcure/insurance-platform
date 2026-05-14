import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/options";
import {
  ShieldCheck,
  FileText,
  Users,
  BarChart3,
  ArrowRight,
  LogIn,
  CheckCircle2,
} from "lucide-react";
import {
  DEFAULT_LANDING,
  type LandingPageSettings,
} from "@/app/api/admin/landing-page/route";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { Button } from "@/components/ui/button";
import { tStatic } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

async function getLandingContent(): Promise<LandingPageSettings> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "landing_page"))
      .limit(1);

    const stored = row?.value ? (row.value as Partial<LandingPageSettings>) : {};
    const base: LandingPageSettings = { ...DEFAULT_LANDING, ...stored };

    // Check on-disk whether logo files actually exist
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const assetsDir = path.join(process.cwd(), ".uploads", "assets");
    try {
      const files = await fs.readdir(assetsDir);
      base.logoUrl = files.some((f) => f.startsWith("logo-light."))
        ? "/api/admin/assets/logo?variant=light"
        : "";
      base.logoUrlDark = files.some((f) => f.startsWith("logo-dark."))
        ? "/api/admin/assets/logo?variant=dark"
        : "";
    } catch {
      base.logoUrl = "";
      base.logoUrlDark = "";
    }

    return base;
  } catch {
    return DEFAULT_LANDING;
  }
}

const FEATURE_ICONS = [FileText, Users, BarChart3];

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect("/dashboard");
  }

  const c = await getLandingContent();
  // Page chrome (Sign in button / footer copyright / Forgot password
  // link) follows the language switcher; the admin-edited landing
  // content (`c.brandName`, `c.heroHeading`, etc.) intentionally
  // stays as-is until the dynamic translation pipeline lands.
  const locale = await getLocale();

  return (
    <main className="min-h-screen bg-neutral-50 transition-colors duration-500 dark:bg-neutral-950">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 sm:px-10">
        <div className="flex items-center gap-3">
          {(c.logoUrl || c.logoUrlDark) ? (
            // Both variants share the same slot. When BOTH are uploaded we
            // cross-fade between them as `.dark` toggles on <html>. When only
            // ONE is uploaded we show that one in both modes (no fade), so the
            // navbar never goes blank.
            <div className="relative inline-flex h-12 items-center">
              {c.logoUrl && c.logoUrlDark ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.logoUrl}
                    alt={c.brandName}
                    className="block h-12 max-w-[208px] object-contain object-left transition-opacity duration-500 ease-in-out dark:opacity-0"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.logoUrlDark}
                    alt=""
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-0 h-12 max-w-[208px] object-contain object-left opacity-0 transition-opacity duration-500 ease-in-out dark:opacity-100"
                  />
                </>
              ) : (
                // Only one variant uploaded — show it in both modes.
                // dark:invert flips a black-on-transparent logo to white
                // in dark mode so it stays visible without a second file.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.logoUrl || c.logoUrlDark}
                  alt={c.brandName}
                  className="block h-12 max-w-[208px] object-contain object-left transition-[filter] duration-500 dark:invert"
                />
              )}
            </div>
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-900 transition-colors duration-500 dark:bg-neutral-100">
              <ShieldCheck className="h-6 w-6 text-white transition-colors duration-500 dark:text-neutral-900" />
            </div>
          )}
          <span className="text-lg font-semibold text-neutral-900 transition-colors duration-500 dark:text-neutral-100">
            {c.brandName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ModeToggle />
          <Button
            asChild
            size="sm"
            className="bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Link href="/auth/signin" aria-label={tStatic("landing.signIn", locale, "Sign in")}>
              <LogIn className="h-4 w-4 shrink-0 sm:hidden lg:inline" />
              <span className="hidden sm:inline">{tStatic("landing.signIn", locale, "Sign in")}</span>
            </Link>
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-20 pt-16 text-center sm:px-10 sm:pt-24">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900 sm:text-5xl dark:text-neutral-100">
          {c.heroHeading}
          {c.heroHeadingAccent && (
            <>
              <br />
              <span className="text-neutral-500 dark:text-neutral-400">{c.heroHeadingAccent}</span>
            </>
          )}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">
          {c.heroDescription}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/auth/signin"
            className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {c.heroCta}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-neutral-200 bg-white px-6 py-20 sm:px-10 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {c.featuresHeading}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-neutral-500 dark:text-neutral-400">
            {c.featuresSubheading}
          </p>

          <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {c.featureCards.map((card, i) => {
              const Icon = FEATURE_ICONS[i % FEATURE_ICONS.length]!;
              return (
                <FeatureCard
                  key={i}
                  icon={Icon}
                  title={card.title}
                  description={card.description}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {c.highlightsHeading}
          </h2>
          <ul className="mt-10 space-y-5">
            {c.highlights.map((text, i) => (
              <li key={i} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
                <span className="text-neutral-700 dark:text-neutral-300">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-neutral-200 bg-white px-6 py-16 text-center sm:px-10 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          {c.ctaHeading}
        </h2>
        <p className="mt-2 text-neutral-500 dark:text-neutral-400">
          {c.ctaSubheading}
        </p>
        <Link
          href="/auth/signin"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {tStatic("landing.signIn", locale, "Sign in")}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 px-6 py-8 dark:border-neutral-800">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-neutral-400" />
            <span className="text-sm text-neutral-500 dark:text-neutral-400">
              &copy; {new Date().getFullYear()} {c.footerName}. {tStatic("landing.allRightsReserved", locale, "All rights reserved.")}
            </span>
          </div>
          <div className="flex gap-6 text-sm text-neutral-500 dark:text-neutral-400">
            <Link href="/auth/signin" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              {tStatic("landing.signIn", locale, "Sign in")}
            </Link>
            <Link href="/forgot-password" className="hover:text-neutral-900 dark:hover:text-neutral-100">
              {tStatic("landing.forgotPassword", locale, "Forgot password")}
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
        <Icon className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
      </div>
      <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
        {description}
      </p>
    </div>
  );
}
