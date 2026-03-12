import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { reminderSchedules, reminderSendLog } from "@/db/schema/reminders";
import { policies } from "@/db/schema/insurance";
import { users, memberships } from "@/db/schema/core";
import { and, eq, sql, count, max } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { appendPolicyAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function canManageReminders(userId: number, userType: string, policyId: number): Promise<boolean> {
  if (userType === "admin" || userType === "internal_staff") return true;

  const rows = await db
    .select({ id: policies.id })
    .from(policies)
    .innerJoin(
      memberships,
      and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, userId)),
    )
    .where(eq(policies.id, policyId))
    .limit(1);
  return rows.length > 0;
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const hasAccess = await canManageReminders(Number(user.id), user.userType, policyId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const creatorAlias = db.select({ id: users.id, email: users.email }).from(users).as("creator");

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
        isActive: reminderSchedules.isActive,
        completedAt: reminderSchedules.completedAt,
        completedReason: reminderSchedules.completedReason,
        createdBy: reminderSchedules.createdBy,
        createdAt: reminderSchedules.createdAt,
        updatedAt: reminderSchedules.updatedAt,
        createdByEmail: creatorAlias.email,
        sendCount: logStats.sendCount,
        lastSentAt: logStats.lastSentAt,
      })
      .from(reminderSchedules)
      .leftJoin(creatorAlias, eq(creatorAlias.id, reminderSchedules.createdBy))
      .leftJoin(logStats, eq(logStats.scheduleId, reminderSchedules.id))
      .where(eq(reminderSchedules.policyId, policyId))
      .orderBy(reminderSchedules.createdAt);

    return NextResponse.json(rows, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Only admins can create reminders" }, { status: 403 });
    }

    const { id: idParam } = await ctx.params;
    const policyId = Number(idParam);
    if (!Number.isFinite(policyId) || policyId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await request.json()) as {
      documentTypeKey?: string;
      recipientEmail?: string;
      intervalDays?: number;
      maxSends?: number | null;
      customMessage?: string;
      sendNow?: boolean;
    };

    if (!body.documentTypeKey?.trim()) {
      return NextResponse.json({ error: "documentTypeKey is required" }, { status: 400 });
    }
    if (!body.recipientEmail?.trim() || !body.recipientEmail.includes("@")) {
      return NextResponse.json({ error: "Valid recipientEmail is required" }, { status: 400 });
    }
    const intervalDays = body.intervalDays ?? 3;
    if (intervalDays < 1 || intervalDays > 90) {
      return NextResponse.json({ error: "intervalDays must be 1-90" }, { status: 400 });
    }

    const [row] = await db
      .insert(reminderSchedules)
      .values({
        policyId,
        documentTypeKey: body.documentTypeKey.trim(),
        recipientEmail: body.recipientEmail.trim(),
        intervalDays,
        maxSends: body.maxSends ?? null,
        customMessage: body.customMessage?.trim() || null,
        createdBy: Number(user.id),
      })
      .returning();

    const userEmail = (user as { email?: string }).email ?? "";
    await appendPolicyAudit(policyId, { id: Number(user.id), email: userEmail }, [
      { key: "reminder_created", from: null, to: `${body.documentTypeKey} → ${body.recipientEmail} every ${intervalDays}d` },
    ]);

    if (body.sendNow) {
      const { sendReminderEmail } = await import("@/lib/reminder-sender");
      await sendReminderEmail(row.id);
    }

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
