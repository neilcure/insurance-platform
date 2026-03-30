import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { accountingPaymentSchedules } from "@/db/schema/accounting";
import { and, eq } from "drizzle-orm";
import { generateStatementInvoice, getDuePeriodForSchedule } from "@/lib/accounting-statements";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      const token = authHeader?.replace("Bearer ", "").trim();
      if (token !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const activeSchedules = await db
      .select()
      .from(accountingPaymentSchedules)
      .where(and(eq(accountingPaymentSchedules.isActive, true)));

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const schedule of activeSchedules) {
      const duePeriod = getDuePeriodForSchedule(schedule);
      if (!duePeriod) {
        skipped++;
        results.push({ scheduleId: schedule.id, skipped: true, reason: "Not due yet" });
        continue;
      }

      try {
        const result = await generateStatementInvoice({
          scheduleId: schedule.id,
          userId: schedule.createdBy ?? null,
          periodStart: duePeriod.periodStart,
          periodEnd: duePeriod.periodEnd,
          markScheduleGenerated: true,
        });

        if (result.skipped) {
          skipped++;
          results.push({ scheduleId: schedule.id, skipped: true, reason: result.reason });
          continue;
        }
        if (!result.statement) {
          skipped++;
          results.push({ scheduleId: schedule.id, skipped: true, reason: "No statement created" });
          continue;
        }

        generated++;
        results.push({
          scheduleId: schedule.id,
          invoiceId: result.statement.id,
          invoiceNumber: result.statement.invoiceNumber,
          itemCount: result.itemCount,
          periodStart: duePeriod.periodStart,
          periodEnd: duePeriod.periodEnd,
        });
      } catch (error) {
        failed++;
        results.push({
          scheduleId: schedule.id,
          failed: true,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      processed: activeSchedules.length,
      generated,
      skipped,
      failed,
      results,
    });
  } catch (err) {
    console.error("Cron accounting-statements error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
