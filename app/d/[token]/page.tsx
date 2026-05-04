/**
 * Public document download page — landing target for the
 * `/d/<token>` URLs the WhatsApp Files dialog mints.
 *
 * No login required. The token IS the credential. We render a clean,
 * mobile-first list of files with one tap per download. The page is
 * fully self-contained (no auth header / sidebar) so the recipient
 * never sees our internal app chrome.
 */

import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import { ShareDownloadClient } from "./share-download-client";

export const metadata: Metadata = {
  title: "Documents",
  // Don't index public download pages.
  robots: { index: false, follow: false, nocache: true },
};

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-md">
        <ShareDownloadClient token={token} />
      </div>
    </main>
  );
}
