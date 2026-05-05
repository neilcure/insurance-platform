import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { auditLog, users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { desc, eq, sql, type SQL } from "drizzle-orm";
import { parsePaginationParams } from "@/lib/pagination/types";

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

    if (countOnly) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(eq(auditLog.isRead, false));
      return NextResponse.json({ unreadCount: row?.count ?? 0 });
    }

    const { limit, offset } = parsePaginationParams(url.searchParams, {
      defaultLimit: 30,
      maxLimit: 200,
    });

    const whereExpr: SQL | undefined = unreadOnly
      ? eq(auditLog.isRead, false)
      : undefined;

    const [rows, totalRow] = await Promise.all([
      db
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
        .where(whereExpr)
        .orderBy(desc(auditLog.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(whereExpr),
    ]);

    return NextResponse.json({
      rows,
      total: totalRow[0]?.count ?? 0,
      limit,
      offset,
    });
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
