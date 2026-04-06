import { db } from "@/db/client";
import { formOptions } from "@/db/schema/form_options";
import { and, eq } from "drizzle-orm";

type TemplateType = "invoice" | "quotation" | "receipt" | "credit_note" | "debit_note" |
  "endorsement" | "statement" | "certificate" | "letter" | "custom";

let _cache: { data: Map<string, string>; ts: number } | null = null;
const CACHE_TTL = 60_000;

async function loadPrefixMap(): Promise<Map<string, string>> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.data;

  const map = new Map<string, string>();
  try {
    const rows = await db
      .select({ meta: formOptions.meta })
      .from(formOptions)
      .where(
        and(
          eq(formOptions.groupKey, "document_templates"),
          eq(formOptions.isActive, true),
        ),
      );

    for (const row of rows) {
      const meta = row.meta as Record<string, unknown> | null;
      if (!meta?.documentPrefix || !meta?.type) continue;
      const type = String(meta.type);
      if (!map.has(type)) {
        map.set(type, String(meta.documentPrefix));
      }
    }

    const pdfRows = await db
      .select({ meta: formOptions.meta })
      .from(formOptions)
      .where(
        and(
          eq(formOptions.groupKey, "pdf_templates"),
          eq(formOptions.isActive, true),
        ),
      );

    for (const row of pdfRows) {
      const meta = row.meta as Record<string, unknown> | null;
      if (!meta?.documentPrefix || !meta?.type) continue;
      const type = String(meta.type);
      if (!map.has(type)) {
        map.set(type, String(meta.documentPrefix));
      }
    }
  } catch { /* non-fatal */ }

  _cache = { data: map, ts: Date.now() };
  return map;
}

/**
 * Resolve the document number prefix for a given template type from admin-configured
 * document templates. Falls back to a sensible default only if no admin setting exists.
 */
export async function resolveDocPrefix(
  type: TemplateType | string,
  fallback?: string,
): Promise<string> {
  const map = await loadPrefixMap();
  return map.get(type) ?? fallback ?? type.toUpperCase().slice(0, 3);
}

/**
 * Resolve the invoice prefix based on invoice type and direction.
 * Reads from admin-configured document template prefixes first.
 */
export async function resolveInvoicePrefix(
  invoiceType: string,
  direction: string,
): Promise<string> {
  if (invoiceType === "credit_note") return resolveDocPrefix("credit_note", "CN");
  if (invoiceType === "debit_note") return resolveDocPrefix("debit_note", "DN");
  if (invoiceType === "statement") return resolveDocPrefix("statement", "ST");
  if (direction === "payable") return resolveDocPrefix("payable", "AP");
  return resolveDocPrefix("invoice", "INV");
}

/**
 * Return all admin-configured prefix mappings (type → prefix).
 * Useful for diagnostic / admin panels.
 */
export async function getAllResolvedPrefixes(): Promise<Record<string, string>> {
  const map = await loadPrefixMap();
  const result: Record<string, string> = {};
  for (const [type, prefix] of map) result[type] = prefix;
  return result;
}

export function invalidatePrefixCache() {
  _cache = null;
}
