import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { memberships, clients, clientAgentAssignments } from "@/db/schema/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const baseSelect = db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        organisationId: policies.organisationId,
        createdAt: policies.createdAt,
        carId: cars.id,
        plateNumber: cars.plateNumber,
        make: cars.make,
        model: cars.model,
        year: cars.year,
        extraAttributes: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.id, id))
      .limit(1);

    type Row = {
      policyId: number;
      policyNumber: string;
      organisationId: number;
      createdAt: string;
      carId: number | null;
      plateNumber: string | null;
      make: string | null;
      model: string | null;
      year: number | null;
      extraAttributes?: unknown;
    };
    let rows: Row[];
    try {
      if (user.userType === "admin" || user.userType === "internal_staff") {
        rows = await baseSelect;
      } else if (user.userType === "agent") {
        // Agents can view policies they authored (agent_id = current user)
        const agentId = Number(user.id);
        const result = await db.execute(sql`
          with has_agent as (
            select exists (select 1 from information_schema.columns where table_name='policies' and column_name='agent_id') as present
          )
          select
            p.id as "policyId",
            p.policy_number as "policyNumber",
            p.organisation_id as "organisationId",
            p.created_at as "createdAt",
            c.id as "carId",
            c.plate_number as "plateNumber",
            c.make as "make",
            c.model as "model",
            c.year as "year",
            c.extra_attributes as "extraAttributes"
          from "policies" p
          left join "cars" c on c.policy_id = p.id
          where p.id = ${id}
            and (select present from has_agent)
            and p.agent_id = ${agentId}
          limit 1
        `);
        rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as any[];
      } else {
        rows = await db
          .select({
            policyId: policies.id,
            policyNumber: policies.policyNumber,
            organisationId: policies.organisationId,
            createdAt: policies.createdAt,
            carId: cars.id,
            plateNumber: cars.plateNumber,
            make: cars.make,
            model: cars.model,
            year: cars.year,
            extraAttributes: cars.extraAttributes,
          })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .innerJoin(
            memberships,
            and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id)))
          )
          .where(eq(policies.id, id))
          .limit(1);
      }
    } catch {
      // Fallback for legacy DBs without created_by:
      // - Admin/Internal Staff: allow
      // - Agent: treat as not found to avoid leakage
      // - Others: membership-based
      if (user.userType === "admin" || user.userType === "internal_staff") {
        rows = await baseSelect;
      } else if (user.userType === "agent") {
        rows = [];
      } else {
        rows = await db
          .select({
            policyId: policies.id,
            policyNumber: policies.policyNumber,
            organisationId: policies.organisationId,
            createdAt: policies.createdAt,
            carId: cars.id,
            plateNumber: cars.plateNumber,
            make: cars.make,
            model: cars.model,
            year: cars.year,
          })
          .from(policies)
          .leftJoin(cars, eq(cars.policyId, policies.id))
          .innerJoin(
            memberships,
            and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id)))
          )
          .where(eq(policies.id, id))
          .limit(1);
      }
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const base = rows[0] as Row & { extraAttributes?: any };
    // Resolve client from snapshot (or clientNumber) to make UI simpler
    let policyClientId: number | null = null;
    let resolvedClient:
      | { id: number; clientNumber: string; createdAt?: string }
      | null = null;
    try {
      // Prefer the relational link when `policies.client_id` exists (this is the most reliable).
      // Older snapshots may not contain clientId, but the policy row can still be linked.
      try {
        const res = await db.execute(sql`
          with has_client as (
            select exists (
              select 1 from information_schema.columns
              where table_name='policies' and column_name='client_id'
            ) as present
          )
          select
            (case when (select present from has_client) then p.client_id else null end) as "clientId"
          from "policies" p
          where p.id = ${id}
          limit 1
        `);
        const r = Array.isArray(res) ? (res as any)[0] : (res as any)?.rows?.[0];
        const cid = Number(r?.clientId ?? r?.client_id);
        if (Number.isFinite(cid) && cid > 0) {
          policyClientId = cid;
          const [c] = await db
            .select({ id: clients.id, clientNumber: clients.clientNumber, createdAt: clients.createdAt })
            .from(clients)
            .where(eq(clients.id, cid))
            .limit(1);
          if (c) {
            resolvedClient = { id: c.id, clientNumber: c.clientNumber, createdAt: c.createdAt };
          }
        }
      } catch {
        // ignore policy client_id lookup failures
      }

      const extra = (base?.extraAttributes ?? {}) as any;
      // 1) Try numeric clientId in snapshot
      let cid = Number(extra?.clientId);
      if (!(Number.isFinite(cid) && cid > 0) && Number.isFinite(policyClientId) && (policyClientId as number) > 0) {
        cid = Number(policyClientId);
      }
      // 2) Try packagesSnapshot.*.values.clientId (scan broadly)
      if (!(Number.isFinite(cid) && cid > 0)) {
        const pkgs = (extra?.packagesSnapshot ?? {}) as Record<string, unknown>;
        for (const entry of Object.values(pkgs)) {
          const obj =
            entry && typeof entry === "object"
              ? ("values" in (entry as any) ? (entry as any).values : entry)
              : null;
          if (obj && typeof obj === "object") {
            const raw =
              (obj as any)?.clientId ??
              (obj as any)?.client_id ??
              (obj as any)?.clientID ??
              (obj as any)?.ClientID;
            const n = Number(raw as any);
            if (Number.isFinite(n) && n > 0) {
              cid = n;
              break;
            }
          }
        }
      }
      // 3) If still missing, try to resolve by clientNumber in snapshot
      let numberCandidate: string | undefined;
      if (!(Number.isFinite(cid) && cid > 0)) {
        const pkgs = (extra?.packagesSnapshot ?? {}) as Record<string, unknown>;
        const readNum = (o: any) =>
          o?.clientNumber ?? o?.client_no ?? o?.clientNo ?? o?.ClientNumber ?? o?.ClientNo;
        for (const entry of Object.values(pkgs)) {
          const obj =
            entry && typeof entry === "object"
              ? ("values" in (entry as any) ? (entry as any).values : entry)
              : null;
          if (obj && typeof obj === "object") {
            const rn = readNum(obj);
            if (typeof rn === "string" && rn.trim().length > 0) {
              numberCandidate = rn.trim();
              break;
            }
          }
        }
      }
      // 4) If still unresolved, infer from insured identity (category + primaryId) in snapshot
      let inferredCategory: "company" | "personal" | undefined;
      let inferredPrimaryId: string | undefined;
      if (!(Number.isFinite(cid) && cid > 0) && !numberCandidate) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        const tokens = (obj: Record<string, unknown>) =>
          Object.entries(obj).map(([k, v]) => [norm(String(k)), v] as const);
        const pkgs = (extra?.packagesSnapshot ?? {}) as Record<string, unknown>;
        const allObjs: Record<string, unknown>[] = [];
        for (const entry of Object.values(pkgs)) {
          const obj =
            entry && typeof entry === "object"
              ? ("values" in (entry as any) ? (entry as any).values : entry)
              : null;
          if (obj && typeof obj === "object") allObjs.push(obj as Record<string, unknown>);
        }
        // Try to infer category
        for (const obj of allObjs) {
          const list = tokens(obj);
          const hasCompanySignals = list.some(([k]) =>
            ["companyname", "organisationname", "orgname", "brnumber", "businessreg", "brno", "registrationnumber", "cinumber", "ci"].some((t) => k.includes(t))
          );
          const hasPersonalSignals = list.some(([k]) =>
            ["fullname", "firstname", "lastname", "idnumber", "hkid"].some((t) => k.includes(t))
          );
          if (hasCompanySignals && !inferredCategory) inferredCategory = "company";
          if (hasPersonalSignals && !inferredCategory) inferredCategory = "personal";
          if (inferredCategory) break;
        }
        // Extract primaryId by category-specific keys
        const getVal = (obj: Record<string, unknown>, keys: string[]) => {
          const list = tokens(obj);
          for (const [k, v] of list) {
            if (keys.some((t) => k.includes(t))) {
              const sv = typeof v === "string" ? v : (v as any)?.toString?.();
              const out = String(sv ?? "").trim();
              if (out) return out;
            }
          }
          return undefined;
        };
        for (const obj of allObjs) {
          if (inferredCategory === "company") {
            inferredPrimaryId =
              getVal(obj, ["brnumber", "businessreg", "brno", "registrationnumber"]) ??
              getVal(obj, ["cinumber", "ci"]);
          } else if (inferredCategory === "personal") {
            inferredPrimaryId = getVal(obj, ["idnumber", "hkid", "id"]);
          }
          if (inferredPrimaryId) break;
        }
        if (inferredCategory && inferredPrimaryId) {
          const [c] = await db
            .select({ id: clients.id, clientNumber: clients.clientNumber, createdAt: clients.createdAt })
            .from(clients)
            .where(and(eq(clients.category, inferredCategory), eq(clients.primaryId, inferredPrimaryId)))
            .limit(1);
          if (c) {
            resolvedClient = { id: c.id, clientNumber: c.clientNumber, createdAt: c.createdAt };
          }
        }
      }
      if (Number.isFinite(cid) && cid > 0) {
        const [c] = await db
          .select({ id: clients.id, clientNumber: clients.clientNumber, createdAt: clients.createdAt })
          .from(clients)
          .where(eq(clients.id, Number(cid)))
          .limit(1);
        if (c) resolvedClient = { id: c.id, clientNumber: c.clientNumber, createdAt: c.createdAt };
      } else if (numberCandidate) {
        const [c] = await db
          .select({ id: clients.id, clientNumber: clients.clientNumber, createdAt: clients.createdAt })
          .from(clients)
          .where(eq(clients.clientNumber, numberCandidate))
          .limit(1);
        if (c) resolvedClient = { id: c.id, clientNumber: c.clientNumber, createdAt: c.createdAt };
      }
    } catch {
      // ignore resolution errors
    }
    // Resolve agent linked to this policy (if column present)
    let resolvedAgent:
      | { id: number; userNumber: string | null; name: string | null; email: string }
      | null = null;
    try {
      const res = await db.execute(sql`
        with has_agent as (
          select exists (
            select 1 from information_schema.columns
            where table_name='policies' and column_name='agent_id'
          ) as present
        )
        select u.id, u.user_number as "userNumber", u.name, u.email
        from "policies" p
        left join "users" u on ((select present from has_agent) and u.id = p.agent_id)
        where p.id = ${id}
        limit 1
      `);
      const r = Array.isArray(res) ? (res as any)[0] : (res as any)?.rows?.[0];
      if (r && r.id) {
        resolvedAgent = {
          id: Number(r.id),
          userNumber: r.userNumber !== undefined ? (r.userNumber as any) : (r.user_number as any) ?? null,
          name: (r.name as any) ?? null,
          email: String(r.email),
        };
      }
    } catch {
      resolvedAgent = null;
    }
    const res = NextResponse.json(
      { ...base, clientId: policyClientId ?? resolvedClient?.id ?? null, client: resolvedClient, agent: resolvedAgent },
      { status: 200 }
    );
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    // Only admin or internal staff can delete policies
    if (!(user.userType === "admin" || user.userType === "internal_staff")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await db.delete(policies).where(eq(policies.id, id));
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}


