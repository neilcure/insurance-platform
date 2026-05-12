import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth/options";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db/client";
import { memberships, organisations, users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { LocalUpdatedBadge } from "@/components/LocalUpdatedBadge";
import { FilePlus2 } from "lucide-react";
import { PolicyExpiryCalendar } from "@/components/dashboard/policy-expiry-calendar";

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

  const isAdmin = user?.userType === "admin";

  return (
    /*
      Dashboard layout
      ----------------
      The page header + Welcome card are preserved as the user's
      profile / sign-in / account-status surface. The big calendar
      below is the work-focused centrepiece — it deliberately
      stretches to the full available width inside `<SidebarInset>`
      (the layout already adds `p-3 sm:p-6` padding around children),
      so we DON'T constrain `<main>` with a `max-w-*`. The Welcome
      card naturally fills the same width — both surfaces stay
      aligned and the calendar dominates the visible viewport.
    */
    <main className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Dashboard</h1>
        <Button asChild size="sm">
          <Link href="/policies/new">
            <FilePlus2 className="h-4 w-4 shrink-0 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Create Policy</span>
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            Signed in as <span className="font-medium">{user?.name ?? user?.email}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Role</span>
            <Badge>{user?.userType ?? "user"}</Badge>
            {accountComplete ? <Badge variant="success">Account setup complete</Badge> : null}
            {updatedAtIso ? <LocalUpdatedBadge ts={updatedAtIso} timeZone={userTimeZone} /> : null}
          </div>
        </CardContent>
      </Card>

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






















