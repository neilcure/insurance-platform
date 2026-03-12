import type { PdfFieldMapping } from "@/lib/types/pdf-template";

type SnapshotData = {
  insuredSnapshot?: Record<string, unknown> | null;
  packagesSnapshot?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type MergeContext = {
  policyNumber: string;
  createdAt: string;
  snapshot: SnapshotData;
  agent?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  organisation?: Record<string, unknown> | null;
};

function fuzzyGet(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return obj[k];
  }
  return undefined;
}

function resolveInsured(snapshot: SnapshotData, key: string): unknown {
  const insured = snapshot.insuredSnapshot;
  if (!insured || typeof insured !== "object") return "";
  return (
    fuzzyGet(insured, key) ??
    fuzzyGet(insured, `insured__${key}`) ??
    fuzzyGet(insured, `insured_${key}`) ??
    ""
  );
}

function resolveContact(snapshot: SnapshotData, key: string): unknown {
  const insured = snapshot.insuredSnapshot;
  if (!insured || typeof insured !== "object") return "";
  return (
    fuzzyGet(insured, key) ??
    fuzzyGet(insured, `contactinfo__${key}`) ??
    fuzzyGet(insured, `contactinfo_${key}`) ??
    ""
  );
}

function resolvePackage(
  snapshot: SnapshotData,
  packageName: string,
  key: string,
): unknown {
  const pkgs = (snapshot.packagesSnapshot ?? {}) as Record<string, unknown>;
  const pkg = pkgs[packageName];
  if (!pkg || typeof pkg !== "object") return "";
  const obj = pkg as Record<string, unknown>;
  const vals =
    "values" in obj
      ? ((obj.values as Record<string, unknown>) ?? {})
      : obj;
  return (
    fuzzyGet(vals, key) ??
    fuzzyGet(vals, `${packageName}__${key}`) ??
    fuzzyGet(vals, `${packageName}_${key}`) ??
    ""
  );
}

export function resolveFieldValue(
  field: PdfFieldMapping,
  ctx: MergeContext,
): string {
  let raw: unknown = "";

  switch (field.source) {
    case "policy": {
      const map: Record<string, unknown> = {
        policyNumber: ctx.policyNumber,
        createdAt: ctx.createdAt,
      };
      raw = map[field.fieldKey] ?? ctx.snapshot[field.fieldKey] ?? "";
      break;
    }
    case "insured":
      raw = resolveInsured(ctx.snapshot, field.fieldKey);
      break;
    case "contactinfo":
      raw = resolveContact(ctx.snapshot, field.fieldKey);
      break;
    case "package":
      raw = resolvePackage(
        ctx.snapshot,
        field.packageName ?? "",
        field.fieldKey,
      );
      break;
    case "agent":
      raw = ctx.agent ? fuzzyGet(ctx.agent, field.fieldKey) ?? "" : "";
      break;
    case "client":
      raw = ctx.client ? fuzzyGet(ctx.client, field.fieldKey) ?? "" : "";
      break;
    case "organisation":
      raw = ctx.organisation
        ? fuzzyGet(ctx.organisation, field.fieldKey) ?? ""
        : "";
      break;
    case "static":
      raw = field.staticValue ?? "";
      break;
  }

  const formatted = formatValue(raw, field.format, field.currencyCode);
  const prefix = field.prefix ?? "";
  const suffix = field.suffix ?? "";
  return `${prefix}${formatted}${suffix}`;
}

function formatValue(
  raw: unknown,
  format?: string,
  currencyCode?: string,
): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";

  if (format === "currency") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return s;
    try {
      return new Intl.NumberFormat("en-HK", {
        style: "currency",
        currency: (currencyCode || "HKD").toUpperCase(),
      }).format(n);
    } catch {
      return n.toFixed(2);
    }
  }

  if (format === "date") {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }

  if (format === "boolean") {
    return raw === true || raw === "true" ? "Yes" : "No";
  }

  if (format === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n.toLocaleString() : s;
  }

  return s;
}
