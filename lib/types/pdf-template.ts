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

  source:
    | "policy"
    | "insured"
    | "contactinfo"
    | "package"
    | "agent"
    | "client"
    | "organisation"
    | "static";
  packageName?: string;
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
};

export type PdfTemplateMeta = {
  filePath: string;
  pages: PdfPageInfo[];
  fields: PdfFieldMapping[];
  flows?: string[];
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
  { value: "agent", label: "Agent", description: "Agent name, email, user number" },
  { value: "client", label: "Client", description: "Client number, display name, primary ID, etc." },
  { value: "organisation", label: "Organisation / Insurer", description: "Company name, contact, address" },
  { value: "static", label: "Static Text", description: "Fixed text value" },
];

export const FIELD_KEY_HINTS: Record<PdfFieldMapping["source"], string[]> = {
  policy: ["policyNumber", "createdAt"],
  insured: [
    "fullName", "lastName", "firstName", "idNumber", "companyName",
    "brNumber", "organisationName", "hasDrivingLicense", "insuredType",
  ],
  contactinfo: [
    "name", "personalTitle", "tel", "mobile", "fax", "email",
    "flatNumber", "floorNumber", "blockNumber", "blockName",
    "streetNumber", "streetName", "propertyName", "districtName", "area",
  ],
  package: [],
  agent: ["name", "email", "userNumber"],
  client: ["clientNumber", "category", "displayName", "primaryId", "contactPhone"],
  organisation: [
    "name", "contactName", "contactEmail", "contactPhone",
    "flatNumber", "floorNumber", "blockNumber", "blockName",
    "streetNumber", "streetName", "propertyName", "districtName", "area",
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
