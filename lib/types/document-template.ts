export type TemplateFieldMapping = {
  key: string;
  label: string;
  format?: "text" | "currency" | "date" | "boolean" | "number";
  currencyCode?: string;
};

export type TemplateSection = {
  id: string;
  title: string;
  /** Where to pull data from in the snapshot */
  source: "insured" | "contactinfo" | "package" | "policy" | "agent" | "accounting" | "client" | "organisation" | "custom";
  /** Required when source is "package" */
  packageName?: string;
  /** Which audience sees this section: "all" (default), "client", or "agent" */
  audience?: "all" | "client" | "agent";
  fields: TemplateFieldMapping[];
};

export type DocumentTemplateMeta = {
  type: "quotation" | "invoice" | "receipt" | "certificate" | "letter" | "custom";
  /** Restrict to specific flows (empty = available for all flows) */
  flows?: string[];
  /** Only show this document when policy status matches (empty = always) */
  showWhenStatus?: string[];
  /** Restrict to specific insurance companies by their policy record IDs (empty = all) */
  insurerPolicyIds?: number[];
  /** Whether this document requires client confirmation after sending (default: true for quotation, false for others) */
  requiresConfirmation?: boolean;
  /** Prefix for auto-generated document numbers (e.g. "QUO", "INV", "REC") */
  documentPrefix?: string;
  /** Mark as agent template — auto-appends (A) to document numbers */
  isAgentTemplate?: boolean;
  header: {
    title: string;
    subtitle?: string;
    showDate?: boolean;
    showPolicyNumber?: boolean;
  };
  sections: TemplateSection[];
  footer?: {
    text?: string;
    showSignature?: boolean;
  };
};

export type DocumentTemplateRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  meta: DocumentTemplateMeta | null;
};
