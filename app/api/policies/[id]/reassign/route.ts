import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { policies } from "@/db/schema/insurance";
import { users, memberships } from "@/db/schema/core";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";

export const dynamic = "force-dynamic";

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

    const body = await request.json();
    const agentEmail = String(body?.agentEmail ?? "").trim();
    if (!agentEmail || !agentEmail.includes("@")) {
      return NextResponse.json(
        { error: "Valid agent email is required" },
        { status: 400 },
      );
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

    const [agent] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.organisationId, orgId)))
      .where(eq(users.email, agentEmail))
      .limit(1);

    if (!agent) {
      return NextResponse.json(
        { error: `No user found with email "${agentEmail}" in your organisation` },
        { status: 404 },
      );
    }

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
