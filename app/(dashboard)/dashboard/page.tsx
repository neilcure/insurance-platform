import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth/options";
import { Button } from "@/components/ui/button";
import { db } from "@/db/client";
import { memberships, organisations, users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { FilePlus2 } from "lucide-react";
import { PolicyExpiryCalendar } from "@/components/dashboard/policy-expiry-calendar";
import { WelcomeCard } from "@/components/dashboard/welcome-card";
import { resolvePrimaryDashboardCreatePolicyHref } from "@/lib/dashboard/resolve-create-policy-href";
import { tStatic } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const user = session?.user as (Session["user"] & { userType?: string }) | undefined;

  // Compute account completion and last updated for the welcome card
  let accountComplete = false;
  let updatedAtIso: string | undefined;
  let userTimeZone: string | undefined;
  try {
    const userId = Number((user as any)?.id);
    if (Number.isFinite(userId)) {
      const [userResult, orgResult] = await Promise.all([
        db
          .select({ updatedAt: users.updatedAt, name: users.name, timezone: users.timezone })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
        db
          .select({
            updatedAt: organisations.updatedAt,
            name: organisations.name,
            contactEmail: organisations.contactEmail,
            contactPhone: organisations.contactPhone,
          })
          .from(memberships)
          .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
          .where(eq(memberships.userId, userId))
          .limit(1),
      ]);
      const [u] = userResult;
      const [orgRow] = orgResult;
      const hasUserName = typeof u?.name === "string" && (u?.name as string).trim().length > 0;
      const hasOrg = Boolean(orgRow);
      const hasContact = Boolean((orgRow as any)?.contactEmail || (orgRow as any)?.contactPhone);
      accountComplete = hasUserName && hasOrg && hasContact;
      const rawTs = (orgRow?.updatedAt as any) ?? (u?.updatedAt as any);
      if (rawTs) {
        updatedAtIso = rawTs instanceof Date ? rawTs.toISOString() : String(rawTs);
      }
      userTimeZone = (u?.timezone as any) ?? undefined;
    }
  } catch {
    // ignore
  }

  const isDirectClient = user?.userType === "direct_client";
  const locale = await getLocale();
  const createPolicy =
    !isDirectClient ? await resolvePrimaryDashboardCreatePolicyHref() : null;
  const createPolicyHref = createPolicy?.href ?? "/policies/new";
  const createPolicyLabel =
    createPolicy?.flowButtonLabel?.trim() ||
    tStatic("dashboard.createPolicy", locale, "Create Policy");

  return (
    /*
      Dashboard layout
      ----------------
      The Welcome card appears only once after a successful sign-in from
      `/auth/signin` (see `lib/dashboard/welcome-session-flag.ts`). It does
      not reappear on dashboard reloads or in-tab navigation. The big calendar
      below is the work-focused centrepiece — it deliberately
      stretches to the full available width inside `<SidebarInset>`
      (the layout already adds `p-3 sm:p-6` padding around children),
      so we DON'T constrain `<main>` with a `max-w-*`. The Welcome
      card naturally fills the same width — both surfaces stay
      aligned and the calendar dominates the visible viewport.
    */
    <main className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{tStatic("dashboard.title", locale, "Dashboard")}</h1>
        {!isDirectClient ? (
          <Button asChild size="sm">
            <Link href={createPolicyHref}>
              <FilePlus2 className="h-4 w-4 shrink-0 sm:hidden lg:inline" />
              <span className="hidden sm:inline">{createPolicyLabel}</span>
            </Link>
          </Button>
        ) : null}
      </div>
      <WelcomeCard
        name={user?.name}
        email={user?.email}
        userType={user?.userType}
        accountComplete={accountComplete}
        updatedAtIso={updatedAtIso}
        userTimeZone={userTimeZone}
      />

      {/*
        Policy renewals widget — shows a full-width month calendar
        plus a grouped list of upcoming and overdue expiries. The
        calendar always renders, even when there are no expiring
        policies in the window. Visibility is RBAC-scoped inside
        `/api/policies/expiring`, so admins see all org policies,
        agents see their assignments, and direct_clients see only
        their own.
      */}
      <PolicyExpiryCalendar userType={user?.userType} />
    </main>
  );
}






















