import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { listBatches, uploadAndStage, MAX_BATCH_ROWS } from "@/lib/import/batch-service";

export const runtime = "nodejs";

/**
 * GET /api/imports/batches?flow=policyset
 *   Lists batches the caller can see (admins / internal staff: all; others
 *   restricted to their own).
 *
 * POST /api/imports/batches
 *   multipart/form-data:
 *     file:           xlsx
 *     flowKey:        e.g. "policyset"
 *     clientFlowKey:  optional override (default "clientSet")
 *
 *   Parses + validates + stages the file, returns the new batch + summary.
 *   Every row goes through the staging review screen; warnings are surfaced
 *   but do NOT block commit.
 */

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const flowKey = searchParams.get("flow") || undefined;
    const mineOnly = user.userType !== "admin" && user.userType !== "internal_staff";
    const batches = await listBatches({
      flowKey,
      createdBy: mineOnly ? Number(user.id) : undefined,
    });
    return NextResponse.json({ batches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") return NextResponse.json({ error: message }, { status: 401 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing 'file' field." }, { status: 400 });
    }

    const flowKey = String(form.get("flowKey") ?? "").trim();
    if (!flowKey) {
      return NextResponse.json({ error: "Missing 'flowKey' field." }, { status: 400 });
    }

    const clientFlowKeyRaw = String(form.get("clientFlowKey") ?? "").trim();
    const clientFlowKey = clientFlowKeyRaw || undefined;

    const fileName =
      typeof (file as File).name === "string" && (file as File).name.length > 0
        ? (file as File).name
        : "upload.xlsx";
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await uploadAndStage({
      flowKey,
      filename: fileName,
      fileSizeBytes: buffer.length,
      fileBuffer: buffer,
      clientFlowKey,
      createdBy: Number(user.id),
    });

    return NextResponse.json(
      {
        batchId: result.batch.id,
        flowKey: result.batch.flowKey,
        status: result.batch.status,
        aggregates: result.aggregates,
        summary: result.summary,
        maxRows: MAX_BATCH_ROWS,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") return NextResponse.json({ error: message }, { status: 401 });
    if (message.toLowerCase().startsWith("too many rows")) {
      return NextResponse.json({ error: message }, { status: 413 });
    }
    if (message.toLowerCase().includes("no fields configured")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
