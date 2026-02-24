import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { memberships, userInvites, users } from "@/db/schema/core";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

type LogEntry = {
  at: string;
  type: "invite" | "membership" | "status";
  message: string;
  meta?: Record<string, unknown>;
};

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUser();
    const { id } = await context.params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    if (!(me.userType === "admin" || me.userType === "internal_staff" || (me.userType === "agent" && Number(me.id) === userId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const logs: LogEntry[] = [];

    // Invite events
    const invites = await db
      .select({
        createdAt: userInvites.createdAt,
        expiresAt: userInvites.expiresAt,
        usedAt: userInvites.usedAt,
      })
      .from(userInvites)
      .where(eq(userInvites.userId, userId));
    for (const inv of invites) {
      logs.push({
        at: inv.createdAt as string,
        type: "invite",
        message: `Invite sent (expires ${inv.expiresAt ?? "-"})`,
        meta: { expiresAt: inv.expiresAt, usedAt: inv.usedAt },
      });
      if (inv.usedAt) {
        logs.push({
          at: inv.usedAt as string,
          type: "invite",
          message: "Invite accepted",
        });
      }
    }

    // Membership events
    const mems = await db
      .select({
        orgId: memberships.organisationId,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .where(eq(memberships.userId, userId));
    for (const m of mems) {
      logs.push({
        at: m.createdAt as string,
        type: "membership",
        message: `Joined organisation #${m.orgId}`,
        meta: { organisationId: m.orgId },
      });
    }

    // Basic status timestamps
    const [u] = await db
      .select({ createdAt: users.createdAt, updatedAt: users.updatedAt, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (u?.createdAt) {
      logs.push({ at: u.createdAt as string, type: "status", message: "User created", meta: { isActive: u.isActive } });
    }
    if (u?.updatedAt) {
      logs.push({ at: u.updatedAt as string, type: "status", message: "User updated", meta: { isActive: u.isActive } });
    }

    // Sort by time ascending
    logs.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return NextResponse.json(logs, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

