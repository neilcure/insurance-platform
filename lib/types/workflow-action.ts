import type { Locale, TranslationBlock } from "@/lib/i18n";

export type WorkflowActionType =
  | "note"
  | "email"
  | "status_change"
  | "duplicate"
  | "export"
  | "webhook"
  | "send_document"
  | "custom";

export type WorkflowActionMeta = {
  type: WorkflowActionType;
  /** Restrict to specific flows (empty = available for all) */
  flows?: string[];
  /** Only show this action when the policy status matches one of these values */
  showWhenStatus?: string[];
  /** Icon name from lucide-react */
  icon?: string;
  /** Description shown below the action title */
  description?: string;
  /** For email type: default subject template */
  emailSubject?: string;
  /** For email type: default body template (supports {{policyNumber}}, {{createdAt}}) */
  emailBody?: string;
  /** For status_change type: target status value */
  targetStatus?: string;
  /** For webhook type: URL to POST to */
  webhookUrl?: string;
  /** For export type: format */
  exportFormat?: "json" | "csv";
  /** For custom type: button label */
  buttonLabel?: string;
  /** Whether this action needs a text input from the user */
  requiresInput?: boolean;
  /** Placeholder for the input field */
  inputPlaceholder?: string;
  /** Label for the input field */
  inputLabel?: string;
  /** For send_document type: PDF template ID to generate & send */
  documentTemplateId?: number;
  /** For send_document type: document template label for display */
  documentTemplateLabel?: string;
  /** Locale-specific overrides edited via `<TranslationsEditor>`. Falls back to English on missing entries. */
  translations?: Partial<Record<Locale, TranslationBlock>>;
};

export type WorkflowActionRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  meta: WorkflowActionMeta | null;
};
