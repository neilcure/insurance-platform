import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { GlobalDialogHost } from "@/components/ui/global-dialogs";

const SITE_NAME = "Bravo General Insurance Interface";

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} | Insurance Management Made Simple`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Bravo General Insurance Interface — manage policies, clients, agents, and documents — all in one place.",
  metadataBase: new URL("https://bravogi.com"),
  openGraph: {
    title: `${SITE_NAME} | Insurance Management Made Simple`,
    description:
      "Bravo General Insurance Interface — manage policies, clients, agents, and documents — all in one place.",
    url: "https://bravogi.com",
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | Insurance Management Made Simple`,
    description:
      "Bravo General Insurance Interface — manage policies, clients, agents, and documents — all in one place.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthSessionProvider>
            {children}
            <Toaster richColors position="top-right" duration={2000} />
            <GlobalDialogHost />
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
