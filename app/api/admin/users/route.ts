import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users, userInvites, memberships, clients } from "@/db/schema/core";
import { cars } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq, isNull, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendEmail, getBaseUrlFromRequestUrl } from "@/lib/email";
import { generateNextUserNumber } from "@/lib/user-number";
import { getInsuredDisplayName, getInsuredType, getInsuredPrimaryId, getContactField } from "@/lib/field-resolver";

/**
 * Creates a clients table entry from a clientSet flow record (cars row).
 * Returns the new client ID, or null if it fails.
 */
async function createClientFromFlow(carId: number, createdBy: number): Promise<number | null> {
  const [carRow] = await db
    .select({ extraAttributes: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.id, carId))
    .limit(1);

  if (!carRow) return null;
  const ea = carRow.extraAttributes as Record<string, unknown> | null;
  if (!ea || ea.flowKey !== "clientSet") return null;

  const snap = (ea.insuredSnapshot ?? {}) as Record<string, unknown>;
  const category = getInsuredType(snap) || "personal";
  const displayName = getInsuredDisplayName(snap) || "Client";
  const primaryId = getInsuredPrimaryId(snap);

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(snap)) {
    if (k.startsWith("_")) continue;
    extra[k] = v;
  }

  const phone = getContactField(snap, "mobile") || getContactField(snap, "tel");

  const [newClient] = await db
    .insert(clients)
    .values({
      clientNumber: `C-FLOW-${carId}`,
      category,
      displayName,
      primaryId,
      contactPhone: phone || null,
      extraAttributes: extra,
      createdBy,
    })
    .returning({ id: clients.id });

  // Fix clientNumber to standard format
  if (newClient) {
    const paddedId = String(newClient.id).padStart(6, "0");
    await db.update(clients).set({ clientNumber: `C${paddedId}` }).where(eq(clients.id, newClient.id));
  }

  return newClient?.id ?? null;
}

type PostBody = {
  email: string;
  mobile?: string;
  name?: string;
  userType: "admin" | "agent" | "accounting" | "internal_staff" | "direct_client";
  clientId?: number;
  flowCarId?: number;
  creationMode?: "invite" | "account_only";
  agentProfile?: {
    accountType?: "personal" | "company";
    companyName?: string;
    primaryId?: string;
  };
};

export async function POST(request: Request) {
  try {
    const me = await requireUser();
    if (!(me.userType === "admin" || me.userType === "agent" || me.userType === "internal_staff")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as PostBody;
    const email = (body.email ?? "").trim().toLowerCase();
    const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
    const accountType = body.agentProfile?.accountType === "company" ? "company" : "personal";
    const companyName = typeof body.agentProfile?.companyName === "string" ? body.agentProfile.companyName.trim() : "";
    const primaryId = typeof body.agentProfile?.primaryId === "string" ? body.agentProfile.primaryId.trim() : "";
    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }
    // For direct_client: resolve the client record (from table or flow)
    let resolvedClientId: number | null = null;
    if (body.userType === "direct_client") {
      if (me.userType !== "admin") {
        return NextResponse.json({ error: "Only admin can create client accounts." }, { status: 403 });
      }
      if (!body.clientId && !body.flowCarId) {
        return NextResponse.json({ error: "A client record must be selected for direct_client accounts." }, { status: 400 });
      }

      if (body.flowCarId) {
        // Create clients table entry from flow record
        resolvedClientId = await createClientFromFlow(Number(body.flowCarId), Number(me.id));
        if (!resolvedClientId) {
          return NextResponse.json({ error: "Failed to resolve client from flow record." }, { status: 400 });
        }
      } else {
        resolvedClientId = Number(body.clientId);
        const [existingClient] = await db
          .select({ id: clients.id, userId: clients.userId })
          .from(clients)
          .where(eq(clients.id, resolvedClientId))
          .limit(1);
        if (!existingClient) {
          return NextResponse.json({ error: "Client record not found." }, { status: 404 });
        }
        if (existingClient.userId) {
          return NextResponse.json({ error: "This client record is already linked to a user account." }, { status: 409 });
        }
      }
    }

    if (me.userType !== "admin" && (body.userType === "admin" || body.userType === "agent")) {
      return NextResponse.json({ error: "Only admin can assign admin/agent roles." }, { status: 403 });
    }
    const creationMode = body.creationMode === "account_only" ? "account_only" : "invite";
    if (body.userType === "direct_client" && creationMode === "account_only") {
      return NextResponse.json({ error: "Direct client accounts must be created via invite flow." }, { status: 400 });
    }
    const profileMeta =
      body.userType === "agent"
        ? {
            accountType,
            companyName: companyName || null,
            primaryId: primaryId || null,
          }
        : null;

    // Create a random strong passphrase hash so the account can't be used
    const tempPassword = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    let createdUser;
    try {
      const [u] = await db
        .insert(users)
        .values({
          email,
          mobile: mobile || null,
          name: body.name,
          profileMeta,
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

    // Link user to client record for direct_client
    if (body.userType === "direct_client" && resolvedClientId) {
      try {
        await db
          .update(clients)
          .set({ userId: createdUser.id })
          .where(and(eq(clients.id, resolvedClientId), isNull(clients.userId)));
      } catch (err) {
        console.error("Failed to link client record:", err);
      }
    }

    // Auto-assign userNumber for non-direct_client types
    try {
      if (createdUser?.userType && ["admin", "agent", "accounting", "internal_staff"].includes(createdUser.userType as any)) {
        const userNumber = await generateNextUserNumber(createdUser.userType as any, orgId);
        await db.update(users).set({ userNumber }).where(and(eq(users.id, createdUser.id)));
        createdUser.userNumber = userNumber as any;
      }
    } catch (err) {
      console.error("Failed to generate userNumber:", err);
    }

    const isDev = process.env.NODE_ENV !== "production";
    if (creationMode === "account_only") {
      return NextResponse.json(
        {
          id: createdUser.id,
          email: createdUser.email,
          name: createdUser.name,
          userType: createdUser.userType,
          isActive: createdUser.isActive,
          creationMode,
          message: "Account created without invite",
        },
        { status: 201 }
      );
    }

    // Invite mode: create one-time invite token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await db.insert(userInvites).values({
      userId: createdUser.id,
      tokenHash,
      expiresAt: expiresAt.toISOString() as unknown as any,
    });

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
            creationMode,
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




