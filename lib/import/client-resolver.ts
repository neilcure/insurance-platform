/**
 * Resolves or auto-creates the "client" (clientSet-flow policy) for an
 * import row. Resolution order:
 *
 *   1. Explicit Client Number → look up the existing clientSet policy
 *      and reuse it. Hard-error if not found.
 *   2. No Client Number → try to MATCH an existing client by strong
 *      identifier (CI Number for companies, HKID for personal). Reuses
 *      the existing record so re-importing rows for the same insured
 *      doesn't spawn duplicate client cards in /dashboard/clients —
 *      this was the original bug (every row created a new client even
 *      when the same person/company was already in the database).
 *   3. Still no match → auto-create a new client-policy by POSTing to
 *      /api/policies with `flowKey = clientFlowKey`.
 *
 * The actual policy creation goes through the existing internal route —
 * no duplication of business logic.
 */
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { and, eq } from "drizzle-orm";
import { serverFetch } from "@/lib/auth/server-fetch";

export type ResolvedClient = {
  clientPolicyId: number;
  clientPolicyNumber: string;
  /** True if this row created a new client-policy. */
  created: boolean;
  /**
   * How the client was resolved:
   *   - "by-number": user supplied a Client Number (step 1)
   *   - "by-identity": dedupe matched an existing record by CI/HKID (step 2)
   *   - "created": no match, a new client-policy was created (step 3)
   */
  matchKind: "by-number" | "by-identity" | "created";
  /**
   * Field that produced the identity match (e.g. "ciNumber"). Only set
   * when matchKind === "by-identity". Useful for the row note shown on
   * the staging review screen.
   */
  matchedOn?: string;
};

/**
 * Strong identifiers extracted from an insured snapshot. Returned by
 * `extractIdentity` so the matcher can run a single targeted SQL query
 * instead of scanning every clientSet record.
 */
type InsuredIdentity = {
  category: "company" | "personal" | "unknown";
  /** Commercial Identity number — strong unique key for companies. */
  ciNumber?: string;
  /** Business Registration number — alt strong key for companies. */
  brNumber?: string;
  /** Hong Kong ID number — strong unique key for personal. */
  idNumber?: string;
};

/**
 * Looks up an existing clientSet-flow policy by its policy number.
 * Returns null if not found.
 */
export async function findClientByNumber(
  clientNumber: string,
  clientFlowKey: string,
): Promise<{ id: number; policyNumber: string } | null> {
  const trimmed = clientNumber.trim();
  if (!trimmed) return null;
  const rows = await db
    .select({ id: policies.id, policyNumber: policies.policyNumber })
    .from(policies)
    .where(
      and(
        eq(policies.policyNumber, trimmed),
        eq(policies.flowKey, clientFlowKey),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0];
}

/**
 * Auto-creates a clientSet-flow policy from the insured snapshot.
 * Returns the new client policy id + number.
 *
 * Calls the internal POST /api/policies endpoint via serverFetch so the
 * existing creation logic (numbering, snapshots, validation) is reused.
 */
export async function autoCreateClient(
  insured: Record<string, unknown>,
  clientFlowKey: string,
): Promise<{ id: number; policyNumber: string }> {
  const res = await serverFetch("/api/policies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ insured, flowKey: clientFlowKey }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    policyId?: number;
    recordId?: number;
    id?: number;
    policyNumber?: string;
    recordNumber?: string;
  };

  if (!res.ok) {
    throw new Error(body?.error ?? `Failed to auto-create client (HTTP ${res.status})`);
  }

  const id = Number(body.recordId ?? body.policyId ?? body.id ?? 0);
  const number = String(body.recordNumber ?? body.policyNumber ?? "");
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Auto-create client returned invalid id");
  }
  return { id, policyNumber: number };
}

/**
 * Pull the strong identifiers (CI / BR / HKID) out of an insured snapshot.
 *
 * Tolerates BOTH the wizard's RHF key shape (`insured__ciNumber`) and the
 * legacy unprefixed form (`ciNumber`) so this works whether the snapshot
 * came from the import payload builder or a hand-rolled insert.
 *
 * Returns the values normalised (trimmed, internal whitespace collapsed)
 * so "K625697A" matches "k625697a " and "K6 25697 A".
 */
export function extractIdentity(insured: Record<string, unknown>): InsuredIdentity {
  const get = (key: string): string | undefined => {
    const candidates = [
      insured[key],
      insured[`insured__${key}`],
      insured[`insured_${key}`],
    ];
    for (const v of candidates) {
      if (typeof v !== "string") continue;
      // Collapse internal whitespace — HK IDs and CI numbers are commonly
      // typed with stray spaces (e.g. "K6 25697 A") that should match the
      // canonical "K625697A".
      const norm = v.trim().replace(/\s+/g, "").toLowerCase();
      if (norm.length > 0) return norm;
    }
    return undefined;
  };

  const rawCat = (insured.category ?? insured.insured__category ?? insured.insuredType) as unknown;
  const cat = typeof rawCat === "string" ? rawCat.trim().toLowerCase() : "";
  const category: InsuredIdentity["category"] =
    cat === "company" ? "company" : cat === "personal" ? "personal" : "unknown";

  return {
    category,
    ciNumber: get("ciNumber") ?? get("cinumber"),
    brNumber: get("brNumber") ?? get("brnumber"),
    idNumber: get("idNumber") ?? get("idnumber") ?? get("hkid"),
  };
}

/**
 * Look for an existing clientSet-flow policy whose insured snapshot matches
 * the given identity on a STRONG identifier (CI/BR for companies, HKID for
 * personal). Returns the first match or null.
 *
 * Implementation: JOIN policies + cars, filter by flow_key in SQL (cheap),
 * then scan the snapshot in JS to compare normalised identifiers. JSONB
 * path matching is doable in pure SQL but the snapshot has 5 candidate
 * keys per identifier (the wizard isn't strict about which prefix it
 * uses), and the JS pass keeps the matching rules in ONE place — same
 * normalisation as `extractIdentity`, no risk of drift.
 *
 * Cost: O(N clientSet policies) per row. For tenants with <10k clients
 * this is fine. If it becomes a hot path, swap to a generated
 * `client_identity` column + B-tree index.
 */
export async function findClientByIdentity(
  insured: Record<string, unknown>,
  clientFlowKey: string,
): Promise<{ id: number; policyNumber: string; matchedOn: string } | null> {
  const target = extractIdentity(insured);
  // No strong identifier in the row → can't match safely. (Matching by
  // name + phone would create false positives — two "John Chan"s would
  // collide. Better to create a duplicate than merge wrong records.)
  const targetIds = [
    { key: "ciNumber", val: target.ciNumber },
    { key: "brNumber", val: target.brNumber },
    { key: "idNumber", val: target.idNumber },
  ].filter((x): x is { key: string; val: string } => Boolean(x.val));
  if (targetIds.length === 0) return null;

  const rows = await db
    .select({
      id: policies.id,
      policyNumber: policies.policyNumber,
      extra: cars.extraAttributes,
    })
    .from(policies)
    .leftJoin(cars, eq(cars.policyId, policies.id))
    .where(eq(policies.flowKey, clientFlowKey));

  for (const row of rows) {
    const extra = (row.extra ?? {}) as { insuredSnapshot?: Record<string, unknown> };
    const snap = extra.insuredSnapshot;
    if (!snap || typeof snap !== "object") continue;
    const candidate = extractIdentity(snap);
    // Compare by category WHEN both sides know it — but allow "unknown" to
    // match either (legacy snapshots often omit category, and the strong
    // identifier alone is enough evidence).
    if (
      target.category !== "unknown" &&
      candidate.category !== "unknown" &&
      target.category !== candidate.category
    ) {
      continue;
    }
    for (const t of targetIds) {
      const c = (candidate as Record<string, string | undefined>)[t.key];
      if (c && c === t.val) {
        return { id: row.id, policyNumber: row.policyNumber, matchedOn: t.key };
      }
    }
  }
  return null;
}

/**
 * Resolves the client for an import row — see file-level docstring for the
 * 3-step resolution order.
 */
export async function resolveOrCreateClient(params: {
  clientNumber?: string;
  insured: Record<string, unknown>;
  clientFlowKey: string;
}): Promise<ResolvedClient> {
  const { clientNumber, insured, clientFlowKey } = params;

  // STEP 1 — explicit client number wins, hard-error on miss.
  if (clientNumber) {
    const existing = await findClientByNumber(clientNumber, clientFlowKey);
    if (!existing) {
      throw new Error(`Client number "${clientNumber}" not found in flow "${clientFlowKey}"`);
    }
    return {
      clientPolicyId: existing.id,
      clientPolicyNumber: existing.policyNumber,
      created: false,
      matchKind: "by-number",
    };
  }

  // STEP 2 — identity dedupe. Only triggers when the row has a usable
  // strong identifier; otherwise we fall through to step 3 to avoid
  // false-positive merges on weak signals (name, phone).
  const matched = await findClientByIdentity(insured, clientFlowKey);
  if (matched) {
    return {
      clientPolicyId: matched.id,
      clientPolicyNumber: matched.policyNumber,
      created: false,
      matchKind: "by-identity",
      matchedOn: matched.matchedOn,
    };
  }

  // STEP 3 — no match anywhere, create a fresh client-policy.
  const created = await autoCreateClient(insured, clientFlowKey);
  return {
    clientPolicyId: created.id,
    clientPolicyNumber: created.policyNumber,
    created: true,
    matchKind: "created",
  };
}
