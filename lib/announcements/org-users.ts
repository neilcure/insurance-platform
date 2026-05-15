import { db } from "@/db/client";
import { clients, memberships } from "@/db/schema/core";
import { and, eq, inArray } from "drizzle-orm";

export async function assertUserIdsBelongToOrg(userIds: number[], orgId: number): Promise<void> {
  const unique = [...new Set(userIds)].filter((n) => Number.isFinite(n) && n > 0);
  if (unique.length === 0) return;
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organisationId, orgId), inArray(memberships.userId, unique)));
  const ok = new Set(rows.map((r) => r.userId));
  const missing = unique.filter((id) => !ok.has(id));
  if (missing.length > 0) {
    throw new Error(`Users not in organisation: ${missing.join(", ")}`);
  }
}

/**
 * Assert that every supplied client id refers to a row in `clients`.
 *
 * Note: the `clients` table doesn't carry an `organisation_id` column —
 * org scope is implicit via the policies / agents that reference the
 * client. For the announcement audience picker we settle for "the
 * client exists" because the picker itself is admin/internal-staff
 * gated and only lists clients the active org can see anyway.
 */
export async function assertClientIdsExist(clientIds: number[]): Promise<void> {
  const unique = [...new Set(clientIds)].filter((n) => Number.isFinite(n) && n > 0);
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(inArray(clients.id, unique));
  const ok = new Set(rows.map((r) => r.id));
  const missing = unique.filter((id) => !ok.has(id));
  if (missing.length > 0) {
    throw new Error(`Clients not found: ${missing.join(", ")}`);
  }
}
