export type ReminderScheduleRow = {
  id: number;
  policyId: number;
  documentTypeKey: string;
  channel: string;
  recipientEmail: string;
  intervalDays: number;
  maxSends: number | null;
  customMessage: string | null;
  isActive: boolean;
  completedAt: string | null;
  completedReason: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  /** Joined fields */
  createdByEmail?: string;
  sendCount?: number;
  lastSentAt?: string | null;
};

export type ReminderSendLogRow = {
  id: number;
  scheduleId: number;
  channel: string;
  recipientEmail: string;
  status: string;
  errorMessage: string | null;
  sentAt: string;
};
