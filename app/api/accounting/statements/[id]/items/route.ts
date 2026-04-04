import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import {
  addInvoiceToStatement,
  removeItemFromStatement,
  markItemPaidIndividually,
  reactivateItem,
} from "@/lib/statement-management";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const statementId = Number(id);
    const body = await request.json();
    const { invoiceId } = body as { invoiceId: number };

    if (!invoiceId) {
      return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });
    }

    const result = await addInvoiceToStatement(statementId, invoiceId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("POST /api/accounting/statements/[id]/items error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireUser();
    const { id } = await ctx.params;
    const statementId = Number(id);
    const body = await request.json();
    const { itemId, action } = body as {
      itemId: number;
      action: "paid_individually" | "reactivate" | "remove";
    };

    if (!itemId || !action) {
      return NextResponse.json({ error: "itemId and action are required" }, { status: 400 });
    }

    switch (action) {
      case "paid_individually":
        await markItemPaidIndividually(statementId, itemId);
        break;
      case "reactivate":
        await reactivateItem(statementId, itemId);
        break;
      case "remove":
        await removeItemFromStatement(statementId, itemId);
        break;
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/accounting/statements/[id]/items error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 },
    );
  }
}
