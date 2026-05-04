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

  // Split `request.initialFiles` into upload IDs vs. PDF template
  // IDs so the dialog can pre-check both kinds independently. Per-
  // template share buttons (DocumentsTab "Send via WhatsApp" icon)
  // pass a single `{ kind: "pdfTemplate", id }` here so the dialog
  // opens with that template already selected and 0 uploads chosen.
  const initialSelectedIds = React.useMemo(() => {
    if (!request?.initialFiles) return undefined;
    const ids = request.initialFiles
      .filter((f) => f.kind === "upload")
      .map((f) => f.id);
    return ids.length > 0 ? ids : undefined;
  }, [request?.initialFiles]);

  const initialSelectedTplIds = React.useMemo(() => {
    if (!request?.initialFiles) return undefined;
    const ids = request.initialFiles
      .filter((f) => f.kind === "pdfTemplate")
      .map((f) => f.id);
    return ids.length > 0 ? ids : undefined;
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
        initialSelectedTplIds={initialSelectedTplIds}
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
        initialSelectedTplIds={initialSelectedTplIds}
        groups={isWhatsApp ? request.groups : []}
      />
    </>
  );
}
