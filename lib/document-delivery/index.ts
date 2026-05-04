/**
 * Document-delivery barrel.
 *
 * Import everything via `@/lib/document-delivery`:
 *
 *   import {
 *     resolveDefaultRecipientFromExtra,
 *     usePolicyVisiblePdfTemplates,
 *     type DeliveryFile,
 *   } from "@/lib/document-delivery";
 *
 * See `.cursor/rules/document-delivery.mdc` for the contract.
 */

export {
  getDefaultEmailFromInsured,
  getDefaultPhoneFromInsured,
  getDefaultRecipientNameFromInsured,
  resolveDefaultRecipientFromExtra,
} from "./recipient";

export {
  filterPolicyVisibleTemplates,
  usePolicyVisiblePdfTemplates,
} from "./pdf-templates-loader";

export type {
  DeliveryChannel,
  DeliveryDocGroup,
  DeliveryFile,
  DeliveryPdfTemplate,
  DeliveryRecipient,
  DeliveryRequest,
} from "./types";

export {
  DocumentDeliveryProvider,
  useDeliverDocuments,
} from "./delivery-context";
