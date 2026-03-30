import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { generateStatementInvoice } from "@/lib/accounting-statements";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const scheduleId = Number(id);
    const body = await request.json();
    const { periodStart, periodEnd, flowFilter } = body;
    const result = await generateStatementInvoice({
      scheduleId,
      userId: Number(user.id),
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      flowFilter: flowFilter || null,
    });

    if (result.skipped) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/schedules/[id]/generate error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
