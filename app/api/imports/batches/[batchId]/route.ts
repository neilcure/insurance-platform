import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { getBatchOrThrow } from "@/lib/import/batch-service";

export const runtime = "nodejs";

/** GET /api/imports/batches/[batchId] — returns the batch + summary */
export async function GET(
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
    // Non-admin can only see their own
    if (user.userType !== "admin" && user.userType !== "internal_staff" && batch.createdBy !== Number(user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ batch });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") return NextResponse.json({ error: message }, { status: 401 });
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
