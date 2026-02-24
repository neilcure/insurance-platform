import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "@/components/dashboard/user-menu";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { db } from "@/db/client";
import { memberships, organisations, users } from "@/db/schema/core";
import { eq } from "drizzle-orm";
import { LocalUpdatedBadge } from "@/components/LocalUpdatedBadge";

export async function Header() {
  const session = await getServerSession(authOptions);
  const user = session?.user as (Session["user"] & { userType?: string }) | undefined;

  // Derive last updated time from organisation or user
  let updatedAtIso: string | undefined;
  let userTimeZone: string | undefined;
  let accountComplete = false;
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
      const ts: string | undefined = (orgRow?.updatedAt as any) ?? (u?.updatedAt as any);
      if (ts) {
        updatedAtIso = ts as any;
      }
      userTimeZone = (u?.timezone as any) ?? undefined;
      const hasUserName = typeof u?.name === "string" && (u?.name as string).trim().length > 0;
      const hasOrg = Boolean(orgRow);
      const hasContact = Boolean((orgRow as any)?.contactEmail || (orgRow as any)?.contactPhone);
      accountComplete = hasUserName && hasOrg && hasContact;
    }
  } catch {
    // ignore errors, badge is optional
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
      <div className="flex items-center gap-3">
        <span className="text-sm text-neutral-600 dark:text-neutral-400">Role</span>
        <Badge>{user?.userType ?? "user"}</Badge>
        {accountComplete ? <Badge variant="success">Account setup complete</Badge> : null}
        {updatedAtIso ? <LocalUpdatedBadge ts={updatedAtIso} timeZone={userTimeZone} /> : null}
      </div>
      <div className="flex items-center gap-3">
        <ModeToggle />
        <UserMenu nameOrEmail={user?.name ?? user?.email ?? "Account"} />
      </div>
    </header>
  );
}






















