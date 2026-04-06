import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { eq, sql } from "drizzle-orm";
import {
  resolveRawValue,
  formatResolvedValue,
  getInsuredDisplayName,
  getInsuredType,
  getInsuredPrimaryId,
  getContactField,
  getDisplayNameFromSnapshot,
  buildAddressFromGetter,
  fuzzyGet,
  type ResolveContext,
  type SnapshotData,
} from "@/lib/field-resolver";
import { getAllResolvedPrefixes, resolveInvoicePrefix } from "@/lib/resolve-prefix";

export const dynamic = "force-dynamic";

type DocTrackingMap = Record<string, { documentNumber?: string; status?: string; [key: string]: unknown }>;

function buildContext(
  row: { pId: number; pNum: string; pCreated: string; cExtra: unknown; agentId: number | null },
  extra: Record<string, unknown>,
  snapshot: SnapshotData,
  agent: Record<string, unknown> | null,
  documentTracking?: DocTrackingMap | null,
  currentDocTrackingKey?: string,
): ResolveContext {
  return {
    policyNumber: row.pNum,
    policyId: row.pId,
    createdAt: String(row.pCreated ?? ""),
    snapshot,
    policyExtra: extra,
    agent,
    documentTracking: documentTracking ?? null,
    currentDocTrackingKey,
  };
}

export async function GET(request: NextRequest) {
  const me = await requireUser();
  if (me.userType !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const policyNumber = request.nextUrl.searchParams.get("policyNumber");
  const customSource = request.nextUrl.searchParams.get("source");
  const customFieldKey = request.nextUrl.searchParams.get("fieldKey");
  const customPackageName = request.nextUrl.searchParams.get("packageName");
  const customFormat = request.nextUrl.searchParams.get("format");
  const customCurrency = request.nextUrl.searchParams.get("currencyCode");

  if (!policyNumber) {
    return NextResponse.json({ error: "policyNumber is required" }, { status: 400 });
  }

  const [row] = await db
    .select({
      pId: policies.id,
      pNum: policies.policyNumber,
      pCreated: policies.createdAt,
      cExtra: cars.extraAttributes,
      agentId: policies.agentId,
      docTracking: policies.documentTracking,
    })
    .from(policies)
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(sql`LOWER(${policies.policyNumber}) = LOWER(${policyNumber})`)
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

  const docTracking = (row.docTracking ?? null) as DocTrackingMap | null;
  const customDocKey = request.nextUrl.searchParams.get("docTrackingKey") || undefined;

  const ctx = buildContext(
    { pId: row.pId, pNum: row.pNum, pCreated: String(row.pCreated ?? ""), cExtra: row.cExtra, agentId: row.agentId },
    extra,
    snapshot,
    agent,
    docTracking,
    customDocKey,
  );

  // Custom single-field test mode
  if (customSource && customFieldKey) {
    const raw = resolveRawValue(
      { source: customSource, fieldKey: customFieldKey, packageName: customPackageName || undefined },
      ctx,
    );
    const formatted = customFormat ? formatResolvedValue(raw, customFormat, customCurrency || undefined) : null;
    return NextResponse.json({
      mode: "custom",
      policyNumber: row.pNum,
      source: customSource,
      fieldKey: customFieldKey,
      packageName: customPackageName || null,
      rawValue: raw,
      formatted,
      formatUsed: customFormat || null,
    });
  }

  // Full scan mode
  type TestEntry = { source: string; fieldKey: string; packageName?: string };
  const testSources: TestEntry[] = [
    { source: "policy", fieldKey: "policyNumber" },
    { source: "policy", fieldKey: "createdAt" },
    { source: "policy", fieldKey: "status" },
    { source: "policy", fieldKey: "flowKey" },
    { source: "policy", fieldKey: "effectiveDate" },
    { source: "policy", fieldKey: "expiryDate" },
    { source: "policy", fieldKey: "documentNumber" },
    { source: "policy", fieldKey: "documentStatus" },
    { source: "insured", fieldKey: "displayName" },
    { source: "insured", fieldKey: "primaryId" },
    { source: "insured", fieldKey: "insuredType" },
    { source: "insured", fieldKey: "lastName" },
    { source: "insured", fieldKey: "firstName" },
    { source: "insured", fieldKey: "companyName" },
    { source: "contactinfo", fieldKey: "mobile" },
    { source: "contactinfo", fieldKey: "tel" },
    { source: "contactinfo", fieldKey: "email" },
    { source: "contactinfo", fieldKey: "fullAddress" },
    { source: "agent", fieldKey: "name" },
    { source: "agent", fieldKey: "email" },
  ];

  // Dynamically add ALL insured snapshot keys
  const insuredSnap = snapshot.insuredSnapshot;
  if (insuredSnap && typeof insuredSnap === "object") {
    const alreadyTested = new Set(
      testSources.filter((t) => t.source === "insured").map((t) => t.fieldKey),
    );
    for (const key of Object.keys(insuredSnap)) {
      const stripped = key.replace(/^insured__?/, "").replace(/^contactinfo__?/, "");
      if (!alreadyTested.has(key) && !alreadyTested.has(stripped)) {
        testSources.push({ source: "insured", fieldKey: key });
        alreadyTested.add(key);
      }
    }
  }

  // Dynamically add ALL package fields (no limit)
  const pkgs = (snapshot.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const pkgName of Object.keys(pkgs)) {
    const pkg = pkgs[pkgName];
    if (!pkg || typeof pkg !== "object") continue;
    const obj = pkg as Record<string, unknown>;
    const vals = "values" in obj ? ((obj.values as Record<string, unknown>) ?? {}) : obj;
    for (const key of Object.keys(vals)) {
      testSources.push({ source: "package", fieldKey: key, packageName: pkgName });
    }
  }

  const results = testSources.map((t) => {
    const raw = resolveRawValue(
      { source: t.source, fieldKey: t.fieldKey, packageName: t.packageName },
      ctx,
    );
    return {
      source: t.source,
      fieldKey: t.fieldKey,
      packageName: t.packageName || null,
      rawValue: raw,
      formattedCurrency: typeof raw === "number" ? formatResolvedValue(raw, "currency") : null,
      formattedDate: typeof raw === "string" && raw.includes("-") ? formatResolvedValue(raw, "date") : null,
    };
  });

  const insured = snapshot.insuredSnapshot;
  const convenience = {
    getInsuredDisplayName: getInsuredDisplayName(insured),
    getInsuredType: getInsuredType(insured),
    getInsuredPrimaryId: getInsuredPrimaryId(insured),
    getContactMobile: getContactField(insured, "mobile"),
    getContactTel: getContactField(insured, "tel"),
    getContactEmail: getContactField(insured, "email"),
    getDisplayNameFromSnapshot: getDisplayNameFromSnapshot(snapshot),
    getContactFullAddress: insured ? buildAddressFromGetter((k) => fuzzyGet(insured, k)) : "",
  };

  // Package summary — show every package and its field count
  const packageSummary: { name: string; fieldCount: number; sampleKeys: string[] }[] = [];
  for (const pkgName of Object.keys(pkgs)) {
    const pkg = pkgs[pkgName];
    if (!pkg || typeof pkg !== "object") continue;
    const obj = pkg as Record<string, unknown>;
    const vals = "values" in obj ? ((obj.values as Record<string, unknown>) ?? {}) : obj;
    const keys = Object.keys(vals);
    packageSummary.push({ name: pkgName, fieldCount: keys.length, sampleKeys: keys.slice(0, 30) });
  }

  // Document tracking summary
  const docTrackingSummary: { key: string; documentNumber: string; status: string }[] = [];
  if (docTracking) {
    for (const [key, entry] of Object.entries(docTracking)) {
      if (key.startsWith("_")) continue;
      docTrackingSummary.push({
        key,
        documentNumber: (entry as Record<string, unknown>)?.documentNumber as string ?? "",
        status: (entry as Record<string, unknown>)?.status as string ?? "",
      });
    }
  }

  const adminPrefixes = await getAllResolvedPrefixes();
  const effectivePrefixes = {
    invoice: await resolveInvoicePrefix("invoice", "receivable"),
    payable: await resolveInvoicePrefix("invoice", "payable"),
    credit_note: await resolveInvoicePrefix("credit_note", "receivable"),
    statement: await resolveInvoicePrefix("statement", "receivable"),
  };

  return NextResponse.json({
    mode: "full",
    policyNumber: row.pNum,
    policyId: row.pId,
    rawSnapshot: {
      insuredSnapshot: snapshot.insuredSnapshot,
      insuredKeyCount: insuredSnap ? Object.keys(insuredSnap).length : 0,
    },
    packageSummary,
    convenienceHelpers: convenience,
    fieldResults: results,
    documentTracking: docTrackingSummary,
    prefixes: {
      adminConfigured: adminPrefixes,
      effective: effectivePrefixes,
    },
  });
}
