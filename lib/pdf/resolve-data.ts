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

function stripPrefix(k: string): string {
  let s = k;
  // Strip known prefixes repeatedly (handles insured__contactinfo__key)
  while (/^(insured|contactinfo)(_+)/i.test(s)) {
    s = s.replace(/^(insured|contactinfo)(_+)/i, "");
  }
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function prefixedGet(
  obj: Record<string, unknown>,
  key: string,
  prefix: string,
): unknown {
  const direct = fuzzyGet(obj, key);
  if (direct !== undefined) return direct;
  for (const sep of ["__", "_"]) {
    const v = fuzzyGet(obj, `${prefix}${sep}${key}`);
    if (v !== undefined) return v;
  }
  const norm = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [k, v] of Object.entries(obj)) {
    if (stripPrefix(k) === norm && v !== undefined && v !== null) return v;
  }
  return "";
}

function insuredGet(insured: Record<string, unknown>, key: string): unknown {
  return prefixedGet(insured, key, "insured");
}

function resolveInsuredDisplayName(insured: Record<string, unknown>): string {
  const insuredType = String(
    insuredGet(insured, "insuredType") ||
    insuredGet(insured, "category") ||
    ""
  ).trim().toLowerCase();

  if (insuredType === "personal") {
    const last = String(insuredGet(insured, "lastName") ?? "").trim();
    const first = String(insuredGet(insured, "firstName") ?? "").trim();
    const combined = [last, first].filter(Boolean).join(" ");
    if (combined) return combined;
    const full = String(insuredGet(insured, "fullName") ?? "").trim();
    if (full) return full;
  }

  if (insuredType === "company") {
    const company = String(insuredGet(insured, "companyName") ?? "").trim();
    if (company) return company;
    const org = String(insuredGet(insured, "organisationName") ?? "").trim();
    if (org) return org;
  }

  // Fallback: try all name fields regardless of type
  for (const k of ["companyName", "organisationName", "fullName"]) {
    const v = String(insuredGet(insured, k) ?? "").trim();
    if (v) return v;
  }
  const last = String(insuredGet(insured, "lastName") ?? "").trim();
  const first = String(insuredGet(insured, "firstName") ?? "").trim();
  return [last, first].filter(Boolean).join(" ");
}

function resolveInsuredPrimaryId(insured: Record<string, unknown>): string {
  const insuredType = String(
    insuredGet(insured, "insuredType") ||
    insuredGet(insured, "category") ||
    ""
  ).trim().toLowerCase();

  if (insuredType === "personal") {
    return String(insuredGet(insured, "idNumber") ?? "").trim();
  }
  if (insuredType === "company") {
    return String(insuredGet(insured, "brNumber") ?? "").trim();
  }
  // Fallback
  const id = String(insuredGet(insured, "idNumber") ?? "").trim();
  if (id) return id;
  return String(insuredGet(insured, "brNumber") ?? "").trim();
}

function resolveInsured(snapshot: SnapshotData, key: string): unknown {
  const insured = snapshot.insuredSnapshot;
  if (!insured || typeof insured !== "object") return "";

  if (key === "displayName") return resolveInsuredDisplayName(insured);
  if (key === "primaryId") return resolveInsuredPrimaryId(insured);

  return insuredGet(insured, key);
}

function contactGet(insured: Record<string, unknown>, key: string): unknown {
  return prefixedGet(insured, key, "contactinfo");
}

function firstNonEmpty(getter: (key: string) => unknown, ...keys: string[]): string {
  for (const k of keys) {
    const v = String(getter(k) ?? "").trim();
    if (v) return v;
  }
  return "";
}

function toTitleCase(s: string): string {
  if (!s) return s;
  const lower = s.toLowerCase();
  if (lower === s || s.toUpperCase() === s) {
    return lower.replace(/(?:^|\s|[-'/])\S/g, (ch) => ch.toUpperCase());
  }
  return s;
}

function buildAddressFromGetter(
  getter: (key: string) => unknown,
): string {
  const parts: string[] = [];
  const flat = firstNonEmpty(getter, "flatNumber", "flatNo", "flat");
  const floor = firstNonEmpty(getter, "floorNumber", "floorNo", "floor", "foorNo");
  const block = firstNonEmpty(getter, "blockNumber", "blockNo");
  const blockName = toTitleCase(firstNonEmpty(getter, "blockName", "block"));
  const streetNum = firstNonEmpty(getter, "streetNumber", "streetNo");
  const street = toTitleCase(firstNonEmpty(getter, "streetName", "street"));
  const prop = toTitleCase(firstNonEmpty(getter, "propertyName", "property"));
  const district = toTitleCase(firstNonEmpty(getter, "districtName", "district"));
  const area = toTitleCase(firstNonEmpty(getter, "area", "region"));
  if (flat) parts.push(`Flat ${flat}`);
  if (floor) parts.push(`${floor}/F`);
  if (block || blockName) parts.push([block, blockName].filter(Boolean).join(" "));
  if (streetNum || street) parts.push([streetNum, street].filter(Boolean).join(" "));
  if (prop) parts.push(prop);
  if (district) parts.push(district);
  if (area) parts.push(area);
  return parts.join(", ");
}

function resolveContact(snapshot: SnapshotData, key: string): unknown {
  const insured = snapshot.insuredSnapshot;
  if (!insured || typeof insured !== "object") return "";

  if (key === "fullAddress") {
    return buildAddressFromGetter((k) => contactGet(insured, k));
  }

  return contactGet(insured, key);
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
      if (!ctx.organisation) {
        raw = "";
      } else if (field.fieldKey === "fullAddress") {
        raw = buildAddress(ctx.organisation);
      } else {
        raw = fuzzyGet(ctx.organisation, field.fieldKey) ?? "";
      }
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
