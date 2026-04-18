import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { loadFlowImportSchema } from "@/lib/import/schema";
import { buildImportTemplate } from "@/lib/import/excel";

export const runtime = "nodejs";

/**
 * GET /api/flows/[flow]/import/template
 *
 * Returns an .xlsx file with one column per importable field for the given
 * flow. The template is generated from form_options at request time, so it
 * always reflects the current admin-configured schema.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ flow: string }> },
) {
  try {
    const user = await requireUser();
    if (!canCreatePolicy(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { flow } = await params;
    if (!flow || typeof flow !== "string") {
      return NextResponse.json({ error: "Missing flow key" }, { status: 400 });
    }

    const schema = await loadFlowImportSchema(flow);
    if (schema.packages.length === 0) {
      return NextResponse.json(
        { error: `No fields configured for flow "${flow}"` },
        { status: 404 },
      );
    }

    const buf = await buildImportTemplate(schema);
    const filename = `${flow}-import-template.xlsx`;

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (message === "Unauthorized") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
