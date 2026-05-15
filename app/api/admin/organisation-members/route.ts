import { NextResponse } from "next/server";
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, memberships, users } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { ActiveOrgError, resolveActiveOrgId } from "@/lib/auth/active-org";
import { isPlaceholderEmail } from "@/lib/auth/placeholder-email";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/organisation-members
 *
 * Lists "people" in the resolved active organisation. Used by the shared
 * <UserPicker> (announcements audience, etc.).
 *
 * Two row shapes:
 *  - kind="user"   — a row in `users` joined via `memberships`. Has a
 *                    real `userId` and is selectable for any feature
 *                    that targets login accounts (announcements, etc.).
 *  - kind="client" — a row in `clients` that is NOT yet linked to a
 *                    `users` account (`clients.userId is null`). Surfaces
 *                    on the picker so the admin can SEE the full org
 *                    roster, but is `selectable=false` because there is
 *                    no login to deliver a dashboard pop-up to.
 *
 * Query params:
 *  - includeClients=1  → also return client-only rows (default off)
 *  - q                 → optional ILIKE filter on name/email/user_number
 *                        (applied to `users` rows; client-only rows are
 *                        filtered client-side because their fields live
 *                        in different columns)
 *  - limit             → cap, default + max 500
 */
export async function GET(request: Request) {
  try {
    const me = await requireUser();
    if (me.userType !== "admin" && me.userType !== "internal_staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const urlObj = new URL(request.url);
    const searchParams = urlObj.searchParams;

    let orgId: number;
    try {
      const rawOrg = searchParams.get("organisationId");
      orgId = await resolveActiveOrgId(me, rawOrg ? Number(rawOrg) : undefined, {
        context: "GET /api/admin/organisation-members",
      });
    } catch (e) {
      if (e instanceof ActiveOrgError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const q = (searchParams.get("q") ?? "").trim();
    const limitRaw = Number(searchParams.get("limit") ?? "500");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 500) : 500;
    const includeClients = ["1", "true", "yes"].includes(
      (searchParams.get("includeClients") ?? "").toLowerCase(),
    );

    const safeQ = q.replace(/[%_\\]/g, "").slice(0, 120);
    const pattern = safeQ ? `%${safeQ}%` : null;

    const whereParts = [eq(memberships.organisationId, orgId)];

    if (pattern) {
      whereParts.push(
        or(
          ilike(users.email, pattern),
          ilike(users.name, pattern),
          sql`COALESCE(${users.userNumber}, '') ILIKE ${pattern}`,
        )!,
      );
    }

    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        userType: users.userType,
        userNumber: users.userNumber,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(...whereParts))
      .orderBy(users.id)
      .limit(limit);

    type Member = {
      kind: "user" | "client";
      /** users.id when kind=="user", else null (client master without a login). */
      id: number | null;
      /** clients.id when kind=="client", else null. */
      clientId: number | null;
      email: string;
      name: string | null;
      userType: string;
      userNumber: string | null;
      /** Whether this row can be picked as an announcement target. */
      selectable: boolean;
      /**
       * Why a row is not selectable. Used by <UserPicker> to render a
       * helpful badge (e.g. "Invite to enable").
       */
      reason: "ok" | "placeholder_email" | "no_login";
    };

    const userMembers: Member[] = userRows.map((u) => {
      const placeholder = isPlaceholderEmail(u.email);
      return {
        kind: "user",
        id: u.id,
        clientId: null,
        email: u.email,
        name: u.name,
        userType: u.userType,
        userNumber: u.userNumber,
        selectable: !placeholder,
        reason: placeholder ? "placeholder_email" : "ok",
      };
    });

    let clientMembers: Member[] = [];
    if (includeClients) {
      const clientRows = await db
        .select({
          id: clients.id,
          clientNumber: clients.clientNumber,
          category: clients.category,
          displayName: clients.displayName,
          primaryId: clients.primaryId,
        })
        .from(clients)
        .where(isNull(clients.userId))
        .orderBy(asc(clients.id))
        .limit(limit);

      clientMembers = clientRows.map((c) => ({
        kind: "client",
        id: null,
        clientId: c.id,
        email: "",
        name: c.displayName,
        userType: c.category === "company" ? "company_client" : "personal_client",
        userNumber: c.clientNumber,
        selectable: false,
        reason: "no_login",
      }));
    }

    const members = [...userMembers, ...clientMembers];
    const total = members.length;
    const totalSelectable = members.filter((m) => m.selectable).length;

    return NextResponse.json({ members, total, totalSelectable });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
