import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { reminderSchedules } from "@/db/schema/reminders";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { appendPolicyAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; reminderId: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Only admins can update reminders" }, { status: 403 });
    }

    const { reminderId: rIdParam } = await ctx.params;
    const reminderId = Number(rIdParam);
    if (!Number.isFinite(reminderId) || reminderId <= 0) {
      return NextResponse.json({ error: "Invalid reminder id" }, { status: 400 });
    }

    const body = (await request.json()) as {
      intervalDays?: number;
      maxSends?: number | null;
      customMessage?: string | null;
      isActive?: boolean;
    };

    const [existing] = await db
      .select()
      .from(reminderSchedules)
      .where(eq(reminderSchedules.id, reminderId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.intervalDays !== undefined) {
      if (body.intervalDays < 1 || body.intervalDays > 90) {
        return NextResponse.json({ error: "intervalDays must be 1-90" }, { status: 400 });
      }
      updateData.intervalDays = body.intervalDays;
    }
    if (body.maxSends !== undefined) updateData.maxSends = body.maxSends;
    if (body.customMessage !== undefined) updateData.customMessage = body.customMessage;
    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
      if (!body.isActive && !existing.completedAt) {
        updateData.completedAt = new Date().toISOString();
        updateData.completedReason = "paused_by_admin";
      }
      if (body.isActive && existing.completedReason === "paused_by_admin") {
        updateData.completedAt = null;
        updateData.completedReason = null;
      }
    }

    const [updated] = await db
      .update(reminderSchedules)
      .set(updateData)
      .where(eq(reminderSchedules.id, reminderId))
      .returning();

    const userEmail = (user as { email?: string }).email ?? "";
    const auditChanges = [];
    if (body.isActive === false) {
      auditChanges.push({ key: "reminder_paused", from: existing.documentTypeKey, to: existing.recipientEmail });
    } else if (body.isActive === true) {
      auditChanges.push({ key: "reminder_resumed", from: existing.documentTypeKey, to: existing.recipientEmail });
    } else {
      auditChanges.push({ key: "reminder_updated", from: existing.documentTypeKey, to: existing.recipientEmail });
    }
    await appendPolicyAudit(existing.policyId, { id: Number(user.id), email: userEmail }, auditChanges);

    return NextResponse.json(updated, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _: Request,
  ctx: { params: Promise<{ id: string; reminderId: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Only admins can delete reminders" }, { status: 403 });
    }

    const { reminderId: rIdParam } = await ctx.params;
    const reminderId = Number(rIdParam);
    if (!Number.isFinite(reminderId) || reminderId <= 0) {
      return NextResponse.json({ error: "Invalid reminder id" }, { status: 400 });
    }

    const [existing] = await db
      .select({
        id: reminderSchedules.id,
        policyId: reminderSchedules.policyId,
        documentTypeKey: reminderSchedules.documentTypeKey,
        recipientEmail: reminderSchedules.recipientEmail,
      })
      .from(reminderSchedules)
      .where(eq(reminderSchedules.id, reminderId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
    }

    await db.delete(reminderSchedules).where(eq(reminderSchedules.id, reminderId));

    const userEmail = (user as { email?: string }).email ?? "";
    await appendPolicyAudit(existing.policyId, { id: Number(user.id), email: userEmail }, [
      { key: "reminder_deleted", from: `${existing.documentTypeKey} → ${existing.recipientEmail}`, to: null },
    ]);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
