type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail({ to, subject, html, text }: SendEmailInput): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER;
  const senderName = process.env.BREVO_SENDER_NAME || "No-Reply";

  if (!apiKey || !senderEmail) {
    return { ok: false, error: "Email is not configured (missing BREVO_API_KEY or BREVO_SENDER)" };
  }

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!res.ok) {
      const msg = await res.text();
      return { ok: false, error: msg || "Brevo send failed" };
    }
    return { ok: true };
  } catch (err: unknown) {
    const message = err && typeof err === "object" && "message" in err ? (err as any).message : "Unknown error";
    return { ok: false, error: String(message) };
  }
}

export function getBaseUrlFromRequestUrl(requestUrl: string): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  try {
    const u = new URL(requestUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}


















