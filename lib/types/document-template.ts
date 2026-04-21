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
  source: "insured" | "contactinfo" | "package" | "policy" | "agent" | "accounting" | "client" | "organisation" | "statement";
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
  /** Client-specific status visibility (fallback to showWhenStatus when empty) */
  showWhenStatusClient?: string[];
  /** Agent-specific status visibility (fallback to showWhenStatus when empty) */
  showWhenStatusAgent?: string[];
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
  /** When true, this single template generates both a Client copy and an Agent copy (with "(A)" suffix). */
  enableAgentCopy?: boolean;
  /** Where this template should be listed/rendered */
  showOn?: ("policy" | "agent")[];
  /** When true, hides the document if no statement exists for this audience (requires Payment Schedule) */
  requiresStatement?: boolean;
  /** Restrict to a specific accounting line key (e.g. "tpo", "od"). Only shows when the policy has a premium line with this key. Empty = all. */
  accountingLineKey?: string;
  header: {
    title: string;
    /** "sm" | "md" | "lg" | "xl" — controls the rendered title font-size (default "lg") */
    titleSize?: "sm" | "md" | "lg" | "xl";
    subtitle?: string;
    /** "xs" | "sm" | "md" — controls the rendered subtitle font-size (default "sm") */
    subtitleSize?: "xs" | "sm" | "md";
    /** Tailwind-compatible hex color for the subtitle text (default "#737373") */
    subtitleColor?: string;
    showDate?: boolean;
    showPolicyNumber?: boolean;
  };
  sections: TemplateSection[];
  footer?: {
    text?: string;
    showSignature?: boolean;
  };
};

export function resolveDocumentTemplateShowOn(
  meta: DocumentTemplateMeta | null | undefined,
): ("policy" | "agent")[] {
  const configured = meta?.showOn?.filter((v): v is "policy" | "agent" => v === "policy" || v === "agent") ?? [];
  let result: ("policy" | "agent")[];
  if (configured.length > 0) {
    result = [...new Set(configured)];
  } else if (meta?.type === "statement" && meta?.isAgentTemplate) {
    result = ["agent"];
  } else {
    result = ["policy"];
  }
  // Agent statements must list under Agent Details even if Show On was saved as policy-only.
  if (meta?.type === "statement" && meta?.isAgentTemplate && !result.includes("agent")) {
    result = [...result, "agent"];
  }
  // Client workflow docs (invoice, receipt, …) stay on Policy Details unless the template is agent-only.
  if (!meta?.isAgentTemplate && meta?.type !== "statement" && !result.includes("policy")) {
    result = [...result, "policy"];
  }
  return [...new Set(result)];
}

export type DocumentTemplateRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  meta: DocumentTemplateMeta | null;
};
