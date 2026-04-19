import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { cancelBatch, getBatchOrThrow } from "@/lib/import/batch-service";

export const runtime = "nodejs";

/** POST /api/imports/batches/[batchId]/cancel */
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
    await cancelBatch(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") return NextResponse.json({ error: message }, { status: 401 });
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    if (/cannot cancel/i.test(message)) return NextResponse.json({ error: message }, { status: 409 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
