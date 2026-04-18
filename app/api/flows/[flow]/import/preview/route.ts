import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { loadFlowImportSchema, flattenFields } from "@/lib/import/schema";
import { parseImportWorkbook, fieldColumnId } from "@/lib/import/excel";
import { validateRows } from "@/lib/import/validate";

export const runtime = "nodejs";

/** Maximum rows allowed in a single import (matches user choice: medium ≈ 500). */
const MAX_ROWS = 500;

export type PreviewResponse = {
  flow: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  unknownColumns: string[];
  missingColumns: string[];
  rows: Array<{
    excelRow: number;
    valid: boolean;
    errors: { column: string | null; message: string }[];
    values: Record<string, unknown>;
  }>;
  /** Order in which columns should be displayed in the preview table */
  columnOrder: { id: string; label: string }[];
};

/**
 * POST /api/flows/[flow]/import/preview
 *
 * Accepts multipart/form-data with field "file" (.xlsx). Parses the workbook,
 * validates each row against the current flow schema, and returns a per-row
 * report. NO database writes occur here — purely a dry-run check.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ flow: string }> },
) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { flow } = await params;
    if (!flow) {
      return NextResponse.json({ error: "Missing flow key" }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing file field. Upload an .xlsx file under field name 'file'." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const schema = await loadFlowImportSchema(flow);
    if (schema.packages.length === 0) {
      return NextResponse.json(
        { error: `No fields configured for flow "${flow}"` },
        { status: 404 },
      );
    }

    const parsed = await parseImportWorkbook(buffer, schema);

    if (parsed.rows.length > MAX_ROWS) {
      return NextResponse.json(
        {
          error: `Too many rows: ${parsed.rows.length}. Maximum per import is ${MAX_ROWS}.`,
        },
        { status: 413 },
      );
    }

    const validated = validateRows(parsed.rows, schema);

    const fields = flattenFields(schema);
    const columnOrder = fields.map((f) => ({
      id: fieldColumnId(f),
      label: f.label,
    }));

    const response: PreviewResponse = {
      flow,
      totalRows: validated.length,
      validRows: validated.filter((r) => r.errors.length === 0).length,
      errorRows: validated.filter((r) => r.errors.length > 0).length,
      unknownColumns: parsed.unknownColumns,
      missingColumns: parsed.missingColumns,
      columnOrder,
      rows: validated.map((r) => ({
        excelRow: r.excelRow,
        valid: r.errors.length === 0,
        errors: r.errors,
        values: r.values,
      })),
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
