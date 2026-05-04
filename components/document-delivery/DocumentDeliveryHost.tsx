"use client";

/**
 * Mounts the Email Files + WhatsApp Files dialogs ONCE per app and
 * drives them from the imperative `useDeliverDocuments()` hook.
 *
 * Place ONLY one of these in the dashboard layout. Adding a second
 * (or local) instance breaks the "one dialog at a time" UX and
 * doubles the PDF-template fetch cost.
 *
 * Pattern is intentional copy of `<GlobalDialogHost />` in
 * `@/components/ui/global-dialogs` — same lifecycle, same single-host
 * rule. Future channels (SMS, Telegram, in-app share) plug in here.
 */

import * as React from "react";

import { EmailUploadedFilesDialog } from "@/components/policies/EmailUploadedFilesDialog";
import { WhatsAppUploadedFilesDialog } from "@/components/policies/WhatsAppUploadedFilesDialog";
import { useDocumentDeliveryState } from "@/lib/document-delivery/delivery-context";

export function DocumentDeliveryHost() {
  const { request, close } = useDocumentDeliveryState();

  const isEmail = request?.channel === "email";
  const isWhatsApp = request?.channel === "whatsapp";

  // Build initialSelectedIds from `request.initialFiles`. The
  // dialogs accept a flat list of upload IDs; PDF template selection
  // remains user-driven for now (a future iteration could honour
  // `initialFiles` of kind "pdfTemplate" too).
  const initialSelectedIds = React.useMemo(() => {
    if (!request?.initialFiles) return undefined;
    return request.initialFiles
      .filter((f) => f.kind === "upload")
      .map((f) => f.id);
  }, [request?.initialFiles]);

  return (
    <>
      <EmailUploadedFilesDialog
        open={isEmail}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        policyId={request?.policyId ?? 0}
        policyNumber={request?.policyNumber}
        defaultEmail={request?.recipient?.email ?? undefined}
        initialSelectedIds={initialSelectedIds}
        groups={isEmail ? request.groups : []}
      />
      <WhatsAppUploadedFilesDialog
        open={isWhatsApp}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        policyId={request?.policyId ?? 0}
        policyNumber={request?.policyNumber}
        defaultPhone={request?.recipient?.phone ?? undefined}
        defaultRecipientName={request?.recipient?.name ?? undefined}
        initialSelectedIds={initialSelectedIds}
        groups={isWhatsApp ? request.groups : []}
      />
    </>
  );
}
