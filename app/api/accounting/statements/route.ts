import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import {
  findOrCreateDraftStatement,
  addInvoiceToStatement,
  getStatementForSchedule,
} from "@/lib/statement-management";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const { scheduleId, invoiceIds } = body as {
      scheduleId: number;
      invoiceIds?: number[];
    };

    if (!scheduleId) {
      return NextResponse.json({ error: "scheduleId is required" }, { status: 400 });
    }

    const stmt = await findOrCreateDraftStatement(scheduleId, Number(user.id));

    if (invoiceIds && invoiceIds.length > 0) {
      for (const invId of invoiceIds) {
        await addInvoiceToStatement(stmt.statementId, invId);
      }
    }

    const detail = await getStatementForSchedule(scheduleId);

    return NextResponse.json({
      ...stmt,
      statement: detail,
    }, { status: stmt.created ? 201 : 200 });
  } catch (err) {
    console.error("POST /api/accounting/statements error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const scheduleId = Number(searchParams.get("scheduleId"));

    if (!scheduleId) {
      return NextResponse.json({ error: "scheduleId is required" }, { status: 400 });
    }

    const detail = await getStatementForSchedule(scheduleId);
    return NextResponse.json({ statement: detail });
  } catch (err) {
    console.error("GET /api/accounting/statements error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}
