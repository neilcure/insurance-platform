import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { memberships, organisations, clients, appSettings } from "@/db/schema/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { policyCreateSchema } from "@/lib/validation/policy";
import { normalizeDeclarations, DeclarationsDynamicSchema } from "@/lib/validation/declarations";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
// removed insured upsert/validation; insured snapshot only

type FinalPolicyPayload = {
  insured?: any;
  vehicle?: {
    plateNo: string;
    make?: string;
    model?: string;
    year?: number;
  } & Record<string, unknown>;
  policy?: {
    insurerOrgId: number;
    coverType: "third_party" | "comprehensive";
    clientId?: number;
    covernoteNo?: string;
    insurerPolicyNo?: string;
    startDate: string;
    endDate: string;
    grossPremium: number;
    currency?: string;
    [k: string]: unknown;
  };
  declarations?: any;
};

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const json = await request.json();

    // Support enhanced wizard payload OR legacy payload
    if (json?.insured || json?.vehicle || json?.policy || json?.declarations || json?.packages) {
      const extractClientExtraFromInsured = (insured: unknown): Record<string, unknown> => {
        if (!insured || typeof insured !== "object") return {};
        const obj = insured as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (typeof k !== "string") continue;
          const lower = k.toLowerCase();
          const isInsured = lower.startsWith("insured_") || lower.startsWith("insured__");
          const isContact = lower.startsWith("contactinfo_") || lower.startsWith("contactinfo__");
          if (!isInsured && !isContact) continue;
          // keep booleans/numbers/arrays/objects; ignore empty strings
          if (v === undefined || v === null) continue;
          if (typeof v === "string" && v.trim() === "") continue;
          out[k] = v;
        }
        // Also include insuredType (used by some configs)
        const insuredType = obj["insuredType"];
        if (typeof insuredType === "string") {
          const t = insuredType.trim().toLowerCase();
          if (t === "company" || t === "personal") out["insuredType"] = t;
        }
        return out;
      };

      const body = json as FinalPolicyPayload & {
        packages?: Record<
          string,
          { category?: string; values?: Record<string, unknown> } | Record<string, unknown>
        >;
        organisationId?: number;
      };

      // Allow vehicle/policy from either top-level or under packages["vehicle"/"policy"]
      const packages = body.packages ?? {};
      const pkgVehicleRaw = (packages as any)?.vehicle;
      const pkgPolicyRaw = (packages as any)?.policy;
      const pkgVehicle =
        (pkgVehicleRaw && ("values" in (pkgVehicleRaw as any) ? (pkgVehicleRaw as any).values : pkgVehicleRaw)) || null;
      const pkgPolicy =
        (pkgPolicyRaw && ("values" in (pkgPolicyRaw as any) ? (pkgPolicyRaw as any).values : pkgPolicyRaw)) || null;

      const policy = (body.policy ?? pkgPolicy ?? null) as FinalPolicyPayload["policy"] | null;
      const vehicle = (body.vehicle ?? pkgVehicle ?? null) as FinalPolicyPayload["vehicle"] | null;

      let organisationIdCandidate =
        (policy as any)?.insurerOrgId ?? body.organisationId ?? (packages as any)?.organisationId;
      let organisationId = Number(organisationIdCandidate);
      if (!Number.isFinite(organisationId) || organisationId <= 0) {
        // Fallback to the first organisation the user belongs to (if any)
        const firstMembership = await db
          .select({ organisationId: memberships.organisationId })
          .from(memberships)
          .where(eq(memberships.userId, Number(user.id)))
          .limit(1);
        organisationId = Number(firstMembership?.[0]?.organisationId);
        // If still missing (e.g., admin without memberships), pick the first organisation in the system
        if (!Number.isFinite(organisationId) || organisationId <= 0) {
          const firstOrgRow = await db.select({ id: organisations.id }).from(organisations).limit(1);
          organisationId = Number(firstOrgRow?.[0]?.id);
        }
      if (!Number.isFinite(organisationId) || organisationId <= 0) {
        return NextResponse.json({ error: "Invalid or missing insurer organisation" }, { status: 400 });
        }
      }

      // For non-admin/internal_staff, ensure the user has membership in the target organisation
      if (!(user.userType === "admin" || user.userType === "internal_staff")) {
        const hasMembership = await db
          .select({ exists: memberships.organisationId })
          .from(memberships)
          .where(and(eq(memberships.userId, Number(user.id)), eq(memberships.organisationId, organisationId)))
          .limit(1);
        if (hasMembership.length === 0) {
          return NextResponse.json({ error: "Forbidden: no access to organisation" }, { status: 403 });
        }
      }

      const generatedPolicyNumber =
        (policy as any)?.insurerPolicyNo ||
        (policy as any)?.covernoteNo ||
        `POL-${Date.now()}`;

      // Normalize declarations shape (support legacy and new)
      let normalizedDeclarations: { answers: Record<string, boolean>; notes?: string } | null = null;
      if (typeof body.declarations !== "undefined") {
        normalizedDeclarations = normalizeDeclarations(body.declarations);
        if (!normalizedDeclarations) {
          return NextResponse.json({ error: "Invalid declarations" }, { status: 400 });
        }
      }

      // Try to construct an insured candidate from either body.insured or packages snapshot
      function buildInsuredCandidate(): any | null {
        if (typeof (body as any).insured === "object" && (body as any).insured) return (body as any).insured;
        // Scan packages for likely insured fields
        const scanKeys = (obj: Record<string, unknown>): any | null => {
          const keys = Object.keys(obj).map((k) => k.toLowerCase());
          const hasCompany = keys.includes("companyname") || keys.includes("brnumber");
          const hasPersonal = keys.includes("fullname") || keys.includes("idnumber");
          if (!(hasCompany || hasPersonal)) return null;
          if (hasCompany) {
            const ci =
              (obj as any).ciNumber ??
              (obj as any).cinumber ??
              (obj as any)["CI Number"] ??
              (obj as any).ci ??
              undefined;
            return {
              insuredType: "company",
              companyName:
                (obj as any).companyName ??
                (obj as any).CompanyName ??
                (obj as any)["Company Name"] ??
                (obj as any).organisationName ??
                (obj as any).orgName ??
                (obj as any).name,
              brNumber:
                (obj as any).brNumber ??
                (obj as any).businessRegNo ??
                (obj as any).brNo ??
                (obj as any).br ??
                (obj as any).registrationNumber ??
                ci,
              contactName: (obj as any).contactName ?? (obj as any).contactPerson,
              contactPhone: (obj as any).contactPhone ?? (obj as any).phone ?? (obj as any).mobile,
            };
          }
          const first =
            (obj as any).firstName ?? (obj as any)["First Name"] ?? (obj as any).firstname ?? "";
          const last =
            (obj as any).lastName ?? (obj as any)["Last Name"] ?? (obj as any).lastname ?? "";
          const combined =
            [last, first]
              .map((x) => (typeof x === "string" ? x.trim() : ""))
              .filter(Boolean)
              .join(" ") || (obj as any).fullName || (obj as any).name;
          return {
            insuredType: "personal",
            fullName: combined,
            idNumber: (obj as any).idNumber ?? (obj as any).id ?? (obj as any).hkid,
            dob: (obj as any).dob ?? (obj as any).birthDate,
          };
        };
        for (const entry of Object.values(packages as Record<string, any>)) {
          const valuesObj =
            entry && typeof entry === "object"
              ? ("values" in entry ? (entry as any).values : (entry as any))
              : null;
          if (valuesObj && typeof valuesObj === "object") {
            const cand = scanKeys(valuesObj as Record<string, unknown>);
            if (cand) return cand;
          }
        }
        return null;
      }
      const insuredCandidate = buildInsuredCandidate();

      // Check legacy DB shape to avoid errors inside an open transaction
      let hasCreatedBy = false;
      let hasClientIdColumn = false;
      let hasAgentIdColumn = false;
      try {
        const chk = await db.execute(
          sql`select 1 as ok from information_schema.columns where table_name = 'policies' and column_name = 'created_by' limit 1`
        );
        const row =
          (Array.isArray(chk) ? (chk as any[])[0] : (chk as any)?.rows?.[0]) as { ok?: unknown } | undefined;
        hasCreatedBy = Boolean(row?.ok ?? row);
      } catch {
        hasCreatedBy = false;
      }
      try {
        const chk2 = await db.execute(
          sql`select 1 as ok from information_schema.columns where table_name = 'policies' and column_name = 'client_id' limit 1`
        );
        const row2 =
          (Array.isArray(chk2) ? (chk2 as any[])[0] : (chk2 as any)?.rows?.[0]) as { ok?: unknown } | undefined;
        hasClientIdColumn = Boolean(row2?.ok ?? row2);
      } catch {
        hasClientIdColumn = false;
      }
      try {
        const chk3 = await db.execute(
          sql`select 1 as ok from information_schema.columns where table_name = 'policies' and column_name = 'agent_id' limit 1`
        );
        const row3 =
          (Array.isArray(chk3) ? (chk3 as any[])[0] : (chk3 as any)?.rows?.[0]) as { ok?: unknown } | undefined;
        hasAgentIdColumn = Boolean(row3?.ok ?? row3);
      } catch {
        hasAgentIdColumn = false;
      }

      // Per-policy model: no client-level assignment check on create.

      const result = await db.transaction(async (tx) => {
        // We no longer create/upsert Client here; snapshot only to car.extraAttributes
        const ensuredClientId: number | undefined =
          typeof (policy as any)?.clientId === "number" && Number.isFinite((policy as any).clientId)
            ? Number((policy as any).clientId)
            : undefined;
        // Determine target agentId:
        // - Agents: always current user
        // - Admin/Internal: use provided policy.agentId when present and valid
        const requestedAgentId =
          user.userType === "agent"
            ? Number(user.id)
            : ((): number | undefined => {
                const direct = Number((policy as any)?.agentId);
                if (Number.isFinite(direct) && direct > 0) return direct;
                // also accept agentId from packagesSnapshot.policy.values.agentId for admin/internal
                try {
                  const raw = (packages as any)?.policy?.values?.agentId ?? (packages as any)?.policy?.agentId;
                  const n = Number(raw as any);
                  if (Number.isFinite(n) && n > 0) return n;
                } catch {}
                return undefined;
              })();

        // Insert policy according to available columns (avoid raising inside tx)
        let createdPolicy: { id: number; policyNumber: string; organisationId: number; createdAt: string };
        if (hasCreatedBy) {
          [createdPolicy] = await tx
            .insert(policies)
            .values({
              policyNumber: generatedPolicyNumber,
              organisationId,
              createdBy: Number(user.id),
              ...(hasClientIdColumn && ensuredClientId ? { clientId: ensuredClientId } : {}),
              ...(hasAgentIdColumn && Number.isFinite(Number(requestedAgentId)) ? { agentId: Number(requestedAgentId) } : {}),
            })
            .returning({
              id: policies.id,
              policyNumber: policies.policyNumber,
              organisationId: policies.organisationId,
              createdAt: policies.createdAt,
            });
        } else {
          // Use raw SQL to guarantee no reference to non-existent created_by column
          const inserted =
            hasClientIdColumn && ensuredClientId
              ? hasAgentIdColumn && Number.isFinite(Number(requestedAgentId))
                ? await tx.execute(
                    sql`insert into "policies" ("policy_number","organisation_id","client_id","agent_id") values (${generatedPolicyNumber}, ${organisationId}, ${ensuredClientId}, ${Number(
                      requestedAgentId
                    )}) returning "id","policy_number","organisation_id","created_at"`
                  )
                : await tx.execute(
                    sql`insert into "policies" ("policy_number","organisation_id","client_id") values (${generatedPolicyNumber}, ${organisationId}, ${ensuredClientId}) returning "id","policy_number","organisation_id","created_at"`
                  )
              : hasAgentIdColumn && Number.isFinite(Number(requestedAgentId))
              ? await tx.execute(
                  sql`insert into "policies" ("policy_number","organisation_id","agent_id") values (${generatedPolicyNumber}, ${organisationId}, ${Number(
                    requestedAgentId
                  )}) returning "id","policy_number","organisation_id","created_at"`
                )
              : await tx.execute(
                  sql`insert into "policies" ("policy_number","organisation_id") values (${generatedPolicyNumber}, ${organisationId}) returning "id","policy_number","organisation_id","created_at"`
                );
          const row = (Array.isArray(inserted) ? inserted[0] : (inserted as any)?.rows?.[0]) as {
            id: number;
            policy_number: string;
            organisation_id: number;
            created_at: string;
          };
          createdPolicy = {
            id: Number(row.id),
            policyNumber: String((row as any).policy_number),
            organisationId: Number((row as any).organisation_id),
            createdAt: String((row as any).created_at),
          };
        }

        // IMPORTANT:
        // Policy creation must NOT mutate the Client record.
        // The wizard has an explicit "update client?" step that PATCHes `/api/clients/:id` with
        // proper deletion semantics (deletedKeys + null tombstones + variant pruning).
        // Mutating the client here can accidentally re-introduce stale values into `clients.extra_attributes`
        // during policy creation (e.g. when the wizard carries old values in its insured snapshot).

        // Always create a car row to store a snapshot of dynamic packages,
        // even if there is no explicit "vehicle" package.
        // Derive registration/plate from dynamic packages (common aliases)
        const plate = (() => {
          const direct =
            (vehicle as any)?.plateNo ??
            (vehicle as any)?.plate ??
            (vehicle as any)?.registrationNumber ??
            (vehicle as any)?.registrationNo ??
            (vehicle as any)?.regNumber ??
            (vehicle as any)?.regNo ??
            (vehicle as any)?.vrn ??
            (packages as any)?.vehicle?.values?.plateNo ??
            (packages as any)?.vehicle?.values?.plate ??
            (packages as any)?.vehicle?.values?.registrationNumber ??
            (packages as any)?.vehicle?.values?.registrationNo ??
            (packages as any)?.vehicle?.values?.regNumber ??
            (packages as any)?.vehicle?.values?.regNo ??
            (packages as any)?.vehicle?.values?.vrn;
          const firstDirect = typeof direct === "string" ? direct.trim() : "";
          if (firstDirect) return firstDirect;
          // Fuzzy scan: look for keys containing registration/plate/vrn
          const scan = (obj: unknown): string | "" => {
            if (!obj || typeof obj !== "object") return "";
            for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
              const nk = String(k).toLowerCase().replace(/\s+/g, "");
              if (
                /(^|_)(plate|plateno|plate_number)($|_)/.test(nk) ||
                /(reg|registration).*(number|no)/.test(nk) ||
                /(^|_)vrn($|_)/.test(nk)
              ) {
                const sv = typeof v === "string" ? v.trim() : (v as any)?.toString?.()?.trim?.() ?? "";
                if (sv) return sv;
              }
            }
            return "";
          };
          // check vehicle, packages.vehicle.values, then whole packages snapshot shallowly
          const fromVehicle = scan(vehicle);
          if (fromVehicle) return fromVehicle;
          const fromVehiclePkg = scan((packages as any)?.vehicle?.values ?? (packages as any)?.vehicle);
          if (fromVehiclePkg) return fromVehiclePkg;
          for (const entry of Object.values(((packages as any) ?? {}) as Record<string, unknown>)) {
            const obj =
              entry && typeof entry === "object" ? (("values" in (entry as any) ? (entry as any).values : entry) as unknown) : null;
            const sv = scan(obj);
            if (sv) return sv;
          }
          return "UNKNOWN";
        })();
        const snapshot = {
          ...(vehicle || {}),
          declarations: normalizedDeclarations ?? (body as any).declarations,
          insuredSnapshot: (body as any).insured,
          clientId: ensuredClientId,
          // include all packages snapshot for traceability
          packagesSnapshot: packages,
          excessSection1: (policy as any)?.coverType === "comprehensive" ? (policy as any).excessSection1 : undefined,
        } as Record<string, unknown>;

        // Normalize vehicle primitives for DB column types
        // Helper scanners for dynamic package keys
        const scanStringByKeyList = (obj: unknown, keys: string[]): string | "" => {
          if (!obj || typeof obj !== "object") return "";
          for (const k of keys) {
            const v = (obj as Record<string, unknown>)[k];
            const s = typeof v === "string" ? v.trim() : (v as any)?.toString?.()?.trim?.() ?? "";
            if (s) return s;
          }
          return "";
        };
        const scanStringByTokens = (obj: unknown, tokenGroups: RegExp[]): string | "" => {
          if (!obj || typeof obj !== "object") return "";
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            const nk = String(k).toLowerCase().replace(/\s+/g, "");
            if (tokenGroups.some((re) => re.test(nk))) {
              const s = typeof v === "string" ? v.trim() : (v as any)?.toString?.()?.trim?.() ?? "";
              if (s) return s;
            }
          }
          return "";
        };
        const scanFromPackages = (keys: string[], tokenGroups: RegExp[]): string | "" => {
          // vehicle object first
          const fromVehicle = scanStringByKeyList(vehicle, keys) || scanStringByTokens(vehicle, tokenGroups);
          if (fromVehicle) return fromVehicle;
          // vehicle package values
          const vehPkg = (packages as any)?.vehicle;
          const vehValues = (vehPkg && typeof vehPkg === "object" && "values" in (vehPkg as any)) ? (vehPkg as any).values : vehPkg;
          const fromVehPkg = scanStringByKeyList(vehValues, keys) || scanStringByTokens(vehValues, tokenGroups);
          if (fromVehPkg) return fromVehPkg;
          // generic scan across all package entries shallowly
          for (const entry of Object.values(((packages as any) ?? {}) as Record<string, unknown>)) {
            const obj =
              entry && typeof entry === "object" ? (("values" in (entry as any) ? (entry as any).values : entry) as unknown) : null;
            const s = scanStringByKeyList(obj, keys) || scanStringByTokens(obj, tokenGroups);
            if (s) return s;
          }
          return "";
        };
        const scanYear = (): number | null => {
          const yearStr =
            scanFromPackages(
              [
                "year",
                "makeOfYear",
                "make_year",
                "yearOfMake",
                "yearofmake",
                "manufactureYear",
                "manufacturedYear",
                "yearOfManufacture",
                "yearofmanufacture",
              ],
              [/year.*(make|manu|manufacture)/, /(^|_)(yom|year)($|_)/],
            ) || "";
          const n = Number.parseInt(String(yearStr ?? "").replace(/[^\d]/g, ""), 10);
          return Number.isFinite(n) ? n : null;
        };
        const makeStr = (() => {
          const s =
            scanFromPackages(
              ["make", "vehicleMake", "makeName"],
              [/^make$/, /(^|_)vehiclemake($|_)/, /make(name)?/],
            ) || "";
          return s ? s : null;
        })();
        const modelStr = (() => {
          const s =
            scanFromPackages(
              ["model", "modelName", "model_name", "modelNameInVRD", "modelnameinvrd"],
              [/model(name)?/, /vrd.*model/],
            ) || "";
          return s ? s : null;
        })();
        const yearNum = scanYear();
        try {
          await tx
            .insert(cars)
            .values({
              policyId: createdPolicy.id,
              plateNumber: plate,
              make: makeStr,
              model: modelStr,
              year: yearNum,
              extraAttributes: snapshot,
            })
            .returning();
        } catch (_err) {
          // Fallbacks for legacy DBs without some columns (e.g., extra_attributes or year/model/make)
          try {
            await tx
              .insert(cars)
              .values({
                policyId: createdPolicy.id,
                plateNumber: plate,
              })
              .returning();
          } catch {
            // Final fallback via raw SQL with minimal required columns
            await tx.execute(
              sql`insert into "cars" ("policy_id","plate_number") values (${createdPolicy.id}, ${plate})`
            );
          }
        }

        return { policy: createdPolicy };
      });

      return NextResponse.json({ success: true, policyId: result.policy.id }, { status: 201 });
    } else {
      // Legacy body
      if (!canCreatePolicy(user)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const parsed = policyCreateSchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
      }
      const { policyNumber, organisationId, car } = parsed.data;

      if (!(user.userType === "admin" || user.userType === "internal_staff")) {
        const hasMembership = await db
          .select({ exists: memberships.organisationId })
          .from(memberships)
          .where(and(eq(memberships.userId, Number(user.id)), eq(memberships.organisationId, organisationId)))
          .limit(1);
        if (hasMembership.length === 0) {
          return NextResponse.json({ error: "Forbidden: no access to organisation" }, { status: 403 });
        }
      }

      const result = await db.transaction(async (tx) => {
        const [createdPolicy] = await tx
          .insert(policies)
          .values({ policyNumber, organisationId })
          .returning();

        const [createdCar] = await tx
          .insert(cars)
          .values({
            policyId: createdPolicy.id,
            plateNumber: car.plateNumber,
            make: car.make,
            model: car.model,
            year: car.year,
          })
          .returning();

        return { policy: createdPolicy, car: createdCar };
      });

      return NextResponse.json(result, { status: 201 });
    }
  } catch (err) {
    console.error(err);
    const message =
      (err as any)?.message ||
      (typeof err === "string" ? err : undefined) ||
      "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const clientIdParam = url.searchParams.get("clientId");
    const policyNumberParam = url.searchParams.get("policyNumber");
    const clientNumberParam = url.searchParams.get("clientNumber");
    // Optional flags can be read from querystring, but we always return car extra for simplicity
    const clientIdFilter = Number(clientIdParam);
    const hasClientFilter = Number.isFinite(clientIdFilter) && clientIdFilter > 0;
    const hasPolicyNumberFilter = typeof policyNumberParam === "string" && policyNumberParam.trim().length > 0;
    const hasClientNumberFilter = typeof clientNumberParam === "string" && clientNumberParam.trim().length > 0;
    // Scope: admin/internal_staff see all; others limited to their memberships
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
        carExtra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id));

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
      carExtra: Record<string, unknown> | null;
    };
    let rows: Row[];
    // Prefer fast path on policies.client_id when present; otherwise JSON snapshot fallbacks
    const clientFilterExpr = hasClientFilter
      ? sql`(
          (CASE WHEN EXISTS (select 1 from information_schema.columns where table_name = 'policies' and column_name = 'client_id')
            THEN (${policies.clientId} = ${clientIdFilter}) ELSE false END)
          OR
          (((${cars.extraAttributes})::jsonb ->> 'clientId')::int = ${clientIdFilter})
          OR ((((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy') ->> 'clientId')::int = ${clientIdFilter})
          OR ((((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy' -> 'values') ->> 'clientId')::int = ${clientIdFilter})
          OR (((${cars.extraAttributes})::jsonb ->> 'client_id')::int = ${clientIdFilter})
          OR (((${cars.extraAttributes})::jsonb ->> 'clientid')::int = ${clientIdFilter})
          OR ((${cars.extraAttributes})::text ILIKE ${'%\"client%\":' + String(clientIdFilter) + '%'})
          OR ((${cars.extraAttributes})::text ILIKE ${'%\"client%\":\"' + String(clientIdFilter) + '\"%'})
        )`
      : undefined;
    // JSONB filter that supports common key paths for clientNumber
    const clientNumberFilterExpr = hasClientNumberFilter
      ? sql`(
          (((${cars.extraAttributes})::jsonb ->> 'clientNumber') = ${clientNumberParam})
          OR ((((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy') ->> 'clientNumber') = ${clientNumberParam})
          OR ((((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy' -> 'values') ->> 'clientNumber') = ${clientNumberParam})
          OR ((${cars.extraAttributes})::text ILIKE ${'%\"clientNumber\":\"' + String(clientNumberParam) + '\"%'})
        )`
      : undefined;
    try {
      if (user.userType === "admin" || user.userType === "internal_staff") {
        let q: any = baseSelect;
        if (hasPolicyNumberFilter) q = q.where(eq(policies.policyNumber, policyNumberParam!));
        if (hasClientFilter) q = q.where(clientFilterExpr!);
        if (hasClientNumberFilter) q = q.where(clientNumberFilterExpr!);
        q = q.orderBy(desc(policies.createdAt), desc(policies.id));
        rows = await q;
      } else if (user.userType === "agent") {
        // Agent: see policies they authored (agent_id = current user); optional clientId filter narrows the list
        const agentId = Number(user.id);
        const result = await db.execute(sql`
          with has_agent as (
            select exists (select 1 from information_schema.columns where table_name='policies' and column_name='agent_id') as present
          ), has_client as (
            select exists (select 1 from information_schema.columns where table_name='policies' and column_name='client_id') as present
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
            c.extra_attributes as "carExtra"
          from "policies" p
          left join "cars" c on c.policy_id = p.id
          where (select present from has_agent)
            and p.agent_id = ${agentId}
            ${hasPolicyNumberFilter ? sql`and p.policy_number = ${policyNumberParam!}` : sql``}
            ${
              hasClientFilter
                ? sql`and (select present from has_client) and p.client_id = ${Number(url.searchParams.get("clientId"))}`
                : sql``
            }
            ${hasClientNumberFilter ? sql`and ((c.extra_attributes)::jsonb ->> 'clientNumber') = ${clientNumberParam!}` : sql``}
          order by p.created_at desc, p.id desc
        `);
        rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as any[];
      } else {
        let scoped: any = baseSelect.innerJoin(
          memberships,
          and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id)))
        );
        if (hasPolicyNumberFilter) scoped = scoped.where(eq(policies.policyNumber, policyNumberParam!));
        if (hasClientFilter) scoped = scoped.where(clientFilterExpr!);
        if (hasClientNumberFilter) scoped = scoped.where(clientNumberFilterExpr!);
        scoped = scoped.orderBy(desc(policies.createdAt), desc(policies.id));
        rows = await scoped;
      }
    } catch {
      // Fallback for legacy DBs without created_by:
      // - Admin/Internal Staff: see all
      // - Agent: return none to avoid data leakage until migrations are applied
      // - Others: membership-based scope
      if (user.userType === "admin" || user.userType === "internal_staff") {
        let q: any = baseSelect;
        if (hasPolicyNumberFilter) q = q.where(eq(policies.policyNumber, policyNumberParam!));
        if (hasClientFilter) q = q.where(clientFilterExpr!);
        if (hasClientNumberFilter) q = q.where(clientNumberFilterExpr!);
        q = q.orderBy(desc(policies.createdAt), desc(policies.id));
        rows = await q;
      } else if (user.userType === "agent") {
        rows = [];
      } else {
        let scoped: any = baseSelect.innerJoin(
          memberships,
          and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id)))
        );
        if (hasPolicyNumberFilter) scoped = scoped.where(eq(policies.policyNumber, policyNumberParam!));
        if (hasClientFilter) scoped = scoped.where(clientFilterExpr!);
        if (hasClientNumberFilter) scoped = scoped.where(clientNumberFilterExpr!);
        scoped = scoped.orderBy(desc(policies.createdAt), desc(policies.id));
        rows = await scoped;
      }
    }

    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}


