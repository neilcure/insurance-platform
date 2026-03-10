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
  source: "insured" | "contactinfo" | "package" | "policy" | "agent" | "custom";
  /** Required when source is "package" */
  packageName?: string;
  fields: TemplateFieldMapping[];
};

export type DocumentTemplateMeta = {
  type: "quotation" | "invoice" | "receipt" | "certificate" | "letter" | "custom";
  /** Restrict to specific flows (empty = available for all flows) */
  flows?: string[];
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
