import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import {
  getBatchOrThrow,
  setRowSkipped,
  updateRowValues,
} from "@/lib/import/batch-service";

export const runtime = "nodejs";

/**
 * PATCH /api/imports/batches/[batchId]/rows/[rowId]
 *   Body shape — exactly one of:
 *     { values: { [columnId]: string|null } }   // edit cells; null/empty = clear
 *     { skipped: boolean }                       // toggle skip state
 *
 * The row is re-validated immediately after edit so the UI can refresh
 * its error/warning chips without an extra request.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ batchId: string; rowId: string }> },
) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { batchId, rowId } = await params;
    const bId = Number(batchId);
    const rId = Number(rowId);
    if (!Number.isFinite(bId) || !Number.isFinite(rId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const batch = await getBatchOrThrow(bId);
    const isStaff = user.userType === "admin" || user.userType === "internal_staff";
    if (!isStaff && batch.createdBy !== Number(user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      values?: Record<string, unknown>;
      skipped?: boolean;
    };

    if (typeof body.skipped === "boolean") {
      const result = await setRowSkipped(bId, rId, body.skipped);
      return NextResponse.json({ row: result.row, aggregates: result.aggregates });
    }
    if (body.values && typeof body.values === "object") {
      const result = await updateRowValues(bId, rId, body.values);
      return NextResponse.json({
        row: result.row,
        aggregates: result.aggregates,
        summary: result.summary,
      });
    }
    return NextResponse.json(
      { error: "Provide { values } or { skipped }." },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") return NextResponse.json({ error: message }, { status: 401 });
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    if (/read-only|already committed|cannot/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
