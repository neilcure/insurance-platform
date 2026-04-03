export type InvoiceType = "individual" | "statement" | "credit_note";
export type InvoiceDirection = "payable" | "receivable";
export type PremiumType = "net_premium" | "agent_premium" | "client_premium";
export type EntityType = "collaborator" | "agent" | "client";
export type ScheduleFrequency = "weekly" | "monthly";

export type InvoiceStatus = "draft" | "pending" | "partial" | "paid" | "submitted" | "verified" | "overdue" | "cancelled" | "refunded";
export type PaymentStatus = "recorded" | "submitted" | "verified" | "rejected" | "confirmed";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  partial: "Partially Paid",
  paid: "Paid",
  submitted: "Submitted",
  verified: "Verified",
  overdue: "Overdue",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  recorded: "Recorded",
  submitted: "Submitted",
  verified: "Verified",
  rejected: "Rejected",
  confirmed: "Confirmed",
};

export const PREMIUM_TYPE_LABELS: Record<PremiumType, string> = {
  net_premium: "Net Premium",
  agent_premium: "Agent Premium",
  client_premium: "Client Premium",
};

export const DIRECTION_LABELS: Record<InvoiceDirection, string> = {
  payable: "Payable (We Pay)",
  receivable: "Receivable (We Receive)",
};

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  individual: "Individual",
  statement: "Statement",
  credit_note: "Credit Note",
};

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  collaborator: "Collaborator",
  agent: "Agent",
  client: "Client",
};

export const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "e_transfer", label: "E-Transfer" },
  { value: "fps", label: "FPS" },
  { value: "online_payment", label: "Online Payment" },
  { value: "other", label: "Other" },
] as const;

export type PaymentMethod = typeof PAYMENT_METHOD_OPTIONS[number]["value"];

export type DocLifecycleStatus = "generated" | "sent" | "confirmed" | "rejected";

export type DocumentStatusEntry = {
  status: DocLifecycleStatus;
  documentNumber?: string;
  generatedAt?: string;
  sentAt?: string;
  sentTo?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  confirmMethod?: "admin" | "upload";
  confirmNote?: string;
  confirmProofPath?: string;
  confirmProofName?: string;
  rejectedAt?: string;
  rejectionNote?: string;
};

export type DocumentStatusMap = Record<string, DocumentStatusEntry | undefined>;

/**
 * Extended tracking data stored in policy.documentTracking.
 * `_setCodes` maps group names to shared random codes so templates
 * in the same group (e.g. quotation / invoice / receipt) share a number,
 * while templates in different groups (e.g. credit notes) get independent numbers.
 */
export type DocumentTrackingData = DocumentStatusMap & {
  _setCodes?: Record<string, { code: string; year: number }>;
};

export const DOC_LIFECYCLE_LABELS: Record<DocLifecycleStatus, string> = {
  generated: "Generated",
  sent: "Sent",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

export type AccountingInvoiceRow = {
  id: number;
  organisationId: number;
  invoiceNumber: string;
  invoiceType: InvoiceType;
  direction: InvoiceDirection;
  premiumType: PremiumType;
  entityPolicyId: number | null;
  entityType: EntityType;
  entityName: string | null;
  scheduleId: number | null;
  parentInvoiceId: number | null;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  invoiceDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: InvoiceStatus;
  documentStatus: DocumentStatusMap | null;
  notes: string | null;
  verifiedBy: number | null;
  verifiedAt: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  totalGainCents?: number;
  totalNetPremiumCents?: number;
  cancellationDate?: string | null;
  refundReason?: string | null;
};

export type AccountingInvoiceItemRow = {
  id: number;
  invoiceId: number;
  policyId: number;
  policyPremiumId: number | null;
  lineKey: string | null;
  amountCents: number;
  gainCents: number | null;
  netPremiumCents?: number;
  /** Current premium amount from policy_premiums (for drift detection, uses invoice's premiumType column) */
  currentPremiumCents?: number | null;
  /** All premium columns (keyed by DB column name, e.g. netPremiumCents, agentCommissionCents, …) */
  allPremiumCents?: Record<string, number> | null;
  description: string | null;
  createdAt: string;
  policyNumber?: string;
};

export type AccountingPaymentRow = {
  id: number;
  invoiceId: number;
  amountCents: number;
  currency: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  status: PaymentStatus;
  notes: string | null;
  submittedBy: number | null;
  submittedByName?: string | null;
  verifiedBy: number | null;
  verifiedByName?: string | null;
  verifiedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
  updatedAt: string;
  documents?: AccountingDocumentRow[];
};

export type AccountingDocumentRow = {
  id: number;
  invoiceId: number | null;
  paymentId: number | null;
  docType: string;
  fileName: string;
  storedPath: string;
  fileSize: number | null;
  mimeType: string | null;
  uploadedBy: number | null;
  createdAt: string;
};

export type PaymentScheduleRow = {
  id: number;
  organisationId: number;
  entityPolicyId: number | null;
  agentId: number | null;
  clientId: number | null;
  entityType: EntityType;
  entityName: string | null;
  frequency: ScheduleFrequency;
  billingDay: number | null;
  currency: string;
  isActive: boolean;
  notes: string | null;
  lastGeneratedAt: string | null;
  lastPeriodStart: string | null;
  lastPeriodEnd: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
};

export type LineEntityInfo = {
  collaboratorName: string | null;
  insurerName: string | null;
};

export type InvoiceEntityNames = {
  clientName: string | null;
  agentName: string | null;
  collaboratorNames: string[];
  insurerNames: string[];
  perLine: Record<string, LineEntityInfo>;
};

export type PremiumFieldDef = {
  key: string;
  label: string;
  column: string;
  inputType: string;
};

export type InvoiceWithItems = AccountingInvoiceRow & {
  items: AccountingInvoiceItemRow[];
  payments: AccountingPaymentRow[];
  documents: AccountingDocumentRow[];
  childInvoices?: AccountingInvoiceRow[];
  documentStatus: DocumentStatusMap | null;
  entityNames?: InvoiceEntityNames;
  premiumFields?: PremiumFieldDef[];
};
