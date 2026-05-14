import { db } from "@/db/client";
import { users, clients } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { desc, eq, inArray } from "drizzle-orm";
import { policies, cars } from "@/db/schema/insurance";
import { getInsuredPrimaryId, getInsuredType } from "@/lib/field-resolver";
import InviteForm from "@/components/admin/invite-form";
import UserSettingsTableClient from "@/components/admin/UserSettingsTableClient";
import { SettingsBlock } from "@/components/ui/settings-block";
import { Separator } from "@/components/ui/separator";
import { ServerErrorToast } from "@/components/ui/ServerErrorToast";
import { getCompletedSetupUserIds } from "@/lib/auth/user-setup-status";
import { tStatic } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

type UserType = "admin" | "agent" | "accounting" | "internal_staff" | "direct_client" | "service_provider";

type UserRow = {
  id: number;
  email: string;
  mobile: string | null;
  name: string | null;
  companyName: string | null;
  primaryId: string | null;
  accountType: "personal" | "company" | null;
  userType: UserType;
  isActive: boolean;
  hasCompletedSetup: boolean;
  createdAt: string;
  userNumber: string | null;
};

export default async function AdminUsersPage() {
  const me = await requireUser();
  if (!(me.userType === "admin" || me.userType === "agent" || me.userType === "internal_staff")) {
    throw new Error("Forbidden");
  }

  let rows: UserRow[] = [];
  let loadError: string | undefined;
  try {
    const raw =
      ((await db
        .select({
          id: users.id,
          email: users.email,
          mobile: users.mobile,
          name: users.name,
          profileMeta: users.profileMeta,
          userType: users.userType,
          isActive: users.isActive,
          createdAt: users.createdAt,
          userNumber: users.userNumber,
        })
        .from(users)) as unknown as Array<Omit<UserRow, "userType" | "companyName" | "primaryId" | "accountType" | "hasCompletedSetup"> & { userType: string; profileMeta?: Record<string, unknown> | null }>) ?? [];
    rows = raw.map((r): UserRow => {
      const meta = (r.profileMeta ?? {}) as Record<string, unknown>;
      const accountType: "personal" | "company" | null =
        meta.accountType === "company" || meta.accountType === "personal" ? meta.accountType : null;
      return {
        id: r.id,
        email: r.email,
        mobile: r.mobile,
        name: r.name,
        userNumber: r.userNumber,
        isActive: r.isActive,
        createdAt: r.createdAt,
        companyName:
          typeof meta.companyName === "string" && meta.companyName.trim() ? meta.companyName.trim() : null,
        primaryId:
          typeof meta.primaryId === "string" && meta.primaryId.trim() ? meta.primaryId.trim() : null,
        accountType,
        hasCompletedSetup: false,
        userType: r.userType === "insurer_staff" ? ("internal_staff" as UserType) : (r.userType as UserType),
      };
    });
    if (!(me.userType === "admin" || me.userType === "internal_staff")) {
      rows = rows.filter((r) => Number(r.id) === Number(me.id));
    }
  } catch (err: any) {
    // Fallback for environments where migration hasn't run yet (no user_number column)
    try {
      const fallback =
        ((await db
          .select({
            id: users.id,
            email: users.email,
            mobile: users.mobile,
            name: users.name,
            profileMeta: users.profileMeta,
            userType: users.userType,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users)) as unknown as Array<Omit<UserRow, "userNumber" | "companyName"> & { profileMeta?: Record<string, unknown> | null }>) ?? [];
      const mapped: UserRow[] = fallback.map((r) => {
        const meta = (r.profileMeta ?? {}) as Record<string, unknown>;
        const accountType: "personal" | "company" | null =
          meta.accountType === "company" || meta.accountType === "personal" ? meta.accountType : null;
        return {
          id: r.id,
          email: r.email,
          mobile: (r as { mobile?: string | null }).mobile ?? null,
          name: r.name,
          companyName:
            typeof meta.companyName === "string" && meta.companyName.trim() ? meta.companyName.trim() : null,
          primaryId: typeof meta.primaryId === "string" && meta.primaryId.trim() ? meta.primaryId.trim() : null,
          accountType,
          userType: (r.userType as string) === "insurer_staff" ? ("internal_staff" as UserType) : (r.userType as UserType),
          isActive: r.isActive,
          hasCompletedSetup: false,
          createdAt: r.createdAt,
          userNumber: null,
        };
      });
      rows =
        me.userType === "admin" || me.userType === "internal_staff"
          ? mapped
          : mapped.filter((r) => Number(r.id) === Number(me.id));
    } catch (err2: any) {
      loadError = err2?.message ?? err?.message ?? "Failed to load users";
    }
  }

  // Load linked client names and client numbers for direct_client users
  let clientLinks: Record<number, string> = {};
  let clientNumbers: Record<number, string> = {};
  let profilePolicyNumbers: Record<number, string> = {};
  try {
    const clientUserIds = rows.filter((r) => r.userType === "direct_client").map((r) => r.id);
    if (clientUserIds.length > 0) {
      const directClientUserIdSet = new Set(clientUserIds);
      const profileRows = await db
        .select({
          policyNumber: policies.policyNumber,
          extraAttributes: cars.extraAttributes,
        })
        .from(policies)
        .leftJoin(cars, eq(cars.policyId, policies.id))
        .where(eq(policies.flowKey, "clientSet"));
      const profileMap = new Map<string, string>();
      for (const p of profileRows) {
        const extra = (p.extraAttributes ?? {}) as Record<string, unknown>;
        const insured = (extra.insuredSnapshot ?? {}) as Record<string, unknown>;
        const category = (getInsuredType(insured) || "").trim().toLowerCase();
        const primaryId = (getInsuredPrimaryId(insured) || "").trim();
        if (!category || !primaryId) continue;
        if (!profileMap.has(`${category}::${primaryId}`)) {
          profileMap.set(`${category}::${primaryId}`, p.policyNumber);
        }
      }
      const linkRows = await db
        .select({
          id: clients.id,
          userId: clients.userId,
          displayName: clients.displayName,
          clientNumber: clients.clientNumber,
          category: clients.category,
          primaryId: clients.primaryId,
          createdAt: clients.createdAt,
        })
        .from(clients)
        .where(inArray(clients.userId, clientUserIds))
        .orderBy(desc(clients.createdAt), desc(clients.id));
      for (const lr of linkRows) {
        if (
          lr.userId &&
          directClientUserIdSet.has(lr.userId) &&
          !clientNumbers[lr.userId]
        ) {
          clientLinks[lr.userId] = lr.displayName;
          clientNumbers[lr.userId] = lr.clientNumber;
          profilePolicyNumbers[lr.userId] =
            profileMap.get(`${String(lr.category).trim().toLowerCase()}::${String(lr.primaryId).trim()}`) ?? "";
        }
      }
    }
  } catch {}

  try {
    const completedSet = await getCompletedSetupUserIds(rows.map((r) => r.id));
    rows = rows.map((r) => ({ ...r, hasCompletedSetup: completedSet.has(r.id) }));
  } catch {
    // If the lookup fails, leave hasCompletedSetup as `false` — UI will show
    // the "Setup Pending" status, which is the safe default that exposes the
    // re-issue invite affordance.
  }

  const makeSortKey = (r: UserRow) =>
    `${(r.userNumber ?? "").toString()}|${(r.email || "").toLowerCase()}|${String(r.id).padStart(10, "0")}`;
  rows = rows.slice().sort((a, b) => makeSortKey(a).localeCompare(makeSortKey(b)));

  const locale = await getLocale();
  return (
    <main className="mx-auto max-w-6xl space-y-6">
      {loadError ? <ServerErrorToast message={loadError} /> : null}
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          {tStatic("sidebar.adminPanel", locale, "Admin Panel")}
        </h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {tStatic(
            "admin.users.subtitle",
            locale,
            "Manage users and permissions.",
          )}
        </p>
      </div>
      <Separator />
      <SettingsBlock
        title={tStatic("sidebar.userSettings", locale, "User Settings")}
        description={tStatic(
          "admin.users.description",
          locale,
          "Invite users, change roles, activate/deactivate or delete accounts.",
        )}
      >
        <div className="space-y-4">
          <InviteForm allowedTypes={me.userType === "admin" ? ["admin","agent","accounting","internal_staff","direct_client"] : ["accounting","internal_staff"]} />
          <Separator />
          <UserSettingsTableClient
            initialRows={rows}
            canAssignAdmin={me.userType === "admin"}
            clientLinks={clientLinks}
            clientNumbers={clientNumbers}
            profilePolicyNumbers={profilePolicyNumbers}
          />
        </div>
      </SettingsBlock>

    </main>
  );
}


