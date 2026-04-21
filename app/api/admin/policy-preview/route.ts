import { NextResponse } from "next/server";
import { eq, sql, desc, ilike } from "drizzle-orm";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { clients } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Admin-only endpoint that backs the live document-template preview pane.
 *
 * Two modes:
 *   - GET ?policyNumber=ABC      → returns the matching policy (case-insensitive)
 *   - GET ?id=123                → returns the policy by id
 *   - GET ?search=ABC            → returns up to 20 recent policies whose
 *                                   policyNumber matches `%search%`
 *   - GET (no params)            → returns the 20 most recently created policies
 *                                   (admin can pick one to preview against)
 *
 * The single-policy response intentionally mirrors the `PolicyDetail` shape
 * that the existing `/api/policies/[id]` endpoint returns, so the same
 * `<DocumentPreview />` component used in the policy Documents tab can render
 * against it without any adapter code.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (user.userType !== "admin" && user.userType !== "internal_staff") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const idParam = url.searchParams.get("id");
    const policyNumberParam = url.searchParams.get("policyNumber");
    const searchParam = (url.searchParams.get("search") ?? "").trim();
    const polCols = await getPolicyColumns();

    if (!idParam && !policyNumberParam) {
      const where = searchParam.length > 0
        ? ilike(policies.policyNumber, `%${searchParam}%`)
        : undefined;
      const baseList = db
        .select({
          policyId: policies.id,
          policyNumber: policies.policyNumber,
          createdAt: policies.createdAt,
          flowKey: policies.flowKey,
        })
        .from(policies);
      const list = await (where
        ? baseList.where(where).orderBy(desc(policies.createdAt)).limit(20)
        : baseList.orderBy(desc(policies.createdAt)).limit(20));
      return NextResponse.json({ list });
    }

    let policyId: number | null = idParam ? Number(idParam) : null;
    if (!policyId && policyNumberParam) {
      const [found] = await db
        .select({ id: policies.id })
        .from(policies)
        .where(sql`LOWER(${policies.policyNumber}) = LOWER(${policyNumberParam})`)
        .limit(1);
      if (!found) {
        return NextResponse.json(
          { error: `Policy "${policyNumberParam}" not found` },
          { status: 404 },
        );
      }
      policyId = found.id;
    }

    if (!policyId || !Number.isFinite(policyId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const [base] = await db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        organisationId: policies.organisationId,
        createdAt: policies.createdAt,
        flowKey: policies.flowKey,
        carId: cars.id,
        plateNumber: cars.plateNumber,
        make: cars.make,
        model: cars.model,
        year: cars.year,
        extraAttributes: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id))
      .where(eq(policies.id, policyId))
      .limit(1);

    if (!base) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const extra = (base.extraAttributes ?? {}) as Record<string, unknown>;
    const resolvedFlowKey = base.flowKey || String(extra.flowKey ?? "");

    // Resolve the linked client (for `latestClient*` document fields)
    let resolvedClient: { id: number; clientNumber: string; createdAt?: string } | null = null;
    try {
      let cid = NaN;
      if (polCols.hasClientId) {
        const res = await db.execute(sql`
          select p.client_id as "clientId"
          from "policies" p
          where p.id = ${policyId}
          limit 1
        `);
        const r = Array.isArray(res) ? (res as any)[0] : (res as any)?.rows?.[0];
        cid = Number(r?.clientId ?? r?.client_id);
      }
      if (!Number.isFinite(cid) || cid <= 0) {
        const snapCid = Number(extra.clientId);
        if (Number.isFinite(snapCid) && snapCid > 0) cid = snapCid;
      }
      if (Number.isFinite(cid) && cid > 0) {
        const [c] = await db
          .select({ id: clients.id, clientNumber: clients.clientNumber, createdAt: clients.createdAt })
          .from(clients)
          .where(eq(clients.id, cid))
          .limit(1);
        if (c) resolvedClient = { id: c.id, clientNumber: c.clientNumber, createdAt: c.createdAt };
      }
    } catch {
      // best-effort lookup
    }

    // Resolve the assigned agent
    let resolvedAgent: { id: number; userNumber: string | null; name: string | null; email: string } | null = null;
    if (polCols.hasAgentId) {
      try {
        const res = await db.execute(sql`
          select u.id, u.user_number as "userNumber", u.name, u.email
          from "policies" p
          left join "users" u on u.id = p.agent_id
          where p.id = ${policyId}
          limit 1
        `);
        const r = Array.isArray(res) ? (res as any)[0] : (res as any)?.rows?.[0];
        if (r && r.id) {
          resolvedAgent = {
            id: Number(r.id),
            userNumber: (r.userNumber ?? r.user_number) as string | null,
            name: (r.name as string) ?? null,
            email: String(r.email ?? ""),
          };
        }
      } catch {
        // best-effort lookup
      }
    }

    const detail = {
      ...base,
      flowKey: resolvedFlowKey || null,
      recordId: base.policyId,
      recordNumber: base.policyNumber,
      clientId: resolvedClient?.id ?? null,
      client: resolvedClient,
      agent: resolvedAgent,
    };

    const res = NextResponse.json({ detail });
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err) {
    console.error("[admin/policy-preview] failed", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
