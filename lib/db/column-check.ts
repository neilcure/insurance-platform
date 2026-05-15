import { db } from "@/db/client";
import { sql } from "drizzle-orm";

interface PolicyColumnsPresence {
  hasClientId: boolean;
  hasAgentId: boolean;
  hasCreatedBy: boolean;
  hasIsActive: boolean;
  hasFlowKey: boolean;
  /** Migration 0015 — denormalised calendar window columns. */
  hasStartDateIndexed: boolean;
  hasEndDateIndexed: boolean;
}

let cached: PolicyColumnsPresence | null = null;

/**
 * Returns which optional columns exist on the `policies` table.
 * Result is cached for the lifetime of the process since schema
 * does not change at runtime.
 */
export async function getPolicyColumns(): Promise<PolicyColumnsPresence> {
  if (cached) return cached;

  const result = await db.execute(sql`
    select column_name
    from information_schema.columns
    where table_name = 'policies'
      and column_name in (
        'client_id', 'agent_id', 'created_by', 'is_active', 'flow_key',
        'start_date_indexed', 'end_date_indexed'
      )
  `);

  const rows: Array<{ column_name: string }> = Array.isArray(result)
    ? (result as any[])
    : ((result as any)?.rows ?? []);
  const names = new Set(rows.map((r) => r.column_name));

  cached = {
    hasClientId: names.has("client_id"),
    hasAgentId: names.has("agent_id"),
    hasCreatedBy: names.has("created_by"),
    hasIsActive: names.has("is_active"),
    hasFlowKey: names.has("flow_key"),
    hasStartDateIndexed: names.has("start_date_indexed"),
    hasEndDateIndexed: names.has("end_date_indexed"),
  };
  return cached;
}

/**
 * Invalidate the process-level cache. Call after running a
 * migration that adds/drops columns within the same process (e.g.
 * dev hot reload), so the next call re-reads
 * `information_schema.columns`.
 */
export function invalidatePolicyColumnsCache(): void {
  cached = null;
}
