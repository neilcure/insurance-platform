import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { and, eq, sql } from "drizzle-orm";
import { getCompletedSetupUserIds } from "@/lib/auth/user-setup-status";
import { parsePaginationParams } from "@/lib/pagination/types";

type AgentRow = {
  id: number;
  userNumber: string | null;
  email: string;
  mobile: string | null;
  name: string | null;
  isActive: boolean;
  hasCompletedSetup: boolean;
  accountType: "personal" | "company" | null;
  companyName: string | null;
  primaryId: string | null;
  createdAt: string;
};

function mapProfileMeta(profileMeta: Record<string, unknown> | null | undefined) {
  const accountType =
    profileMeta?.accountType === "company" || profileMeta?.accountType === "personal"
      ? profileMeta.accountType
      : null;
  const companyName =
    typeof profileMeta?.companyName === "string" && profileMeta.companyName.trim()
      ? profileMeta.companyName.trim()
      : null;
  const primaryId =
    typeof profileMeta?.primaryId === "string" && profileMeta.primaryId.trim()
      ? profileMeta.primaryId.trim()
      : null;
  return { accountType, companyName, primaryId } as const;
}

export async function GET(request: Request) {
  try {
    const me = await requireUser();
    const url = new URL(request.url);
    const { limit: qLimit, offset: qOffset } = parsePaginationParams(url.searchParams, {
      defaultLimit: 50,
      maxLimit: 500,
    });

    if (me.userType === "admin" || me.userType === "internal_staff") {
      const whereExpr = eq(users.userType, "agent" as any);
      const [raw, totalRow] = await Promise.all([
        db
          .select({
            id: users.id,
            userNumber: users.userNumber,
            email: users.email,
            mobile: users.mobile,
            name: users.name,
            profileMeta: users.profileMeta,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(whereExpr)
          .orderBy(users.createdAt)
          .limit(qLimit)
          .offset(qOffset),
        db.select({ count: sql<number>`count(*)::int` }).from(users).where(whereExpr),
      ]);
      const completedSet = await getCompletedSetupUserIds(raw.map((r) => r.id));
      const rows: AgentRow[] = raw.map((r) => {
        const meta = mapProfileMeta(r.profileMeta);
        return {
          id: r.id,
          userNumber: r.userNumber,
          email: r.email,
          mobile: r.mobile,
          name: r.name,
          isActive: r.isActive,
          hasCompletedSetup: completedSet.has(r.id),
          accountType: meta.accountType,
          companyName: meta.companyName,
          primaryId: meta.primaryId,
          createdAt: r.createdAt,
        };
      });
      return NextResponse.json(
        { rows, total: totalRow[0]?.count ?? rows.length, limit: qLimit, offset: qOffset },
        { status: 200 },
      );
    }
    if (me.userType === "agent") {
      const whereExpr = and(eq(users.userType, "agent" as any), eq(users.id, Number(me.id)));
      const [raw, totalRow] = await Promise.all([
        db
          .select({
            id: users.id,
            userNumber: users.userNumber,
            email: users.email,
            mobile: users.mobile,
            name: users.name,
            profileMeta: users.profileMeta,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(whereExpr),
        db.select({ count: sql<number>`count(*)::int` }).from(users).where(whereExpr),
      ]);
      const completedSet = await getCompletedSetupUserIds(raw.map((r) => r.id));
      const rows: AgentRow[] = raw.map((r) => {
        const meta = mapProfileMeta(r.profileMeta);
        return {
          id: r.id,
          userNumber: r.userNumber,
          email: r.email,
          mobile: r.mobile,
          name: r.name,
          isActive: r.isActive,
          hasCompletedSetup: completedSet.has(r.id),
          accountType: meta.accountType,
          companyName: meta.companyName,
          primaryId: meta.primaryId,
          createdAt: r.createdAt,
        };
      });
      return NextResponse.json(
        { rows, total: totalRow[0]?.count ?? rows.length, limit: qLimit, offset: qOffset },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { rows: [], total: 0, limit: qLimit, offset: qOffset },
      { status: 200 },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
