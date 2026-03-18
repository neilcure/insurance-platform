import type { PdfFieldMapping } from "@/lib/types/pdf-template";

type SnapshotData = {
  insuredSnapshot?: Record<string, unknown> | null;
  packagesSnapshot?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type AccountingLineContext = {
  lineKey: string;
  lineLabel: string;
  values: Record<string, unknown>;
  margin: number | null;
  insurer?: Record<string, unknown> | null;
  collaborator?: Record<string, unknown> | null;
};

export type MergeContext = {
  policyNumber: string;
  createdAt: string;
  snapshot: SnapshotData;
  agent?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  organisation?: Record<string, unknown> | null;
  accountingLines?: AccountingLineContext[];
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

function buildAddress(org: Record<string, unknown>): string {
  const parts: string[] = [];
  const flat = org.flatNumber as string | undefined;
  const floor = org.floorNumber as string | undefined;
  const block = org.blockNumber as string | undefined;
  const blockName = org.blockName as string | undefined;
  const streetNum = org.streetNumber as string | undefined;
  const street = org.streetName as string | undefined;
  const prop = org.propertyName as string | undefined;
  const district = org.districtName as string | undefined;
  const area = org.area as string | undefined;
  if (flat) parts.push(`Flat ${flat}`);
  if (floor) parts.push(`${floor}/F`);
  if (block || blockName) parts.push([block, blockName].filter(Boolean).join(" "));
  if (streetNum || street) parts.push([streetNum, street].filter(Boolean).join(" "));
  if (prop) parts.push(prop);
  if (district) parts.push(district);
  if (area) parts.push(area);
  return parts.join(", ");
}

function resolveAccounting(
  lines: AccountingLineContext[] | undefined,
  lineKey: string | undefined,
  fieldKey: string,
): unknown {
  if (!lines?.length) return "";

  // Find the matching line; default to the first line if no lineKey specified
  const line = lineKey
    ? lines.find((l) => l.lineKey === lineKey) ?? lines[0]
    : lines[0];

  // Financial values (stored as display amounts, not cents)
  if (fieldKey in (line.values ?? {})) return line.values[fieldKey] ?? "";
  if (fieldKey === "margin") return line.margin;
  if (fieldKey === "lineLabel") return line.lineLabel;

  // Insurer fields (per-line insurance company)
  if (fieldKey === "insurerName") return line.insurer?.name ?? "";
  if (fieldKey === "insurerContactName") return line.insurer?.contactName ?? "";
  if (fieldKey === "insurerContactEmail") return line.insurer?.contactEmail ?? "";
  if (fieldKey === "insurerContactPhone") return line.insurer?.contactPhone ?? "";
  if (fieldKey === "insurerAddress" && line.insurer) return buildAddress(line.insurer);
  if (fieldKey.startsWith("insurer") && line.insurer) {
    const subKey = fieldKey.replace(/^insurer/, "");
    const camel = subKey.charAt(0).toLowerCase() + subKey.slice(1);
    return fuzzyGet(line.insurer, camel) ?? "";
  }

  // Collaborator fields (per-line collaborator)
  if (fieldKey === "collaboratorName") return line.collaborator?.name ?? "";
  if (fieldKey.startsWith("collaborator") && line.collaborator) {
    const subKey = fieldKey.replace(/^collaborator/, "");
    const camel = subKey.charAt(0).toLowerCase() + subKey.slice(1);
    return fuzzyGet(line.collaborator, camel) ?? "";
  }

  return "";
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
    case "accounting":
      raw = resolveAccounting(ctx.accountingLines, field.lineKey, field.fieldKey);
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
