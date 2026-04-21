import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { formOptions } from "@/db/schema/form_options";
import { requireUser } from "@/lib/auth/require-user";
import { eq, sql, inArray } from "drizzle-orm";
import { buildMergeContext } from "@/lib/pdf/build-context";
import { resolveFieldValue } from "@/lib/pdf/resolve-data";
import type { PdfFieldMapping } from "@/lib/types/pdf-template";
import {
  formatResolvedValue,
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
  /** Raw value as stored in the snapshot (e.g. "hkonly", true, 4200). */
  resolved: unknown;
  /** Final string the document will print (option-label-mapped + formatted). */
  display: string;
  status: ValidationStatus;
};

/** Mirror of DocumentTemplatesManager `dynamicSourceMap` — keep in sync. */
const SOURCE_TO_PKG: Record<string, string> = {
  insured: "insured",
  contactinfo: "contactinfo",
  accounting: "premiumRecord",
};

function pkgNameForSource(source: string, packageName?: string): string | undefined {
  if (source === "package") return packageName;
  return SOURCE_TO_PKG[source];
}

/**
 * Loads `${pkg}_fields` form_options for every package referenced by the
 * template's sections and indexes them as `pkg → fieldKey → value → label`,
 * so the validator can show the human-readable display value alongside the
 * raw resolved value.
 */
async function loadOptionLabelMaps(
  pkgs: string[],
): Promise<Record<string, Record<string, Record<string, string>>>> {
  const out: Record<string, Record<string, Record<string, string>>> = {};
  if (pkgs.length === 0) return out;
  const groupKeys = pkgs.map((p) => `${p}_fields`);
  const rows = await db
    .select({ groupKey: formOptions.groupKey, value: formOptions.value, meta: formOptions.meta })
    .from(formOptions)
    .where(inArray(formOptions.groupKey, groupKeys));

  for (const row of rows) {
    const pkg = row.groupKey.replace(/_fields$/, "");
    const m = row.meta ?? null;
    const opts = (m as { options?: Array<{ value?: unknown; label?: unknown }> } | null)?.options;
    if (!Array.isArray(opts) || opts.length === 0) continue;
    const fieldOpts: Record<string, string> = {};
    for (const o of opts) {
      const ov = String(o?.value ?? o?.label ?? "").trim();
      const ol = String(o?.label ?? o?.value ?? "").trim();
      if (ov) fieldOpts[ov] = ol || ov;
    }
    if (Object.keys(fieldOpts).length === 0) continue;
    if (!out[pkg]) out[pkg] = {};
    out[pkg][String(row.value)] = fieldOpts;
  }
  return out;
}

function applyOptionLabel(
  raw: unknown,
  pkg: string | undefined,
  fieldKey: string,
  cache: Record<string, Record<string, Record<string, string>>>,
): unknown {
  if (!pkg) return raw;
  const opts = cache[pkg]?.[fieldKey];
  if (!opts || Object.keys(opts).length === 0) return raw;
  const mapOne = (v: unknown): unknown => {
    if (v === null || v === undefined) return v;
    const key = String(v).trim();
    if (!key) return v;
    return opts[key] ?? v;
  };
  if (Array.isArray(raw)) return raw.map(mapOne);
  if (typeof raw === "string" && raw.includes(",")) {
    return raw.split(",").map((s) => String(mapOne(s.trim()))).join(", ");
  }
  return mapOne(raw);
}

function toDisplay(
  raw: unknown,
  pkg: string | undefined,
  fieldKey: string,
  format: string | undefined,
  cache: Record<string, Record<string, Record<string, string>>>,
): string {
  const mapped = applyOptionLabel(raw, pkg, fieldKey, cache);
  // Friendly boolean: render `true` as "Yes" (matches DocumentsTab.formatValue).
  if ((mapped === true || mapped === "true") && (!format || format === "text" || format === "boolean")) {
    return "Yes";
  }
  return formatResolvedValue(mapped, format as Parameters<typeof formatResolvedValue>[1]);
}

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

  // Pre-load option-label maps for every package referenced by any field so we
  // can return a faithful "display" value alongside the raw `resolved` value.
  const pkgsForFields = Array.from(
    new Set(
      fields
        .map((f) => pkgNameForSource(f.source, f.packageName))
        .filter((p): p is string => typeof p === "string" && p.length > 0),
    ),
  );
  const optionLabelCache = await loadOptionLabelMaps(pkgsForFields);

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
        const pkg = pkgNameForSource(f.source, f.packageName);
        return {
          id: f.id, source: f.source, fieldKey: f.fieldKey,
          packageName: f.packageName, resolved: value,
          display: toDisplay(value, pkg, f.fieldKey, f.format, optionLabelCache),
          status: classifyField(f, value),
        };
      } catch {
        return {
          id: f.id, source: f.source, fieldKey: f.fieldKey,
          packageName: f.packageName, resolved: null, display: "",
          status: "optional" as const,
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
      const pkg = pkgNameForSource(f.source, f.packageName);
      return {
        id: f.id, source: f.source, fieldKey: f.fieldKey,
        packageName: f.packageName, resolved: value,
        display: toDisplay(value, pkg, f.fieldKey, f.format, optionLabelCache),
        status: classifyField(f, value),
      };
    } catch {
      return {
        id: f.id, source: f.source, fieldKey: f.fieldKey,
        packageName: f.packageName, resolved: null, display: "",
        status: "optional" as const,
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
