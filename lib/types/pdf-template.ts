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
    | "statement"
    | "static";
  packageName?: string;
  /** For accounting source: which premium line to pull from (e.g. "tpo", "main") */
  lineKey?: string;
  fieldKey: string;
  staticValue?: string;

  format?: "text" | "currency" | "date" | "boolean" | "number" | "match";
  currencyCode?: string;
  dateFormat?: string;
  prefix?: string;
  suffix?: string;
  /**
   * For `format = "boolean"`: text shown when the resolved value is truthy.
   * Defaults to "Yes". Set to "✓" (and `falseValue` to "") to draw a tick
   * inside a checkbox on a proposal form.
   *
   * For `format = "match"`: text shown when the resolved value equals
   * `matchValue`. Defaults to "✓".
   */
  trueValue?: string;
  /**
   * For `format = "boolean"`: text shown when the resolved value is falsy.
   * Defaults to "No".
   *
   * For `format = "match"`: text shown when the resolved value does NOT
   * equal `matchValue`. Defaults to "" (empty / blank).
   */
  falseValue?: string;
  /**
   * For `format = "match"` only: the value to compare the resolved snapshot
   * value against (case-insensitive). When the field's resolved value
   * equals this string, render `trueValue` (default "✓"); otherwise render
   * `falseValue` (default "").
   *
   * Useful for single-select / multi-choice answers on proposal forms,
   * e.g. an `occupation` snapshot field with `matchValue = "Transportation"`
   * placed inside the "Transportation" checkbox.
   */
  matchValue?: string;
  /** Which audience sees this field: "all" (default), "client", or "agent" */
  audience?: "all" | "client" | "agent";
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

/**
 * Interactive AcroForm checkbox the client can tick after the PDF is
 * generated. Rendered by `pdf-lib`'s `form.createCheckBox()` so any
 * standard PDF viewer (Adobe, Edge, Chrome, in-app preview) can toggle
 * it. Position/size in PDF user-space points (same coordinate system
 * as `PdfDrawing`).
 */
export type PdfCheckbox = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional human-readable label shown in the editor only */
  label?: string;
  /** Tick the box by default in the generated PDF */
  defaultChecked?: boolean;
  /**
   * When true, the AcroForm widget is rendered without its own border
   * or background — useful when the underlying PDF already has a
   * printed box outline that the checkbox should sit inside.
   */
  borderless?: boolean;
  sectionId?: string;
};

/**
 * One option (clickable spot) inside a PdfRadioGroup. Position/size
 * in PDF user-space points.
 */
export type PdfRadioOption = {
  id: string;
  /** The value stored in the PDF when this option is selected */
  value: string;
  /** Editor-only display label (e.g. "Yes" / "No") */
  label?: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Interactive AcroForm radio group — the client picks exactly one
 * option. Maps to `pdf-lib`'s `form.createRadioGroup(name)` plus
 * `radioGroup.addOptionToPage(value, page, ...)` per option.
 */
export type PdfRadioGroup = {
  id: string;
  /** Form field name used inside the PDF (must be unique per template) */
  name: string;
  /** Editor-only display label for the whole question */
  label?: string;
  /** Pre-select an option by its `value` */
  defaultValue?: string;
  /** Render each option as a borderless widget */
  borderless?: boolean;
  options: PdfRadioOption[];
  sectionId?: string;
};

/**
 * Interactive AcroForm text input the recipient can type into after the
 * PDF is generated. Rendered by `pdf-lib`'s `form.createTextField()` so
 * any standard PDF viewer can fill it in. Position/size in PDF user-
 * space points (same coordinate system as `PdfDrawing` / `PdfCheckbox`).
 *
 * Use this for blanks the policy data can't fill — driver rows the
 * recipient must enter by hand, additional remarks, signature dates
 * the client writes in themselves, etc.
 */
export type PdfTextInput = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pre-fill text in the generated PDF (recipient can overwrite) */
  defaultValue?: string;
  /** Editor-only display label so admins remember what each blank is for */
  label?: string;
  /** Placeholder shown when the field is empty (PDF viewer support varies) */
  placeholder?: string;
  fontSize?: number;
  /** Allow line breaks inside the field */
  multiline?: boolean;
  sectionId?: string;
};

export type PdfTemplateMeta = {
  filePath: string;
  pages: PdfPageInfo[];
  fields: PdfFieldMapping[];
  sections?: PdfTemplateSection[];
  images?: PdfImageMapping[];
  drawings?: PdfDrawing[];
  checkboxes?: PdfCheckbox[];
  radioGroups?: PdfRadioGroup[];
  textInputs?: PdfTextInput[];
  /** Semantic document type for business logic (invoice creation, status advancement) */
  type?: "quotation" | "invoice" | "receipt" | "certificate" | "letter" | "credit_note" | "debit_note" | "endorsement" | "custom";
  flows?: string[];
  /** Only show this template when policy status matches (empty = always) */
  showWhenStatus?: string[];
  /** Restrict to specific insurance companies by their policy record IDs (empty = all) */
  insurerPolicyIds?: number[];
  /** Whether this document requires client confirmation after sending (default: true) */
  requiresConfirmation?: boolean;
  /** Prefix for auto-generated document numbers (e.g. "QUO", "INV", "REC") */
  documentPrefix?: string;
  /** Group name for shared document numbering — templates in the same group share one random code */
  documentSetGroup?: string;
  /** Mark as agent template — auto-appends (A) to document numbers */
  isAgentTemplate?: boolean;
  /** Where this template should be listed/rendered */
  showOn?: ("policy" | "agent")[];
  /** Restrict to a specific accounting line key (e.g. "tpo", "od"). Only shows when the policy has a premium line with this key. Empty = all. */
  accountingLineKey?: string;
  /**
   * For repeatable package fields (drivers, beneficiaries, etc.) — how
   * many indexed slots ("Driver 1", "Driver 2", …) to expose in the
   * field picker for this template. Defaults to 4. Each slot becomes
   * pickable child fields with snapshot keys like
   * `drivers__r0__firstName`. Slots without data resolve to empty
   * strings, so unfilled rows render blank on the generated PDF.
   */
  repeatableSlots?: number;
  description?: string;
};

/** Default number of indexed slots for repeatable package fields. */
export const DEFAULT_REPEATABLE_SLOTS = 4;

export function resolvePdfTemplateShowOn(
  meta: PdfTemplateMeta | null | undefined,
): ("policy" | "agent")[] {
  const configured = meta?.showOn?.filter((v): v is "policy" | "agent" => v === "policy" || v === "agent") ?? [];
  let result: ("policy" | "agent")[];
  if (configured.length > 0) {
    result = [...new Set(configured)];
  } else {
    result = ["policy"];
  }
  if (!meta?.isAgentTemplate && !result.includes("policy")) {
    result = [...result, "policy"];
  }
  return [...new Set(result)];
}

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
  { value: "statement", label: "Statement", description: "Statement number, items, totals, entity — for statement documents" },
  { value: "agent", label: "Agent", description: "Agent name, email, user number" },
  { value: "client", label: "Client", description: "Client number, display name, primary ID, etc." },
  { value: "organisation", label: "Organisation / Insurer", description: "Company name, contact, address (policy-level)" },
  { value: "static", label: "Static Text", description: "Fixed text value" },
];

export const FIELD_KEY_HINTS: Record<PdfFieldMapping["source"], string[]> = {
  policy: [
    // ONLY actual columns of the `policies` table. Everything else
    // (effectiveDate, expiryDate, endorsement*, status, etc.) lives in a
    // package snapshot — pick it from the relevant Package source instead.
    "policyNumber",
    "createdAt",
    "flowKey",
    // Resolved from the `documentTracking` JSON column on the policy:
    "documentNumber", "documentStatus", "documentSentTo", "documentSentAt",
  ],
  insured: [
    "displayName", "primaryId", "insuredType",
  ],
  contactinfo: [
    "fullAddress",
  ],
  package: [],
  accounting: [],
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
  statement: [
    "statementNumber", "statementDate", "statementStatus",
    "entityName", "entityType",
    "activeTotal", "paidIndividuallyTotal", "totalAmountCents",
    "paidAmountCents", "outstandingTotal", "agentPaidTotal",
    "commissionTotal", "creditToAgent", "currency",
    "policyPremiumTotal", "endorsementPremiumTotal", "creditTotal",
    "itemCount", "activeItemCount", "paidIndividuallyItemCount",
    "itemDescriptions", "itemAmounts", "itemStatuses", "itemPaymentBadges",
  ],
  static: [],
};

export const FORMAT_OPTIONS: { value: NonNullable<PdfFieldMapping["format"]>; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / No (or ✓ tick)" },
  { value: "match", label: "Match (✓ if equals)" },
  { value: "number", label: "Number" },
];
