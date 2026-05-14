import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { GlobalDialogHost } from "@/components/ui/global-dialogs";
import { I18nProvider } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

const SITE_NAME = "Bravo General Insurance Interface";
const SITE_SHORT_NAME = "Bravo GI";
const SITE_URL = "https://bravogi.com";
const SITE_DESCRIPTION =
  "Bravo General Insurance Interface — manage policies, clients, agents, and documents — all in one place.";

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} | Insurance Management Made Simple`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  // `metadataBase` makes every relative URL in metadata (og:image,
  // twitter:image, manifest, etc.) resolve against the canonical
  // origin so previews always link to the public production URL.
  metadataBase: new URL(SITE_URL),
  // Helps Google + Apple identify the brand at the OS / browser
  // chrome level (right-click "Add to Home Screen" picks this up).
  applicationName: SITE_NAME,
  appleWebApp: {
    capable: true,
    title: SITE_SHORT_NAME,
    statusBarStyle: "default",
  },
  openGraph: {
    title: `${SITE_NAME} | Insurance Management Made Simple`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
    // Image is auto-attached from `app/opengraph-image.tsx` — no need
    // to list it explicitly here.
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | Insurance Management Made Simple`,
    description: SITE_DESCRIPTION,
    // Image is auto-attached from `app/opengraph-image.tsx`.
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Schema.org JSON-LD payload — this is THE thing that lets Google
 * display the proper site name + logo in search results.
 *
 * Without it, Google falls back to:
 *   - Site name: bare hostname ("bravogi.com")
 *   - Site icon: a generic letter avatar (e.g. just "B")
 *
 * Two schemas, both placed on every page (the home page is what
 * Google uses, but extras are harmless and keep CSR routes consistent):
 *
 *   - `Organization` — tells Google the legal name of the publisher
 *     and a high-resolution logo URL it can crop. Required for the
 *     "Site logo" feature in search results.
 *   - `WebSite` — tells Google the human-readable name of THIS web
 *     property. Required for the "Site name" feature in search.
 *
 * Both are injected as raw `<script type="application/ld+json">`
 * tags — Next.js doesn't have a first-class metadata field for
 * JSON-LD because the content is highly schema-dependent.
 */
const jsonLdOrganization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  alternateName: SITE_SHORT_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon`,
};

const jsonLdWebsite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  alternateName: SITE_SHORT_NAME,
  url: SITE_URL,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the locale once on the server so:
  //   1. <html lang> is correct on the very first paint (good for SEO,
  //      screen readers, and browser-native translation prompts).
  //   2. Every nested client component reads the same value via
  //      `useLocale()` without needing a separate fetch.
  // The resolution is cookie-first / DB-second / header-third — see
  // `lib/i18n/locale.ts` for the full chain.
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        {/*
          JSON-LD goes inline in the body. Google's crawler reads it
          regardless of placement; we keep it before the React tree
          so a script-blocked / no-JS crawler still sees it on the
          first paint.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLdOrganization),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLdWebsite),
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <I18nProvider initialLocale={locale}>
            <AuthSessionProvider>
              {children}
              <Toaster richColors position="top-right" duration={2000} />
              <GlobalDialogHost />
            </AuthSessionProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
