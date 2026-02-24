import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { memberships, organisations, users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { LocalUpdatedBadge } from "@/components/LocalUpdatedBadge";

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
      const [u] = await db
        .select({ updatedAt: users.updatedAt, name: users.name, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const [orgRow] = await db
        .select({
          updatedAt: organisations.updatedAt,
          name: organisations.name,
          contactEmail: organisations.contactEmail,
          contactPhone: organisations.contactPhone,
        })
        .from(memberships)
        .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
        .where(eq(memberships.userId, userId))
        .limit(1);
      const hasUserName = typeof u?.name === "string" && (u?.name as string).trim().length > 0;
      const hasOrg = Boolean(orgRow);
      const hasContact = Boolean((orgRow as any)?.contactEmail || (orgRow as any)?.contactPhone);
      accountComplete = hasUserName && hasOrg && hasContact;
      const ts: string | undefined = (orgRow?.updatedAt as any) ?? (u?.updatedAt as any);
      if (ts) {
        updatedAtIso = ts as any;
      }
      userTimeZone = (u?.timezone as any) ?? undefined;
    }
  } catch {
    // ignore
  }

  return (
    <main className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="text-sm text-neutral-600 dark:text-neutral-400">
            Signed in as <span className="font-medium">{user?.name ?? user?.email}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-600 dark:text-neutral-400">Role</span>
            <Badge>{user?.userType ?? "user"}</Badge>
            {accountComplete ? <Badge variant="success">Account setup complete</Badge> : null}
            {updatedAtIso ? <LocalUpdatedBadge ts={updatedAtIso} timeZone={userTimeZone} /> : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}






















