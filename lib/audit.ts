import { db } from "@/db/client";
import { cars } from "@/db/schema/insurance";
import { eq } from "drizzle-orm";

type AuditChange = { key: string; from: unknown; to: unknown };
type UserInfo = { id: number; email: string };

export async function appendPolicyAudit(
  policyId: number,
  user: UserInfo,
  changes: AuditChange[],
): Promise<void> {
  if (changes.length === 0) return;

  const [carRow] = await db
    .select({ id: cars.id, extraAttributes: cars.extraAttributes })
    .from(cars)
    .where(eq(cars.policyId, policyId))
    .limit(1);

  if (!carRow) return;

  const existing = (carRow.extraAttributes ?? {}) as Record<string, unknown>;
  const auditArr = Array.isArray(existing._audit)
    ? [...(existing._audit as unknown[])]
    : [];

  auditArr.push({
    at: new Date().toISOString(),
    by: user,
    changes,
  });

  const updated: Record<string, unknown> = {
    ...existing,
    _audit: auditArr,
    _lastEditedAt: new Date().toISOString(),
  };

  await db
    .update(cars)
    .set({ extraAttributes: updated })
    .where(eq(cars.id, carRow.id));
}
