import { notFound } from "next/navigation";
import { getSigningSession, isSessionOpenable } from "@/lib/signing-sessions";
import { SignPageClient } from "./sign-page-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public sign page. Renders the document the recipient was emailed
 * and lets them sign with one of three methods (draw / type /
 * accept). The page deliberately:
 *  - is unauthed: the unguessable token in the URL IS the auth.
 *  - lives outside the app shell (no sidebar / header) so the
 *    recipient sees a focused signing surface, similar to a
 *    DocuSign envelope page.
 *  - is server-rendered for the load — the session existence /
 *    expiry / already-signed check happens server-side so we don't
 *    flash a "loading…" skeleton to invalid links.
 */
export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await getSigningSession(token);
  if (!session) {
    notFound();
  }

  const alreadySigned = !!session.signedAt;
  const declined = !alreadySigned && !!session.declinedAt;
  const expired = !alreadySigned && !declined && !isSessionOpenable(session);

  return (
    <SignPageClient
      token={session.token}
      documentLabel={session.documentLabel}
      subject={session.subject}
      recipientName={session.recipientName}
      recipientEmail={session.recipientEmail}
      pdfUrl={`/api/sign/${session.token}/pdf`}
      signedPdfUrl={
        session.signedPdfStoredName
          ? `/api/sign/${session.token}/signed.pdf`
          : null
      }
      initialState={
        alreadySigned
          ? "already_signed"
          : declined
            ? "declined"
            : expired
              ? "expired"
              : "open"
      }
      signedAt={session.signedAt}
      declinedAt={session.declinedAt}
      declineReason={session.declineReason}
    />
  );
}
