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

export type InvoiceContext = {
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  status: string;
  entityName: string | null;
  entityType: string;
  premiumType: string;
  direction: string;
  invoiceType: string;
  periodStart: string | null;
  periodEnd: string | null;
  notes: string | null;
  cancellationDate?: string | null;
  refundReason?: string | null;
  parentInvoiceNumber?: string | null;
};

export type StatementContext = {
  statementNumber: string;
  statementDate: string | null;
  statementStatus: string;
  entityName: string | null;
  entityType: string;
  activeTotal: number;
  paidIndividuallyTotal: number;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  items: {
    description: string | null;
    amountCents: number;
    status: string;
    policyId: number;
  }[];
};

export type MergeContext = {
  policyNumber: string;
  createdAt: string;
  snapshot: SnapshotData;
  agent?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  organisation?: Record<string, unknown> | null;
  accountingLines?: AccountingLineContext[];
  invoiceData?: InvoiceContext | null;
  statementData?: StatementContext | null;
  isTpoWithOd?: boolean;
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

function resolveAccountingTotal(
  lines: AccountingLineContext[],
  fieldKey: string,
): unknown {
  const sumKeys = ["grossPremium", "netPremium", "clientPremium", "agentCommission", "creditPremium", "levy", "stampDuty", "discount"];
  if (sumKeys.includes(fieldKey)) {
    let total = 0;
    let found = false;
    for (const l of lines) {
      const v = Number(l.values[fieldKey]);
      if (Number.isFinite(v)) { total += v; found = true; }
    }
    return found ? total : "";
  }
  if (fieldKey === "margin") {
    let total = 0;
    let found = false;
    for (const l of lines) {
      if (l.margin !== null) { total += l.margin; found = true; }
    }
    return found ? total : "";
  }
  if (fieldKey === "lineLabel") return "Total";
  if (fieldKey === "currency") return lines[0]?.values?.currency ?? "";
  return "";
}

function suffixedPolicyNumber(
  policyNumber: string,
  lineIndex: number,
  totalLines: number,
  isTpoWithOd: boolean,
): string {
  if (!isTpoWithOd || totalLines < 2) return policyNumber;
  const suffix = String.fromCharCode(97 + lineIndex); // a, b, c …
  return `${policyNumber}(${suffix})`;
}

function resolveAccounting(
  lines: AccountingLineContext[] | undefined,
  lineKey: string | undefined,
  fieldKey: string,
  policyNumber?: string,
  isTpoWithOd?: boolean,
): unknown {
  if (!lines?.length) return "";

  if (lineKey === "total" || lineKey === "Total") {
    return resolveAccountingTotal(lines, fieldKey);
  }

  // Find the matching line; default to the first line if no lineKey specified
  const line = lineKey
    ? lines.find((l) => l.lineKey === lineKey) ?? lines[0]
    : lines[0];

  if (fieldKey === "policyNumber" && policyNumber) {
    const idx = lines.indexOf(line);
    return suffixedPolicyNumber(policyNumber, idx >= 0 ? idx : 0, lines.length, !!isTpoWithOd);
  }

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

function resolveInvoice(
  inv: InvoiceContext | null | undefined,
  fieldKey: string,
): unknown {
  if (!inv) return "";
  switch (fieldKey) {
    case "invoiceNumber": return inv.invoiceNumber;
    case "invoiceDate": return inv.invoiceDate ?? "";
    case "dueDate": return inv.dueDate ?? "";
    case "totalAmount": return inv.totalAmountCents / 100;
    case "paidAmount": return inv.paidAmountCents / 100;
    case "remainingAmount": return (inv.totalAmountCents - inv.paidAmountCents) / 100;
    case "status": return inv.status;
    case "entityName": return inv.entityName ?? "";
    case "entityType": return inv.entityType;
    case "premiumType": return inv.premiumType;
    case "direction": return inv.direction;
    case "currency": return inv.currency;
    case "invoiceType": return inv.invoiceType;
    case "periodStart": return inv.periodStart ?? "";
    case "periodEnd": return inv.periodEnd ?? "";
    case "notes": return inv.notes ?? "";
    case "cancellationDate": return inv.cancellationDate ?? "";
    case "refundReason": return inv.refundReason ?? "";
    case "parentInvoiceNumber": return inv.parentInvoiceNumber ?? "";
    default: return "";
  }
}

function resolveStatement(
  stmt: StatementContext | null | undefined,
  fieldKey: string,
): unknown {
  if (!stmt) return "";
  const activeItems = stmt.items.filter((it) => it.status === "active");
  const paidItems = stmt.items.filter((it) => it.status === "paid_individually");

  switch (fieldKey) {
    case "statementNumber": return stmt.statementNumber;
    case "statementDate": return stmt.statementDate ?? "";
    case "statementStatus": return stmt.statementStatus;
    case "entityName": return stmt.entityName ?? "";
    case "entityType": return stmt.entityType;
    case "activeTotal": return stmt.activeTotal / 100;
    case "paidIndividuallyTotal": return stmt.paidIndividuallyTotal / 100;
    case "totalAmountCents": return stmt.totalAmountCents / 100;
    case "paidAmountCents": return stmt.paidAmountCents / 100;
    case "currency": return stmt.currency;
    case "itemCount": return stmt.items.length;
    case "activeItemCount": return activeItems.length;
    case "paidIndividuallyItemCount": return paidItems.length;
    case "itemDescriptions": return activeItems.map((it) => it.description ?? "Premium").join("\n");
    case "itemAmounts": return activeItems.map((it) => (it.amountCents / 100).toFixed(2)).join("\n");
    case "itemStatuses": return stmt.items.map((it) => it.status).join("\n");
    default: return "";
  }
}

export function resolveFieldValue(
  field: PdfFieldMapping,
  ctx: MergeContext,
): string {
  let raw: unknown = "";

  switch (field.source) {
    case "policy": {
      const snap = ctx.snapshot ?? {};
      const map: Record<string, unknown> = {
        policyNumber: ctx.policyNumber,
        createdAt: ctx.createdAt,
        flowKey: snap.flowKey ?? "",
        status: snap.status ?? "",
        linkedPolicyId: snap.linkedPolicyId ?? "",
        linkedPolicyNumber: snap.linkedPolicyNumber ?? "",
        endorsementType: snap.endorsementType ?? "",
        endorsementReason: snap.endorsementReason ?? "",
        effectiveDate: snap.effectiveDate ?? "",
        expiryDate: snap.expiryDate ?? "",
      };
      raw = map[field.fieldKey] ?? snap[field.fieldKey] ?? "";
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
      raw = resolveAccounting(ctx.accountingLines, field.lineKey, field.fieldKey, ctx.policyNumber, ctx.isTpoWithOd);
      break;
    case "invoice":
      raw = resolveInvoice(ctx.invoiceData, field.fieldKey);
      break;
    case "statement":
      raw = resolveStatement(ctx.statementData, field.fieldKey);
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
