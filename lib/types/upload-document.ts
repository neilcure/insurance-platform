export type UploadDocumentTypeMeta = {
  description?: string;
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
  /** Restrict to specific insured types: "personal", "company" (empty = all) */
  insuredTypes?: string[];
  /** Only show when policy has NCB (No Claims Bonus) */
  requireNcb?: boolean;
  /** Show payment detail fields (method, amount, reference) on upload — creates an accounting_payments record */
  requirePaymentDetails?: boolean;
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

export type DocumentStatus = "outstanding" | "uploaded" | "verified" | "rejected";

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
