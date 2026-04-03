import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { requireUser } from "@/lib/auth/require-user";
import { eq, and, sql } from "drizzle-orm";
import type { UploadDocumentTypeMeta } from "@/lib/types/upload-document";

export const dynamic = "force-dynamic";

const ENDORSEMENT_UPLOAD_TYPES: Array<{
  label: string;
  value: string;
  sortOrder: number;
  meta: UploadDocumentTypeMeta;
}> = [
  {
    label: "Endorsement Request Form",
    value: "endorsement_request_form",
    sortOrder: 20,
    meta: {
      description: "Signed endorsement request or instruction letter",
      acceptedTypes: ["image/*", "application/pdf"],
      maxSizeMB: 10,
      required: true,
      flows: ["endorsement"],
    },
  },
  {
    label: "Supporting Documents",
    value: "endorsement_supporting_docs",
    sortOrder: 21,
    meta: {
      description: "Any supporting documents for the endorsement (e.g. new vehicle registration, ID change proof)",
      acceptedTypes: ["image/*", "application/pdf"],
      maxSizeMB: 10,
      required: false,
      flows: ["endorsement"],
    },
  },
  {
    label: "Endorsement Confirmation",
    value: "endorsement_confirmation",
    sortOrder: 22,
    meta: {
      description: "Confirmation from insurer that endorsement has been processed",
      acceptedTypes: ["image/*", "application/pdf"],
      maxSizeMB: 10,
      required: false,
      flows: ["endorsement"],
    },
  },
  {
    label: "Payment Record",
    value: "endorsement_payment_record",
    sortOrder: 23,
    meta: {
      description: "Payment proof for endorsement premium",
      acceptedTypes: ["image/*", "application/pdf"],
      maxSizeMB: 10,
      required: false,
      flows: ["endorsement"],
      requirePaymentDetails: true,
    },
  },
];

async function seedTypes() {
  const results: string[] = [];

  // 1) Create endorsement-specific upload types
  for (const tpl of ENDORSEMENT_UPLOAD_TYPES) {
    const existing = await db
      .select({ id: formOptions.id })
      .from(formOptions)
      .where(
        and(
          eq(formOptions.groupKey, "upload_document_types"),
          eq(formOptions.value, tpl.value),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      results.push(`${tpl.label}: already exists, skipped`);
      continue;
    }

    await db.insert(formOptions).values({
      groupKey: "upload_document_types",
      label: tpl.label,
      value: tpl.value,
      valueType: "json",
      sortOrder: tpl.sortOrder,
      isActive: true,
      meta: tpl.meta as unknown as Record<string, unknown>,
    });
    results.push(`${tpl.label}: created`);
  }

  // 2) Restrict existing generic upload types to non-endorsement flows
  //    Only update types that have empty flows (apply to all) so endorsement
  //    policies stop showing irrelevant requirements like "Driving License Copy"
  const allTypes = await db
    .select({ id: formOptions.id, label: formOptions.label, value: formOptions.value, meta: formOptions.meta })
    .from(formOptions)
    .where(eq(formOptions.groupKey, "upload_document_types"));

  const endorsementKeys = new Set(ENDORSEMENT_UPLOAD_TYPES.map((t) => t.value));

  for (const row of allTypes) {
    if (endorsementKeys.has(row.value)) continue;
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const flows = meta.flows as string[] | undefined;

    if (!flows || flows.length === 0) {
      // Load all available flow values to assign all except endorsement
      const allFlows = await db
        .select({ value: formOptions.value })
        .from(formOptions)
        .where(eq(formOptions.groupKey, "flows"));

      const nonEndorsementFlows = allFlows
        .map((f) => f.value)
        .filter((v) => !v.toLowerCase().includes("endorsement"));

      if (nonEndorsementFlows.length > 0) {
        await db.execute(sql`
          UPDATE form_options
          SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{flows}', ${JSON.stringify(nonEndorsementFlows)}::jsonb)
          WHERE id = ${row.id}
        `);
        results.push(`${row.label}: restricted to [${nonEndorsementFlows.join(", ")}]`);
      }
    }
  }

  return results;
}

export async function GET() {
  const user = await requireUser();
  if (!["admin", "internal_staff"].includes(user.userType)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const results = await seedTypes();
  return NextResponse.json({ ok: true, results });
}

export async function POST() {
  const user = await requireUser();
  if (!["admin", "internal_staff"].includes(user.userType)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const results = await seedTypes();
  return NextResponse.json({ ok: true, results });
}
