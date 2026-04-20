import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { getBatchOrThrow, revalidateBatch } from "@/lib/import/batch-service";
import { addOptionsForBatch } from "@/lib/import/option-additions";

export const runtime = "nodejs";

/**
 * POST /api/imports/batches/[batchId]/add-options
 *
 * Lets the admin extend a select / collapsed-child field's option list FROM
 * THE STAGING REVIEW SCREEN, without leaving the import flow. After applying
 * the additions, the batch is automatically re-validated so the previously
 * "unknown value" warnings disappear (or surface remaining issues).
 *
 * Body shape:
 * {
 *   "additions": [
 *     // Plain select / radio: append to that field's options
 *     { "columnId": "vehicleInfo.region",      "values": [{ "value": "Kowloon" }] },
 *
 *     // Collapsed option-child (e.g. Make → Model): append to the parent
 *     // option's children list. The endpoint resolves the parent option by
 *     // its (lower-cased) value; the parent option must already exist.
 *     { "columnId": "vehicleInfo.make_collapsed1_model",
 *       "parentValue": "toyota",
 *       "values": [{ "value": "Camry" }, { "value": "Corolla" }] },
 *
 *     // Make/Model atomic: add a brand-new Make THEN add Models under it,
 *     // by ordering the additions in the array (Make first, then Model).
 *     { "columnId": "vehicleInfo.make",        "values": [{ "value": "Tesla" }] },
 *     { "columnId": "vehicleInfo.make_collapsed1_model",
 *       "parentValue": "tesla",
 *       "values": [{ "value": "Model 3" }] }
 *   ]
 * }
 *
 * Response: { ok: true, added: number, aggregates, summary } — same shape as
 * the revalidate endpoint so the BatchReviewClient can drop it into state.
 */
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
    const id = Number(batchId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid batch id" }, { status: 400 });
    }
    const batch = await getBatchOrThrow(id);
    const isStaff = user.userType === "admin" || user.userType === "internal_staff";
    if (!isStaff && batch.createdBy !== Number(user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      additions?: Array<{
        columnId?: string;
        parentValue?: string;
        values?: Array<{ value?: string; label?: string }>;
      }>;
    };
    const additions = Array.isArray(body.additions) ? body.additions : [];
    if (additions.length === 0) {
      return NextResponse.json({ error: "No additions provided" }, { status: 400 });
    }

    const added = await addOptionsForBatch(batch.flowKey, additions);
    const result = await revalidateBatch(id);
    return NextResponse.json({ ok: true, added, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") return NextResponse.json({ error: message }, { status: 401 });
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
