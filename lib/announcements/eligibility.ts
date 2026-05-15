import type { AnnouncementTargeting } from "@/db/schema/announcements";
import type { SessionUser } from "@/lib/auth/require-user";
import { db } from "@/db/client";
import { clients } from "@/db/schema/core";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

/**
 * Synchronous eligibility check for the current user against an
 * announcement's targeting.
 *
 * NOTE: only inspects `userIds` for `mode === "users"`. To honour the
 * `clientIds` extension as well, callers must use
 * {@link userMatchesAnnouncementTargetingAsync} which queries the
 * `clients` table to resolve clientIds → users.id.
 */
export function userMatchesAnnouncementTargeting(
  targeting: AnnouncementTargeting,
  user: SessionUser,
): boolean {
  if (targeting.mode === "all") return true;
  if (targeting.mode === "user_types") {
    return targeting.userTypes.includes(user.userType);
  }
  if (targeting.mode === "users") {
    return targeting.userIds.includes(Number(user.id));
  }
  return false;
}

/**
 * Filter a list of announcements to the ones a given user is allowed
 * to see. Resolves `targeting.clientIds` against `clients.user_id` in
 * one batched query so a stale / delayed client-to-user link still
 * surfaces the right announcements once the client gets invited.
 */
export async function filterAnnouncementsForUser<
  T extends { id: number; targeting: AnnouncementTargeting },
>(rows: T[], user: SessionUser): Promise<T[]> {
  if (rows.length === 0) return rows;
  const uid = Number(user.id);

  // First pass — anything that matches without needing a clientIds lookup
  // can be resolved synchronously.
  const result: T[] = [];
  const needsClientLookup: T[] = [];
  for (const row of rows) {
    if (row.targeting.mode === "all") {
      result.push(row);
      continue;
    }
    if (row.targeting.mode === "user_types") {
      if (row.targeting.userTypes.includes(user.userType)) result.push(row);
      continue;
    }
    if (row.targeting.mode === "users") {
      if (row.targeting.userIds.includes(uid)) {
        result.push(row);
        continue;
      }
      const cids = row.targeting.clientIds ?? [];
      if (cids.length > 0) {
        needsClientLookup.push(row);
      }
    }
  }

  if (needsClientLookup.length === 0) return result;

  // Resolve which clientIds are linked to the current user.id, in one
  // query — handles the (rare) case where one user is linked to
  // multiple client master rows.
  const allCids = Array.from(
    new Set(
      needsClientLookup.flatMap((r) =>
        r.targeting.mode === "users" ? r.targeting.clientIds ?? [] : [],
      ),
    ),
  );
  if (allCids.length === 0) return result;

  const linkedClients = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(isNotNull(clients.userId), eq(clients.userId, uid), inArray(clients.id, allCids)));
  const linkedSet = new Set(linkedClients.map((c) => c.id));

  for (const row of needsClientLookup) {
    if (row.targeting.mode !== "users") continue;
    const cids = row.targeting.clientIds ?? [];
    if (cids.some((cid) => linkedSet.has(cid))) result.push(row);
  }

  return result;
}
