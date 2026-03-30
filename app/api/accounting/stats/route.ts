import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingInvoices, accountingPayments } from "@/db/schema/accounting";
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
        return NextResponse.json({
          pendingVerification: 0, overdue: 0,
          totalReceivableCents: 0, totalPaidCents: 0, totalOutstandingCents: 0,
          pendingPaymentCount: 0, invoicesByStatus: {},
        });
      }
      conditions.push(inArray(accountingInvoices.organisationId, orgIds));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [pendingResult, overdueResult, receivableSummary, pendingPayments, statusCounts] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` })
        .from(accountingInvoices)
        .where(and(eq(accountingInvoices.status, "submitted"), ...(conditions.length > 0 ? conditions : []))),

      db.select({ count: sql<number>`count(*)::int` })
        .from(accountingInvoices)
        .where(and(eq(accountingInvoices.status, "overdue"), ...(conditions.length > 0 ? conditions : []))),

      db.select({
        totalAmount: sql<number>`coalesce(sum(${accountingInvoices.totalAmountCents}), 0)::int`,
        totalPaid: sql<number>`coalesce(sum(${accountingInvoices.paidAmountCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
        .from(accountingInvoices)
        .where(and(eq(accountingInvoices.direction, "receivable"), ...(conditions.length > 0 ? conditions : []))),

      db.select({ count: sql<number>`count(*)::int` })
        .from(accountingPayments)
        .where(eq(accountingPayments.status, "submitted")),

      db.select({
        status: accountingInvoices.status,
        count: sql<number>`count(*)::int`,
        totalCents: sql<number>`coalesce(sum(${accountingInvoices.totalAmountCents}), 0)::int`,
      })
        .from(accountingInvoices)
        .where(whereClause)
        .groupBy(accountingInvoices.status),
    ]);

    const invoicesByStatus: Record<string, { count: number; totalCents: number }> = {};
    for (const row of statusCounts) {
      invoicesByStatus[row.status] = { count: row.count, totalCents: row.totalCents };
    }

    const receivable = receivableSummary[0];

    return NextResponse.json({
      pendingVerification: pendingResult[0]?.count ?? 0,
      overdue: overdueResult[0]?.count ?? 0,
      totalReceivableCents: receivable?.totalAmount ?? 0,
      totalPaidCents: receivable?.totalPaid ?? 0,
      totalOutstandingCents: (receivable?.totalAmount ?? 0) - (receivable?.totalPaid ?? 0),
      receivableCount: receivable?.count ?? 0,
      pendingPaymentCount: pendingPayments[0]?.count ?? 0,
      invoicesByStatus,
    });
  } catch (err) {
    console.error("GET /api/accounting/stats error:", err);
    return NextResponse.json({
      pendingVerification: 0, overdue: 0,
      totalReceivableCents: 0, totalPaidCents: 0, totalOutstandingCents: 0,
      pendingPaymentCount: 0, invoicesByStatus: {},
    });
  }
}
