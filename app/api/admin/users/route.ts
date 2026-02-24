import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users, userInvites, memberships } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendEmail, getBaseUrlFromRequestUrl } from "@/lib/email";
import { generateNextUserNumber } from "@/lib/user-number";

type PostBody = {
  email: string;
  name?: string;
  userType: "admin" | "agent" | "accounting" | "internal_staff";
};

export async function POST(request: Request) {
  try {
    const me = await requireUser();
    if (!(me.userType === "admin" || me.userType === "agent" || me.userType === "internal_staff")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as any;
    const email = (body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }
    if (body.userType === "direct_client" || body.userType === "service_provider") {
      return NextResponse.json({ error: "This type is not managed as a User. Choose Admin, Agent, Accounting or Internal Staff." }, { status: 400 });
    }
    if (me.userType !== "admin" && (body.userType === "admin" || body.userType === "agent")) {
      return NextResponse.json({ error: "Only admin can assign admin/agent roles." }, { status: 403 });
    }

    // Create a random strong passphrase hash so the account can't be used
    const tempPassword = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    let createdUser;
    try {
      const [u] = await db
        .insert(users)
        .values({
          email,
          name: body.name,
          userType: body.userType,
          passwordHash,
          isActive: false,
        })
        .returning();
      createdUser = u;
    } catch (err: any) {
      // Unique violation on email
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }

    // If inviter has an organisation, add the new user to that organisation
    let orgId: number | undefined;
    try {
      const orgRows = await db.select({ organisationId: memberships.organisationId }).from(memberships).where(eq(memberships.userId, Number(me.id))).limit(1);
      orgId = Number(orgRows?.[0]?.organisationId);
      if (Number.isFinite(orgId) && orgId! > 0) {
        try {
          await db.insert(memberships).values({ userId: createdUser.id, organisationId: orgId!, role: "member" });
        } catch {}
      }
    } catch {}

    // Auto-assign userNumber for non-direct_client types
    try {
      if (createdUser?.userType && ["admin", "agent", "accounting", "internal_staff"].includes(createdUser.userType as any)) {
        const userNumber = await generateNextUserNumber(createdUser.userType as any, orgId);
        await db.update(users).set({ userNumber }).where(and(eq(users.id, createdUser.id)));
        createdUser.userNumber = userNumber as any;
      }
    } catch (err) {
      // Best-effort: do not fail invite creation if numbering fails
      console.error("Failed to generate userNumber:", err);
    }

    // Create invite
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await db.insert(userInvites).values({
      userId: createdUser.id,
      tokenHash,
      expiresAt: expiresAt.toISOString() as unknown as any,
    });

    const isDev = process.env.NODE_ENV !== "production";
    const baseUrl = getBaseUrlFromRequestUrl(request.url);
    const inviteLink = `${baseUrl}/invite/${token}`;

    // Send invite email (best-effort)
    const emailResult = await sendEmail({
      to: createdUser.email,
      subject: "You're invited to GInsurance Platform",
      html: `<p>Hello${createdUser.name ? ` ${createdUser.name}` : ""},</p>
<p>You have been invited to join the platform. Click the link below to set your password and activate your account:</p>
<p><a href="${inviteLink}">${inviteLink}</a></p>
<p>This link will expire in 48 hours.</p>`,
      text: `You have been invited to join the platform. Use this link within 48 hours: ${inviteLink}`,
    });
    if (!emailResult.ok) {
      console.error("Brevo invite email send failed:", emailResult.error);
    }

    return NextResponse.json(
      isDev
        ? {
            id: createdUser.id,
            email: createdUser.email,
            name: createdUser.name,
            userType: createdUser.userType,
            isActive: createdUser.isActive,
            inviteLink,
            emailSent: emailResult.ok,
            emailError: emailResult.ok ? undefined : emailResult.error,
          }
        : { message: "Invite created", emailSent: emailResult.ok },
      { status: 201 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}




