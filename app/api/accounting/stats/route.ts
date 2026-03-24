import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices } from "@/db/schema/accounting";
import { memberships } from "@/db/schema/core";
import { eq, sql, and, inArray } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();

    const conditions: ReturnType<typeof eq>[] = [];

    if (!(user.userType === "admin" || user.userType === "internal_staff" || user.userType === "accounting")) {
      const userMemberships = await db
        .select({ orgId: memberships.organisationId })
        .from(memberships)
        .where(eq(memberships.userId, Number(user.id)));
      const orgIds = userMemberships.map((m) => m.orgId);
      if (orgIds.length === 0) {
        return NextResponse.json({ pendingVerification: 0, overdue: 0 });
      }
      conditions.push(inArray(accountingInvoices.organisationId, orgIds));
    }

    const pendingResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accountingInvoices)
      .where(and(eq(accountingInvoices.status, "submitted"), ...(conditions.length > 0 ? conditions : [])));

    const overdueResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(accountingInvoices)
      .where(and(eq(accountingInvoices.status, "overdue"), ...(conditions.length > 0 ? conditions : [])));

    return NextResponse.json({
      pendingVerification: pendingResult[0]?.count ?? 0,
      overdue: overdueResult[0]?.count ?? 0,
    });
  } catch (err) {
    console.error("GET /api/accounting/stats error:", err);
    return NextResponse.json({ pendingVerification: 0, overdue: 0 });
  }
}
