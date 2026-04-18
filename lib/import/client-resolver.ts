/**
 * Resolves or auto-creates the "client" (clientSet-flow policy) for an
 * import row. Mirrors the wizard's two-step pattern:
 *
 *   1. If the row has a Client Number → look up the existing clientSet policy
 *      and reuse it.
 *   2. Otherwise → POST /api/policies with `flowKey = clientFlowKey` to create
 *      a new client-policy from the insured snapshot, then reuse its id.
 *
 * The actual policy creation goes through the existing internal route — no
 * duplication of business logic.
 */
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { and, eq } from "drizzle-orm";
import { serverFetch } from "@/lib/auth/server-fetch";

export type ResolvedClient = {
  clientPolicyId: number;
  clientPolicyNumber: string;
  /** True if this row created a new client-policy */
  created: boolean;
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
 * Resolves the client for an import row:
 *   - explicit clientNumber → existing client
 *   - empty clientNumber → auto-created client (or returns the existing match
 *     if the insured snapshot collides with one)
 */
export async function resolveOrCreateClient(params: {
  clientNumber?: string;
  insured: Record<string, unknown>;
  clientFlowKey: string;
}): Promise<ResolvedClient> {
  const { clientNumber, insured, clientFlowKey } = params;
  if (clientNumber) {
    const existing = await findClientByNumber(clientNumber, clientFlowKey);
    if (!existing) {
      throw new Error(`Client number "${clientNumber}" not found in flow "${clientFlowKey}"`);
    }
    return {
      clientPolicyId: existing.id,
      clientPolicyNumber: existing.policyNumber,
      created: false,
    };
  }

  const created = await autoCreateClient(insured, clientFlowKey);
  return {
    clientPolicyId: created.id,
    clientPolicyNumber: created.policyNumber,
    created: true,
  };
}
