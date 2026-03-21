import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { buildMergeContext } from "@/lib/pdf/build-context";
import { resolveFieldValue } from "@/lib/pdf/resolve-data";
import type { PdfFieldMapping } from "@/lib/types/pdf-template";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await requireUser();

  const body = await request.json();
  const policyId = Number(body.policyId);
  const fields: PdfFieldMapping[] = body.fields ?? [];

  if (!policyId) {
    return NextResponse.json({ error: "policyId is required" }, { status: 400 });
  }

  const result = await buildMergeContext(policyId);
  if (!result) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }

  const resolved: Record<string, string> = {};
  for (const field of fields) {
    resolved[field.id] = resolveFieldValue(field, result.ctx);
  }

  return NextResponse.json({
    policyNumber: result.policyNumber,
    values: resolved,
  });
}
