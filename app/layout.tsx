import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { AuthSessionProvider } from "@/components/auth/session-provider";
import { GlobalDialogHost } from "@/components/ui/global-dialogs";

export const metadata: Metadata = {
  title: {
    default: "GInsurance Platform | Insurance Management Made Simple",
    template: "%s | GInsurance",
  },
  description:
    "Streamline your insurance operations with GInsurance — manage policies, clients, agents, and documents all in one modern platform.",
  metadataBase: new URL("https://bravogi.com"),
  openGraph: {
    title: "GInsurance Platform",
    description:
      "Streamline your insurance operations with GInsurance — manage policies, clients, agents, and documents all in one modern platform.",
    url: "https://bravogi.com",
    siteName: "GInsurance",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GInsurance Platform",
    description:
      "Streamline your insurance operations with GInsurance — manage policies, clients, agents, and documents all in one modern platform.",
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
