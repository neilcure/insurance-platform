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
  source: "insured" | "contactinfo" | "package" | "policy" | "agent" | "accounting" | "client" | "organisation" | "statement" | "static" | "custom";
  /** Required when source is "package" */
  packageName?: string;
  /** Which audience sees this section: "all" (default), "client", or "agent" */
  audience?: "all" | "client" | "agent";
  /** Render fields as a table (one row per item) instead of label–value pairs */
  layout?: "default" | "table";
  fields: TemplateFieldMapping[];
};

export type DocumentTemplateMeta = {
  type: "quotation" | "invoice" | "receipt" | "certificate" | "letter" | "credit_note" | "debit_note" | "endorsement" | "statement" | "custom";
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
  /** Group name for shared document numbering — templates in the same group share one random code */
  documentSetGroup?: string;
  /** Mark as agent template — auto-appends (A) to document numbers */
  isAgentTemplate?: boolean;
  /** When true, hides the document if no statement exists for this audience (requires Payment Schedule) */
  requiresStatement?: boolean;
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
