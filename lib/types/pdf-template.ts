export type PdfTemplateSection = {
  id: string;
  name: string;
  color: string;
};

export const SECTION_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];

export type PdfFieldMapping = {
  id: string;
  label: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  fontColor?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;

  sectionId?: string;

  source:
    | "policy"
    | "insured"
    | "contactinfo"
    | "package"
    | "agent"
    | "client"
    | "organisation"
    | "accounting"
    | "invoice"
    | "static";
  packageName?: string;
  /** For accounting source: which premium line to pull from (e.g. "tpo", "main") */
  lineKey?: string;
  fieldKey: string;
  staticValue?: string;

  format?: "text" | "currency" | "date" | "boolean" | "number";
  currencyCode?: string;
  dateFormat?: string;
  prefix?: string;
  suffix?: string;
};

export type PdfPageInfo = {
  width: number;
  height: number;
  /** "pdf" (default) = page from uploaded PDF, "blank" = added blank page */
  type?: "pdf" | "blank";
};

export type PdfImageMapping = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Stored file name in pdf_template_files */
  storedName: string;
  label?: string;
  sectionId?: string;
};

export type PdfDrawing = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  strokeWidth?: number;
  sectionId?: string;
};

export type PdfTemplateMeta = {
  filePath: string;
  pages: PdfPageInfo[];
  fields: PdfFieldMapping[];
  sections?: PdfTemplateSection[];
  images?: PdfImageMapping[];
  drawings?: PdfDrawing[];
  flows?: string[];
  /** Only show this template when policy status matches (empty = always) */
  showWhenStatus?: string[];
  description?: string;
};

export type PdfTemplateRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  meta: PdfTemplateMeta | null;
};

export const PDF_TEMPLATE_GROUP_KEY = "pdf_merge_templates";

export const DATA_SOURCE_OPTIONS: {
  value: PdfFieldMapping["source"];
  label: string;
  description: string;
}[] = [
  { value: "policy", label: "Policy", description: "Policy number, created date, etc." },
  { value: "insured", label: "Insured (Snapshot)", description: "Insured name, ID, etc. from policy snapshot" },
  { value: "contactinfo", label: "Contact Info (Snapshot)", description: "Phone, address, etc. from policy snapshot" },
  { value: "package", label: "Package (Snapshot)", description: "Any package field from policy snapshot" },
  { value: "accounting", label: "Accounting (Premiums)", description: "Premium amounts, insurer/collaborator per line" },
  { value: "invoice", label: "Invoice", description: "Invoice number, dates, amounts, status, entity" },
  { value: "agent", label: "Agent", description: "Agent name, email, user number" },
  { value: "client", label: "Client", description: "Client number, display name, primary ID, etc." },
  { value: "organisation", label: "Organisation / Insurer", description: "Company name, contact, address (policy-level)" },
  { value: "static", label: "Static Text", description: "Fixed text value" },
];

export const FIELD_KEY_HINTS: Record<PdfFieldMapping["source"], string[]> = {
  policy: ["policyNumber", "createdAt"],
  insured: [
    "displayName", "primaryId",
    "fullName", "lastName", "firstName", "idNumber", "companyName",
    "brNumber", "organisationName", "hasDrivingLicense", "insuredType",
  ],
  contactinfo: [
    "fullAddress",
    "name", "personalTitle", "tel", "mobile", "fax", "email",
    "flatNumber", "floorNumber", "blockNumber", "blockName",
    "streetNumber", "streetName", "propertyName", "districtName", "area",
  ],
  package: [],
  accounting: [
    "grossPremium", "netPremium", "clientPremium", "agentCommission",
    "creditPremium", "levy", "stampDuty", "discount",
    "commissionRate", "currency", "margin", "lineLabel",
    "insurerName", "insurerContactName", "insurerContactEmail", "insurerContactPhone",
    "insurerAddress",
    "collaboratorName",
  ],
  agent: ["name", "email", "userNumber"],
  client: ["clientNumber", "category", "displayName", "primaryId", "contactPhone"],
  organisation: [
    "fullAddress",
    "name", "contactName", "contactEmail", "contactPhone",
    "flatNumber", "floorNumber", "blockNumber", "blockName",
    "streetNumber", "streetName", "propertyName", "districtName", "area",
  ],
  invoice: [
    "invoiceNumber", "invoiceDate", "dueDate", "totalAmount", "paidAmount",
    "remainingAmount", "status", "entityName", "entityType", "premiumType",
    "direction", "currency", "invoiceType", "periodStart", "periodEnd", "notes",
    "cancellationDate", "refundReason", "parentInvoiceNumber",
  ],
  static: [],
};

export const FORMAT_OPTIONS: { value: NonNullable<PdfFieldMapping["format"]>; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No" },
  { value: "number", label: "Number" },
];
