import { db } from "@/db/client";
import { appSettings, userCounters, userTypeEnum } from "@/db/schema/core";
import { eq, sql } from "drizzle-orm";

export type AllowedUserType = "admin" | "agent" | "accounting" | "internal_staff";

const SETTINGS_KEY = "user_type_prefixes";

const DEFAULT_PREFIXES: Record<AllowedUserType, string> = {
  admin: "AD",
  agent: "AG",
  accounting: "AC",
  internal_staff: "IN",
};

export async function getUserTypePrefixes(organisationId?: number): Promise<Record<AllowedUserType, string>> {
  const suffix = organisationId ? `:${organisationId}` : "";
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, (SETTINGS_KEY + suffix) as any)).limit(1);
  const value = (row?.value as Partial<Record<AllowedUserType, string>> | undefined) ?? {};
  return {
    admin: (value as any).admin?.trim() || DEFAULT_PREFIXES.admin,
    agent: (value as any).agent?.trim() || DEFAULT_PREFIXES.agent,
    accounting: (value as any).accounting?.trim() || DEFAULT_PREFIXES.accounting,
    internal_staff: (value as any).internal_staff?.trim() || DEFAULT_PREFIXES.internal_staff,
  };
}

export async function generateNextUserNumber(userType: AllowedUserType, organisationId?: number): Promise<string> {
  const prefixes = await getUserTypePrefixes(organisationId);
  const prefix = prefixes[userType] || DEFAULT_PREFIXES[userType];

  // Atomic upsert-increment to get the next number for this user type
  const [row] = await db
    .insert(userCounters)
    .values({
      userType: userTypeEnum.enumValues.includes(userType) ? (userType as any) : (userType as any),
      orgId: organisationId ?? 0,
      lastNumber: 1,
    })
    .onConflictDoUpdate({
      target: [userCounters.orgId, userCounters.userType] as any,
      set: { lastNumber: sql`${userCounters.lastNumber} + 1`, updatedAt: sql`now()` },
    })
    .returning({ lastNumber: userCounters.lastNumber });

  const nextNumber = row.lastNumber;
  const padded = String(nextNumber).padStart(6, "0");
  return `${prefix}${padded}`;
}

