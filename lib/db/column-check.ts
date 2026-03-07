import { db } from "@/db/client";
import { sql } from "drizzle-orm";

interface PolicyColumnsPresence {
  hasClientId: boolean;
  hasAgentId: boolean;
  hasCreatedBy: boolean;
  hasIsActive: boolean;
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
      and column_name in ('client_id', 'agent_id', 'created_by', 'is_active')
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
  };
  return cached;
}
