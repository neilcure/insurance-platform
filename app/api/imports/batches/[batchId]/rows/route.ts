import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { getBatchOrThrow, getBatchRows, bulkSkipRows } from "@/lib/import/batch-service";
import type { ImportBatchRow } from "@/db/schema/imports";

export const runtime = "nodejs";

/**
 * GET /api/imports/batches/[batchId]/rows?status=pending,failed&limit=100&offset=0
 *   Lists rows in excelRow order. Filter by status via comma-separated list.
 *
 * POST /api/imports/batches/[batchId]/rows
 *   { action: "bulk_skip", rowIds: number[] }
 *   Marks the given row ids as skipped. Already-committed rows are untouched.
 */

const ALL_STATUSES: ImportBatchRow["status"][] = ["pending", "skipped", "committed", "failed"];

async function authBatch(batchIdRaw: string, userId: number, isStaff: boolean) {
  const id = Number(batchIdRaw);
  if (!Number.isFinite(id)) throw new Error("Invalid batch id");
  const batch = await getBatchOrThrow(id);
  if (!isStaff && batch.createdBy !== userId) {
    const e = new Error("Forbidden");
    (e as { __status?: number }).__status = 403;
    throw e;
  }
  return batch;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { batchId } = await params;
    const isStaff = user.userType === "admin" || user.userType === "internal_staff";
    await authBatch(batchId, Number(user.id), isStaff);

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const status = statusParam
      ? (statusParam.split(",").map((s) => s.trim()).filter((s) =>
          (ALL_STATUSES as string[]).includes(s),
        ) as ImportBatchRow["status"][])
      : undefined;
    const limitRaw = Number(searchParams.get("limit") ?? "0");
    const offsetRaw = Number(searchParams.get("offset") ?? "0");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : undefined;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : undefined;

    const rows = await getBatchRows(Number(batchId), { status, limit, offset });
    return NextResponse.json({ rows });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { batchId } = await params;
    const isStaff = user.userType === "admin" || user.userType === "internal_staff";
    await authBatch(batchId, Number(user.id), isStaff);

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      rowIds?: number[];
    };
    if (body.action === "bulk_skip") {
      const ids = Array.isArray(body.rowIds) ? body.rowIds.filter((n) => Number.isFinite(n)) : [];
      const result = await bulkSkipRows(Number(batchId), ids.map(Number));
      return NextResponse.json({ updated: result.updated, aggregates: result.aggregates });
    }
    return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Unexpected error";
  const status = (err as { __status?: number })?.__status;
  if (status) return NextResponse.json({ error: message }, { status });
  if (message === "Unauthorized") return NextResponse.json({ error: message }, { status: 401 });
  if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
  return NextResponse.json({ error: message }, { status: 500 });
}
