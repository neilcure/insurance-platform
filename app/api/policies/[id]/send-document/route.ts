import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json();
    const email = String(body?.email ?? "").trim();
    const subject = String(body?.subject ?? "").trim();
    const htmlContent = String(body?.htmlContent ?? "").trim();
    const plainText = String(body?.plainText ?? "").trim();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email address is required" }, { status: 400 });
    }
    if (!subject) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }
    if (!htmlContent && !plainText) {
      return NextResponse.json({ error: "Document content is required" }, { status: 400 });
    }

    const senderName = (user as unknown as { name?: string }).name || (user as unknown as { email?: string }).email || "Insurance Platform";

    const html = `
      <div style="font-family: system-ui, sans-serif; max-width: 700px; margin: 0 auto;">
        ${htmlContent || `<pre style="white-space: pre-wrap; font-family: system-ui, sans-serif;">${plainText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`}
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #888; font-size: 12px;">
          Sent by ${senderName} via Insurance Platform.
        </p>
      </div>
    `;

    const result = await sendEmail({
      to: email,
      subject,
      html,
      text: plainText || undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
