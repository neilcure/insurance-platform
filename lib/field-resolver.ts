/**
 * Shared field value resolution and formatting.
 *
 * Used by DocumentsTab (HTML preview), resolve-data (PDF generation),
 * and any future consumer that needs to pull a value from policy
 * snapshots, accounting, statements, or entity data.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SnapshotData = {
  insuredSnapshot?: Record<string, unknown> | null;
  packagesSnapshot?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type AccountingLineCtx = {
  lineKey: string;
  lineLabel: string;
  values: Record<string, unknown>;
  margin: number | null;
  insurer?: Record<string, unknown> | null;
  collaborator?: Record<string, unknown> | null;
  insurerName?: string | null;
  collaboratorName?: string | null;
};

export type InvoiceCtx = {
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

export type StatementCtx = {
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
    premiums?: Record<string, number>;
  }[];
  premiumTotals?: Record<string, number>;
};

/** Unified reference to a field in any data source. */
export type FieldRef = {
  source: string;
  fieldKey: string;
  packageName?: string;
  lineKey?: string;
  staticValue?: string;
};

/** Shape of a single document tracking entry (mirrors DocumentStatusEntry). */
export type DocTrackingEntry = {
  documentNumber?: string;
  status?: string;
  sentTo?: string;
  sentAt?: string;
  [key: string]: unknown;
};

/** All data a resolver might need. */
export type ResolveContext = {
  policyNumber?: string;
  policyId?: number;
  createdAt?: string;
  snapshot: SnapshotData;
  policyExtra?: Record<string, unknown>;
  agent?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  organisation?: Record<string, unknown> | null;
  accountingLines?: AccountingLineCtx[];
  invoiceData?: InvoiceCtx | null;
  statementData?: StatementCtx | null;
  isTpoWithOd?: boolean;
  /** Document tracking data keyed by tracking key (e.g. "quotation", "invoice_agent"). */
  documentTracking?: Record<string, DocTrackingEntry> | null;
  /** The current template's tracking key — determines which documentNumber is resolved. */
  currentDocTrackingKey?: string;
};

export type FormatOptions = {
  format?: string;
  currencyCode?: string;
  prefix?: string;
  suffix?: string;
};

// ---------------------------------------------------------------------------
// Key matching utilities
// ---------------------------------------------------------------------------

export function fuzzyGet(obj: Record<string, unknown>, key: string): unknown {
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return obj[k];
  }
  return undefined;
}

function stripPrefix(k: string): string {
  let s = k;
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

// ---------------------------------------------------------------------------
// Address builder
// ---------------------------------------------------------------------------

export function buildAddressFromGetter(getter: (key: string) => unknown): string {
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

function buildAddressFromObj(obj: Record<string, unknown>): string {
  return buildAddressFromGetter((k) => fuzzyGet(obj, k));
}

// ---------------------------------------------------------------------------
// Source resolvers
// ---------------------------------------------------------------------------

function resolveInsuredDisplayName(insured: Record<string, unknown>): string {
  const insuredType = String(
    insuredGet(insured, "insuredType") || insuredGet(insured, "category") || ""
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

  for (const k of ["companyName", "organisationName", "collCoName", "fullName", "name", "displayName"]) {
    const v = String(insuredGet(insured, k) ?? "").trim();
    if (v) return v;
  }
  const last = String(insuredGet(insured, "lastName") ?? "").trim();
  const first = String(insuredGet(insured, "firstName") ?? "").trim();
  return [last, first].filter(Boolean).join(" ");
}

function resolveInsuredPrimaryId(insured: Record<string, unknown>): string {
  const insuredType = String(
    insuredGet(insured, "insuredType") || insuredGet(insured, "category") || ""
  ).trim().toLowerCase();

  if (insuredType === "personal") {
    return String(insuredGet(insured, "idNumber") ?? "").trim();
  }
  if (insuredType === "company") {
    return String(insuredGet(insured, "brNumber") ?? "").trim();
  }
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
    "values" in obj ? ((obj.values as Record<string, unknown>) ?? {}) : obj;
  return (
    fuzzyGet(vals, key) ??
    fuzzyGet(vals, `${packageName}__${key}`) ??
    fuzzyGet(vals, `${packageName}_${key}`) ??
    ""
  );
}

function resolveDocTracking(ctx: ResolveContext, key: string): unknown {
  const trackingKey = ctx.currentDocTrackingKey;
  if (!trackingKey || !ctx.documentTracking) return "";
  const entry = ctx.documentTracking[trackingKey];
  if (!entry) return "";
  switch (key) {
    case "documentNumber": return entry.documentNumber ?? "";
    case "documentStatus": return entry.status ?? "";
    case "documentSentTo": return entry.sentTo ?? "";
    case "documentSentAt": return entry.sentAt ?? "";
    default: return entry[key] ?? "";
  }
}

function resolvePolicy(ctx: ResolveContext, key: string): unknown {
  if (key === "documentNumber" || key === "documentStatus" ||
      key === "documentSentTo" || key === "documentSentAt") {
    return resolveDocTracking(ctx, key);
  }

  const ext = ctx.policyExtra ?? {};
  const map: Record<string, unknown> = {
    policyNumber: ctx.policyNumber,
    policyId: ctx.policyId,
    createdAt: ctx.createdAt,
    flowKey: ext.flowKey ?? "",
    status: ext.status ?? "",
    linkedPolicyId: ext.linkedPolicyId ?? "",
    linkedPolicyNumber: ext.linkedPolicyNumber ?? "",
    endorsementType: ext.endorsementType ?? "",
    endorsementReason: ext.endorsementReason ?? "",
    effectiveDate: ext.effectiveDate ?? "",
    expiryDate: ext.expiryDate ?? "",
  };
  return map[key] ?? ext[key] ?? ctx.snapshot[key] ?? "";
}

function resolveAccountingTotal(
  lines: AccountingLineCtx[],
  fieldKey: string,
): unknown {
  const sumKeys = [
    "grossPremium", "netPremium", "clientPremium", "agentCommission",
    "creditPremium", "levy", "stampDuty", "discount",
  ];
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
  const suffix = String.fromCharCode(97 + lineIndex);
  return `${policyNumber}(${suffix})`;
}

function resolveAccounting(
  lines: AccountingLineCtx[] | undefined,
  lineKey: string | undefined,
  fieldKey: string,
  premiumTotals?: Record<string, number>,
  policyNumber?: string,
  isTpoWithOd?: boolean,
): unknown {
  if (premiumTotals && fieldKey in premiumTotals) {
    return premiumTotals[fieldKey] ?? "";
  }

  if (!lines?.length) return "";

  if (lineKey === "total" || lineKey === "Total") {
    return resolveAccountingTotal(lines, fieldKey);
  }

  const line = lineKey
    ? lines.find((l) => l.lineKey === lineKey) ?? lines[0]
    : lines[0];

  if (fieldKey === "policyNumber" && policyNumber) {
    const idx = lines.indexOf(line);
    return suffixedPolicyNumber(policyNumber, idx >= 0 ? idx : 0, lines.length, !!isTpoWithOd);
  }

  if (fieldKey in (line.values ?? {})) return line.values[fieldKey] ?? "";
  if (fieldKey === "margin") return line.margin;
  if (fieldKey === "lineLabel") return line.lineLabel;

  const insurerObj = line.insurer ?? (line.insurerName != null ? { name: line.insurerName } : null);
  if (fieldKey === "insurerName") return insurerObj?.name ?? line.insurerName ?? "";
  if (fieldKey === "insurerContactName" && insurerObj) return (insurerObj as Record<string, unknown>).contactName ?? "";
  if (fieldKey === "insurerContactEmail" && insurerObj) return (insurerObj as Record<string, unknown>).contactEmail ?? "";
  if (fieldKey === "insurerContactPhone" && insurerObj) return (insurerObj as Record<string, unknown>).contactPhone ?? "";
  if (fieldKey === "insurerAddress" && insurerObj) return buildAddressFromObj(insurerObj as Record<string, unknown>);
  if (fieldKey.startsWith("insurer") && insurerObj) {
    const subKey = fieldKey.replace(/^insurer/, "");
    const camel = subKey.charAt(0).toLowerCase() + subKey.slice(1);
    return fuzzyGet(insurerObj as Record<string, unknown>, camel) ?? "";
  }

  const collabObj = line.collaborator ?? (line.collaboratorName != null ? { name: line.collaboratorName } : null);
  if (fieldKey === "collaboratorName") return collabObj?.name ?? line.collaboratorName ?? "";
  if (fieldKey.startsWith("collaborator") && collabObj) {
    const subKey = fieldKey.replace(/^collaborator/, "");
    const camel = subKey.charAt(0).toLowerCase() + subKey.slice(1);
    return fuzzyGet(collabObj as Record<string, unknown>, camel) ?? "";
  }

  return "";
}

function resolveInvoice(inv: InvoiceCtx | null | undefined, fieldKey: string): unknown {
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

function resolveStatement(stmt: StatementCtx | null | undefined, fieldKey: string, ctx?: ResolveContext): unknown {
  if (!stmt) return "";
  const activeItems = stmt.items.filter((it) => it.status === "active");
  const paidItems = stmt.items.filter((it) => it.status === "paid_individually");

  switch (fieldKey) {
    case "statementNumber": {
      if (stmt.statementNumber) return stmt.statementNumber;
      // Fall back to the template's own document number
      const trackKey = ctx?.currentDocTrackingKey;
      if (trackKey && ctx?.documentTracking?.[trackKey]?.documentNumber) {
        return ctx.documentTracking[trackKey].documentNumber;
      }
      return "";
    }
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
    default: {
      if (fieldKey.startsWith("item_")) {
        const premKey = fieldKey.slice(5);
        return activeItems
          .map((it) => {
            const v = it.premiums?.[premKey];
            return v != null ? v : "";
          })
          .join("\n");
      }
      return "";
    }
  }
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a raw field value from the given context.
 * Returns the unformatted value — call `formatFieldValue` to format for display.
 */
export function resolveRawValue(ref: FieldRef, ctx: ResolveContext): unknown {
  switch (ref.source) {
    case "policy":
      return resolvePolicy(ctx, ref.fieldKey);

    case "insured":
      return resolveInsured(ctx.snapshot, ref.fieldKey);

    case "contactinfo":
      return resolveContact(ctx.snapshot, ref.fieldKey);

    case "package":
      return resolvePackage(ctx.snapshot, ref.packageName ?? "", ref.fieldKey);

    case "agent":
      return ctx.agent ? fuzzyGet(ctx.agent, ref.fieldKey) ?? "" : "";

    case "client":
      return ctx.client ? fuzzyGet(ctx.client, ref.fieldKey) ?? "" : "";

    case "organisation":
      if (!ctx.organisation) return "";
      if (ref.fieldKey === "fullAddress") return buildAddressFromObj(ctx.organisation);
      return fuzzyGet(ctx.organisation, ref.fieldKey) ?? "";

    case "accounting":
      return resolveAccounting(
        ctx.accountingLines,
        ref.lineKey,
        ref.fieldKey,
        ctx.statementData?.premiumTotals,
        ctx.policyNumber,
        ctx.isTpoWithOd,
      );

    case "invoice":
      return resolveInvoice(ctx.invoiceData, ref.fieldKey);

    case "statement":
      return resolveStatement(ctx.statementData, ref.fieldKey, ctx);

    case "static":
      return ref.staticValue ?? "";

    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a raw value for display.
 * Handles currency (with multi-line support), date, boolean, and number.
 */
export function formatResolvedValue(
  raw: unknown,
  format?: string,
  currencyCode?: string,
): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";

  if (format === "currency" || format === "negative_currency") {
    const cur = (currencyCode || "HKD").toUpperCase();
    const fmtOne = (v: unknown) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return String(v);
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
      } catch {
        return n.toFixed(2);
      }
    };
    if (s.includes("\n")) {
      return s.split("\n").map((line) => fmtOne(line.trim())).join("\n");
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return s;
    return fmtOne(n);
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

/**
 * Resolve + format in one call. Convenience wrapper used by PDF and HTML
 * template consumers that want a final display string.
 */
export function resolveAndFormat(
  ref: FieldRef,
  ctx: ResolveContext,
  opts?: FormatOptions,
): string {
  const raw = resolveRawValue(ref, ctx);
  const formatted = formatResolvedValue(raw, opts?.format, opts?.currencyCode);
  const prefix = opts?.prefix ?? "";
  const suffix = opts?.suffix ?? "";
  return `${prefix}${formatted}${suffix}`;
}

// ---------------------------------------------------------------------------
// Convenience helpers for direct use (no full ResolveContext needed)
// ---------------------------------------------------------------------------

/**
 * Extract display name from an insured snapshot object.
 * Handles personal (lastName + firstName) and company (companyName) patterns,
 * with fuzzy key matching for prefixed keys like `insured__lastName`.
 */
export function getInsuredDisplayName(insured: Record<string, unknown> | null | undefined): string {
  if (!insured || typeof insured !== "object") return "";
  return resolveInsuredDisplayName(insured);
}

/**
 * Extract the insured type from a snapshot object (personal / company).
 */
export function getInsuredType(insured: Record<string, unknown> | null | undefined): string {
  if (!insured || typeof insured !== "object") return "";
  return String(
    insuredGet(insured, "insuredType") || insuredGet(insured, "category") || ""
  ).trim().toLowerCase();
}

/**
 * Extract primary ID (idNumber for personal, brNumber for company).
 */
export function getInsuredPrimaryId(insured: Record<string, unknown> | null | undefined): string {
  if (!insured || typeof insured !== "object") return "";
  return resolveInsuredPrimaryId(insured);
}

/**
 * Extract a contact field from an insured snapshot (e.g. mobile, tel, email).
 * Uses prefixed key matching for `contactinfo__` variants.
 */
export function getContactField(insured: Record<string, unknown> | null | undefined, key: string): string {
  if (!insured || typeof insured !== "object") return "";
  return String(contactGet(insured, key) ?? "").trim();
}

/**
 * Extract a display name by scanning all package values for name-like fields.
 * Falls back to insured snapshot if packages don't contain a name.
 */
export function getDisplayNameFromSnapshot(
  snapshot: { insuredSnapshot?: Record<string, unknown> | null; packagesSnapshot?: Record<string, unknown> | null },
): string {
  const insured = snapshot.insuredSnapshot;
  if (insured && typeof insured === "object") {
    const name = resolveInsuredDisplayName(insured);
    if (name) return name;
  }

  const pkgs = (snapshot.packagesSnapshot ?? {}) as Record<string, unknown>;
  for (const data of Object.values(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const obj = data as Record<string, unknown>;
    const vals = "values" in obj ? ((obj.values as Record<string, unknown>) ?? {}) : obj;
    for (const [k, v] of Object.entries(vals)) {
      const norm = k.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");
      if (/companyname|organisationname|organizationname|fullname|displayname|insurername|collconame|^name$/.test(norm) && v) {
        return String(v).trim();
      }
    }
  }

  return "";
}
