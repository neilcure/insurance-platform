export type UploadDocumentTypeMeta = {
  description?: string;
  /**
   * Who provides the document.
   * - "customer" (default): client / agent uploads, admin verifies. Reminders apply.
   * - "admin": admin uploads to provide the file to the client / agent.
   *   Clients / agents can only view and download. No reminder.
   */
  uploadSource?: "customer" | "admin";
  /** Accepted MIME patterns, e.g. ["image/*", "application/pdf"] */
  acceptedTypes?: string[];
  /** Max file size in megabytes */
  maxSizeMB?: number;
  /** Whether this document is mandatory */
  required?: boolean;
  /** Restrict to specific flows (empty = all) */
  flows?: string[];
  /** Only show this upload requirement when policy status matches (empty = always) */
  showWhenStatus?: string[];
  /** Restrict to policies linked to specific insurance company records (empty = all) */
  insurerPolicyIds?: number[];
  /**
   * Restrict which signed-in user_type values see this requirement in Workflow.
   * Empty / omitted = visible to everyone with policy access (defense-in-depth on
   * downloads still enforced per document routes).
   */
  visibleToUserTypes?: string[];
  /** Restrict to specific insured types: "personal", "company" (empty = all) */
  insuredTypes?: string[];
  /** Only show when policy has NCB (No Claims Bonus) */
  requireNcb?: boolean;
  /** Show payment detail fields (method, amount, reference) on upload — creates an accounting_payments record */
  requirePaymentDetails?: boolean;
  /** Restrict to a specific accounting line key (e.g. "tpo", "od"). Only shows when the policy has a premium line with this key. Empty = all. */
  accountingLineKey?: string;
};

export type UploadDocumentTypeRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  meta: UploadDocumentTypeMeta | null;
};

/** `awaiting_office` = configured as admin-provided (`uploadSource: "admin"`) but no file yet — not an outstanding client/agent task */
export type DocumentStatus = "outstanding" | "awaiting_office" | "uploaded" | "verified" | "rejected";

export type PolicyDocumentRow = {
  id: number;
  policyId: number;
  documentTypeKey: string;
  fileName: string;
  storedPath: string;
  fileSize: number | null;
  mimeType: string | null;
  status: string;
  uploadedBy: number | null;
  uploadedByRole: string;
  verifiedBy: number | null;
  verifiedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
  /** Joined from users table */
  uploadedByEmail?: string;
  verifiedByEmail?: string;
};

export type PolicyPaymentRecord = {
  amountCents: number;
  paymentMethod: string | null;
  paymentDate: string | null;
  referenceNumber: string | null;
  status: string;
  createdAt: string;
  payer?: "client" | "agent" | "client_to_agent" | null;
  direction?: "receivable" | "payable" | string;
  entityType?: "client" | "agent" | string | null;
};

export type PremiumBreakdown = {
  clientPremiumCents: number;
  agentPremiumCents: number;
  agentName?: string;
};

export type DocumentRequirement = {
  typeKey: string;
  label: string;
  meta: UploadDocumentTypeMeta | null;
  displayStatus: DocumentStatus;
  uploads: PolicyDocumentRow[];
  payments?: PolicyPaymentRecord[];
  premiumBreakdown?: PremiumBreakdown;
};
