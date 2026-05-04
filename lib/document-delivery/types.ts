/**
 * Shared types for the document-delivery system.
 *
 * Goal: a SINGLE place that describes "send these files via this
 * channel to this recipient". Replaces the ad-hoc shapes scattered
 * across `EmailUploadedFilesDialog`, `WhatsAppUploadedFilesDialog`,
 * `DocumentsTab.handleEmail/handleWhatsApp`, and the per-row icon
 * handlers.
 *
 * The contract is intentionally narrow: a `DeliveryFile` is either
 * an existing upload (DB row) or a PDF template that gets generated
 * on demand. Anything that ships a file in this codebase reduces to
 * one of those two kinds.
 */

import type { PolicyDocumentRow } from "@/lib/types/upload-document";

export type DeliveryFile =
  /** An already-uploaded file from `policy_documents`. */
  | { kind: "upload"; id: number }
  /** A PDF mail-merge template that will be regenerated from current
   *  policy data at delivery time. `id` is the `form_options.id`. */
  | { kind: "pdfTemplate"; id: number };

/** Optional pre-fill payload — the dialog will fall back to the
 *  recipient resolved from the policy snapshot when fields are
 *  omitted. */
export type DeliveryRecipient = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
};

export type DeliveryChannel = "email" | "whatsapp";

/** Group descriptor for the multi-select picker. Both dialogs use
 *  the same shape so they can share the picker UI. */
export type DeliveryDocGroup = {
  typeKey: string;
  label: string;
  uploads: PolicyDocumentRow[];
};

/** Parsed PDF template row available for selection in the dialog. */
export type DeliveryPdfTemplate = {
  id: number;
  label: string;
};

/** Imperative request shape for `useDeliverDocuments()`. The hook is
 *  added in Commit B; the type lives here so Commit A stays purely
 *  about extraction. */
export type DeliveryRequest = {
  channel: DeliveryChannel;
  policyId: number;
  policyNumber?: string;
  /** Pre-checked items. Falls back to "all uploads" when omitted. */
  initialFiles?: DeliveryFile[];
  groups: DeliveryDocGroup[];
  recipient?: DeliveryRecipient;
};
