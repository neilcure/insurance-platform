import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { users, memberships } from "@/db/schema/core";
import { and, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";

export const dynamic = "force-dynamic";

const REASSIGNABLE_STATUSES = new Set([
  "draft",
  "pending",
  /** Early client workflow — agent often assigned after initial quotation */
  "quotation_prepared",
]);

type ResolvedAgent = { id: number; name: string | null; email: string };

async function findUserInOrgById(
  orgId: number,
  userId: number,
): Promise<ResolvedAgent | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.organisationId, orgId)),
    )
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

async function findUserInOrgByEmail(
  orgId: number,
  email: string,
): Promise<ResolvedAgent | null> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.organisationId, orgId)),
    )
    .where(eq(users.email, email))
    .limit(1);
  return row ?? null;
}

async function findUsersInOrgByUserNumber(
  orgId: number,
  raw: string,
): Promise<ResolvedAgent[]> {
  const n = raw.trim().toLowerCase();
  if (!n) return [];
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(
      memberships,
      and(eq(memberships.userId, users.id), eq(memberships.organisationId, orgId)),
    )
    .where(sql`lower(trim(coalesce(${users.userNumber}, ''))) = ${n}`)
    .limit(3);
}

type ResolveOutcome =
  | { ok: true; agent: ResolvedAgent }
  | { ok: false; status: number; error: string };

async function resolveAgent(
  orgId: number,
  body: Record<string, unknown>,
): Promise<ResolveOutcome> {
  const agentIdRaw = body?.agentId;
  const agentEmail = String(body?.agentEmail ?? "").trim();
  const agentUserNumber = String(body?.agentUserNumber ?? "").trim();
  const agentLookup = String(body?.agentLookup ?? "").trim();

  if (agentIdRaw !== undefined && agentIdRaw !== null && `${agentIdRaw}`.length > 0) {
    const id = Number(agentIdRaw);
    if (Number.isFinite(id) && id > 0) {
      const agent = await findUserInOrgById(orgId, id);
      if (!agent) {
        return {
          ok: false,
          status: 404,
          error: `No user with id ${id} in your organisation`,
        };
      }
      return { ok: true, agent };
    }
  }

  if (agentEmail && agentEmail.includes("@")) {
    const agent = await findUserInOrgByEmail(orgId, agentEmail);
    if (!agent) {
      return {
        ok: false,
        status: 404,
        error: `No user found with email "${agentEmail}" in your organisation`,
      };
    }
    return { ok: true, agent };
  }

  if (agentUserNumber) {
    const matches = await findUsersInOrgByUserNumber(orgId, agentUserNumber);
    if (matches.length === 0) {
      return {
        ok: false,
        status: 404,
        error: `No user with agent number "${agentUserNumber}" in your organisation`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        status: 409,
        error:
          "Multiple users match that agent number; use their email or numeric user id.",
      };
    }
    return { ok: true, agent: matches[0]! };
  }

  if (agentLookup) {
    if (agentLookup.includes("@")) {
      const agent = await findUserInOrgByEmail(orgId, agentLookup);
      if (!agent) {
        return {
          ok: false,
          status: 404,
          error: `No user found with email "${agentLookup}" in your organisation`,
        };
      }
      return { ok: true, agent };
    }
    if (/^\d+$/.test(agentLookup)) {
      const asNum = Number(agentLookup);
      if (Number.isFinite(asNum) && asNum > 0) {
        const byId = await findUserInOrgById(orgId, asNum);
        if (byId) return { ok: true, agent: byId };
      }
      const matches = await findUsersInOrgByUserNumber(orgId, agentLookup);
      if (matches.length === 0) {
        return {
          ok: false,
          status: 404,
          error: `No user matches "${agentLookup}" (user id or agent number) in your organisation`,
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          status: 409,
          error:
            "Multiple users match that agent number; pick from the list or use email.",
        };
      }
      return { ok: true, agent: matches[0]! };
    }
    const matches = await findUsersInOrgByUserNumber(orgId, agentLookup);
    if (matches.length === 0) {
      return {
        ok: false,
        status: 404,
        error: `No user with agent number "${agentLookup}" in your organisation`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        status: 409,
        error: "Multiple users match; use email or numeric user id.",
      };
    }
    return { ok: true, agent: matches[0]! };
  }

  return {
    ok: false,
    status: 400,
    error:
      "Provide one of: agentId, agentEmail, agentUserNumber, or agentLookup (email, agent number, or user id).",
  };
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin") {
      return NextResponse.json({ error: "Only admins can reassign" }, { status: 403 });
    }

    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const orgIds = await db
      .select({ orgId: memberships.organisationId })
      .from(memberships)
      .where(eq(memberships.userId, Number(user.id)));
    if (orgIds.length === 0) {
      return NextResponse.json({ error: "No organisation" }, { status: 403 });
    }
    const orgId = orgIds[0].orgId;

    const [policy] = await db
      .select({ id: policies.id })
      .from(policies)
      .where(and(eq(policies.id, id), eq(policies.organisationId, orgId)))
      .limit(1);
    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const [carRow] = await db
      .select({ extraAttributes: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, id))
      .limit(1);
    const policyStatus = String(
      (carRow?.extraAttributes as Record<string, unknown> | null)?.status ??
        "quotation_prepared",
    );
    if (!REASSIGNABLE_STATUSES.has(policyStatus)) {
      return NextResponse.json(
        {
          error: `Cannot reassign agent on a policy with status "${policyStatus}". Allowed statuses: ${[...REASSIGNABLE_STATUSES].join(", ")}.`,
        },
        { status: 409 },
      );
    }

    const resolved = await resolveAgent(orgId, body);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const agent = resolved.agent;

    const cols = await getPolicyColumns();
    if (!cols.hasAgentId) {
      return NextResponse.json(
        { error: "Agent assignment column not available" },
        { status: 400 },
      );
    }

    await db
      .update(policies)
      .set({ agentId: agent.id })
      .where(eq(policies.id, id));

    return NextResponse.json({
      ok: true,
      agent: { id: agent.id, name: agent.name, email: agent.email },
    });
  } catch (err: unknown) {
    const message =
      err && typeof err === "object" && "message" in err
        ? (err as { message: string }).message
        : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
