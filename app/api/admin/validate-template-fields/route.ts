import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { eq, sql } from "drizzle-orm";
import { buildMergeContext } from "@/lib/pdf/build-context";
import { resolveFieldValue } from "@/lib/pdf/resolve-data";
import type { PdfFieldMapping } from "@/lib/types/pdf-template";
import {
  resolveRawValue,
  type ResolveContext,
  type SnapshotData,
} from "@/lib/field-resolver";
import { users } from "@/db/schema/core";

export const dynamic = "force-dynamic";

type FieldToValidate = {
  id: string;
  source: string;
  fieldKey: string;
  packageName?: string;
  format?: string;
};

type ValidationStatus = "ok" | "optional";

type ValidationResult = {
  id: string;
  source: string;
  fieldKey: string;
  packageName?: string;
  resolved: unknown;
  status: ValidationStatus;
};

export async function POST(request: Request) {
  const user = await requireUser();
  if (user.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const fields: FieldToValidate[] = body.fields ?? [];
  const templateType: "document" | "pdf" = body.templateType ?? "document";
  let policyId: number | null = body.policyId ? Number(body.policyId) : null;
  const policyNumber: string | null = body.policyNumber ?? null;

  if (fields.length === 0) {
    return NextResponse.json({ error: "No fields to validate" }, { status: 400 });
  }

  if (!policyId && policyNumber) {
    const [found] = await db
      .select({ id: policies.id })
      .from(policies)
      .where(sql`LOWER(${policies.policyNumber}) = LOWER(${policyNumber})`)
      .limit(1);
    if (!found) {
      return NextResponse.json({ error: `Policy "${policyNumber}" not found` }, { status: 404 });
    }
    policyId = found.id;
  }

  if (!policyId) {
    const [sample] = await db
      .select({ id: policies.id })
      .from(policies)
      .innerJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.isActive, true))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (!sample) {
      return NextResponse.json({ error: "No policies available to validate against" }, { status: 404 });
    }
    policyId = sample.id;
  }

  // Load policy data (shared by both template types)
  const [row] = await db
    .select({
      pId: policies.id,
      pNum: policies.policyNumber,
      pCreated: policies.createdAt,
      cExtra: cars.extraAttributes,
      agentId: policies.agentId,
    })
    .from(policies)
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(eq(policies.id, policyId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Policy not found" }, { status: 404 });
  }

  const extra = (row.cExtra ?? {}) as Record<string, unknown>;
  const snapshot: SnapshotData = {
    insuredSnapshot: (extra.insuredSnapshot ?? null) as Record<string, unknown> | null,
    packagesSnapshot: (extra.packagesSnapshot ?? null) as Record<string, unknown> | null,
  };

  let agent: Record<string, unknown> | null = null;
  if (row.agentId) {
    const [agentRow] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, row.agentId))
      .limit(1);
    if (agentRow) agent = agentRow as Record<string, unknown>;
  }

  function classifyField(_f: FieldToValidate, resolvedValue: unknown): ValidationStatus {
    const hasValue = resolvedValue !== "" && resolvedValue !== null && resolvedValue !== undefined;
    return hasValue ? "ok" : "optional";
  }

  if (templateType === "pdf") {
    const mergeCtx = await buildMergeContext(policyId);
    if (!mergeCtx) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const results: ValidationResult[] = fields.map((f) => {
      try {
        const pdfField: PdfFieldMapping = {
          id: f.id,
          label: f.fieldKey,
          page: 0, x: 0, y: 0,
          source: f.source as PdfFieldMapping["source"],
          fieldKey: f.fieldKey,
          packageName: f.packageName,
          format: (f.format as PdfFieldMapping["format"]) || undefined,
        };
        const value = resolveFieldValue(pdfField, mergeCtx.ctx);
        return {
          id: f.id, source: f.source, fieldKey: f.fieldKey,
          packageName: f.packageName, resolved: value,
          status: classifyField(f, value),
        };
      } catch {
        return {
          id: f.id, source: f.source, fieldKey: f.fieldKey,
          packageName: f.packageName, resolved: null, status: "optional" as const,
        };
      }
    });

    return buildResponse(results, policyId, mergeCtx.policyNumber);
  }

  // Document template validation
  const ctx: ResolveContext = {
    policyNumber: row.pNum,
    policyId: row.pId,
    createdAt: String(row.pCreated ?? ""),
    snapshot,
    policyExtra: extra,
    agent,
    documentTracking: null,
  };

  const results: ValidationResult[] = fields.map((f) => {
    try {
      const value = resolveRawValue(
        { source: f.source, fieldKey: f.fieldKey, packageName: f.packageName },
        ctx,
      );
      return {
        id: f.id, source: f.source, fieldKey: f.fieldKey,
        packageName: f.packageName, resolved: value,
        status: classifyField(f, value),
      };
    } catch {
      return {
        id: f.id, source: f.source, fieldKey: f.fieldKey,
        packageName: f.packageName, resolved: null, status: "optional" as const,
      };
    }
  });

  return buildResponse(results, policyId, row.pNum);
}

function buildResponse(results: ValidationResult[], policyId: number, policyNumber: string) {
  return NextResponse.json({
    policyId,
    policyNumber,
    totalFields: results.length,
    okCount: results.filter((r) => r.status === "ok").length,
    optionalCount: results.filter((r) => r.status === "optional").length,
    results,
  });
}
