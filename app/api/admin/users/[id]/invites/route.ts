import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { userInvites, users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq, gt, isNull } from "drizzle-orm";
import crypto from "crypto";
import { sendEmail, getBaseUrlFromRequestUrl } from "@/lib/email";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Invalidate any active invites for this user
    const nowIso = new Date().toISOString();
    await db
      .update(userInvites)
      .set({ usedAt: nowIso })
      .where(
        and(
          eq(userInvites.userId, userId),
          isNull(userInvites.usedAt),
          gt(userInvites.expiresAt, nowIso)
        )
      );

    // Issue new invite
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await db.insert(userInvites).values({
      userId,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
    });

    const isDev = process.env.NODE_ENV !== "production";
    const baseUrl = getBaseUrlFromRequestUrl(request.url);
    const inviteLink = `${baseUrl}/invite/${token}`;

    // Send invite email (best-effort)
    const emailResult = await sendEmail({
      to: user.email,
      subject: "Your invite has been re-issued",
      html: `<p>Hello${user.name ? ` ${user.name}` : ""},</p>
<p>Your invite link has been re-issued. Click the link below to set your password and activate your account:</p>
<p><a href="${inviteLink}">${inviteLink}</a></p>
<p>This link will expire in 48 hours.</p>`,
      text: `Your invite link has been re-issued. Use this link within 48 hours: ${inviteLink}`,
    });
    if (!emailResult.ok) {
      console.error("Brevo re-issue email send failed:", emailResult.error);
    }

    return NextResponse.json(isDev ? { inviteLink, emailSent: emailResult.ok, emailError: emailResult.ok ? undefined : emailResult.error } : { message: "Invite re-issued", emailSent: emailResult.ok }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}


