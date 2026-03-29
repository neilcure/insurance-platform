import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { formOptions } from "@/db/schema/form_options";
import { memberships, clients, clientAgentAssignments } from "@/db/schema/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";

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
      .where(eq(policies.id, id))
      .limit(1);

    type Row = {
      policyId: number;
      policyNumber: string;
      organisationId: number;
      createdAt: string;
      flowKey: string | null;
      carId: number | null;
      plateNumber: string | null;
      make: string | null;
      model: string | null;
      year: number | null;
      extraAttributes?: unknown;
    };
    let rows: Row[];
    const polCols = await getPolicyColumns();
    try {
      if (user.userType === "admin" || user.userType === "internal_staff") {
        rows = await baseSelect;
      } else if (user.userType === "agent") {
        const agentId = Number(user.id);
        if (!polCols.hasAgentId) {
          rows = [];
        } else {
          const result = await db.execute(sql`
            select
              p.id as "policyId",
              p.policy_number as "policyNumber",
              p.organisation_id as "organisationId",
              p.created_at as "createdAt",
              ${polCols.hasFlowKey ? sql`p.flow_key as "flowKey",` : sql``}
              c.id as "carId",
              c.plate_number as "plateNumber",
              c.make as "make",
              c.model as "model",
              c.year as "year",
              c.extra_attributes as "extraAttributes"
            from "policies" p
            left join "cars" c on c.policy_id = p.id
            where p.id = ${id}
              and p.agent_id = ${agentId}
            limit 1
          `);
          rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as any[];
        }
      } else {
        rows = await db
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
          .innerJoin(
            memberships,
            and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id)))
          )
          .where(eq(policies.id, id))
          .limit(1);
      }
    } catch {
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
            flowKey: policies.flowKey,
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
        let cid = NaN;
        if (polCols.hasClientId) {
          const res = await db.execute(sql`
            select p.client_id as "clientId"
            from "policies" p
            where p.id = ${id}
            limit 1
          `);
          const r = Array.isArray(res) ? (res as any)[0] : (res as any)?.rows?.[0];
          cid = Number(r?.clientId ?? r?.client_id);
        }
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
    // For client flow records, keep the client's clientNumber in sync with policyNumber
    // so there is only one identifier visible to the user.
    const resolvedFlowKey = (base as any).flowKey || String((base.extraAttributes as any)?.flowKey ?? "");
    const flowKey = resolvedFlowKey.toLowerCase();
    if (flowKey.includes("client") && resolvedClient && resolvedClient.clientNumber !== base.policyNumber) {
      try {
        await db.update(clients).set({ clientNumber: base.policyNumber }).where(eq(clients.id, resolvedClient.id));
        resolvedClient = { ...resolvedClient, clientNumber: base.policyNumber };
      } catch { /* best effort */ }
    }
    // Resolve agent linked to this policy (if column present)
    let resolvedAgent:
      | { id: number; userNumber: string | null; name: string | null; email: string }
      | null = null;
    if (polCols.hasAgentId) {
      try {
        const res = await db.execute(sql`
          select u.id, u.user_number as "userNumber", u.name, u.email
          from "policies" p
          left join "users" u on u.id = p.agent_id
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
    }
    const res = NextResponse.json(
      {
        ...base,
        flowKey: resolvedFlowKey || null,
        recordId: base.policyId,
        recordNumber: base.policyNumber,
        clientId: policyClientId ?? resolvedClient?.id ?? null,
        client: resolvedClient,
        agent: resolvedAgent,
      },
      { status: 200 }
    );
    res.headers.set("cache-control", "no-store");
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    if (!(user.userType === "admin" || user.userType === "internal_staff")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      packages?: Record<string, unknown>;
      insured?: Record<string, unknown>;
      flowKey?: string;
      isActive?: boolean;
      note?: string;
      noteAction?: string;
      deleteNoteIndex?: number;
      status?: string;
      statusNote?: string;
    };

    // Handle isActive toggle on the policies table
    if (typeof body.isActive === "boolean") {
      const cols = await getPolicyColumns();
      if (cols.hasIsActive) {
        await db.update(policies).set({ isActive: body.isActive }).where(eq(policies.id, id));
      }
      if (body.packages === undefined && body.insured === undefined && !body.note && !body.status) {
        return NextResponse.json({ ok: true, policyId: id, recordId: id, isActive: body.isActive }, { status: 200 });
      }
    }

    const [carRow] = await db
      .select({ id: cars.id, extraAttributes: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, id))
      .limit(1);

    if (!carRow) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const existing = (carRow.extraAttributes ?? {}) as Record<string, unknown>;
    const userInfo = { id: Number(user.id), email: (user as { email?: string }).email ?? "" };

    function appendAudit(
      base: Record<string, unknown>,
      changes: { key: string; from: unknown; to: unknown }[],
    ): unknown[] {
      const arr = Array.isArray(base._audit) ? [...(base._audit as unknown[])] : [];
      arr.push({ at: new Date().toISOString(), by: userInfo, changes });
      return arr;
    }

    // Handle note append
    if (body.note && body.noteAction === "append") {
      const notesArr = Array.isArray(existing.notes) ? [...(existing.notes as unknown[])] : [];
      notesArr.push({
        text: body.note,
        at: new Date().toISOString(),
        by: userInfo,
      });
      const updated: Record<string, unknown> = {
        ...existing,
        notes: notesArr,
        _audit: appendAudit(existing, [{ key: "note", from: null, to: body.note }]),
        _lastEditedAt: new Date().toISOString(),
      };
      await db.update(cars).set({ extraAttributes: updated }).where(eq(cars.id, carRow.id));
      if (!body.packages && !body.insured && !body.status) {
        return NextResponse.json({ ok: true, policyId: id, recordId: id }, { status: 200 });
      }
    }

    // Handle note deletion by index
    if (typeof body.deleteNoteIndex === "number") {
      const notesArr = Array.isArray(existing.notes) ? [...(existing.notes as unknown[])] : [];
      if (body.deleteNoteIndex >= 0 && body.deleteNoteIndex < notesArr.length) {
        const deleted = notesArr[body.deleteNoteIndex] as { text?: string };
        notesArr.splice(body.deleteNoteIndex, 1);
        const updated: Record<string, unknown> = {
          ...existing,
          notes: notesArr,
          _audit: appendAudit(existing, [{ key: "note", from: deleted?.text ?? "(note)", to: null }]),
          _lastEditedAt: new Date().toISOString(),
        };
        await db.update(cars).set({ extraAttributes: updated }).where(eq(cars.id, carRow.id));
      }
      if (!body.packages && !body.insured && !body.status) {
        return NextResponse.json({ ok: true, policyId: id, recordId: id }, { status: 200 });
      }
    }

    // Handle status change
    if (body.status) {
      const oldStatus = (existing.status as string) ?? "active";
      const historyArr = Array.isArray(existing.statusHistory)
        ? [...(existing.statusHistory as unknown[])]
        : [];
      historyArr.push({
        status: body.status,
        changedAt: new Date().toISOString(),
        changedBy: userInfo.email || `user:${user.id}`,
        note: body.statusNote ?? undefined,
      });
      const refreshed = (
        await db
          .select({ extraAttributes: cars.extraAttributes })
          .from(cars)
          .where(eq(cars.id, carRow.id))
          .limit(1)
      )[0];
      const base = ((refreshed?.extraAttributes ?? existing) as Record<string, unknown>);
      const updated: Record<string, unknown> = {
        ...base,
        status: body.status,
        statusHistory: historyArr,
        _audit: appendAudit(base, [{ key: "status", from: oldStatus, to: body.status }]),
        _lastEditedAt: new Date().toISOString(),
      };
      await db.update(cars).set({ extraAttributes: updated }).where(eq(cars.id, carRow.id));

      // Process onEnter hooks for the new status
      const hooksExecuted: string[] = [];
      try {
        const [statusDef] = await db
          .select({ meta: formOptions.meta })
          .from(formOptions)
          .where(and(eq(formOptions.groupKey, "policy_statuses"), eq(formOptions.value, body.status)))
          .limit(1);
        const onEnter = (statusDef?.meta as { onEnter?: { action: string; templateId?: number; targetStatus?: string }[] } | null)?.onEnter;
        if (Array.isArray(onEnter)) {
          for (const hook of onEnter) {
            try {
              if (hook.action === "generate_document" && hook.templateId) {
                hooksExecuted.push(`generate_document:${hook.templateId}`);
              }
            } catch { /* best-effort hooks */ }
          }
        }
      } catch { /* ignore hook lookup errors */ }

      if (!body.packages && !body.insured) {
        return NextResponse.json({ ok: true, policyId: id, recordId: id, status: body.status, previousStatus: oldStatus, hooks: hooksExecuted }, { status: 200 });
      }
    }

    const oldPkgs = (existing.packagesSnapshot ?? {}) as Record<string, unknown>;
    let newPkgs: Record<string, unknown>;
    if (body.packages) {
      const incoming = body.packages as Record<string, unknown>;
      newPkgs = { ...oldPkgs };
      for (const [pkgName, pkgData] of Object.entries(incoming)) {
        const existingPkg = oldPkgs[pkgName];
        if (existingPkg && typeof existingPkg === "object" && pkgData && typeof pkgData === "object") {
          const oldIsStruct = "values" in (existingPkg as Record<string, unknown>);
          const newIsStruct = "values" in (pkgData as Record<string, unknown>);
          if (oldIsStruct && newIsStruct) {
            const oldVals = (existingPkg as { values?: Record<string, unknown> }).values ?? {};
            const newVals = (pkgData as { values?: Record<string, unknown> }).values ?? {};
            newPkgs[pkgName] = { ...existingPkg as object, ...(pkgData as object), values: { ...oldVals, ...newVals } };
          } else if (!oldIsStruct && !newIsStruct) {
            newPkgs[pkgName] = { ...existingPkg as object, ...(pkgData as object) };
          } else {
            newPkgs[pkgName] = pkgData;
          }
        } else {
          newPkgs[pkgName] = pkgData;
        }
      }
    } else {
      newPkgs = oldPkgs;
    }

    // Cross-sync: when insuredSnapshot is updated but packagesSnapshot is not
    // explicitly provided, propagate changes to matching insured/contactinfo
    // packages in packagesSnapshot so they stay in sync.
    if (body.insured && !body.packages) {
      const normKey = (k: string) => k.toLowerCase().replace(/_+/g, "");
      const syncPkg = (pkgName: string, sourceEntries: [string, unknown][]) => {
        if (!(pkgName in newPkgs)) return;
        const pkgData = newPkgs[pkgName] as Record<string, unknown> | null;
        if (!pkgData || typeof pkgData !== "object") return;
        const isStruct = "values" in pkgData || "category" in pkgData;
        const vals = isStruct
          ? { ...((pkgData as { values?: Record<string, unknown> }).values ?? {}) }
          : { ...pkgData };
        const valsNorms = new Map<string, string>();
        for (const k of Object.keys(vals)) valsNorms.set(normKey(k), k);
        let changed = false;
        for (const [sk, sv] of sourceEntries) {
          const existing = valsNorms.get(normKey(sk));
          if (existing) {
            if (JSON.stringify(vals[existing]) !== JSON.stringify(sv)) {
              vals[existing] = sv;
              changed = true;
            }
          }
        }
        if (changed) {
          newPkgs = { ...newPkgs };
          newPkgs[pkgName] = isStruct ? { ...pkgData, values: vals } : vals;
        }
      };
      const insuredEntries: [string, unknown][] = [];
      const contactEntries: [string, unknown][] = [];
      for (const [k, v] of Object.entries(body.insured)) {
        const lower = k.toLowerCase();
        if (lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__")) {
          contactEntries.push([k, v]);
        } else if (lower.startsWith("insured_") || lower.startsWith("insured__")) {
          insuredEntries.push([k, v]);
        }
      }
      if (insuredEntries.length > 0) syncPkg("insured", insuredEntries);
      if (contactEntries.length > 0) syncPkg("contactinfo", contactEntries);
    }

    const changes: { key: string; from: unknown; to: unknown }[] = [];
    const flattenPkg = (pkgs: Record<string, unknown>): Record<string, unknown> => {
      const flat: Record<string, unknown> = {};
      for (const [pkg, data] of Object.entries(pkgs)) {
        if (!data || typeof data !== "object") continue;
        const vals = (data as { values?: Record<string, unknown> }).values ?? (data as Record<string, unknown>);
        for (const [k, v] of Object.entries(vals)) flat[k] = v;
        if ((data as { category?: string }).category) flat[`${pkg}__category`] = (data as { category?: string }).category;
      }
      return flat;
    };
    const oldFlat = flattenPkg(oldPkgs);
    const newFlat = flattenPkg(newPkgs);
    const allKeys = new Set([...Object.keys(oldFlat), ...Object.keys(newFlat)]);
    for (const k of allKeys) {
      const ov = oldFlat[k], nv = newFlat[k];
      const os = JSON.stringify(ov ?? null), ns = JSON.stringify(nv ?? null);
      if (os !== ns) changes.push({ key: k, from: ov ?? null, to: nv ?? null });
    }
    if (body.insured) {
      const oldInsured = (existing.insuredSnapshot ?? {}) as Record<string, unknown>;
      const newInsured = body.insured;
      const insuredKeys = new Set([...Object.keys(oldInsured), ...Object.keys(newInsured)]);
      for (const k of insuredKeys) {
        const ov = oldInsured[k], nv = newInsured[k];
        const os = JSON.stringify(ov ?? null), ns = JSON.stringify(nv ?? null);
        if (os !== ns) changes.push({ key: k, from: ov ?? null, to: nv ?? null });
      }
    }

    // Deduplicate changes by normalized key to avoid double entries
    // for keys like insured_companyName vs insured__companyName
    const normalizeChangeKey = (k: string) =>
      k.replace(/^[a-zA-Z0-9]+__/, "").replace(/^[a-zA-Z0-9]+_/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const seenChangeKeys = new Set<string>();
    const dedupedChanges = changes.filter((c) => {
      const nk = normalizeChangeKey(c.key);
      if (seenChangeKeys.has(nk)) return false;
      seenChangeKeys.add(nk);
      return true;
    });

    const auditArr = Array.isArray(existing._audit) ? [...(existing._audit as unknown[])] : [];
    if (dedupedChanges.length > 0) {
      auditArr.push({
        at: new Date().toISOString(),
        by: { id: Number(user.id), email: (user as { email?: string }).email ?? "" },
        changes: dedupedChanges,
      });
    }

    const stripLinkedKeys = (raw: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(raw)) {
        if (pk.includes("___linked")) continue;
        if (pv && typeof pv === "object" && !Array.isArray(pv)) {
          const inner = pv as Record<string, unknown>;
          if ("values" in inner && inner.values && typeof inner.values === "object") {
            const cleaned: Record<string, unknown> = {};
            for (const [fk, fv] of Object.entries(inner.values as Record<string, unknown>)) {
              if (!fk.includes("___linked")) cleaned[fk] = fv;
            }
            out[pk] = { ...inner, values: cleaned };
          } else {
            const cleaned: Record<string, unknown> = {};
            for (const [fk, fv] of Object.entries(inner)) {
              if (!fk.includes("___linked")) cleaned[fk] = fv;
            }
            out[pk] = cleaned;
          }
        } else {
          out[pk] = pv;
        }
      }
      return out;
    };

    const updated: Record<string, unknown> = {
      ...existing,
      packagesSnapshot: stripLinkedKeys(newPkgs),
      insuredSnapshot: body.insured ?? existing.insuredSnapshot,
      _audit: auditArr,
      _lastEditedAt: new Date().toISOString(),
    };

    await db
      .update(cars)
      .set({ extraAttributes: updated })
      .where(eq(cars.id, carRow.id));

    return NextResponse.json({ ok: true, policyId: id, recordId: id }, { status: 200 });
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
    if (!(user.userType === "admin" || user.userType === "internal_staff")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [carRow] = await db
      .select({ id: cars.id, extra: cars.extraAttributes })
      .from(cars)
      .where(eq(cars.policyId, id))
      .limit(1);
    const extra = (carRow?.extra ?? {}) as Record<string, unknown>;
    const linkedPolicyId = extra.linkedPolicyId ? Number(extra.linkedPolicyId) : null;

    // ── Endorsement record: soft-delete + rollback changes on original policy ──
    if (linkedPolicyId) {
      const cols = await getPolicyColumns();

      // 1) Soft-delete: mark endorsement as inactive
      if (cols.hasIsActive) {
        await db.update(policies).set({ isActive: false }).where(eq(policies.id, id));
      }

      // Mark as deleted in extraAttributes for UI filtering
      const updatedExtra = {
        ...extra,
        _deletedAt: new Date().toISOString(),
        _deletedBy: user.email ?? user.id,
      };
      if (carRow) {
        await db.update(cars).set({ extraAttributes: updatedExtra }).where(eq(cars.id, carRow.id));
      }

      // 2) Rollback: reverse changes on the original policy using _endorsementChanges
      const changes = Array.isArray(extra._endorsementChanges)
        ? (extra._endorsementChanges as { field: string; from: unknown; to: unknown }[])
        : [];

      if (changes.length > 0) {
        const [origCarRow] = await db
          .select({ id: cars.id, extra: cars.extraAttributes })
          .from(cars)
          .where(eq(cars.policyId, linkedPolicyId))
          .limit(1);

        if (origCarRow) {
          const origExtra = (origCarRow.extra ?? {}) as Record<string, unknown>;
          const origPkgs = (origExtra.packagesSnapshot ?? {}) as Record<string, Record<string, unknown>>;
          const rolledBackPkgs = JSON.parse(JSON.stringify(origPkgs)) as Record<string, Record<string, unknown>>;

          for (const change of changes) {
            const fieldKey = String(change.field);
            const parts = fieldKey.split("__");
            if (parts.length < 2) continue;
            const pkgName = parts[0];
            const valKey = parts.slice(1).join("__");
            const pkg = rolledBackPkgs[pkgName];
            if (!pkg) continue;

            if (pkg.values && typeof pkg.values === "object") {
              (pkg.values as Record<string, unknown>)[valKey] = change.from;
            } else {
              pkg[valKey] = change.from;
            }
          }

          // Add audit entry for the rollback
          const auditLog = Array.isArray(origExtra._editHistory)
            ? [...(origExtra._editHistory as unknown[])]
            : [];
          auditLog.push({
            at: new Date().toISOString(),
            by: user.email ?? String(user.id),
            action: "endorsement_rollback",
            endorsementId: id,
            changes: changes.map((c) => ({ key: c.field, from: c.to, to: c.from })),
          });

          const updatedOrigExtra = {
            ...origExtra,
            packagesSnapshot: rolledBackPkgs,
            _editHistory: auditLog,
          };

          await db.update(cars).set({ extraAttributes: updatedOrigExtra }).where(eq(cars.id, origCarRow.id));
        }
      }

      return NextResponse.json({
        success: true,
        softDeleted: true,
        rolledBack: changes.length > 0,
        message: `Endorsement deactivated${changes.length > 0 ? " and changes rolled back on the original policy" : ""}.`,
      }, { status: 200 });
    }

    // ── Regular policy: prevent deletion if endorsements are linked ──
    const linkedEndorsements = await db.execute(
      sql`SELECT 1 FROM cars WHERE ((extra_attributes)::jsonb ->> 'linkedPolicyId')::int = ${id} LIMIT 1`
    );
    const hasLinked = Array.isArray(linkedEndorsements) ? linkedEndorsements.length > 0 : !!(linkedEndorsements as any)?.rows?.length;
    if (hasLinked) {
      return NextResponse.json(
        { error: "Cannot delete this policy because it has endorsement records linked to it. Remove the endorsements first." },
        { status: 400 },
      );
    }

    await db.delete(policies).where(eq(policies.id, id));
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}


