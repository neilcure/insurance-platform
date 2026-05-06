/**
 * Client-safe accounting / premium field helpers — no DB imports.
 * Imported by `PackageBlock` and other client bundles; mirrors server rules
 * in `lib/accounting-fields.ts`.
 */
import { isAdminLikeUserType } from "@/lib/user-types";

export type ColumnType = "cents" | "rate" | "string";

export type PremiumContext = "policy" | "collaborator" | "insurer" | "client" | "agent" | "self";

export type PremiumRole = "client" | "agent" | "net" | "commission";

export type AccountingFieldDef = {
  key: string;
  label: string;
  inputType: string;
  sortOrder: number;
  groupOrder?: number;
  groupName?: string;
  options?: Array<{ value: string; label: string }>;
  premiumColumn?: string;
  premiumContexts?: PremiumContext[];
  premiumRole?: PremiumRole;
  currencyCode?: string;
  decimals?: number;
  formula?: string;
  visibleToUserTypes?: string[];
};

/**
 * Maps one `form_options` row (premiumRecord_fields group or equivalent shape)
 * into `AccountingFieldDef` so the wizard can reuse `filterFieldsByUserType`
 * with the same semantics as the premiums API.
 */
export function mapFormOptionRowToAccountingFieldDef(r: {
  value?: unknown;
  label?: unknown;
  sortOrder?: unknown;
  meta?: unknown;
}): AccountingFieldDef | null {
  const m = (r.meta ?? {}) as Record<string, unknown>;
  const opts = Array.isArray(m?.options)
    ? (m.options as Array<{ value?: unknown; label?: unknown }>).map((o) => ({
        value: String(o?.value ?? o?.label ?? ""),
        label: String(o?.label ?? o?.value ?? ""),
      }))
    : [];
  const ccRaw = typeof m?.currencyCode === "string" ? m.currencyCode.trim() : "";
  const decRaw = Number(m?.decimals);
  const key = String(r.value ?? "");
  if (!key) return null;
  return {
    key,
    label: String(r.label ?? r.value ?? ""),
    inputType: String(m?.inputType ?? "text"),
    sortOrder: Number(r.sortOrder ?? 0),
    groupOrder: Number(m?.groupOrder ?? 0),
    groupName: typeof m?.group === "string" ? m.group : "",
    options: opts.length > 0 ? opts : undefined,
    premiumColumn: typeof m?.premiumColumn === "string"
      ? m.premiumColumn.replace(/^"|"$/g, "")
      : undefined,
    premiumContexts: Array.isArray(m?.premiumContexts)
      ? (m.premiumContexts as PremiumContext[])
      : undefined,
    premiumRole: typeof m?.premiumRole === "string" &&
      ["client", "agent", "net", "commission"].includes(m.premiumRole)
      ? (m.premiumRole as PremiumRole)
      : undefined,
    currencyCode: ccRaw || undefined,
    decimals: Number.isFinite(decRaw) ? decRaw : undefined,
    formula: typeof m?.formula === "string" && m.formula.trim() ? m.formula.trim() : undefined,
    visibleToUserTypes: Array.isArray(m?.visibleToUserTypes)
      ? (m.visibleToUserTypes as unknown[])
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : undefined,
  };
}

/**
 * Filters fields to only those visible to the given user_type — same contract
 * as `lib/accounting-fields.ts` on the server.
 */
export function filterFieldsByUserType(
  fields: AccountingFieldDef[],
  userType: string | null | undefined,
): AccountingFieldDef[] {
  if (!userType) return fields;
  if (isAdminLikeUserType(userType)) return fields;
  return fields.filter((f) => {
    if (Array.isArray(f.visibleToUserTypes) && f.visibleToUserTypes.length > 0) {
      return f.visibleToUserTypes.includes(userType);
    }
    return legacyRoleAllow(f, userType);
  });
}

function legacyRoleAllow(f: AccountingFieldDef, userType: string): boolean {
  const k = f.key.toLowerCase();
  const l = f.label.toLowerCase();
  if (k === "currency" || l === "currency") return true;
  if (userType === "agent") {
    if (f.premiumRole) return f.premiumRole !== "net";
    const isNet = (k.includes("net") || l.includes("net")) && !k.includes("agent") && !l.includes("agent");
    return !isNet;
  }
  if (userType === "client" || userType === "direct_client") {
    if (f.premiumRole) return f.premiumRole === "client";
    return k.includes("client") || l.includes("client");
  }
  return true;
}
