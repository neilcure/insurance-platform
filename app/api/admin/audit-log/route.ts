import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { auditLog, users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const me = await requireUser();
    if (!["admin", "internal_staff"].includes(me.userType)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unread") === "true";
    const countOnly = url.searchParams.get("count") === "true";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

    if (countOnly) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(eq(auditLog.isRead, false));
      return NextResponse.json({ unreadCount: row?.count ?? 0 });
    }

    let query = db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        userType: auditLog.userType,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        changes: auditLog.changes,
        isRead: auditLog.isRead,
        createdAt: auditLog.createdAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.userId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    if (unreadOnly) {
      query = query.where(eq(auditLog.isRead, false)) as any;
    }

    const rows = await query;
    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const me = await requireUser();
    if (!["admin", "internal_staff"].includes(me.userType)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { ids, markAll } = body as { ids?: number[]; markAll?: boolean };

    if (markAll) {
      await db.update(auditLog).set({ isRead: true }).where(eq(auditLog.isRead, false));
    } else if (Array.isArray(ids) && ids.length > 0) {
      for (const id of ids) {
        await db.update(auditLog).set({ isRead: true }).where(eq(auditLog.id, id));
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
