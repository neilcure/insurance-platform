/**
 * Shared field value resolution and formatting.
 *
 * Used by DocumentsTab (HTML preview), resolve-data (PDF generation),
 * and any future consumer that needs to pull a value from policy
 * snapshots, accounting, statements, or entity data.
 */
import { evaluateFormula } from "@/lib/formula";

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

/**
 * Admin-configured package field metadata, used by `resolvePackage` to
 * fall back to a same-label variant when the placed key resolves empty.
 *
 * Lets a single PDF placement (e.g. one "Make" field) auto-resolve to the
 * right snapshot value across vehicle categories — analogous to how the
 * synthetic `displayName` field auto-resolves personal vs company name.
 */
export type PackageFieldVariant = {
  /** The field's `value` column in `form_options` — the snapshot key. */
  key: string;
  /** Human-readable label shared across category-scoped variants. */
  label: string;
  /** `meta.categories` from `form_options` (empty = applies to all). */
  categories?: string[];
  /**
   * Select / multi-select option list (`meta.options[]`) when present.
   * Used to translate stored option values (e.g. `"hkonly"`) into their
   * human-readable labels (e.g. `"Hong Kong Only"`) at PDF render time.
   * Match is case-insensitive on the option `value`.
   */
  options?: { value: string; label: string }[];
  /**
   * Schema of each row's child fields when this variant represents a
   * repeatable parent (top-level `inputType: "repeatable"` OR a boolean
   * branch child with `inputType: "repeatable"`). Used by the resolver's
   * `__r<N>__` path to evaluate **formula** children at PDF render time
   * when the row's stored value is empty — covers the case where the
   * formula was added to admin AFTER policies were saved (so the wizard
   * never had a chance to compute and persist the value).
   */
  repeatableChildren?: { value: string; inputType?: string; formula?: string }[];
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
    paymentBadge?: string;
  }[];
  premiumTotals?: Record<string, number>;
  summaryTotals?: Record<string, number>;
  agentPaidTotal?: number;
  clientPaidTotal?: number;
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
  /** Latest verified/recorded client payment info for this policy (used by receipts). */
  paymentData?: {
    latestClientPaidAmount?: number;
    latestClientPaidDate?: string | null;
    latestClientPaymentRef?: string | null;
  } | null;
  /**
   * Per-package admin-configured field variants, keyed by `packageName`.
   * Populated by `buildMergeContext` from `form_options`. Used for the
   * "by-label" auto-resolution path in `resolvePackage`. Optional — when
   * absent, only direct key resolution is performed (existing behavior).
   */
  packageFieldVariants?: Record<string, PackageFieldVariant[]>;
};

export type FormatOptions = {
  format?: string;
  currencyCode?: string;
  prefix?: string;
  suffix?: string;
  /** Boolean / match: rendered string when condition is true. */
  trueValue?: string;
  /** Boolean / match: rendered string when condition is false. */
  falseValue?: string;
  /** Match format only: target string compared against the resolved value. */
  matchValue?: string;
};

/** Extra options passed to {@link formatResolvedValue}. */
export type FormatExtras = {
  trueValue?: string;
  falseValue?: string;
  matchValue?: string;
};

// ---------------------------------------------------------------------------
// By-label synthetic key (auto-resolution by category)
// ---------------------------------------------------------------------------

/**
 * Prefix used to mark a synthetic `package` field that should auto-resolve
 * by matching the admin-configured field's label to the policy's selected
 * category. Mirrors how the resolver special-cases `displayName` for
 * insured personal vs company.
 *
 * Example: an admin-configured "Make" field exists three times in
 * `vehicleinfo_fields` with different keys (`make`, `motorcycle_make`,
 * `truck_make`) scoped to different vehicle categories. The PDF dialog
 * collapses them into one entry whose mapping has
 * `fieldKey = "__byLabel__make"`. At render time the resolver picks the
 * variant whose `categories` include the policy's `vehicleinfo` category.
 */
export const BY_LABEL_KEY_PREFIX = "__byLabel__";

/**
 * Normalises a human label to a stable slug used for grouping same-label
 * variants and matching the `__byLabel__<slug>` synthetic key. Strips
 * case and non-alphanumeric characters so `Body Type`, `Body type` and
 * `body-type` all map to `bodytype`.
 */
export function slugifyLabel(label: string): string {
  return String(label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function buildByLabelKey(label: string): string {
  return `${BY_LABEL_KEY_PREFIX}${slugifyLabel(label)}`;
}

export function isByLabelKey(key: string): boolean {
  return typeof key === "string" && key.startsWith(BY_LABEL_KEY_PREFIX);
}

function parseByLabelKey(key: string): string | null {
  if (!isByLabelKey(key)) return null;
  return key.slice(BY_LABEL_KEY_PREFIX.length);
}

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
  // Replace underscores (stored as slug separators by deriveOptionValue) with spaces.
  const normalised = s.replace(/_/g, " ");
  const lower = normalised.toLowerCase();
  if (lower === normalised || normalised.toUpperCase() === normalised) {
    return lower.replace(/(?:^|\s|[-'/])\S/g, (ch) => ch.toUpperCase());
  }
  return normalised;
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

/**
 * Common admin-configured field keys that carry the insured's primary
 * legal identifier, by category. Tenants vary — Hong Kong setups use
 * `brNumber` (Business Registration) or `ciNumber` (Certificate of
 * Incorporation) for companies, and `idNumber` / `hkid` for individuals.
 * We try each in order so a single PDF placement works across tenants
 * regardless of which field the admin happened to configure.
 *
 * Adding more aliases here is safe: `insuredGet` returns "" for missing
 * keys, so the chain just falls through.
 */
const PERSONAL_ID_KEYS = ["idNumber", "hkid", "idCard", "id_card", "identityNumber"] as const;
const COMPANY_ID_KEYS = ["brNumber", "ciNumber", "crNumber", "businessNumber", "companyId"] as const;

/**
 * Driver-package OWNER field key → equivalent sub-field key inside one
 * row of the `moreDriver = Yes` repeatable. Used by `resolvePackage` to
 * fall back to `moreDriver[0]` when the owner field is empty (the case
 * for company-insured and personal-without-license policies, where the
 * primary driver is entered as the first extra-driver row instead of
 * through the owner section).
 *
 * Lower-cased keys for case-insensitive lookup. Mirror of
 * `DRIVER_SLOT_TO_OWNER_KEY` in `lib/import/payload.ts` — keep both in
 * sync when admins rename driver fields.
 */
const OWNER_KEY_TO_DRIVER_SLOT_CHILD: Record<string, string> = {
  lastname: "lastName",
  firstname: "firstName",
  ownerboa: "dob",
  ownerdlicence: "dLicense",
  relationshiptheowner: "relationship",
  occuption: "occuption",
  ownerpostion: "postion",
};

function resolveInsuredPrimaryId(insured: Record<string, unknown>): string {
  const insuredType = String(
    insuredGet(insured, "insuredType") || insuredGet(insured, "category") || ""
  ).trim().toLowerCase();
  const get = (k: string) => insuredGet(insured, k);

  if (insuredType === "personal") {
    return firstNonEmpty(get, ...PERSONAL_ID_KEYS);
  }
  if (insuredType === "company") {
    return firstNonEmpty(get, ...COMPANY_ID_KEYS);
  }
  // Unknown / missing type: try personal IDs first (more common), then
  // company IDs as a fallback.
  return firstNonEmpty(get, ...PERSONAL_ID_KEYS, ...COMPANY_ID_KEYS);
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

/**
 * Read the package's selected category. The wizard saves it on the outer
 * package object (`packagesSnapshot[pkg].category`); some legacy snapshots
 * keep it inside `values`, so we check both.
 */
function getPackageCategory(
  pkgObj: Record<string, unknown>,
  vals: Record<string, unknown>,
): string {
  const direct = pkgObj.category;
  if (typeof direct === "string" || typeof direct === "number") {
    const s = String(direct).trim();
    if (s) return s.toLowerCase();
  }
  const inner = fuzzyGet(vals, "category");
  if (typeof inner === "string" || typeof inner === "number") {
    return String(inner).trim().toLowerCase();
  }
  return "";
}

/**
 * By-label resolution for synthetic `__byLabel__<slug>` keys.
 *
 * Walks `ctx.packageFieldVariants[packageName]`, picks variants whose
 * label slugifies to the requested slug, and returns the first non-empty
 * snapshot value, preferring (1) variants whose categories include the
 * policy's selected category, then (2) variants with no category
 * restriction, then (3) anything else as a last-resort.
 */
function resolveByLabelVariant(
  packageName: string,
  labelSlug: string,
  pkgObj: Record<string, unknown>,
  vals: Record<string, unknown>,
  ctx?: ResolveContext,
): unknown {
  const variants = ctx?.packageFieldVariants?.[packageName] ?? [];
  if (variants.length === 0) return "";
  const matches = variants.filter((v) => slugifyLabel(v.label) === labelSlug);
  if (matches.length === 0) return "";

  const pkgCategory = getPackageCategory(pkgObj, vals);

  const ranked: PackageFieldVariant[] = [];
  if (pkgCategory) {
    for (const v of matches) {
      const cats = (v.categories ?? []).map((c) => String(c ?? "").trim().toLowerCase());
      if (cats.includes(pkgCategory)) ranked.push(v);
    }
  }
  for (const v of matches) {
    if (ranked.includes(v)) continue;
    if ((v.categories ?? []).length === 0) ranked.push(v);
  }
  for (const v of matches) {
    if (!ranked.includes(v)) ranked.push(v);
  }

  for (const v of ranked) {
    const direct =
      fuzzyGet(vals, v.key)
      ?? fuzzyGet(vals, `${packageName}__${v.key}`)
      ?? fuzzyGet(vals, `${packageName}_${v.key}`);
    if (direct !== undefined && direct !== null && direct !== "") {
      // Translate select option value → human-readable label using
      // the matched variant's option list. No-op when the variant has
      // no `options` (free-form field).
      return translateOptionValue(direct, v);
    }
  }
  return "";
}

/**
 * Translate a stored option value (e.g. `"hkonly"`) into its human-
 * readable label (e.g. `"Hong Kong Only"`) using the variant's option
 * list. Handles single values, comma-separated multi-select strings,
 * and arrays. Returns the original value when no matching option is
 * found, so non-select fields and free-form values pass through
 * unchanged.
 */
function translateOptionValue(
  raw: unknown,
  variant: PackageFieldVariant | undefined,
): unknown {
  if (raw === null || raw === undefined || raw === "") return raw;
  const opts = variant?.options;
  if (!opts || opts.length === 0) return raw;

  const lookup = (val: unknown): string => {
    const s = String(val ?? "").trim();
    if (!s) return s;
    const match = opts.find(
      (o) => String(o.value ?? "").toLowerCase() === s.toLowerCase(),
    );
    return match ? (match.label || s) : s;
  };

  if (Array.isArray(raw)) {
    const labels = raw.map(lookup).filter((s) => s.length > 0);
    return labels.join(", ");
  }
  if (typeof raw === "string" && raw.includes(",")) {
    const labels = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => lookup(p));
    return labels.join(", ");
  }
  return lookup(raw);
}

/**
 * Find the variant matching the requested key in the package's variant
 * list. Tries exact key match first, then case-insensitive, then a
 * by-label match (for synthetic `__byLabel__` requests where the
 * caller already resolved the label slug).
 */
function findVariantForKey(
  variants: PackageFieldVariant[] | undefined,
  key: string,
): PackageFieldVariant | undefined {
  if (!variants || variants.length === 0) return undefined;
  return (
    variants.find((v) => v.key === key)
    ?? variants.find((v) => v.key.toLowerCase() === key.toLowerCase())
  );
}

function resolvePackage(
  snapshot: SnapshotData,
  packageName: string,
  key: string,
  ctx?: ResolveContext,
): unknown {
  const pkgs = (snapshot.packagesSnapshot ?? {}) as Record<string, unknown>;
  const pkg = pkgs[packageName];
  if (!pkg || typeof pkg !== "object") return "";
  const obj = pkg as Record<string, unknown>;
  const vals =
    "values" in obj ? ((obj.values as Record<string, unknown>) ?? {}) : obj;

  // Synthetic "__byLabel__<slug>" key — auto-resolve by matching admin
  // field label to the policy's category. Lets one PDF placement render
  // the right value regardless of which category-scoped variant the user
  // filled in (e.g. one "Make" field works for car, motorcycle, truck …).
  const labelSlug = parseByLabelKey(key);
  if (labelSlug !== null) {
    return resolveByLabelVariant(packageName, labelSlug, obj, vals, ctx);
  }

  // Repeatable row addressing: `${parent}__r${index}__${child}` looks
  // up the Nth row of an array stored at `vals[parent]` (e.g. multiple
  // drivers, beneficiaries). The wizard saves repeatable groups as
  // arrays of objects under the parent key, and the PDF template
  // editor exposes one indexed entry per slot. Returns "" when the
  // row is missing so unfilled slots render blank.
  const repMatch = key.match(/^(.+?)__r(\d+)__(.+)$/);
  if (repMatch) {
    const [, parentKey, idxStr, childKey] = repMatch;
    const arr =
      fuzzyGet(vals, parentKey)
      ?? fuzzyGet(vals, `${packageName}__${parentKey}`)
      ?? fuzzyGet(vals, `${packageName}_${parentKey}`);
    if (Array.isArray(arr)) {
      const idx = Number(idxStr);
      const row = arr[idx];
      if (row && typeof row === "object") {
        const v = fuzzyGet(row as Record<string, unknown>, childKey);
        if (v !== undefined && v !== null && v !== "") return v;
        // FORMULA-AT-RENDER FALLBACK: if the row has no stored value
        // for this child, but the admin field is configured as a
        // formula (e.g. "Age = YEARS_BETWEEN(TODAY, {dob})"), evaluate
        // the formula now using the row's other values. Covers the
        // case where the formula was added to admin AFTER policies
        // were saved (so the wizard's `RepeatableFormulaCell` never
        // had a chance to compute and persist it). The wizard still
        // computes and persists for newly-saved policies — this just
        // back-fills existing rows so admins don't have to re-open
        // and save every policy after a formula change.
        const variant = findVariantForKey(
          ctx?.packageFieldVariants?.[packageName],
          parentKey,
        );
        const childSchema = variant?.repeatableChildren?.find(
          (c) => c.value.toLowerCase() === childKey.toLowerCase(),
        );
        if (
          childSchema
          && String(childSchema.inputType ?? "").toLowerCase() === "formula"
          && childSchema.formula
        ) {
          const computed = evaluateFormula(
            childSchema.formula,
            row as Record<string, unknown>,
          );
          if (computed) return computed;
        }
        return "";
      }
    }
    return "";
  }

  // For multi-cover motor policies, a single snapshot key like policyinfo__coverType
  // may only hold one option ("tpo") while accounting lines contain the full set ("tpo"+"pd").
  // Prefer accounting line labels (human-readable) when available.
  if (packageName.toLowerCase() === "policyinfo" && key.toLowerCase() === "covertype") {
    const lines = (ctx?.accountingLines ?? [])
      .map((l) => ({
        key: String(l.lineKey ?? "").trim().toLowerCase(),
        label: String(l.lineLabel ?? "").trim(),
      }))
      .filter((l) => l.key && l.key !== "total");
    const seen = new Set<string>();
    const unique = lines.filter((l) => {
      if (seen.has(l.key)) return false;
      seen.add(l.key);
      return true;
    });
    const names = unique
      .map((l) => l.label || l.key.toUpperCase())
      .filter(Boolean);
    if (names.length > 0) {
      return names.join(" + ");
    }
  }

  const direct = (
    fuzzyGet(vals, key) ??
    fuzzyGet(vals, `${packageName}__${key}`) ??
    fuzzyGet(vals, `${packageName}_${key}`)
  );

  // Driver-package owner → moreDriver[0] fallback.
  //
  // The wizard has TWO physical places where Driver 1's identity may live:
  //   (a) `driver` package OWNER fields (driver__lastname, driver__ownerBoA, …)
  //       — populated automatically from the insured when the personal
  //       insured ticks "The insured with Driving License? = Yes" (via the
  //       autoFill config on form_options.theOqnwewithDL), OR entered
  //       manually for company / personal-no-license policies that still
  //       want to use the owner section.
  //   (b) The `moreDriver = Yes` boolean-child REPEATABLE
  //       (`driver__moreDriver__true__c0[0]`) — used when the insured is a
  //       company or personal-without-license, so the actual primary driver
  //       is entered as the FIRST extra-driver row.
  //
  // To let a single PDF placement of "Driver Information" render the
  // correct value across all three scenarios (personal+yes / personal+no /
  // company), if the owner field is empty we transparently fall back to
  // the equivalent sub-field of moreDriver row 0. The owner ↔ slot key
  // mapping mirrors `DRIVER_SLOT_TO_OWNER_KEY` in lib/import/payload.ts.
  const directIsEmpty = direct === undefined || direct === null || direct === "";
  if (directIsEmpty && packageName.toLowerCase() === "driver") {
    const slotChildKey = OWNER_KEY_TO_DRIVER_SLOT_CHILD[key.toLowerCase()];
    if (slotChildKey) {
      const slotArr =
        fuzzyGet(vals, "moreDriver__true__c0")
        ?? fuzzyGet(vals, "driver__moreDriver__true__c0")
        ?? fuzzyGet(vals, "driver_moreDriver__true__c0");
      if (Array.isArray(slotArr) && slotArr.length > 0) {
        const row0 = slotArr[0] as Record<string, unknown> | null | undefined;
        if (row0 && typeof row0 === "object") {
          const v = fuzzyGet(row0, slotChildKey);
          if (v !== undefined && v !== null && v !== "") {
            const variant = findVariantForKey(ctx?.packageFieldVariants?.[packageName], key);
            return translateOptionValue(v, variant);
          }
        }
      }
    }
  }

  if (direct !== undefined && direct !== null && direct !== "") {
    // SMART BOOLEAN ROUTING: when the resolved value is a boolean
    // (literal or "true"/"false" string) AND the admin configured a
    // nested branch child whose own value is set, prefer that
    // translated value instead. Maps the admin's
    // `meta.booleanChildren.{true,false}[idx]` config exactly: the
    // wizard names branch children `${key}__${branch}__c${idx}`.
    //
    // Lets a single PDF placement of e.g. "No Claims Bonus
    // (Discount)" render the chosen child option label ("Fleet"
    // / "10" / "20" / "New Purchase") instead of "true" / "false".
    //
    // Covers the common case of one branch child at index 0;
    // multi-child cases (c1, c2, ...) require explicit per-child
    // placements from the picker.
    const directIsBool =
      direct === "true" || direct === "false"
      || direct === true || direct === false;
    if (directIsBool) {
      const branch = String(direct);
      const childKey = `${key}__${branch}__c0`;
      const childRaw = (
        fuzzyGet(vals, childKey)
        ?? fuzzyGet(vals, `${packageName}__${childKey}`)
        ?? fuzzyGet(vals, `${packageName}_${childKey}`)
      );
      if (childRaw !== undefined && childRaw !== null && childRaw !== "") {
        const childVariant = findVariantForKey(
          ctx?.packageFieldVariants?.[packageName],
          childKey,
        );
        return translateOptionValue(childRaw, childVariant);
      }
    }

    // For select / multi-select fields, translate the stored option
    // value (e.g. "hkonly") into the human-readable label (e.g.
    // "Hong Kong Only"). Pass-through for free-form fields whose
    // variant has no `options` configured.
    const variant = findVariantForKey(ctx?.packageFieldVariants?.[packageName], key);
    return translateOptionValue(direct, variant);
  }

  // Same-label sibling fallback. When the placed key matches a known
  // admin-configured variant whose categories don't match this policy
  // (e.g. an old PDF placed `motorcycle_model` rendering against a CAR
  // policy where only `model` has data), look for a sibling with the
  // same label whose categories do match. Lets templates created before
  // the by-label feature auto-fix without re-placing every field.
  const variants = ctx?.packageFieldVariants?.[packageName];
  if (variants && variants.length > 0) {
    const requested = variants.find(
      (v) => v.key === key || v.key.toLowerCase() === key.toLowerCase(),
    );
    if (requested?.label) {
      const fallback = resolveByLabelVariant(
        packageName,
        slugifyLabel(requested.label),
        obj,
        vals,
        ctx,
      );
      if (fallback !== undefined && fallback !== null && fallback !== "") {
        return fallback;
      }
    }
  }

  // Backward-compatible receipt fallback:
  // Some existing templates use package.policyinfo.premium while paid amount is stored in accounting payments.
  if (packageName.toLowerCase() === "policyinfo" && key.toLowerCase() === "premium") {
    const paid = ctx?.paymentData?.latestClientPaidAmount;
    if (typeof paid === "number" && Number.isFinite(paid)) return paid;
  }
  return "";
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
  // Only keys that map to ACTUAL columns on the policies table are listed
  // here. Anything else (effectiveDate, status, endorsement*, etc.) falls
  // through to ext[key] / snapshot[key] for backward compatibility with old
  // templates, but is not advertised in the admin Policy Info source.
  const map: Record<string, unknown> = {
    policyNumber: ctx.policyNumber,
    policyId: ctx.policyId,
    createdAt: ctx.createdAt,
    flowKey: ext.flowKey ?? "",
    // Payment fields keep their explicit mapping because they have a clean
    // resolver source (paymentData) that's distinct from the JSONB blob.
    latestClientPaidAmount: ctx.paymentData?.latestClientPaidAmount ?? "",
    latestClientPaidDate: ctx.paymentData?.latestClientPaidDate ?? "",
    latestClientPaymentRef: ctx.paymentData?.latestClientPaymentRef ?? "",
    paymentAmount: ctx.paymentData?.latestClientPaidAmount ?? "",
    paymentDate: ctx.paymentData?.latestClientPaidDate ?? "",
    paymentReference: ctx.paymentData?.latestClientPaymentRef ?? "",
  };
  if (key in map) return map[key];
  // Backward-compat fallback for templates that referenced fields living
  // inside extraAttributes or the snapshot root.
  if (key in ext) return ext[key];
  if (key in ctx.snapshot) return ctx.snapshot[key];
  return "";
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
  summaryTotals?: Record<string, number>,
  policyNumber?: string,
  isTpoWithOd?: boolean,
): unknown {
  if (premiumTotals && fieldKey in premiumTotals) {
    return premiumTotals[fieldKey] ?? "";
  }
  if (summaryTotals && fieldKey in summaryTotals) {
    const v = summaryTotals[fieldKey];
    return typeof v === "number" ? v / 100 : "";
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
  const billableStatuses = new Set(["active", "paid_individually"]);
  const statementBillableItems = stmt.items.filter((it) => billableStatuses.has(it.status));
  const isCommissionItem = (it: StatementCtx["items"][number]) => {
    return String(it.description ?? "").trim().toLowerCase().includes("commission:");
  };
  const isCreditItem = (it: StatementCtx["items"][number]) => {
    return String(it.description ?? "").trim().toLowerCase().includes("credit:");
  };
  const computedCommissionFromItemsCents = stmt.items
    .filter((it) => isCommissionItem(it))
    .reduce((sum, it) => sum + Number(it.amountCents ?? 0), 0);
  const summaryCommissionTotalCents = Number(stmt.summaryTotals?.commissionTotal ?? 0);
  const commissionTotalCents = summaryCommissionTotalCents > 0
    ? summaryCommissionTotalCents
    : Math.max(computedCommissionFromItemsCents, 0);
  // Total Due = ALL premiums (active + paid) using pre-computed role-resolved values.
  // Agent statements use agent premium, client statements use client premium.
  const totalDueCents = stmt.activeTotal + stmt.paidIndividuallyTotal;

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
    case "activeTotal": return totalDueCents / 100;
    case "paidIndividuallyTotal": return (stmt.clientPaidTotal ?? 0) / 100;
    case "totalAmountCents": return stmt.totalAmountCents / 100;
    case "paidAmountCents": return stmt.paidAmountCents / 100;
    case "agentPaidTotal": return (stmt.agentPaidTotal ?? 0) / 100;
    case "outstandingTotal": {
      // Outstanding = unpaid items only (activeTotal).
      // paidIndividuallyTotal already covers client-paid AND agent-paid items.
      // Commission is already factored into agent premium amounts.
      return Math.max(stmt.activeTotal, 0) / 100;
    }
    case "creditToAgent": {
      // Credit to Agent = commission the company owes the agent.
      return commissionTotalCents > 0 ? commissionTotalCents / 100 : "";
    }
    case "currency": return stmt.currency;
    case "policyPremiumTotal":
    case "endorsementPremiumTotal":
    case "creditTotal":
    case "commissionTotal": {
      const v = stmt.summaryTotals?.[fieldKey];
      return typeof v === "number" ? v / 100 : "";
    }
    case "itemCount": return stmt.items.length;
    case "activeItemCount": return activeItems.length;
    case "paidIndividuallyItemCount": return paidItems.length;
    case "itemDescriptions": return activeItems.map((it) => it.description ?? "Premium").join("\n");
    case "itemAmounts": return activeItems.map((it) => (it.amountCents / 100).toFixed(2)).join("\n");
    case "itemStatuses": return stmt.items.map((it) => it.status).join("\n");
    case "itemPaymentBadges": return statementBillableItems
      .filter((it) => !isCommissionItem(it) && !isCreditItem(it))
      .map((it) => it.paymentBadge ?? "")
      .join("\n");
    default: {
      if (fieldKey.startsWith("item_")) {
        const premKey = fieldKey.slice(5);
        if (premKey === "paymentBadge") {
          return activeItems.map((it) => it.paymentBadge ?? "").join("\n");
        }
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
      return resolvePackage(ctx.snapshot, ref.packageName ?? "", ref.fieldKey, ctx);

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
        ctx.statementData?.summaryTotals,
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
  extras?: FormatExtras,
): string {
  // `boolean` and `match` formats need to render their `falseValue`
  // (e.g. an empty string for an unticked checkbox) even when the raw
  // value is empty / undefined, so handle them BEFORE the empty-check
  // fast path used by the other formats.
  if (format === "boolean") {
    const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
    const isTrue = normalized === true
      || normalized === "true"
      || normalized === 1
      || normalized === "1"
      || normalized === "yes"
      || normalized === "y";
    return isTrue ? (extras?.trueValue ?? "Yes") : (extras?.falseValue ?? "No");
  }

  if (format === "match") {
    const target = (extras?.matchValue ?? "").trim();
    const valStr = raw === null || raw === undefined ? "" : String(raw).trim();
    const matched = target.length > 0
      && (valStr === target || valStr.toLowerCase() === target.toLowerCase());
    return matched ? (extras?.trueValue ?? "✓") : (extras?.falseValue ?? "");
  }

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
  const formatted = formatResolvedValue(raw, opts?.format, opts?.currencyCode, {
    trueValue: opts?.trueValue,
    falseValue: opts?.falseValue,
    matchValue: opts?.matchValue,
  });
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
