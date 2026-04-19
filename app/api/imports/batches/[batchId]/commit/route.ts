import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { commitBatch, getBatchOrThrow } from "@/lib/import/batch-service";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes — large batches

/**
 * POST /api/imports/batches/[batchId]/commit
 *   Starts the commit phase. Synchronous: returns when the batch finishes
 *   or after maxDuration. Use GET /api/imports/batches/[batchId]/progress
 *   if you need to poll mid-flight from a different client.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { batchId } = await params;
    const id = Number(batchId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid batch id" }, { status: 400 });
    }
    const batch = await getBatchOrThrow(id);
    const isStaff = user.userType === "admin" || user.userType === "internal_staff";
    if (!isStaff && batch.createdBy !== Number(user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const progress = await commitBatch(id);
    return NextResponse.json(progress);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") return NextResponse.json({ error: message }, { status: 401 });
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    if (/already in progress|cancelled/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
