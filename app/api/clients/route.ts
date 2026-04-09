import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { and, eq, asc, sql } from "drizzle-orm";
import { clients, appSettings, clientAgentAssignments } from "@/db/schema/core";
import { policies, cars } from "@/db/schema/insurance";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import { getInsuredPrimaryId, getInsuredType } from "@/lib/field-resolver";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PostBody = {
  insured?: Record<string, unknown>;
};

export async function POST(request: Request) {
  try {
    const me = await requireUser();
    const body = (await request.json()) as PostBody;
    const rawInput = (body?.insured ?? {}) as Record<string, unknown>;
    // Flatten one level (some forms wrap data)
    const raw: Record<string, unknown> = {};
    const addEntries = (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) {
        raw[k] = v;
      }
    };
    addEntries(rawInput);
    for (const [k, v] of Object.entries(rawInput)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        addEntries(v as Record<string, unknown>);
      }
    }

    // Helper: normalize key for matching (drop non-alphanum)
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const entries = Object.entries(raw);
    const getByTokens = (tokens: string[]): string | undefined => {
      const wanted = tokens.map(norm);
      for (const [k, v] of entries) {
        // Strip common prefixes like 'insured_' before matching
        let nk = norm(String(k));
        nk = nk.replace(/^insured+/, "");
        if (wanted.some((t) => nk.includes(t) || nk.endsWith(t))) {
          const sv = typeof v === "string" ? v : (v as any)?.toString?.();
          const out = String(sv ?? "").trim();
          if (out) return out;
        }
      }
      return undefined;
    };

    // Infer type
    let inferredType: "company" | "personal" | undefined;
    const rawType = getByTokens(["insuredtype", "type"]);
    const normalizedType = typeof rawType === "string" ? (rawType as string).toLowerCase().trim() : undefined;
    if (normalizedType === "company" || normalizedType === "personal") inferredType = normalizedType;
    if (!inferredType) {
      if (getByTokens(["companyname", "organisationname", "orgname", "company"])) inferredType = "company";
      else if (getByTokens(["fullname", "firstname", "lastname", "idnumber", "hkid", "name"])) inferredType = "personal";
    }

    // Extract fields
    const companyName =
      getByTokens(["companyname", "organisationname", "orgname", "company", "companyname"]) ??
      (raw as any)["Company Name"];
    const brNumber =
      getByTokens(["brnumber", "businessreg", "brno", "registrationnumber"]) ?? undefined;
    const ciNumber = getByTokens(["cinumber", "cinum", "ci"]);

    const firstName = getByTokens(["firstname", "first", "givenname"]);
    const lastName = getByTokens(["lastname", "last", "surname", "familyname"]);
    const fullName =
      getByTokens(["fullname", "name"]) ||
      [lastName, firstName].filter((s) => typeof s === "string" && s.trim().length > 0).join(" ").trim();

    const idNumber = getByTokens(["idnumber", "hkid", "id"]);
    const contactPhoneRaw = getByTokens(["contactphone", "phone", "mobile"]);

    if (!inferredType) {
      inferredType = companyName ? "company" : "personal";
    }

    // Determine minimum identity presence
    const hasCompanyMin = Boolean(companyName) || Boolean(brNumber) || Boolean(ciNumber);
    const hasPersonalMin =
      Boolean(fullName) ||
      ((Boolean(firstName) && Boolean(lastName))) ||
      Boolean(idNumber);

    // Minimal normalization with strict validation per selected category
    // Prefer explicit type but let strong evidence override when the other side has no signals
    let category: "company" | "personal" = inferredType!;
    if (category === "company" && hasPersonalMin && !hasCompanyMin) {
      category = "personal";
    } else if (category === "personal" && hasCompanyMin && !hasPersonalMin) {
      category = "company";
    }
    let displayName = (category === "company" ? companyName : fullName) || "";
    let primaryId = (category === "company" ? (brNumber || ciNumber) : idNumber) || "";
    const contactPhone = contactPhoneRaw ? String(contactPhoneRaw) : undefined;
    if (!primaryId) primaryId = `AUTO-${Date.now()}`;
    // Enforce required identifiers
    if (category === "company") {
      if (!companyName || String(companyName).trim().length === 0) {
        return NextResponse.json({ error: "Invalid insured data: companyName is required for company insured" }, { status: 400 });
      }
      displayName = String(companyName).trim();
    } else {
      const hasPersonalId =
        (typeof fullName === "string" && fullName.trim().length > 0) ||
        ((typeof firstName === "string" && firstName.trim().length > 0) &&
          (typeof lastName === "string" && lastName.trim().length > 0)) ||
        (typeof idNumber === "string" && idNumber.trim().length > 0);
      if (!hasPersonalId) {
        return NextResponse.json({ error: "Invalid insured data: fullName (or first+last) or idNumber is required for personal insured" }, { status: 400 });
      }
      displayName =
        (typeof fullName === "string" && fullName.trim().length > 0)
          ? String(fullName).trim()
          : [lastName, firstName].map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join(" ");
    }

    // Try to find existing client by logical key (select subset to avoid legacy column issues)
    const existing = await db
      .select({ id: clients.id, clientNumber: clients.clientNumber })
      .from(clients)
      .where(and(eq(clients.category, category), eq(clients.primaryId, primaryId)))
      .limit(1);
    if (existing.length > 0) {
      const c = existing[0]!;
      return NextResponse.json(
        { clientId: c.id, clientNumber: c.clientNumber, existed: true },
        { status: 200 }
      );
    }

    // Load prefixes with defaults (per-organisation)
    const orgIdRes = await db.execute<any>(`select organisation_id as "organisationId" from memberships where user_id = ${Number(me.id)} limit 1` as any);
    const organisationId = Array.isArray(orgIdRes) ? orgIdRes[0]?.organisationId : (orgIdRes as any)?.rows?.[0]?.organisationId;
    const suffix = organisationId ? `:${organisationId}` : "";
    const [settingsRow] = await db.select().from(appSettings).where(eq(appSettings.key, ("client_number_prefixes" + suffix) as any)).limit(1);
    const settings = (settingsRow?.value as { companyPrefix?: string; personalPrefix?: string } | undefined) ?? {};
    const companyPrefix = (settings.companyPrefix ?? "C").trim();
    const personalPrefix = (settings.personalPrefix ?? "P").trim();
    const prefix = category === "company" ? companyPrefix : personalPrefix;

    // Create a new client first to get ID
    const tmpNumber = `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    let created: { id: number };
    try {
      [created] = await db
        .insert(clients)
        .values({
          category,
          displayName,
          primaryId,
          contactPhone: contactPhone ?? null,
          extraAttributes: (raw as unknown) as Record<string, unknown>,
          createdBy: Number(me.id),
          // unique placeholder; will update with prefix + padded id
          clientNumber: tmpNumber,
        })
        .returning({ id: clients.id });
    } catch (_err) {
      // Fallback for pre-migration DBs lacking is_active column: insert via raw SQL with explicit columns
      const inserted = await db.execute<{ id: number }>(
        sql`insert into "clients" ("client_number","category","display_name","primary_id","contact_phone")
            values (${tmpNumber}, ${category}, ${displayName}, ${primaryId}, ${contactPhone ?? null})
            returning "id"`
      );
      created = Array.isArray(inserted) ? inserted[0]! : (inserted as unknown as { rows: { id: number }[] }).rows[0]!;
    }
    // Ensure extra_attributes are saved even on fallback path
    try {
      // Also duplicate known canonical keys under insured_* to support client details rendering
      const canonicalKeys = new Set([
        "companyName",
        "brNumber",
        "ciNumber",
        "contactName",
        "contactPhone",
        "fullName",
        "idNumber",
        "dob",
      ]);
      const withPrefixed: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
      const canonicalizePrefixedKey = (k: string): string => {
        let out = String(k ?? "").trim();
        if (!out) return "";
        if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
        if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
        return out.toLowerCase();
      };
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof k === "string" && !k.startsWith("insured_")) {
          const lower = k.toLowerCase();
          // Accept typical aliases to canonical keys
          const aliasToCanonical: Record<string, string> = {
            companyname: "companyName",
            brnumber: "brNumber",
            cinumber: "ciNumber",
            contactname: "contactName",
            contactphone: "contactPhone",
            fullname: "fullName",
            idnumber: "idNumber",
          };
          const canonical = canonicalKeys.has(k)
            ? k
            : aliasToCanonical[lower] ?? undefined;
          if (canonical) {
            const prefixed = canonicalizePrefixedKey(`insured_${canonical}`);
            if (prefixed && typeof withPrefixed[prefixed] === "undefined") {
              withPrefixed[prefixed] = v;
            }
          }
        }
      }
      await db.update(clients).set({ extraAttributes: withPrefixed }).where(eq(clients.id, created.id));
    } catch {
      // ignore silently; not critical for client creation
    }
    const padded = String(created.id).padStart(6, "0");
    const clientNumber = `${prefix}${padded}`;
    await db.update(clients).set({ clientNumber }).where(eq(clients.id, created.id));

    return NextResponse.json(
      { clientId: created.id, clientNumber, existed: false },
      { status: 201 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const me = await requireUser();
    const url = new URL(request.url);
    const MAX_LIMIT = 500;
    const qLimit = Math.min(Math.max(Number(url.searchParams.get("limit")) || MAX_LIMIT, 1), MAX_LIMIT);
    const qOffset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    // Helpers must be available to both primary and fallback branches.
    const canonicalizeKey = (k: string): string => {
      let out = String(k ?? "").trim();
      if (!out) return "";
      if (out.startsWith("insured__")) out = `insured_${out.slice("insured__".length)}`;
      if (out.startsWith("contactinfo__")) out = `contactinfo_${out.slice("contactinfo__".length)}`;
      return out.toLowerCase();
    };
    const pickStr = (m: Record<string, unknown>, ...keys: string[]): string => {
      for (const k of keys) {
        const v = m[k];
        if (v === null || typeof v === "undefined") continue;
        // Accept numbers for fields like phone/mobile that may be stored as numeric.
        const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "bigint" ? String(v) : "";
        if (s && s.trim()) return s.trim();
      }
      return "";
    };
    const buildCanonMap = (extra: Record<string, unknown>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(extra ?? {})) {
        const canon = canonicalizeKey(k);
        if (!canon) continue;
        const isPerfect = k === canon;
        if (typeof out[canon] === "undefined" || isPerfect) out[canon] = v;
      }
      return out;
    };
    const resolveDynamic = (extra: Record<string, unknown>): Record<string, unknown> => {
      const base = extra ?? {};
      const canon = buildCanonMap(base);
      const dyn: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(canon)) {
        if (k.startsWith("insured_") || k.startsWith("contactinfo_")) dyn[k] = v;
      }
      const auditRaw = (base as any)["_audit"] as unknown;
      if (Array.isArray(auditRaw)) {
        for (const entry of auditRaw as any[]) {
          const changes = Array.isArray(entry?.changes) ? entry.changes : [];
          for (const c of changes as any[]) {
            const ck = canonicalizeKey(String(c?.key ?? ""));
            if (!ck) continue;
            if (!(ck.startsWith("insured_") || ck.startsWith("contactinfo_"))) continue;
            dyn[ck] = c?.to;
          }
        }
      }
      return { ...canon, ...dyn };
    };
    const deriveDisplayName = (category: string, m: Record<string, unknown>): string => {
      const cat = String(category ?? "").trim().toLowerCase();
      if (cat === "company") {
        return (
          pickStr(m, "insured_companyname", "insured_company_name", "insured_organisationname", "insured_orgname") ||
          pickStr(m, "companyname", "organisationname", "orgname") ||
          ""
        );
      }
      if (cat === "personal") {
        const full =
          pickStr(m, "insured_fullname", "insured_full_name") ||
          pickStr(m, "fullname", "full_name");
        if (full) return full;
        const first =
          pickStr(m, "insured_firstname", "insured_first_name") ||
          pickStr(m, "firstname", "first_name");
        const last =
          pickStr(m, "insured_lastname", "insured_last_name") ||
          pickStr(m, "lastname", "last_name", "surname");
        return [last, first].filter(Boolean).join(" ").trim();
      }
      return pickStr(m, "insured_companyname", "insured_fullname") || "";
    };
    const deriveContactPhone = (m: Record<string, unknown>): string => {
      return pickStr(
        m,
        "contactinfo_mobile",
        "contactinfo_phone",
        "contactinfo_tel",
        "insured_contactphone",
        "insured_contact_phone",
        "contactphone",
        "phone",
        "mobile"
      );
    };
    const derivePrimaryId = (category: string, m: Record<string, unknown>): string => {
      const cat = String(category ?? "").trim().toLowerCase();
      if (cat === "company") {
        return pickStr(m, "insured_brnumber", "insured_br_number", "insured_cinumber", "insured_ci_number");
      }
      if (cat === "personal") {
        return pickStr(m, "insured_idnumber", "insured_id_number", "insured_hkid", "idnumber", "hkid");
      }
      return pickStr(m, "insured_brnumber", "insured_idnumber");
    };
    const loadClientProfileMap = async () => {
      const rows = await db
        .select({
          policyNumber: policies.policyNumber,
          extra: cars.extraAttributes,
        })
        .from(policies)
        .leftJoin(cars, eq(cars.policyId, policies.id))
        .where(sql`${cars.extraAttributes}->>'flowKey' = 'clientSet'`);

      const map = new Map<string, string>();
      for (const row of rows) {
        const extra = toExtraObject(row.extra);
        const insured = (extra.insuredSnapshot ?? {}) as Record<string, unknown>;
        const category = (getInsuredType(insured) || "").trim().toLowerCase();
        const primaryId = (getInsuredPrimaryId(insured) || "").trim();
        if (!category || !primaryId) continue;
        map.set(`${category}::${primaryId}`, row.policyNumber);
      }
      return map;
    };
    const toExtraObject = (raw: unknown): Record<string, unknown> => {
      if (!raw) return {};
      if (typeof raw === "object") {
        try {
          if (raw instanceof Uint8Array) {
            const s = Buffer.from(raw).toString("utf8").trim();
            if (!s) return {};
            const parsed = JSON.parse(s) as unknown;
            return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
          }
        } catch {}
        try {
          const rec = raw as Record<string, unknown>;
          const wrapped =
            typeof rec.value === "string"
              ? rec.value
              : typeof rec.json === "string"
                ? rec.json
                : typeof rec.data === "string"
                  ? rec.data
                  : undefined;
          if (wrapped) {
            const s = wrapped.trim();
            if (!s) return {};
            const parsed = JSON.parse(s) as unknown;
            return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
          }
        } catch {}
        try {
          const anyObj = raw as any;
          if (typeof anyObj?.toJSON === "function") {
            const j = anyObj.toJSON();
            if (j && typeof j === "object") return j as Record<string, unknown>;
          }
        } catch {}
        return raw as Record<string, unknown>;
      }
      if (typeof raw === "string") {
        const s = raw.trim();
        if (!s) return {};
        try {
          const parsed = JSON.parse(s) as unknown;
          if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
        } catch {}
      }
      return {};
    };
    try {
      let rows:
        | Array<{
            id: number;
            clientNumber: string;
            category: "company" | "personal";
            displayName: string;
            primaryId: string;
            contactPhone: string | null;
            isActive: boolean;
            createdAt: string;
          }>
        | any[] = [];
      if (me.userType === "admin" || me.userType === "internal_staff") {
        rows = await db
          .select({
            id: clients.id,
            clientNumber: clients.clientNumber,
            category: clients.category,
            displayName: clients.displayName,
            primaryId: clients.primaryId,
            contactPhone: clients.contactPhone,
            isActive: clients.isActive,
            extraAttributes: clients.extraAttributes,
            createdAt: clients.createdAt,
          })
          .from(clients)
          .orderBy(asc(clients.id))
          .limit(qLimit)
          .offset(qOffset);
      } else if (me.userType === "agent") {
        const polCols = await getPolicyColumns();
        const result = await db.execute(sql`
          select distinct
            c.id,
            c.client_number as "clientNumber",
            c.category,
            c.display_name as "displayName",
            c.primary_id as "primaryId",
            c.contact_phone as "contactPhone",
            c.extra_attributes as "extraAttributes",
            coalesce(c.is_active, true) as "isActive",
            c.created_at as "createdAt"
          from "clients" c
          where exists (
            select 1
            from "policies" p
            left join "cars" x on x.policy_id = p.id
            where p.agent_id = ${Number(me.id)}
              and (
                ${polCols.hasClientId ? sql`p.client_id = c.id OR` : sql``}
                (x.extra_attributes->>'clientId')::int = c.id
                or (((x.extra_attributes->'packagesSnapshot'->'policy')->>'clientId')::int = c.id)
                or (((x.extra_attributes->'packagesSnapshot'->'policy'->'values')->>'clientId')::int = c.id)
                or (x.extra_attributes->>'client_id')::int = c.id
                or (x.extra_attributes->>'clientid')::int = c.id
                or (
                  c.client_number is not null and (
                    x.extra_attributes::text ilike ('%'||quote_literal('clientNumber')||':'||quote_literal(c.client_number)||'%')
                  )
                )
              )
          )
          order by c.id asc
          limit ${qLimit} offset ${qOffset}
        `);
        rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as any[];
      } else {
        rows = await db
          .select({
            id: clients.id,
            clientNumber: clients.clientNumber,
            category: clients.category,
            displayName: clients.displayName,
            primaryId: clients.primaryId,
            contactPhone: clients.contactPhone,
            isActive: clients.isActive,
            extraAttributes: clients.extraAttributes,
            createdAt: clients.createdAt,
          })
          .from(clients)
          .orderBy(asc(clients.id))
          .limit(qLimit)
          .offset(qOffset);
      }
      // Ensure the list reflects the latest dynamic insured/contact data even if legacy writes
      // didn't keep core columns in sync.
      const clientProfileMap = await loadClientProfileMap();
      const mapped = (Array.isArray(rows) ? rows : []).map((r: any) => {
        const extraRaw =
          r?.extraAttributes ??
          r?.extra_attributes ??
          r?.extraattributes ??
          r?.extra ??
          null;
        const extra = toExtraObject(extraRaw);
        const cat = String(r?.category ?? "");
        const resolved = resolveDynamic(extra);
        const derivedName = deriveDisplayName(cat, resolved);
        const derivedPhone = deriveContactPhone(resolved);
        const derivedPrimary = derivePrimaryId(cat, resolved);
        const hasAny = (m: Record<string, unknown>, keys: string[]) =>
          keys.some((k) => Object.prototype.hasOwnProperty.call(m, k));
        const catLower = cat.trim().toLowerCase();
        const nameKeys =
          catLower === "company"
            ? ["insured_companyname", "insured_company_name", "insured_organisationname", "insured_orgname"]
            : ["insured_fullname", "insured_full_name", "insured_firstname", "insured_first_name", "insured_lastname", "insured_last_name"];
        const primaryKeys =
          catLower === "company"
            ? ["insured_brnumber", "insured_br_number", "insured_cinumber", "insured_ci_number"]
            : ["insured_idnumber", "insured_id_number", "insured_hkid"];
        const phoneKeys = ["contactinfo_mobile", "contactinfo_phone", "contactinfo_tel", "insured_contactphone", "insured_contact_phone"];
        const nameExplicit = hasAny(resolved, nameKeys);
        const primaryExplicit = hasAny(resolved, primaryKeys);
        const phoneExplicit = hasAny(resolved, phoneKeys);
        return {
          id: Number(r?.id ?? 0),
          clientNumber: String(r?.clientNumber ?? r?.client_number ?? ""),
          category: String(r?.category ?? ""),
          // If a relevant dynamic key exists (including a null tombstone), treat it as authoritative
          // and do not fall back to legacy core columns.
          displayName: nameExplicit ? derivedName : (derivedName || String(r?.displayName ?? r?.display_name ?? "")),
          primaryId: primaryExplicit ? derivedPrimary : (derivedPrimary || String(r?.primaryId ?? r?.primary_id ?? "")),
          contactPhone: phoneExplicit ? derivedPhone : (derivedPhone || (r?.contactPhone ?? r?.contact_phone ?? null)),
          isActive: Boolean(r?.isActive ?? r?.is_active ?? true),
          createdAt: String(r?.createdAt ?? r?.created_at ?? ""),
          profilePolicyNumber: clientProfileMap.get(`${String(r?.category ?? "").trim().toLowerCase()}::${(primaryExplicit ? derivedPrimary : (derivedPrimary || String(r?.primaryId ?? r?.primary_id ?? ""))).trim()}`) ?? null,
        };
      });
      return NextResponse.json(mapped, {
        status: 200,
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      });
    } catch {
      // Fallback if the is_active column hasn't been migrated yet
      const base = db
        .select({
          id: clients.id,
          clientNumber: clients.clientNumber,
          category: clients.category,
          displayName: clients.displayName,
          primaryId: clients.primaryId,
          contactPhone: clients.contactPhone,
          extra: clients.extraAttributes,
          createdAt: clients.createdAt,
        })
        .from(clients);
      // In legacy DBs (no created_by), avoid data leakage: agents see none until migration applied
      const rows = me.userType === "agent" ? [] : await base.orderBy(asc(clients.id));
      const clientProfileMap = await loadClientProfileMap();
      const mapped = rows.map((r) => ({
        ...((): {
          id: number;
          clientNumber: string;
          category: string;
          displayName: string;
          primaryId: string;
          contactPhone: string | null;
          createdAt: string;
          isActive: boolean;
          profilePolicyNumber: string | null;
        } => {
          const extraObj = toExtraObject((r as any).extra);
          const resolved = resolveDynamic(extraObj);
          const cat = String(r.category ?? "");
          const primaryId = derivePrimaryId(cat, resolved) || r.primaryId;
          return {
            id: r.id,
            clientNumber: r.clientNumber,
            category: r.category,
            displayName: deriveDisplayName(cat, resolved) || r.displayName,
            primaryId,
            contactPhone: deriveContactPhone(resolved) || r.contactPhone,
            createdAt: r.createdAt,
            isActive:
              (extraObj as unknown as { shadow_is_active?: boolean } | null)?.shadow_is_active ?? true,
            profilePolicyNumber: clientProfileMap.get(`${String(r.category ?? "").trim().toLowerCase()}::${String(primaryId ?? "").trim()}`) ?? null,
          };
        })(),
        isActive:
          (r.extra as unknown as { shadow_is_active?: boolean } | null)?.shadow_is_active ?? true,
      }));
      return NextResponse.json(mapped, {
        status: 200,
        headers: {
          "cache-control": "no-store, max-age=0",
        },
      });
    }
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

