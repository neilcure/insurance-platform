/**
 * `hasCompletedSetup` for an admin-created user.
 *
 * In this app a user is created with a random throwaway password hash plus
 * (optionally) a user_invites row that must be `usedAt` to "complete setup".
 * "Setup pending" is therefore not the same as `is_active = false`:
 *
 *   - `is_active = false` AND `hasCompletedSetup = false`  → never invited / never set password
 *   - `is_active = false` AND `hasCompletedSetup = true`   → admin disabled this account
 *   - `is_active = true`  AND `hasCompletedSetup = false`  → admin manually flipped active before user accepted (rare; treat as setup pending in UI)
 *   - `is_active = true`  AND `hasCompletedSetup = true`   → normal active user
 *
 * Source of truth: any `user_invites` row with `used_at IS NOT NULL`.
 *
 * Use this helper from any list/detail endpoint that surfaces user status —
 * never inline the SQL, the rule may evolve (e.g. fold in `users.last_login_at`
 * if/when that column lands).
 */

import { db } from "@/db/client";
import { userInvites } from "@/db/schema/core";
import { inArray, isNotNull, and } from "drizzle-orm";

export async function getCompletedSetupUserIds(
  userIds: ReadonlyArray<number>,
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: userInvites.userId })
    .from(userInvites)
    .where(and(inArray(userInvites.userId, userIds as number[]), isNotNull(userInvites.usedAt)));
  return new Set(rows.map((r) => r.userId));
}

export async function hasCompletedSetup(userId: number): Promise<boolean> {
  const set = await getCompletedSetupUserIds([userId]);
  return set.has(userId);
}
