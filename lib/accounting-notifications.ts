import { sendEmail } from "@/lib/email";

type InvoiceNotificationInput = {
  recipientEmail: string;
  recipientName?: string;
  invoiceNumber: string;
  entityName: string;
  totalAmount: string;
  currency: string;
  status: string;
  direction: "payable" | "receivable";
  premiumType: string;
  appUrl?: string;
};

type PaymentNotificationInput = {
  recipientEmail: string;
  recipientName?: string;
  invoiceNumber: string;
  paymentAmount: string;
  currency: string;
  action: "submitted" | "verified" | "rejected";
  rejectionNote?: string;
  appUrl?: string;
};

function premiumTypeLabel(type: string): string {
  const map: Record<string, string> = {
    net_premium: "Net Premium",
    agent_premium: "Agent Premium",
    client_premium: "Client Premium",
  };
  return map[type] || type;
}

export async function sendInvoiceCreatedEmail(input: InvoiceNotificationInput) {
  const directionText = input.direction === "payable"
    ? "A new payable invoice has been created"
    : "A new receivable invoice has been created";

  const accountingUrl = input.appUrl ? `${input.appUrl}/dashboard/accounting` : "";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a; margin-bottom: 16px;">Invoice Created</h2>
      <p style="color: #555; font-size: 14px;">${directionText} for <strong>${input.entityName}</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Invoice Number</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; font-weight: 600;">${input.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Premium Type</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px;">${premiumTypeLabel(input.premiumType)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Total Amount</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; font-weight: 600;">${input.currency} ${input.totalAmount}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Status</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px;">${input.status}</td>
        </tr>
      </table>
      ${accountingUrl ? `<p style="margin-top: 16px;"><a href="${accountingUrl}" style="display: inline-block; padding: 8px 16px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-size: 13px;">View in Accounting</a></p>` : ""}
      <p style="color: #999; font-size: 11px; margin-top: 24px;">This is an automated notification from your insurance platform.</p>
    </div>
  `;

  return sendEmail({
    to: input.recipientEmail,
    subject: `Invoice ${input.invoiceNumber} Created — ${input.currency} ${input.totalAmount}`,
    html,
    text: `Invoice ${input.invoiceNumber} created for ${input.entityName}. Amount: ${input.currency} ${input.totalAmount}. Status: ${input.status}.`,
  });
}

export async function sendPaymentStatusEmail(input: PaymentNotificationInput) {
  const actionText = {
    submitted: "A payment has been submitted for review",
    verified: "Your payment has been verified",
    rejected: "Your payment has been rejected",
  }[input.action];

  const statusColor = {
    submitted: "#f59e0b",
    verified: "#10b981",
    rejected: "#ef4444",
  }[input.action];

  const accountingUrl = input.appUrl ? `${input.appUrl}/dashboard/accounting` : "";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a; margin-bottom: 16px;">Payment ${input.action.charAt(0).toUpperCase() + input.action.slice(1)}</h2>
      <p style="color: #555; font-size: 14px;">${actionText} for invoice <strong>${input.invoiceNumber}</strong>.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Invoice</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; font-weight: 600;">${input.invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Payment Amount</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; font-weight: 600;">${input.currency} ${input.paymentAmount}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Status</td>
          <td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px;"><span style="color: ${statusColor}; font-weight: 600;">${input.action.toUpperCase()}</span></td>
        </tr>
        ${input.rejectionNote ? `<tr><td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #888;">Reason</td><td style="padding: 8px 12px; border: 1px solid #e5e5e5; font-size: 13px; color: #ef4444;">${input.rejectionNote}</td></tr>` : ""}
      </table>
      ${accountingUrl ? `<p style="margin-top: 16px;"><a href="${accountingUrl}" style="display: inline-block; padding: 8px 16px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-size: 13px;">View in Accounting</a></p>` : ""}
      <p style="color: #999; font-size: 11px; margin-top: 24px;">This is an automated notification from your insurance platform.</p>
    </div>
  `;

  return sendEmail({
    to: input.recipientEmail,
    subject: `Payment ${input.action} — Invoice ${input.invoiceNumber}`,
    html,
    text: `Payment ${input.action} for invoice ${input.invoiceNumber}. Amount: ${input.currency} ${input.paymentAmount}.${input.rejectionNote ? ` Reason: ${input.rejectionNote}` : ""}`,
  });
}
