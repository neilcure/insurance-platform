import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { memberships, clients, appSettings } from "@/db/schema/core";
import { policyPremiums } from "@/db/schema/premiums";
import { formOptions } from "@/db/schema/form_options";
import { and, desc, eq, sql } from "drizzle-orm";
import { policyCreateSchema } from "@/lib/validation/policy";
import { requireUser } from "@/lib/auth/require-user";
import { canCreatePolicy } from "@/lib/auth/rbac";
import { resolveActiveOrgId, ActiveOrgError } from "@/lib/auth/active-org";
import { generatePolicyNumber, isPolicyNumberUniqueViolation } from "@/lib/policy-number";
import { getPolicyColumns } from "@/lib/db/column-check";
import { loadAccountingFields, buildFieldColumnMap, getColumnType } from "@/lib/accounting-fields";

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
    coverType: string;
    clientId?: number;
    covernoteNo?: string;
    insurerPolicyNo?: string;
    startDate: string;
    endDate: string;
    grossPremium: number;
    currency?: string;
    [k: string]: unknown;
  };
};

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const json = await request.json();

    // Support enhanced wizard payload OR legacy payload
    if (json?.insured || json?.vehicle || json?.policy || json?.packages) {
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

      // Resolve the target organisation. Order of preference:
      //   1. policy.insurerOrgId / body.organisationId / packages.organisationId
      //   2. user.activeOrganisationId (from JWT, set at sign-in)
      //   3. (warn-only fallback) first membership / first org in DB
      // resolveActiveOrgId also enforces membership for non-admins,
      // replacing the inline membership check below.
      const organisationIdCandidate =
        (policy as any)?.insurerOrgId ?? body.organisationId ?? (packages as any)?.organisationId;
      let organisationId: number;
      try {
        organisationId = await resolveActiveOrgId(user, organisationIdCandidate, {
          context: "POST /api/policies",
        });
      } catch (err) {
        if (err instanceof ActiveOrgError) {
          return NextResponse.json({ error: err.message }, { status: err.status });
        }
        throw err;
      }

      // Start getPolicyColumns() early so it runs concurrently with prefix resolution
      const polColsPromise = getPolicyColumns();

      // Resolve flow-specific prefix from settings
      const flowKey = typeof (json as any).flowKey === "string" ? (json as any).flowKey.trim() : "";
      let recordPrefix = "POL";
      if (flowKey) {
        try {
          const orgSuffix = organisationId ? `:${organisationId}` : "";
          const [fpRow] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, `flow_prefixes${orgSuffix}`)).limit(1);
          const flowPrefixes = (fpRow?.value as Record<string, string> | undefined) ?? {};
          if (flowPrefixes[flowKey]) recordPrefix = flowPrefixes[flowKey];
        } catch { /* use default */ }
      }

      // Override prefix with company/personal prefix ONLY for client-specific flows
      // (e.g., clientSet). Other flows like policyset should use their own flow prefix.
      const isClientFlow = flowKey.toLowerCase().includes("client");
      if (isClientFlow) {
        const insuredObj = (body as any).insured;
        const rawInsuredType =
          insuredObj?.insuredType ??
          insuredObj?.insured__category ??
          insuredObj?.insured_category ??
          insuredObj?.category;
        const resolvedInsuredType =
          typeof rawInsuredType === "string"
            ? rawInsuredType.trim().toLowerCase()
            : "";
        if (resolvedInsuredType === "company" || resolvedInsuredType === "personal") {
          try {
            const orgSuffix = organisationId ? `:${organisationId}` : "";
            const [cpRow] = await db
              .select({ value: appSettings.value })
              .from(appSettings)
              .where(eq(appSettings.key, `client_number_prefixes${orgSuffix}`))
              .limit(1);
            const prefixes = (cpRow?.value as { companyPrefix?: string; personalPrefix?: string } | undefined) ?? {};
            const chosen =
              resolvedInsuredType === "company"
                ? prefixes.companyPrefix
                : prefixes.personalPrefix;
            if (chosen && chosen.trim()) recordPrefix = chosen.trim();
          } catch { /* fall back to flow prefix */ }
        }
      }

      // Resolution chain (ORDER MATTERS — see .cursor/skills/policy-numbering/SKILL.md):
      //   1. Insurer-supplied policy number (authoritative when known)
      //   2. Covernote number (interim insurer reference)
      //   3. Auto-generated via lib/policy-number.ts — collision-safe
      //      with retry; replaces the legacy `${prefix}-${Date.now()}`
      //      pattern that was racy under bulk imports.
      const generatedPolicyNumber =
        (policy as any)?.insurerPolicyNo ||
        (policy as any)?.covernoteNo ||
        (await generatePolicyNumber(recordPrefix));


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

      const { hasCreatedBy, hasClientId: hasClientIdColumn, hasAgentId: hasAgentIdColumn, hasFlowKey: hasFlowKeyColumn } = await polColsPromise;

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
                try {
                  const raw = (packages as any)?.policy?.values?.agentId ?? (packages as any)?.policy?.agentId;
                  const n = Number(raw as any);
                  if (Number.isFinite(n) && n > 0) return n;
                } catch {}
                return undefined;
              })();

        let createdPolicy: { id: number; policyNumber: string; organisationId: number; createdAt: string };
        if (hasCreatedBy) {
          [createdPolicy] = await tx
            .insert(policies)
            .values({
              policyNumber: generatedPolicyNumber,
              organisationId,
              createdBy: Number(user.id),
              ...(hasFlowKeyColumn && flowKey ? { flowKey } : {}),
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
          // Raw SQL fallback for legacy DBs without created_by.
          // Build INSERT dynamically based on which columns exist.
          const colFrags = [sql`"policy_number"`, sql`"organisation_id"`];
          const valFrags = [sql`${generatedPolicyNumber}`, sql`${organisationId}`];
          if (hasFlowKeyColumn && flowKey) { colFrags.push(sql`"flow_key"`); valFrags.push(sql`${flowKey}`); }
          if (hasClientIdColumn && ensuredClientId) { colFrags.push(sql`"client_id"`); valFrags.push(sql`${ensuredClientId}`); }
          if (hasAgentIdColumn && Number.isFinite(Number(requestedAgentId))) { colFrags.push(sql`"agent_id"`); valFrags.push(sql`${Number(requestedAgentId)}`); }

          const colsList = sql.join(colFrags, sql`, `);
          const valsList = sql.join(valFrags, sql`, `);
          const inserted = await tx.execute(
            sql`INSERT INTO "policies" (${colsList}) VALUES (${valsList}) RETURNING "id","policy_number","organisation_id","created_at"`
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
        const extractLinkedPolicyIds = (raw: unknown): number[] => {
          const ids = new Set<number>();
          const scan = (obj: unknown) => {
            if (!obj || typeof obj !== "object") return;
            for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
              if (k.endsWith("___linkedPolicyId")) {
                const n = Number(v);
                if (Number.isFinite(n) && n > 0) ids.add(n);
              }
              if (v && typeof v === "object" && !Array.isArray(v)) scan(v);
            }
          };
          scan(raw);
          return [...ids];
        };
        const entityLinkedPolicyIds = extractLinkedPolicyIds(packages);

        const cleanPackages = (raw: unknown): unknown => {
          if (!raw || typeof raw !== "object") return raw;
          const out: Record<string, unknown> = {};
          for (const [pk, pv] of Object.entries(raw as Record<string, unknown>)) {
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

        const linkedPolicyId = (json as any).linkedPolicyId;
        const endorsementChanges = Array.isArray((json as any).endorsementChanges) ? (json as any).endorsementChanges : undefined;

        let linkedPolicyNumber: string | undefined;
        if (linkedPolicyId) {
          try {
            const [lp] = await db.select({ policyNumber: policies.policyNumber }).from(policies).where(eq(policies.id, Number(linkedPolicyId))).limit(1);
            if (lp) linkedPolicyNumber = lp.policyNumber;
          } catch { /* best-effort */ }
        }

        const initialStatus = "quotation_prepared";
        const userEmail = (user as unknown as { email?: string }).email || `user:${user.id}`;
        const snapshot = {
          ...(vehicle || {}),
          insuredSnapshot: (body as any).insured,
          clientId: ensuredClientId,
          packagesSnapshot: cleanPackages(packages),
          coverType: (policy as any)?.coverType ?? undefined,
          excessSection1: (policy as any)?.coverType === "comprehensive" ? (policy as any).excessSection1 : undefined,
          ...(flowKey ? { flowKey } : {}),
          ...(linkedPolicyId ? { linkedPolicyId: Number(linkedPolicyId) } : {}),
          ...(linkedPolicyNumber ? { linkedPolicyNumber } : {}),
          ...(endorsementChanges ? { _endorsementChanges: endorsementChanges } : {}),
          ...(entityLinkedPolicyIds.length > 0 ? { entityLinkedPolicyIds } : {}),
          status: initialStatus,
          statusHistory: [{
            status: initialStatus,
            changedAt: new Date().toISOString(),
            changedBy: userEmail,
            note: "Auto: policy created",
          }],
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

      // Extract accounting fields and persist to policy_premiums, respecting line config
      try {
        const acctFields = await loadAccountingFields();
        const fieldColumnMap = buildFieldColumnMap(acctFields);

        const acctPkg = (packages as any)?.premiumRecord ?? (packages as any)?.accounting;
        const acctValues =
          acctPkg && typeof acctPkg === "object"
            ? ("values" in acctPkg ? (acctPkg as any).values : acctPkg)
            : null;
        const policyPkg = (packages as any)?.policy;
        const policyValues =
          policyPkg && typeof policyPkg === "object"
            ? ("values" in policyPkg ? (policyPkg as any).values : policyPkg)
            : null;

        const source = { ...(policy ?? {}), ...(policyValues ?? {}), ...(acctValues ?? {}) } as Record<string, unknown>;

        const normalized: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(source)) {
          const bare = k.includes("__") ? k.split("__").pop()! : k;
          if (!(bare in normalized) || normalized[bare] === null || normalized[bare] === undefined || normalized[bare] === "") {
            normalized[bare] = v;
          }
        }

        const toCents = (key: string): number | null => {
          const v = normalized[key];
          if (v === null || v === undefined || v === "") return null;
          const n = Number(v);
          return Number.isFinite(n) ? Math.round(n * 100) : null;
        };

        const buildPremiumPayload = () => {
          const structuredColumns: Record<string, unknown> = {};
          const knownKeys = new Set<string>();
          for (const f of acctFields) {
            const col = fieldColumnMap[f.key];
            if (col) {
              knownKeys.add(f.key);
              const colType = getColumnType(col);
              if (colType === "cents") {
                structuredColumns[col] = toCents(f.key);
              } else if (colType === "rate") {
                const raw = Number(normalized[f.key]);
                structuredColumns[col] = Number.isFinite(raw) ? raw.toFixed(2) : null;
              } else if (colType === "string") {
                const sv = normalized[f.key];
                structuredColumns[col] = typeof sv === "string" && sv.trim() ? sv.trim() : null;
              }
            }
          }
          const currency =
            typeof structuredColumns.currency === "string" && structuredColumns.currency
              ? structuredColumns.currency.toUpperCase()
              : "HKD";
          const extraValues: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(normalized)) {
            if (!knownKeys.has(k) && !fieldColumnMap[k] && v !== null && v !== undefined && v !== "") {
              extraValues[k] = v;
            }
          }
          return { structuredCents: structuredColumns, commRate: structuredColumns.commissionRate as string | null ?? null, currency, extraValues };
        };

        // Load line templates from policy_category form options
        type LineTemplate = { key: string; label: string };
        let lineTemplates: LineTemplate[] = [{ key: "main", label: "Premium" }];
        try {
          // Scan ALL packages (not just policy/premiumRecord) for coverType
          // and OD indicator — matches resolveTemplates detection logic.
          let coverTypeVal = String(normalized.coverType ?? "").trim();
          let hasOwnVehicleDamage = false;

          const scanForCoverTypeAndOd = (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) {
              const bare = k.includes("__") ? k.split("__").pop()! : k;
              if (bare === "coverType" && typeof v === "string" && v.trim() && !coverTypeVal) {
                coverTypeVal = v.trim();
              }
              const lower = k.toLowerCase();
              const lowerBare = bare.toLowerCase();
              if (
                (lowerBare.includes("ownvehicle") || lowerBare.includes("own_vehicle") || lowerBare === "withownvehicledamage") &&
                (v === true || v === "true" || v === "Yes" || v === "yes")
              ) {
                hasOwnVehicleDamage = true;
              }
              if (lower.includes("covertype__opt_tpo__c") && (v === true || v === "true")) {
                hasOwnVehicleDamage = true;
              }
              if (lowerBare.endsWith("pd") && typeof v === "string" && v.trim()) {
                hasOwnVehicleDamage = true;
              }
            }
          };

          // Scan normalized (policy + premiumRecord merged) first
          scanForCoverTypeAndOd(normalized);

          // Then scan ALL packages to catch fields in policyinfo, vehicleinfo, etc.
          for (const [, pkgData] of Object.entries((packages as Record<string, unknown>) ?? {})) {
            if (!pkgData || typeof pkgData !== "object") continue;
            const vals = ("values" in (pkgData as Record<string, unknown>)
              ? (pkgData as { values?: Record<string, unknown> }).values
              : pkgData) as Record<string, unknown> | undefined;
            if (vals && typeof vals === "object") scanForCoverTypeAndOd(vals);
          }

          if (coverTypeVal) {
            const catRows = await db
              .select()
              .from(formOptions)
              .where(and(eq(formOptions.groupKey, "policy_category"), eq(formOptions.isActive, true)));

            let effectiveVal = coverTypeVal;
            if (coverTypeVal.toLowerCase() === "tpo" && hasOwnVehicleDamage) {
              const odMatch = catRows.find((r) => r.value === "tpo_with_od");
              if (odMatch) effectiveVal = "tpo_with_od";
            }

            const norm = effectiveVal.toLowerCase().replace(/[\s_-]+/g, "_");
            const match = catRows.find((r) => {
              const rNorm = String(r.value ?? "").toLowerCase().replace(/[\s_-]+/g, "_");
              return r.value === effectiveVal || rNorm === norm;
            });
            if (match) {
              const meta = (match.meta ?? {}) as Record<string, unknown>;
              const acctLines = Array.isArray(meta.accountingLines) ? (meta.accountingLines as LineTemplate[]) : null;
              if (acctLines && acctLines.length > 0) {
                lineTemplates = acctLines;
              } else {
                lineTemplates = [{ key: match.value ?? "main", label: match.label ?? "Premium" }];
              }
            }
          }
        } catch { /* config not set yet */ }

        const payload = buildPremiumPayload();
        const hasAnyValue = Object.values(payload.structuredCents).some((v) => v !== null) || payload.commRate !== null;

        if (hasAnyValue || Object.keys(payload.extraValues).length > 0) {
          // For multi-line templates (e.g. TPO+OD), partition values so
          // PD-suffixed fields go to the second line and non-PD to the first.
          const isPdField = (fKey: string, fLabel: string) => {
            const kLow = fKey.toLowerCase();
            const lLow = fLabel.toLowerCase();
            return lLow.includes("(pd)") || lLow.includes("(od)")
              || kLow.endsWith("pd") || kLow.endsWith("od")
              || kLow.includes("owndamage") || kLow.includes("ownvehicle");
          };

          const partitionForLine = (lineIdx: number) => {
            if (lineTemplates.length < 2) return payload.structuredCents;
            const partitioned: Record<string, unknown> = {};
            for (const f of acctFields) {
              const col = fieldColumnMap[f.key];
              if (!col || !(col in payload.structuredCents)) continue;
              const pd = isPdField(f.key, f.label);
              // Line 0 = TP (non-PD), line 1+ = OD (PD)
              if ((lineIdx === 0 && !pd) || (lineIdx > 0 && pd)) {
                partitioned[col] = payload.structuredCents[col];
              } else {
                partitioned[col] = null;
              }
            }
            // Pass through non-field columns (like currency)
            for (const [col, val] of Object.entries(payload.structuredCents)) {
              if (!(col in partitioned)) partitioned[col] = val;
            }
            return partitioned;
          };

          const partitionExtraForLine = (lineIdx: number) => {
            if (lineTemplates.length < 2) return payload.extraValues;
            const partitioned: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(payload.extraValues)) {
              const fieldDef = acctFields.find(f => f.key === key);
              const label = fieldDef?.label ?? key;
              const pd = isPdField(key, label);
              if ((lineIdx === 0 && !pd) || (lineIdx > 0 && pd)) {
                partitioned[key] = val;
              }
            }
            return partitioned;
          };

          const batchValues = lineTemplates.map((tmpl, idx) => {
            const lineExtra = partitionExtraForLine(idx);
            return {
              policyId: result.policy.id,
              lineKey: tmpl.key,
              lineLabel: tmpl.label,
              currency: payload.currency,
              ...partitionForLine(idx),
              commissionRate: payload.commRate,
              extraValues: Object.keys(lineExtra).length > 0 ? lineExtra : null,
              updatedBy: Number(user.id),
            };
          });
          if (batchValues.length > 0) {
            await db.insert(policyPremiums).values(batchValues).onConflictDoNothing();
          }
        } else if (lineTemplates.length > 0) {
          const stubValues = lineTemplates.map((tmpl) => ({
            policyId: result.policy.id,
            lineKey: tmpl.key,
            lineLabel: tmpl.label,
            currency: "HKD",
            updatedBy: Number(user.id),
          }));
          await db.insert(policyPremiums).values(stubValues).onConflictDoNothing();
        }
      } catch {
        // Best-effort; don't fail policy creation
      }

      return NextResponse.json({
        success: true,
        policyId: result.policy.id,
        policyNumber: result.policy.policyNumber,
        recordId: result.policy.id,
        recordNumber: result.policy.policyNumber,
        flowKey: flowKey || undefined,
      }, { status: 201 });
    } else {
      // Legacy body
      if (!canCreatePolicy(user)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const parsed = policyCreateSchema.safeParse(json);
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
      }
      const { policyNumber, organisationId: rawOrgId, car } = parsed.data;

      // Re-resolve through the central helper so the membership
      // check stays in one place. Legacy body always carries
      // `organisationId`, so this is effectively just an
      // assertion — we still pass it as the candidate so admins /
      // internal_staff bypass naturally.
      let organisationId: number;
      try {
        organisationId = await resolveActiveOrgId(user, rawOrgId, {
          context: "POST /api/policies (legacy)",
        });
      } catch (err) {
        if (err instanceof ActiveOrgError) {
          return NextResponse.json({ error: err.message }, { status: err.status });
        }
        throw err;
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
    // Translate the rare policy_number unique-violation into a 409
    // with a clear message. The auto-generator's pre-flight check
    // makes this nearly impossible to hit, but if a user supplied
    // an `insurerPolicyNo` / `covernoteNo` that's already taken,
    // they need to know — not see a generic 500.
    if (isPolicyNumberUniqueViolation(err)) {
      return NextResponse.json(
        {
          error:
            "A policy with this number already exists. Please use a different policy number, or leave it blank to auto-generate.",
        },
        { status: 409 },
      );
    }
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
    const flowParam = url.searchParams.get("flow");
    const clientIdFilter = Number(clientIdParam);
    const hasClientFilter = Number.isFinite(clientIdFilter) && clientIdFilter > 0;
    const hasPolicyNumberFilter = typeof policyNumberParam === "string" && policyNumberParam.trim().length > 0;
    const hasClientNumberFilter = typeof clientNumberParam === "string" && clientNumberParam.trim().length > 0;
    const hasFlowFilter = typeof flowParam === "string" && flowParam.trim().length > 0;
    const linkedPolicyIdParam = url.searchParams.get("linkedPolicyId");
    const linkedPolicyIdFilter = Number(linkedPolicyIdParam);
    const hasLinkedPolicyFilter = Number.isFinite(linkedPolicyIdFilter) && linkedPolicyIdFilter > 0;
    const MAX_LIMIT = 500;
    const DEFAULT_LIMIT = 200;
    const qLimit = Math.min(Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const qOffset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    // Scope: admin/internal_staff see all; others limited to their memberships
    const baseSelect = db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        organisationId: policies.organisationId,
        createdAt: policies.createdAt,
        isActive: policies.isActive,
        flowKey: policies.flowKey,
        carId: cars.id,
        plateNumber: cars.plateNumber,
        make: cars.make,
        model: cars.model,
        year: cars.year,
        carExtra: cars.extraAttributes,
        // Window-function total — the count of rows that match the WHERE
        // clause BEFORE limit/offset. Echoed on every row; we read [0].
        totalCount: sql<number>`count(*) over ()::int`,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id));

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
      carExtra: Record<string, unknown> | null;
      totalCount?: number;
    };
    let rows: Row[];
    const polCols = await getPolicyColumns();
    const clientFilterExpr = hasClientFilter
      ? sql`(
          ${polCols.hasClientId ? sql`(${policies.clientId} = ${clientIdFilter}) OR` : sql``}
          (((${cars.extraAttributes})::jsonb ->> 'clientId')::int = ${clientIdFilter})
          OR ((((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy') ->> 'clientId')::int = ${clientIdFilter})
          OR ((((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy' -> 'values') ->> 'clientId')::int = ${clientIdFilter})
          OR (((${cars.extraAttributes})::jsonb ->> 'client_id')::int = ${clientIdFilter})
          OR (((${cars.extraAttributes})::jsonb ->> 'clientid')::int = ${clientIdFilter})
          OR ((${cars.extraAttributes})::text ILIKE ${'%\"client%\":' + String(clientIdFilter) + '%'})
          OR ((${cars.extraAttributes})::text ILIKE ${'%\"client%\":\"' + String(clientIdFilter) + '\"%'})
        )`
      : undefined;
    const clientNumberFilterExpr = hasClientNumberFilter
      ? sql`(
          (((${cars.extraAttributes})::jsonb ->> 'clientNumber') = ${clientNumberParam})
          OR ((((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy') ->> 'clientNumber') = ${clientNumberParam})
          OR ((((${cars.extraAttributes})::jsonb -> 'packagesSnapshot' -> 'policy' -> 'values') ->> 'clientNumber') = ${clientNumberParam})
          OR ((((${cars.extraAttributes})::jsonb -> 'insuredSnapshot') ->> 'clientPolicyNumber') = ${clientNumberParam})
          OR ((${cars.extraAttributes})::text ILIKE ${'%\"clientNumber\":\"' + String(clientNumberParam) + '\"%'})
          OR ((${cars.extraAttributes})::text ILIKE ${'%\"clientPolicyNumber\":\"' + String(clientNumberParam) + '\"%'})
        )`
      : undefined;
    const flowFilterExpr = hasFlowFilter
      ? polCols.hasFlowKey
        ? sql`${policies.flowKey} = ${flowParam}`
        : sql`((${cars.extraAttributes})::jsonb ->> 'flowKey') = ${flowParam}`
      : undefined;
    const linkedPolicyFilterExpr = hasLinkedPolicyFilter
      ? sql`(((${cars.extraAttributes})::jsonb ->> 'linkedPolicyId')::int = ${linkedPolicyIdFilter})`
      : undefined;
    try {
      if (user.userType === "admin" || user.userType === "internal_staff") {
        let q: any = baseSelect;
        if (hasPolicyNumberFilter) q = q.where(eq(policies.policyNumber, policyNumberParam!));
        if (hasClientFilter) q = q.where(clientFilterExpr!);
        if (hasClientNumberFilter) q = q.where(clientNumberFilterExpr!);
        if (hasFlowFilter) q = q.where(flowFilterExpr!);
        if (hasLinkedPolicyFilter) q = q.where(linkedPolicyFilterExpr!);
        q = q.orderBy(desc(policies.createdAt), desc(policies.id)).limit(qLimit).offset(qOffset);
        rows = await q;
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
              p.is_active as "isActive",
              ${polCols.hasFlowKey ? sql`p.flow_key as "flowKey",` : sql``}
              c.id as "carId",
              c.plate_number as "plateNumber",
              c.make as "make",
              c.model as "model",
              c.year as "year",
              c.extra_attributes as "carExtra",
              count(*) over ()::int as "totalCount"
            from "policies" p
            left join "cars" c on c.policy_id = p.id
            where p.agent_id = ${agentId}
              ${hasPolicyNumberFilter ? sql`and p.policy_number = ${policyNumberParam!}` : sql``}
              ${hasClientFilter && polCols.hasClientId ? sql`and p.client_id = ${Number(url.searchParams.get("clientId"))}` : sql``}
              ${hasClientNumberFilter ? sql`and ((c.extra_attributes)::jsonb ->> 'clientNumber') = ${clientNumberParam!}` : sql``}
              ${hasFlowFilter ? (polCols.hasFlowKey ? sql`and p.flow_key = ${flowParam}` : sql`and ((c.extra_attributes)::jsonb ->> 'flowKey') = ${flowParam}`) : sql``}
              ${hasLinkedPolicyFilter ? sql`and (((c.extra_attributes)::jsonb ->> 'linkedPolicyId')::int = ${linkedPolicyIdFilter})` : sql``}
            order by p.created_at desc, p.id desc
            limit ${qLimit} offset ${qOffset}
          `);
          rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as any[];
        }
      } else if (user.userType === "direct_client") {
        // Client users normally see only policyset records where they are the insured.
        // When a caller asks for linked policies, return only endorsements linked
        // to that already-owned parent policy; otherwise the drawer treats every
        // client policy as an endorsement under every other policy.
        const userId = Number(user.id);
        if (hasLinkedPolicyFilter) {
          const result = await db.execute(sql`
            select
              p.id as "policyId",
              p.policy_number as "policyNumber",
              p.organisation_id as "organisationId",
              p.created_at as "createdAt",
              p.is_active as "isActive",
              ${polCols.hasFlowKey ? sql`p.flow_key as "flowKey",` : sql``}
              c.id as "carId",
              c.plate_number as "plateNumber",
              c.make as "make",
              c.model as "model",
              c.year as "year",
              c.extra_attributes as "carExtra",
              count(*) over ()::int as "totalCount"
            from "policies" p
            left join "cars" c on c.policy_id = p.id
            inner join "policies" parent on parent.id = ${linkedPolicyIdFilter}
            left join "cars" parent_car on parent_car.policy_id = parent.id
            inner join "clients" cl on cl.user_id = ${userId}
            where (((c.extra_attributes)::jsonb ->> 'linkedPolicyId')::int = ${linkedPolicyIdFilter})
              and (
                ${polCols.hasClientId ? sql`parent.client_id = cl.id OR` : sql``}
                (
                  ${polCols.hasFlowKey ? sql`parent.flow_key = 'policyset'` : sql`(parent_car.extra_attributes)::jsonb ->> 'flowKey' = 'policyset'`}
                  and (
                    ((parent_car.extra_attributes)::text ILIKE '%' || cl.display_name || '%')
                    OR ((parent_car.extra_attributes)::text ILIKE '%' || cl.primary_id || '%')
                    ${polCols.hasClientId ? sql`OR parent.client_id = cl.id` : sql``}
                  )
                )
              )
            order by p.created_at desc, p.id desc
            limit ${qLimit} offset ${qOffset}
          `);
          rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as any[];
        } else {
          const result = await db.execute(sql`
            select
              p.id as "policyId",
              p.policy_number as "policyNumber",
              p.organisation_id as "organisationId",
              p.created_at as "createdAt",
              p.is_active as "isActive",
              ${polCols.hasFlowKey ? sql`p.flow_key as "flowKey",` : sql``}
              c.id as "carId",
              c.plate_number as "plateNumber",
              c.make as "make",
              c.model as "model",
              c.year as "year",
              c.extra_attributes as "carExtra",
              count(*) over ()::int as "totalCount"
            from "policies" p
            left join "cars" c on c.policy_id = p.id
            inner join "clients" cl on cl.user_id = ${userId}
            where (
              ${polCols.hasClientId ? sql`p.client_id = cl.id OR` : sql``}
              ${polCols.hasFlowKey ? sql`p.flow_key = 'policyset'` : sql`(c.extra_attributes)::jsonb ->> 'flowKey' = 'policyset'`}
              AND (
                ((c.extra_attributes)::text ILIKE '%' || cl.display_name || '%')
                OR ((c.extra_attributes)::text ILIKE '%' || cl.primary_id || '%')
                ${polCols.hasClientId ? sql`OR p.client_id = cl.id` : sql``}
              )
            )
            order by p.created_at desc, p.id desc
            limit ${qLimit} offset ${qOffset}
          `);
          rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as any[];
        }
      } else {
        let scoped: any = baseSelect.innerJoin(
          memberships,
          and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id)))
        );
        if (hasPolicyNumberFilter) scoped = scoped.where(eq(policies.policyNumber, policyNumberParam!));
        if (hasClientFilter) scoped = scoped.where(clientFilterExpr!);
        if (hasClientNumberFilter) scoped = scoped.where(clientNumberFilterExpr!);
        if (hasFlowFilter) scoped = scoped.where(flowFilterExpr!);
        if (hasLinkedPolicyFilter) scoped = scoped.where(linkedPolicyFilterExpr!);
        scoped = scoped.orderBy(desc(policies.createdAt), desc(policies.id)).limit(qLimit).offset(qOffset);
        rows = await scoped;
      }
    } catch {
      if (user.userType === "admin" || user.userType === "internal_staff") {
        let q: any = baseSelect;
        if (hasPolicyNumberFilter) q = q.where(eq(policies.policyNumber, policyNumberParam!));
        if (hasClientFilter) q = q.where(clientFilterExpr!);
        if (hasClientNumberFilter) q = q.where(clientNumberFilterExpr!);
        if (hasFlowFilter) q = q.where(flowFilterExpr!);
        if (hasLinkedPolicyFilter) q = q.where(linkedPolicyFilterExpr!);
        q = q.orderBy(desc(policies.createdAt), desc(policies.id)).limit(qLimit).offset(qOffset);
        rows = await q;
      } else if (user.userType === "agent" || user.userType === "direct_client") {
        rows = [];
      } else {
        let scoped: any = baseSelect.innerJoin(
          memberships,
          and(eq(memberships.organisationId, policies.organisationId), eq(memberships.userId, Number(user.id)))
        );
        if (hasPolicyNumberFilter) scoped = scoped.where(eq(policies.policyNumber, policyNumberParam!));
        if (hasClientFilter) scoped = scoped.where(clientFilterExpr!);
        if (hasClientNumberFilter) scoped = scoped.where(clientNumberFilterExpr!);
        if (hasFlowFilter) scoped = scoped.where(flowFilterExpr!);
        if (hasLinkedPolicyFilter) scoped = scoped.where(linkedPolicyFilterExpr!);
        scoped = scoped.orderBy(desc(policies.createdAt), desc(policies.id)).limit(qLimit).offset(qOffset);
        rows = await scoped;
      }
    }

    const total =
      rows.length > 0
        ? Number((rows[0] as { totalCount?: number }).totalCount ?? 0)
        : 0;
    const enrichedRows = rows.map((r: any) => {
      const resolvedFlowKey = r.flowKey || (r.carExtra as any)?.flowKey || null;
      const rest = { ...r };
      delete (rest as { totalCount?: number }).totalCount;
      return {
        ...rest,
        flowKey: resolvedFlowKey,
        recordId: r.policyId,
        recordNumber: r.policyNumber,
      };
    });
    return NextResponse.json(
      { rows: enrichedRows, total, limit: qLimit, offset: qOffset },
      { status: 200 },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}


