import { db } from "@/db/client";
import { reminderSchedules, reminderSendLog } from "@/db/schema/reminders";
import { policyDocuments } from "@/db/schema/documents";
import { policies } from "@/db/schema/insurance";
import { cars } from "@/db/schema/insurance";
import { and, eq, count, max, isNull, sql } from "drizzle-orm";
import { sendEmail, getBaseUrlFromRequestUrl } from "@/lib/email";

type DueSchedule = {
  id: number;
  policyId: number;
  documentTypeKey: string;
  channel: string;
  recipientEmail: string;
  intervalDays: number;
  maxSends: number | null;
  customMessage: string | null;
  policyNumber: string;
  sendCount: number;
  lastSentAt: string | null;
};

export async function getDueReminders(): Promise<DueSchedule[]> {
  const logStats = db
    .select({
      scheduleId: reminderSendLog.scheduleId,
      sendCount: count(reminderSendLog.id).as("send_count"),
      lastSentAt: max(reminderSendLog.sentAt).as("last_sent_at"),
    })
    .from(reminderSendLog)
    .groupBy(reminderSendLog.scheduleId)
    .as("log_stats");

  const rows = await db
    .select({
      id: reminderSchedules.id,
      policyId: reminderSchedules.policyId,
      documentTypeKey: reminderSchedules.documentTypeKey,
      channel: reminderSchedules.channel,
      recipientEmail: reminderSchedules.recipientEmail,
      intervalDays: reminderSchedules.intervalDays,
      maxSends: reminderSchedules.maxSends,
      customMessage: reminderSchedules.customMessage,
      policyNumber: policies.policyNumber,
      sendCount: logStats.sendCount,
      lastSentAt: logStats.lastSentAt,
    })
    .from(reminderSchedules)
    .innerJoin(policies, eq(policies.id, reminderSchedules.policyId))
    .leftJoin(logStats, eq(logStats.scheduleId, reminderSchedules.id))
    .where(
      and(
        eq(reminderSchedules.isActive, true),
        isNull(reminderSchedules.completedAt),
      ),
    );

  const now = Date.now();
  return rows.filter((r) => {
    const sendCount = Number(r.sendCount ?? 0);
    if (r.maxSends && sendCount >= r.maxSends) return false;

    if (!r.lastSentAt) return true;
    const lastSent = new Date(r.lastSentAt).getTime();
    const intervalMs = r.intervalDays * 24 * 60 * 60 * 1000;
    return now - lastSent >= intervalMs;
  }).map((r) => ({ ...r, sendCount: Number(r.sendCount ?? 0) }));
}

export async function checkAndAutoComplete(policyId: number, documentTypeKey: string): Promise<void> {
  const verified = await db
    .select({ id: policyDocuments.id })
    .from(policyDocuments)
    .where(
      and(
        eq(policyDocuments.policyId, policyId),
        eq(policyDocuments.documentTypeKey, documentTypeKey),
        eq(policyDocuments.status, "verified"),
      ),
    )
    .limit(1);

  if (verified.length > 0) {
    await db
      .update(reminderSchedules)
      .set({
        isActive: false,
        completedAt: new Date().toISOString(),
        completedReason: "document_verified",
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(reminderSchedules.policyId, policyId),
          eq(reminderSchedules.documentTypeKey, documentTypeKey),
          eq(reminderSchedules.isActive, true),
          isNull(reminderSchedules.completedAt),
        ),
      );
  }
}

export async function sendReminderEmail(
  scheduleId: number,
  baseUrl?: string,
): Promise<{ ok: boolean; error?: string }> {
  const [schedule] = await db
    .select({
      id: reminderSchedules.id,
      policyId: reminderSchedules.policyId,
      documentTypeKey: reminderSchedules.documentTypeKey,
      recipientEmail: reminderSchedules.recipientEmail,
      customMessage: reminderSchedules.customMessage,
      isActive: reminderSchedules.isActive,
      completedAt: reminderSchedules.completedAt,
    })
    .from(reminderSchedules)
    .where(eq(reminderSchedules.id, scheduleId))
    .limit(1);

  if (!schedule || !schedule.isActive || schedule.completedAt) {
    return { ok: false, error: "Schedule inactive or completed" };
  }

  const [policy] = await db
    .select({ policyNumber: policies.policyNumber })
    .from(policies)
    .where(eq(policies.id, schedule.policyId))
    .limit(1);

  if (!policy) {
    return { ok: false, error: "Policy not found" };
  }

  const policyUrl = baseUrl
    ? `${baseUrl}/dashboard/policies?policyId=${schedule.policyId}`
    : "#";

  const docLabel = schedule.documentTypeKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const customNote = schedule.customMessage
    ? `<p style="margin: 12px 0; padding: 12px; background: #f5f5f5; border-radius: 6px; font-style: italic;">${schedule.customMessage}</p>`
    : "";

  const result = await sendEmail({
    to: schedule.recipientEmail,
    subject: `Reminder: Outstanding document for Policy ${policy.policyNumber}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Document Reminder</h2>
        <p>This is a reminder that the following document is still outstanding for Policy <strong>${policy.policyNumber}</strong>:</p>
        <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-weight: 600;">Document</td>
            <td style="padding: 8px; border: 1px solid #e5e5e5;">${docLabel}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-weight: 600;">Policy #</td>
            <td style="padding: 8px; border: 1px solid #e5e5e5; font-family: monospace;">${policy.policyNumber}</td>
          </tr>
        </table>
        ${customNote}
        <p>Please upload the required document at your earliest convenience.</p>
        <p>
          <a href="${policyUrl}" style="display: inline-block; padding: 10px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">
            Upload Document
          </a>
        </p>
        <p style="color: #888; font-size: 12px; margin-top: 24px;">
          This is an automated reminder from the insurance platform. You will continue to receive reminders until the document is uploaded and verified.
        </p>
      </div>
    `,
    text: `Reminder: Document "${docLabel}" is outstanding for Policy ${policy.policyNumber}. Please upload it at: ${policyUrl}`,
  });

  await db.insert(reminderSendLog).values({
    scheduleId: schedule.id,
    channel: "email",
    recipientEmail: schedule.recipientEmail,
    status: result.ok ? "sent" : "failed",
    errorMessage: result.ok ? null : (result.error ?? "Unknown error"),
  });

  return result;
}
