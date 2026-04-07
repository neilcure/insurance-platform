import { db } from "@/db/client";
import { appSettings } from "@/db/schema/core";
import { policies } from "@/db/schema/insurance";
import { eq } from "drizzle-orm";
import { sendEmail } from "@/lib/email";

type NotificationSettings = {
  enabled: boolean;
  recipientEmail?: string;
};

async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "upload_notification"))
      .limit(1);
    if (!row?.value) return { enabled: false };
    const val = row.value as Record<string, unknown>;
    return {
      enabled: !!val.enabled,
      recipientEmail: (val.recipientEmail as string) || undefined,
    };
  } catch {
    return { enabled: false };
  }
}

/**
 * Sends an email notification to the configured admin when an agent or client
 * uploads a document. Only sends if the opt-in setting is enabled.
 */
export async function notifyAdminOfUpload(
  policyId: number,
  documentTypeKey: string,
  fileName: string,
  uploadedBy: string,
): Promise<void> {
  const settings = await getNotificationSettings();
  if (!settings.enabled || !settings.recipientEmail) return;

  let policyNumber = String(policyId);
  try {
    const [p] = await db
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);
    if (p) policyNumber = p.policyNumber;
  } catch {}

  const typeLabel = documentTypeKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "") || "";

  await sendEmail({
    to: settings.recipientEmail,
    subject: `Document uploaded: ${typeLabel} — Policy ${policyNumber}`,
    html: `
      <div style="font-family: sans-serif; max-width: 500px;">
        <h3 style="margin: 0 0 12px;">Document Upload Notification</h3>
        <table style="font-size: 14px; border-collapse: collapse;">
          <tr><td style="padding: 4px 12px 4px 0; color: #666;">Policy</td><td><strong>${policyNumber}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #666;">Type</td><td>${typeLabel}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #666;">File</td><td>${fileName}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #666;">Uploaded by</td><td>${uploadedBy}</td></tr>
        </table>
        <p style="margin-top: 16px; font-size: 13px; color: #666;">
          This document requires your review.
          ${appUrl ? `<a href="${appUrl}/dashboard/flows/policyset?open=${policyId}">View Policy</a>` : ""}
        </p>
      </div>
    `,
  });
}
