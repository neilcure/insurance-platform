import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import crypto from "crypto";
import { db } from "@/db/client";
import { userInvites, users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { getBaseUrlFromRequestUrl, sendEmail } from "@/lib/email";

const STAFF_TYPES = new Set(["agent", "accounting", "internal_staff"]);

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, userType: users.userType, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!STAFF_TYPES.has(String(user.userType))) {
      return NextResponse.json({ error: "Setup link is only supported for staff accounts." }, { status: 400 });
    }
    if (user.isActive) {
      return NextResponse.json({ error: "This account is already active." }, { status: 409 });
    }

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

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await db.insert(userInvites).values({
      userId,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
    });

    const baseUrl = getBaseUrlFromRequestUrl(request.url);
    const setupLink = `${baseUrl}/invite/${token}`;
    const isDev = process.env.NODE_ENV !== "production";

    const emailResult = await sendEmail({
      to: user.email,
      subject: "Set up your GInsurance account",
      html: `<p>Hello${user.name ? ` ${user.name}` : ""},</p>
<p>Your account is ready. Click the link below to set your password and activate your account:</p>
<p><a href="${setupLink}">${setupLink}</a></p>
<p>This link will expire in 48 hours.</p>`,
      text: `Set your password and activate your account within 48 hours: ${setupLink}`,
    });
    if (!emailResult.ok) {
      console.error("Setup-link email send failed:", emailResult.error);
    }

    return NextResponse.json(
      isDev
        ? { setupLink, emailSent: emailResult.ok, emailError: emailResult.ok ? undefined : emailResult.error }
        : { message: "Setup link generated", emailSent: emailResult.ok },
      { status: 201 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
