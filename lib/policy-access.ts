import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships } from "@/db/schema/core";
import { cars, policies } from "@/db/schema/insurance";

type AccessUser = {
  id: number | string;
  userType?: string;
};

function readLinkedPolicyId(extra: unknown): number | null {
  if (!extra || typeof extra !== "object") return null;
  const raw = (extra as Record<string, unknown>).linkedPolicyId;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

export async function canAccessPolicy(user: AccessUser, policyId: number): Promise<boolean> {
  if (!Number.isFinite(policyId) || policyId <= 0) return false;
  const userType = String(user.userType ?? "");
  const userId = Number(user.id);
  if (!Number.isFinite(userId) || userId <= 0) return false;

  if (userType === "admin" || userType === "internal_staff") return true;

  if (userType === "agent") {
    const [row] = await db
      .select({
        agentId: policies.agentId,
        extra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.id, policyId))
      .limit(1);
    if (!row) return false;
    if (row.agentId === userId) return true;

    const parentId = readLinkedPolicyId(row.extra);
    if (parentId) {
      const [parent] = await db
        .select({ agentId: policies.agentId })
        .from(policies)
        .where(eq(policies.id, parentId))
        .limit(1);
      if (parent?.agentId === userId) return true;
    }
    return false;
  }

  // Other authenticated user types must belong to the policy organisation.
  const rows = await db
    .select({ id: policies.id })
    .from(policies)
    .innerJoin(
      memberships,
      and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, userId)),
    )
    .where(eq(policies.id, policyId))
    .limit(1);
  return rows.length > 0;
}
