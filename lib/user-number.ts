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
  let value: Partial<Record<AllowedUserType, string>> = {};
  if (organisationId) {
    const [orgRow] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, `${SETTINGS_KEY}:${organisationId}` as any))
      .limit(1);
    if (orgRow?.value && typeof orgRow.value === "object") {
      value = orgRow.value as Partial<Record<AllowedUserType, string>>;
    } else {
      const [globalRow] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, SETTINGS_KEY as any))
        .limit(1);
      value = (globalRow?.value as Partial<Record<AllowedUserType, string>> | undefined) ?? {};
    }
  } else {
    const [globalRow] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SETTINGS_KEY as any))
      .limit(1);
    value = (globalRow?.value as Partial<Record<AllowedUserType, string>> | undefined) ?? {};
  }
  return {
    admin: (value as any).admin?.trim() || DEFAULT_PREFIXES.admin,
    agent: (value as any).agent?.trim() || DEFAULT_PREFIXES.agent,
    accounting: (value as any).accounting?.trim() || DEFAULT_PREFIXES.accounting,
    internal_staff: (value as any).internal_staff?.trim() || DEFAULT_PREFIXES.internal_staff,
  };
}

export async function generateNextUserNumber(userType: AllowedUserType, organisationId?: number): Promise<string> {
  // If tenant-specific prefixes are not configured, fall back to global
  // settings and global counter to preserve existing HID_* sequences.
  let counterOrgId = organisationId ?? 0;
  if (organisationId) {
    const [orgScoped] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, `${SETTINGS_KEY}:${organisationId}` as any))
      .limit(1);
    if (!orgScoped) counterOrgId = 0;
  }

  const prefixes = await getUserTypePrefixes(counterOrgId > 0 ? counterOrgId : undefined);
  const prefix = prefixes[userType] || DEFAULT_PREFIXES[userType];

  // Atomic upsert-increment to get the next number for this user type
  const [row] = await db
    .insert(userCounters)
    .values({
      userType: userTypeEnum.enumValues.includes(userType) ? (userType as any) : (userType as any),
      orgId: counterOrgId,
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

