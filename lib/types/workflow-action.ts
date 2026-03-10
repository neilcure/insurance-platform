export type WorkflowActionType =
  | "note"
  | "email"
  | "status_change"
  | "duplicate"
  | "export"
  | "webhook"
  | "custom";

export type WorkflowActionMeta = {
  type: WorkflowActionType;
  /** Restrict to specific flows (empty = available for all) */
  flows?: string[];
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
