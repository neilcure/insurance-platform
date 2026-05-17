import { NextResponse } from "next/server";
import { and, eq, sql, desc, ilike } from "drizzle-orm";
import { db } from "@/db/client";
import { policies, cars } from "@/db/schema/insurance";
import { clients } from "@/db/schema/core";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import { getInsuredDisplayName } from "@/lib/field-resolver";

/**
 * `clientSet` rows are client-master stubs (insured/contact only). They lack
 * real motor packages / premiums, so listing them for document-template
 * preview duplicates policy numbers and produces confusing empty sections.
 */
const EXCLUDE_CLIENT_MASTER_FLOW = sql`(
  COALESCE(${policies.flowKey}, '') <> 'clientSet'
  AND COALESCE((${cars.extraAttributes})::jsonb ->> 'flowKey', '') <> 'clientSet'
)`;

export const dynamic = "force-dynamic";
export const revalidate = 0;

function registrationFromVehicleSnapshot(extra: Record<string, unknown>): string | null {
  const pkgs = extra.packagesSnapshot;
  if (!pkgs || typeof pkgs !== "object") return null;
  const vehicleinfo = (pkgs as Record<string, unknown>).vehicleinfo;
  if (!vehicleinfo || typeof vehicleinfo !== "object") return null;
  const values = (vehicleinfo as { values?: Record<string, unknown> }).values;
  if (!values || typeof values !== "object") return null;
  const keys = ["registration", "registrationNumber", "vehicleRegistration", "plateNumber", "plate", "vehicleNo"];
  for (const k of keys) {
    const v = values[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/**
 * Admin-only endpoint that backs the live document-template preview pane.
 *
 * Two modes:
 *   - GET ?policyNumber=ABC      → returns the matching policy (case-insensitive)
 *   - GET ?id=123                → returns the policy by id
 *   - GET ?search=ABC            → returns up to 20 recent policies whose
 *                                   policyNumber matches `%search%`
 *   - GET (no params)            → returns up to 20 recent **real policy**
 *                                   rows (excludes `clientSet` client-master
 *                                   stubs), with plate + insured hint labels
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
      const searchWhere =
        searchParam.length > 0 ? ilike(policies.policyNumber, `%${searchParam}%`) : undefined;

      const rows = await db
        .select({
          policyId: policies.id,
          policyNumber: policies.policyNumber,
          createdAt: policies.createdAt,
          flowKey: policies.flowKey,
          plateNumber: cars.plateNumber,
          extraAttributes: cars.extraAttributes,
        })
        .from(policies)
        .leftJoin(cars, eq(cars.policyId, policies.id))
        .where(searchWhere ? and(searchWhere, EXCLUDE_CLIENT_MASTER_FLOW) : EXCLUDE_CLIENT_MASTER_FLOW)
        .orderBy(desc(policies.createdAt))
        .limit(80);

      const seen = new Set<number>();
      const list: {
        policyId: number;
        policyNumber: string;
        createdAt: string;
        flowKey: string | null;
        plateNumber: string | null;
        insuredLabel: string | null;
      }[] = [];

      for (const r of rows) {
        if (seen.has(r.policyId)) continue;
        seen.add(r.policyId);

        const extra = (r.extraAttributes ?? {}) as Record<string, unknown>;
        const insuredSnap = extra.insuredSnapshot as Record<string, unknown> | undefined;
        const insuredLabel = getInsuredDisplayName(insuredSnap) || null;

        const plateCol =
          r.plateNumber != null && String(r.plateNumber).trim() !== ""
            ? String(r.plateNumber).trim()
            : null;
        const plate = plateCol ?? registrationFromVehicleSnapshot(extra);

        list.push({
          policyId: r.policyId,
          policyNumber: r.policyNumber,
          createdAt: String(r.createdAt ?? ""),
          flowKey: r.flowKey,
          plateNumber: plate,
          insuredLabel,
        });
        if (list.length >= 20) break;
      }

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
