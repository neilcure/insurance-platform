import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { cars, policies } from "@/db/schema/insurance";
import { memberships } from "@/db/schema/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/require-user";
import { getPolicyColumns } from "@/lib/db/column-check";
import {
  getInsuredDisplayName,
  getInsuredPrimaryId,
  buildAddressFromGetter,
  fuzzyGet,
} from "@/lib/field-resolver";
import { extractDateField } from "@/lib/policies/date-extract";
import { SYNTHETIC_FIELDS_BY_SOURCE } from "@/lib/pdf/synthetic-fields";
import { parseAnyDate, fmtDateDDMMYYYY } from "@/lib/format/date";
import { parsePaginationParams } from "@/lib/pagination/types";

/**
 * GET /api/policies/expiring
 *
 * Returns policies whose `endDate` (read from
 * `cars.extraAttributes.packagesSnapshot.policy.values.endDate` —
 * with snapshot-aware fallbacks) falls inside the requested date
 * window. Designed for dashboard widgets that need to surface
 * upcoming and overdue renewals.
 *
 * Query params
 * ------------
 *   from         YYYY-MM-DD inclusive   (default: 30 days ago)
 *   to           YYYY-MM-DD inclusive   (default: 60 days from now)
 *   includeInactive  truthy → include `is_active = false` policies
 *   limit / offset   standard pagination contract
 *
 * Visibility scope (mirrors `GET /api/policies`)
 * ---------------------------------------------
 *   - admin / internal_staff: every policy in every org
 *   - agent: policies where `policies.agent_id = me`
 *   - direct_client: policies linked to a client whose `user_id = me`
 *   - everyone else: policies in orgs the user has a membership in
 *
 * Why JS-side filter on `endDate`
 * -------------------------------
 * `endDate` lives inside the per-policy snapshot JSON (no top-level
 * column) and is stored as a string that can be either YYYY-MM-DD
 * (HTML5 date input) or DD-MM-YYYY (formula-evaluated import). Any
 * SQL-side filter would need to handle both shapes; JS-side parse
 * keeps the rule in one place (`parseAnyDate`). We hard-cap the
 * fetch at FETCH_HARD_CAP rows of recent policies — enough for
 * every realistic tenant's dashboard widget. Larger surfaces (an
 * "All Renewals" page) should add SQL-side endDate extraction.
 */

const FETCH_HARD_CAP = 1000;
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_LOOKAHEAD_DAYS = 60;

type ScopedPolicyRow = {
  policyId: number;
  policyNumber: string;
  organisationId: number;
  createdAt: string;
  isActive: boolean;
  flowKey: string | null;
  agentId: number | null;
  carExtra: Record<string, unknown> | null;
};

/**
 * What this calendar event represents:
 *   - `renewal`     → terminal/issued policy (status in
 *                     `TERMINAL_STATUSES`). Plotted at its endDate.
 *                     The user should renew before that date.
 *   - `incomplete`  → policy is still in progress — quotation,
 *                     invoice, or payment workflow has NOT yet
 *                     reached `policy_issued`. Plotted at its
 *                     startDate, which is the deadline by which
 *                     paperwork should be done for the proposed
 *                     coverage to take effect. Acts as a TODO
 *                     reminder to chase the policy through to
 *                     completion.
 */
type CalendarEventKind = "renewal" | "incomplete";

type ExpiringRow = {
  policyId: number;
  policyNumber: string;
  /** ISO date the calendar should plot this event on. For renewals
   *  this is the endDate; for incomplete this is the startDate. */
  date: string;
  /** Localised DD-MM-YYYY label of `date` for inline display. */
  dateDisplay: string;
  /** Signed days from today: negative = past, 0 = today. */
  daysFromToday: number;
  /** Always populated when known. For incomplete policies this is
   *  the original endDate (so the UI can still show the policy term
   *  in the row). */
  endDateDisplay: string | null;
  kind: CalendarEventKind;
  insuredName: string;
  status: string | null;
  flowKey: string | null;
  agentId: number | null;
  isActive: boolean;
  /**
   * Flat snapshot fields the client can use to render user-chosen
   * "extra columns" on each row. Keys are formatted as
   * `<packageName>.<rawKey>` (e.g. `policyinfo.policyinfo__coverType`)
   * so the settings panel can group them by package and present a
   * human-readable picker. Values are always primitives (strings,
   * numbers, booleans) — nested objects are skipped.
   */
  extraFields: Record<string, string>;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function diffInDays(future: Date, past: Date): number {
  const ms = startOfDay(future).getTime() - startOfDay(past).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Determine whether a policy is still "in progress" — i.e. its
 * lifecycle hasn't yet reached one of the terminal states
 * (`policy_issued`, `cancelled`, `declined`, `rejected`,
 * `expired`). These in-progress policies are surfaced on the
 * calendar at their START date — that's the date by which the
 * paperwork should be done for the coverage to take effect, so
 * it doubles as a "follow-up by this date" reminder.
 *
 * Examples that count as in-progress:
 *   - quotation_prepared / quotation_sent / quotation_confirmed
 *   - invoice_prepared / invoice_sent / invoice_confirmed
 *   - payment_received / payment_confirmed
 *   - any custom tenant status that isn't in the terminal set
 *
 * Examples that do NOT count (treated as renewals at endDate):
 *   - policy_issued (the final happy state)
 *   - cancelled / declined / rejected / expired (terminal closed)
 *
 * TODO (per `.cursor/skills/dynamic-config-first/SKILL.md`):
 * migrate this denylist to a `meta.isTerminal: true` flag on each
 * `form_options.policy_statuses` row so admins can mark custom
 * statuses as terminal without a code change. For v1 we ship with
 * the canonical Bravo workflow's terminal names below.
 */
const TERMINAL_STATUSES = new Set([
  "policy_issued",
  "cancelled",
  "declined",
  "rejected",
  "expired",
  "completed",
  "closed",
]);

function isIncompleteStatus(status: string | null): boolean {
  if (!status) return true; // no status at all → treat as incomplete
  return !TERMINAL_STATUSES.has(status.toLowerCase());
}

function extractStatus(carExtra: Record<string, unknown> | null | undefined): string | null {
  if (!carExtra || typeof carExtra !== "object") return null;
  const v = (carExtra as { status?: unknown }).status;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function extractInsuredName(
  carExtra: Record<string, unknown> | null | undefined,
): string {
  if (!carExtra || typeof carExtra !== "object") return "";
  const insured = (carExtra as { insuredSnapshot?: unknown }).insuredSnapshot as
    | Record<string, unknown>
    | null
    | undefined;
  return getInsuredDisplayName(insured ?? null);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const { limit: qLimit, offset: qOffset } = parsePaginationParams(url.searchParams, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const today = startOfDay(new Date());
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    const fromDate = fromParam ? parseAnyDate(fromParam) : null;
    const toDate = toParam ? parseAnyDate(toParam) : null;
    const windowFrom = fromDate
      ? startOfDay(fromDate)
      : new Date(today.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const windowTo = toDate
      ? startOfDay(toDate)
      : new Date(today.getTime() + DEFAULT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

    const includeInactiveParam = url.searchParams.get("includeInactive");
    const includeInactive = includeInactiveParam === "1" || includeInactiveParam === "true";

    const polCols = await getPolicyColumns();

    const baseSelect = db
      .select({
        policyId: policies.id,
        policyNumber: policies.policyNumber,
        organisationId: policies.organisationId,
        createdAt: policies.createdAt,
        isActive: policies.isActive,
        flowKey: policies.flowKey,
        agentId: policies.agentId,
        carExtra: cars.extraAttributes,
      })
      .from(policies)
      .leftJoin(cars, eq(cars.policyId, policies.id));

    let rows: ScopedPolicyRow[] = [];
    try {
      if (user.userType === "admin" || user.userType === "internal_staff") {
        let q: any = baseSelect;
        if (!includeInactive) q = q.where(eq(policies.isActive, true));
        q = q.orderBy(desc(policies.createdAt), desc(policies.id)).limit(FETCH_HARD_CAP);
        rows = (await q) as ScopedPolicyRow[];
      } else if (user.userType === "agent") {
        if (!polCols.hasAgentId) {
          rows = [];
        } else {
          const agentId = Number(user.id);
          const result = await db.execute(sql`
            select
              p.id as "policyId",
              p.policy_number as "policyNumber",
              p.organisation_id as "organisationId",
              p.created_at as "createdAt",
              p.is_active as "isActive",
              ${polCols.hasFlowKey ? sql`p.flow_key as "flowKey",` : sql`null::text as "flowKey",`}
              ${polCols.hasAgentId ? sql`p.agent_id as "agentId",` : sql`null::int as "agentId",`}
              c.extra_attributes as "carExtra"
            from "policies" p
            left join "cars" c on c.policy_id = p.id
            where p.agent_id = ${agentId}
              ${includeInactive ? sql`` : sql`and p.is_active = true`}
            order by p.created_at desc, p.id desc
            limit ${FETCH_HARD_CAP}
          `);
          rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as ScopedPolicyRow[];
        }
      } else if (user.userType === "direct_client") {
        const userId = Number(user.id);
        const result = await db.execute(sql`
          select
            p.id as "policyId",
            p.policy_number as "policyNumber",
            p.organisation_id as "organisationId",
            p.created_at as "createdAt",
            p.is_active as "isActive",
            ${polCols.hasFlowKey ? sql`p.flow_key as "flowKey",` : sql`null::text as "flowKey",`}
            ${polCols.hasAgentId ? sql`p.agent_id as "agentId",` : sql`null::int as "agentId",`}
            c.extra_attributes as "carExtra"
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
          ${includeInactive ? sql`` : sql`and p.is_active = true`}
          order by p.created_at desc, p.id desc
          limit ${FETCH_HARD_CAP}
        `);
        rows = (Array.isArray(result) ? result : (result as any)?.rows ?? []) as ScopedPolicyRow[];
      } else {
        let scoped: any = baseSelect.innerJoin(
          memberships,
          and(
            eq(memberships.organisationId, policies.organisationId),
            eq(memberships.userId, Number(user.id)),
          ),
        );
        if (!includeInactive) scoped = scoped.where(eq(policies.isActive, true));
        scoped = scoped.orderBy(desc(policies.createdAt), desc(policies.id)).limit(FETCH_HARD_CAP);
        rows = (await scoped) as ScopedPolicyRow[];
      }
    } catch {
      rows = [];
    }

    const expiring: ExpiringRow[] = [];
    for (const r of rows) {
      const status = extractStatus(r.carExtra);
      const isIncomplete = isIncompleteStatus(status);

      // Always read both — incomplete policies still display the
      // policy term in the row (so the user sees what date the
      // proposed coverage runs to), even though the calendar dot
      // is plotted on the start date.
      const rawEnd = extractDateField(r.carExtra, "endDate");
      const parsedEnd = rawEnd ? parseAnyDate(rawEnd) : null;
      const endDayDisplay = parsedEnd ? fmtDateDDMMYYYY(startOfDay(parsedEnd)) : null;

      // For an incomplete policy: anchor on startDate (the date
      // by which paperwork should be done). Fall back to endDate
      // only — DO NOT fall back to `policies.createdAt`. The user
      // explicitly objected to seeing the create/issue date here:
      // it's misleading because the calendar implies the date
      // means something policy-relevant, and createdAt has nothing
      // to do with when coverage starts. If neither start nor end
      // is in the snapshot, the policy is too incomplete to plot
      // and we skip it.
      // For a terminal/issued policy: anchor on endDate (renewal
      // calendar).
      const rawAnchor = isIncomplete
        ? extractDateField(r.carExtra, "startDate") || rawEnd
        : rawEnd;
      let anchorDay: Date | null = null;
      if (rawAnchor) {
        const parsedAnchor = parseAnyDate(rawAnchor);
        if (parsedAnchor) anchorDay = startOfDay(parsedAnchor);
      }
      if (!anchorDay) continue;

      // Window filter: applies ONLY to renewals. Incomplete
      // policies are TODOs and must be shown regardless of how
      // far their dates land — otherwise a policy that started 6
      // months ago and still hasn't been issued (clearly the user
      // needs a reminder) gets silently dropped because its end
      // date is 6 months in the future and out of the lookback.
      if (!isIncomplete) {
        if (anchorDay.getTime() < windowFrom.getTime()) continue;
        if (anchorDay.getTime() > windowTo.getTime()) continue;
      }

      // Build the flat extra-fields map for user-configurable row
      // display. Keys are `<pkg>.<rawKey>` so the frontend settings
      // panel can group by package. Only primitives are included —
      // nested objects / arrays are skipped.
      //
      // Synthetic fields (Display Name, Primary ID, Full Address)
      // are pre-resolved here so the picker on the dashboard can
      // offer them just like the PDF Mail-Merge "Add Section"
      // picker does — see `lib/pdf/synthetic-fields.ts`. The
      // canonical paths (`insured.displayName`, `insured.primaryId`,
      // `contactinfo.fullAddress`, `organisation.fullAddress`)
      // mirror the PDF mapping field keys.
      const extraFields: Record<string, string> = {};
      const carExtraObj = (r.carExtra && typeof r.carExtra === "object")
        ? (r.carExtra as Record<string, unknown>)
        : null;
      if (carExtraObj) {
        const pkgs = (carExtraObj.packagesSnapshot ?? {}) as Record<string, unknown>;
        for (const [pkgName, pkgVal] of Object.entries(pkgs)) {
          if (!pkgVal || typeof pkgVal !== "object") continue;
          const inner = pkgVal as Record<string, unknown>;
          const vals = (inner.values ?? inner) as Record<string, unknown>;
          if (!vals || typeof vals !== "object") continue;
          for (const [k, v] of Object.entries(vals)) {
            if (v == null) continue;
            if (typeof v === "object") continue; // skip nested
            const display = String(v).trim();
            if (!display) continue;
            extraFields[`${pkgName}.${k}`] = display;
          }
        }

        // ── Resolve synthetic fields ────────────────────────────
        const insured = (carExtraObj.insuredSnapshot ?? null) as
          | Record<string, unknown>
          | null;
        if (insured && typeof insured === "object") {
          for (const f of SYNTHETIC_FIELDS_BY_SOURCE.insured ?? []) {
            let val = "";
            if (f.fieldKey === "displayName") val = getInsuredDisplayName(insured);
            else if (f.fieldKey === "primaryId") val = getInsuredPrimaryId(insured);
            else if (f.fieldKey === "age") {
              const direct = String(fuzzyGet(insured, "age") ?? "").trim();
              val = direct;
            }
            if (val) extraFields[`insured.${f.fieldKey}`] = val;
          }
          // Address is stored on the insured snapshot under
          // `contactinfo__*` keys (per the policy wizard contract).
          for (const f of SYNTHETIC_FIELDS_BY_SOURCE.contactinfo ?? []) {
            if (f.fieldKey === "fullAddress") {
              const addr = buildAddressFromGetter((k) => {
                // Try contact prefix first, then bare key.
                const v = fuzzyGet(insured, `contactinfo__${k}`);
                if (v != null && String(v).trim()) return v;
                const v2 = fuzzyGet(insured, `contactinfo_${k}`);
                if (v2 != null && String(v2).trim()) return v2;
                return fuzzyGet(insured, k);
              });
              if (addr) extraFields[`contactinfo.${f.fieldKey}`] = addr;
            }
          }
        }
      }

      expiring.push({
        policyId: r.policyId,
        policyNumber: r.policyNumber,
        date: anchorDay.toISOString(),
        dateDisplay: fmtDateDDMMYYYY(anchorDay),
        daysFromToday: diffInDays(anchorDay, today),
        endDateDisplay: endDayDisplay,
        kind: isIncomplete ? "incomplete" : "renewal",
        insuredName: extractInsuredName(r.carExtra),
        status,
        flowKey: r.flowKey ?? null,
        agentId: r.agentId ?? null,
        isActive: r.isActive !== false,
        extraFields,
      });
    }

    // Sort chronologically (oldest first → newest). The dashboard
    // widget re-sorts a copy by `Math.abs(daysFromToday)` to pick
    // the closest event for auto-navigation, but inside each bucket
    // we want chronological order so the user reads "earliest first".
    expiring.sort((a, b) => a.daysFromToday - b.daysFromToday);

    const total = expiring.length;
    const paged = expiring.slice(qOffset, qOffset + qLimit);

    return NextResponse.json(
      {
        rows: paged,
        total,
        limit: qLimit,
        offset: qOffset,
        windowFrom: windowFrom.toISOString(),
        windowTo: windowTo.toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    if ((err as Error)?.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("/api/policies/expiring failed", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
