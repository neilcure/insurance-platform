"use client";

/**
 * PolicyExpiryCalendar — dashboard widget that shows upcoming policy
 * expiries on a month-view calendar plus a grouped action list.
 *
 * Data flow
 * ---------
 *   GET /api/policies/expiring?from=...&to=...
 *
 * Returns rows already RBAC-scoped to the caller (`admin` /
 * `internal_staff` see all in their org; `agent` sees own assignments;
 * `direct_client` sees their own; everyone else sees their
 * memberships' policies). The endpoint reads `endDate` out of the
 * snapshot via the shared field resolver so the same key contract
 * (DD-MM-YYYY or YYYY-MM-DD, in `packagesSnapshot.policy.values`)
 * works for wizard-saved AND import-saved policies.
 *
 * Action wiring
 * -------------
 *   - "Open"   → links to /policies/{id}
 *   - "Renew"  → /policies/new?renewalOf={id} (the wizard already
 *                supports `linkedPolicyId` for endorsement-style
 *                renewals; passing `renewalOf` lets future flows
 *                differentiate without breaking existing endorsements)
 *   - "Remind" → opens the shared document-delivery dialog (per
 *                .cursor/rules/document-delivery.mdc) with the policy
 *                attached so the user can pick a template & recipient
 *
 * Visibility note
 * ---------------
 * "Renew" / "Remind" are gated to admin / agent / internal_staff —
 * direct_clients only see "Open". TODO: migrate this rule into
 * `form_options.user_type_visibility` (see dynamic-config-first
 * skill) so admins can adjust the matrix without a code change.
 */

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Mail, AlertTriangle, CalendarDays, Settings2, Check } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeliverDocuments } from "@/lib/document-delivery";
import { usePolicyStatuses } from "@/hooks/use-policy-statuses";
import {
  SYNTHETIC_FIELDS_BY_SOURCE,
  isHandledByDefault,
} from "@/lib/pdf/synthetic-fields";
import { cn } from "@/lib/utils";

type CalendarEventKind = "renewal" | "incomplete";

type ExpiringRow = {
  policyId: number;
  policyNumber: string;
  /** ISO date the calendar dot for this row is plotted on. For
   *  renewals this is endDate; for incomplete this is the startDate
   *  (the deadline by which paperwork should be done for the
   *  proposed coverage to take effect). */
  date: string;
  /** DD-MM-YYYY label of `date` for display. */
  dateDisplay: string;
  /** Signed days from today: negative = past. */
  daysFromToday: number;
  /** Always populated when the snapshot has an endDate, even for
   *  incomplete policies — the row footer shows it as the proposed
   *  policy term. */
  endDateDisplay: string | null;
  kind: CalendarEventKind;
  insuredName: string;
  status: string | null;
  flowKey: string | null;
  agentId: number | null;
  isActive: boolean;
  extraFields: Record<string, string>;
};

type BucketKey = "overdue_incomplete" | "in_progress" | "expired" | "week" | "month" | "later";

type Bucket = {
  key: BucketKey;
  label: string;
  description: string;
  rows: ExpiringRow[];
  badgeClass: string;
  dotClass: string;
};

type Props = {
  /**
   * Lookback window in days; values older than this are not shown.
   * Default 90: catches recently overdue / never-renewed quotations
   * (a 30-day window proved too short — many tenants only review the
   * dashboard weekly, so a quotation that expired 6 weeks ago should
   * still surface as a red bucket entry).
   */
  lookbackDays?: number;
  /**
   * Lookahead window in days; values further out are not shown.
   * Default 540 (~18 months): most policies in this codebase are
   * annual (e.g. car insurance), AND recently-issued ones can have
   * an end date 12+ months out. We saw policies with end ~13 months
   * out being clipped by a strict 365-day window when their
   * startDate extraction failed. 18 months gives enough headroom
   * that the renewal calendar is never accidentally empty for the
   * "I issued this last week" case. Incomplete policies bypass the
   * window check entirely (they're TODO reminders, see API).
   */
  lookaheadDays?: number;
  /** Page size for the right-hand list.                                 */
  pageLimit?: number;
  /** Current user's userType — used to hide write actions from clients. */
  userType?: string;
};

// ---------------------------------------------------------------------------
// Bucket thresholds
//
// TODO: per `.cursor/skills/dynamic-config-first/SKILL.md`, these
// numbers are candidates for `app_settings` / `form_options` so admins
// can tune the urgency cutoffs per tenant without a code change. For
// v1 we keep them as constants — easy to migrate later.
// ---------------------------------------------------------------------------
/**
 * Statuses that indicate the workflow has NOT yet moved past the
 * quotation stage. A policy stuck here when its start date has
 * already arrived is genuinely overdue — the client's proposed
 * coverage has begun but no paperwork has been confirmed yet.
 *
 * Statuses BEYOND this set (e.g. invoice_sent, payment_received)
 * mean the workflow is progressing normally — the invoice is out
 * and they're just waiting on payment. Those are NOT overdue;
 * they get the "In Progress" bucket instead.
 *
 * TODO (dynamic-config-first skill): migrate to `meta.isEarlyStage`
 * flag on `form_options.policy_statuses` rows so admins can
 * customise this boundary without a code change.
 */
const EARLY_STAGE_STATUSES = new Set([
  "quotation_prepared",
  "quotation_sent",
]);

const BUCKET_DEFS: ReadonlyArray<Pick<Bucket, "key" | "label" | "description" | "badgeClass" | "dotClass">> =
  [
    {
      key: "overdue_incomplete",
      label: "Overdue",
      description: "Quotation not actioned — start date is today or has passed",
      badgeClass:
        "bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-900",
      dotClass: "bg-red-500 dark:bg-red-400",
    },
    {
      key: "in_progress",
      label: "In Progress",
      description: "Invoice sent / payment received — waiting to finalise",
      badgeClass:
        "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
      dotClass: "bg-blue-500 dark:bg-blue-400",
    },
    {
      key: "expired",
      label: "Expired / Overdue",
      description: "Issued policy is already past its end date",
      badgeClass:
        "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900",
      dotClass: "bg-orange-500 dark:bg-orange-400",
    },
    {
      key: "week",
      label: "This week",
      description: "Expires in the next 7 days",
      badgeClass:
        "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
      dotClass: "bg-amber-500 dark:bg-amber-400",
    },
    {
      key: "month",
      label: "This month",
      description: "Expires in 8–30 days",
      badgeClass:
        "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-900",
      dotClass: "bg-yellow-500 dark:bg-yellow-400",
    },
    {
      key: "later",
      label: "Later",
      description: "Expires in 31+ days",
      badgeClass:
        "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-900",
      dotClass: "bg-blue-500 dark:bg-blue-400",
    },
  ];

/**
 * Bucketing rule for incomplete (not-yet-issued) policies:
 *
 *   "overdue_incomplete" — status is still at quotation stage
 *     (quotation_prepared / quotation_sent) AND the policy's start
 *     date has already arrived or passed. This is the genuine
 *     overdue case: the client's coverage was supposed to start but
 *     no invoice has even been sent yet. Needs urgent chasing.
 *
 *   "in_progress" — the workflow has advanced past quotation
 *     (invoice sent, payment received, etc.). Still incomplete but
 *     NOT overdue — it's progressing normally, just waiting for the
 *     next step. Showing "10 days ago" here would be misleading.
 *
 * Issued/terminal policies are bucketed by days-to-expiry (renewal
 * calendar logic: expired → week → month → later).
 */
function bucketForRow(row: ExpiringRow): BucketKey {
  if (row.kind === "incomplete") {
    const status = (row.status ?? "").toLowerCase();
    const isEarlyStage = !status || EARLY_STAGE_STATUSES.has(status);
    // Overdue = today has reached the day BEFORE the start date.
    // Rationale: by the day before coverage starts, the paperwork
    // must be done. If it's still at "Quotation Prepared" at that
    // point, no action has been taken and it's genuinely overdue.
    // (`daysFromToday <= 1` catches both "tomorrow is start" and
    // "start date already passed".)
    const startDateImminent = row.daysFromToday <= 1;
    if (isEarlyStage && startDateImminent) return "overdue_incomplete";
    return "in_progress";
  }
  const days = row.daysFromToday;
  if (days <= 0) return "expired";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  return "later";
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Human-readable label for an N-day duration. Keeps the empty-state
 *  copy short ("12 months") instead of awkward ("365 days"). */
function monthLabel(days: number): string {
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  if (months === 1) return "1 month";
  if (months >= 12) {
    const years = Math.round(months / 12);
    return years === 1 ? "1 year" : `${years} years`;
  }
  return `${months} months`;
}

function relativeLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `${days} days`;
}

/**
 * Build a deep-link that opens this policy's detail drawer. Mirrors
 * the convention used by `lib/reminder-sender.ts` and
 * `app/api/policies/[id]/send/route.ts`:
 *
 *   - if the row carries a `flowKey`, link to the per-flow listing
 *     page (`/dashboard/flows/<flowKey>`) so the user lands on the
 *     same filtered table they normally use
 *   - otherwise fall back to the global `/dashboard/policies` page
 *
 * `PoliciesTableClient` automatically calls `openDetails(id)` for
 * the `?policyId=` query param on mount, so the drawer pops without
 * any extra wiring on this side.
 */
function openPolicyHref(row: ExpiringRow): string {
  const base = row.flowKey
    ? `/dashboard/flows/${encodeURIComponent(row.flowKey)}`
    : `/dashboard/policies`;
  return `${base}?policyId=${row.policyId}`;
}

// ── Persistent settings ────────────────────────────────────────────────────
// Defined OUTSIDE the component so the constant is never recreated and,
// critically, so `loadSettings` cannot accidentally run on the server during
// SSR. In Next.js, client-component `useState(initialiserFn)` calls the
// initialiser during the *server-side* render too — `localStorage` doesn't
// exist there, the try/catch catches the ReferenceError, and React reuses
// the empty-defaults state during hydration without ever re-running the
// initialiser on the client. The fix is to start with plain defaults and
// hydrate from localStorage inside a `useEffect` that only runs client-side.
const SETTINGS_KEY = "policy-calendar-settings-v1";

type CalendarSettings = {
  hiddenStatuses: string[];
  visibleFields: string[];
};

const DEFAULT_SETTINGS: CalendarSettings = { hiddenStatuses: [], visibleFields: [] };
// ──────────────────────────────────────────────────────────────────────────

export function PolicyExpiryCalendar({
  lookbackDays = 90,
  lookaheadDays = 540,
  pageLimit = 25,
  userType,
}: Props) {
  const deliver = useDeliverDocuments();
  // Pull status labels + colours from `form_options.policy_statuses`
  // (admin-configurable) so the calendar row badges stay in sync with
  // the StatusTab and any future status added by an admin. Per the
  // dynamic-config-first skill we MUST NOT hardcode this list here.
  // We also use `options` to drive the status filter chips below the
  // calendar — so adding a new status in the admin UI immediately
  // makes it filterable on the dashboard.
  const {
    options: statusOptions,
    getLabel: getStatusLabel,
    getColor: getStatusColor,
  } = usePolicyStatuses();

  // Status filter — multi-select. Empty Set = no filter (show all).
  const [statusFilter, setStatusFilter] = React.useState<Set<string>>(
    () => new Set(),
  );

  const toggleStatusFilter = React.useCallback((value: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  // ── Settings (persisted in localStorage, edited via draft) ───────
  // hiddenStatuses: status values the user wants to EXCLUDE from the
  //   calendar entirely (persistent — different from the session
  //   `statusFilter` chips below the calendar).
  // visibleFields: ordered list of `<pkg>.<key>` field paths to show
  //   as extra metadata under each row card (max 3 shown).
  //
  // The settings panel uses a draft → committed state pattern. The
  // user toggles checkboxes against `draftSettings` (purely local to
  // the open panel); only Save copies it onto `settings` AND
  // persists to localStorage. Cancel discards the draft.
  //
  // IMPORTANT: we start with DEFAULT_SETTINGS and hydrate from
  // localStorage inside a useEffect. Do NOT use localStorage inside
  // useState() — it runs on the server during SSR and the value is
  // silently discarded during hydration (Next.js client-component
  // behaviour). See the module-level comment above for details.

  const [settings, setSettings] = React.useState<CalendarSettings>(DEFAULT_SETTINGS);

  // Load from localStorage once after the component mounts on the client.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings(JSON.parse(raw) as CalendarSettings);
    } catch { /* ignore */ }
  }, []);

  // Draft state, edited inside the open panel. Reset to `settings`
  // every time the panel opens so a previous Cancel doesn't leak.
  const [draftSettings, setDraftSettings] = React.useState<CalendarSettings>(settings);
  const [settingsOpen, setSettingsOpen] = React.useState<boolean>(false);

  const openSettings = React.useCallback(() => {
    setDraftSettings(settings);
    setSettingsOpen(true);
  }, [settings]);

  const cancelSettings = React.useCallback(() => {
    setDraftSettings(settings); // throw away edits
    setSettingsOpen(false);
  }, [settings]);

  const saveSettingsNow = React.useCallback(() => {
    setSettings(draftSettings);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(draftSettings)); } catch { /* ignore */ }
    setSettingsOpen(false);
  }, [draftSettings]);

  const toggleDraftHiddenStatus = React.useCallback((value: string) => {
    setDraftSettings((prev) => ({
      ...prev,
      hiddenStatuses: prev.hiddenStatuses.includes(value)
        ? prev.hiddenStatuses.filter((s) => s !== value)
        : [...prev.hiddenStatuses, value],
    }));
  }, []);

  const toggleDraftVisibleField = React.useCallback((fieldKey: string) => {
    setDraftSettings((prev) => {
      const already = prev.visibleFields.includes(fieldKey);
      return {
        ...prev,
        visibleFields: already
          ? prev.visibleFields.filter((f) => f !== fieldKey)
          : [...prev.visibleFields, fieldKey].slice(0, 3),
      };
    });
  }, []);

  // Has the draft diverged from saved settings? Powers the Save
  // button's enabled state and a small "modified" indicator.
  const draftDirty = React.useMemo(() => {
    if (draftSettings.hiddenStatuses.length !== settings.hiddenStatuses.length) return true;
    if (draftSettings.visibleFields.length !== settings.visibleFields.length) return true;
    for (let i = 0; i < draftSettings.hiddenStatuses.length; i++) {
      if (draftSettings.hiddenStatuses[i] !== settings.hiddenStatuses[i]) return true;
    }
    for (let i = 0; i < draftSettings.visibleFields.length; i++) {
      if (draftSettings.visibleFields[i] !== settings.visibleFields[i]) return true;
    }
    return false;
  }, [draftSettings, settings]);

  const canTakeWriteActions = React.useMemo(
    () =>
      userType === "admin" || userType === "agent" || userType === "internal_staff",
    [userType],
  );

  const [rows, setRows] = React.useState<ExpiringRow[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedDay, setSelectedDay] = React.useState<Date | undefined>(undefined);
  // Controlled month so we can auto-navigate the calendar to the
  // first month that actually contains an expiry. Without this the
  // calendar always opens on the current month, and tenants whose
  // policies expire 6+ months out (annual motor policies are typical
  // here) just see an empty grid and assume the widget is broken.
  const [calendarMonth, setCalendarMonth] = React.useState<Date | undefined>(undefined);
  // Track whether we've already auto-navigated for this dataset, so
  // we don't keep yanking the user back to the data month every time
  // they paginate to a different month.
  const autoNavigatedRef = React.useRef<boolean>(false);
  // "Show all months" toggle — when true the list is unfiltered by month
  // so the user can see the full 17-policy dataset without paging.
  const [showAllMonths, setShowAllMonths] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fromDate = new Date(today.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
    const toDate = new Date(today.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    setLoading(true);
    autoNavigatedRef.current = false; // re-arm auto-nav for this fetch
    fetch(
      `/api/policies/expiring?from=${fmt(fromDate)}&to=${fmt(toDate)}&limit=${pageLimit * 4}&offset=0`,
      { cache: "no-store" },
    )
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load expiring policies (${res.status})`);
        }
        return res.json();
      })
      .then((json: { rows?: ExpiringRow[] }) => {
        if (cancelled) return;
        setRows(Array.isArray(json?.rows) ? json.rows : []);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message ?? "Failed to load");
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lookbackDays, lookaheadDays, pageLimit]);

  // Auto-navigate the calendar to the soonest-expiring month after
  // each new dataset arrives. Only fires once per fetch — once the
  // user manually clicks `<` / `>` the calendar stays where they
  // put it. Skips if there's already an expiry in the current month.
  React.useEffect(() => {
    if (autoNavigatedRef.current) return;
    if (rows.length === 0) return;
    const today = startOfDay(new Date());
    const sortedByProximity = [...rows].sort(
      (a, b) => Math.abs(a.daysFromToday) - Math.abs(b.daysFromToday),
    );
    const closest = sortedByProximity[0];
    if (!closest) return;
    const closestDate = new Date(closest.date);
    const sameMonth =
      closestDate.getFullYear() === today.getFullYear()
      && closestDate.getMonth() === today.getMonth();
    if (!sameMonth) {
      setCalendarMonth(new Date(closestDate.getFullYear(), closestDate.getMonth(), 1));
    }
    autoNavigatedRef.current = true;
  }, [rows]);

  const buckets: Bucket[] = React.useMemo(() => {
    const grouped: Record<BucketKey, ExpiringRow[]> = {
      overdue_incomplete: [],
      in_progress: [],
      expired: [],
      week: [],
      month: [],
      later: [],
    };
    for (const r of rows) grouped[bucketForRow(r)].push(r);
    return BUCKET_DEFS.map((def) => ({ ...def, rows: grouped[def.key] }));
  }, [rows]);

  const totalCount = rows.length;

  // Which month is currently being shown on the calendar grid?
  // We default to today's month if no manual navigation has happened
  // yet — the auto-nav effect above flips this to the closest event
  // month after the dataset arrives. The list below the calendar is
  // SCOPED to this month, per the user's spec: "June policy in June,
  // not showing all — if showing all why not just go to the policies
  // page?". A clicked day narrows further to that single day.
  const activeMonth = calendarMonth ?? new Date();

  const isInActiveMonth = React.useCallback(
    (iso: string) => {
      const d = new Date(iso);
      return (
        d.getFullYear() === activeMonth.getFullYear()
        && d.getMonth() === activeMonth.getMonth()
      );
    },
    [activeMonth],
  );

  // ── Admin-configured labels for packages and fields ──────────────
  // Mirrors the same form_options fetch pattern as PoliciesTableClient
  // so the Settings field picker shows the SAME human-readable labels
  // the user sees on the policies page (e.g. "Started Date" instead
  // of "Tpbi", "Cover Type" instead of "Coverage_Type"). Per the
  // dynamic-config-first skill — never hardcode labels.

  // Load every admin-configured package + its fields so the picker
  // shows the COMPLETE catalog (not just keys that happen to be in
  // the policies currently loaded). Insured + every package row in
  // form_options gets fetched.

  const [packageLabels, setPackageLabels] = React.useState<Record<string, string>>({});
  const [fieldLabels, setFieldLabels] = React.useState<Record<string, string>>({});
  const [fieldSortOrders, setFieldSortOrders] = React.useState<Record<string, number>>({});
  const [packageOrder, setPackageOrder] = React.useState<string[]>([]);
  // Catalog of every (pkg, fieldKey) pair admin has configured —
  // used so the picker can offer fields even when no currently-loaded
  // policy has populated them yet.
  const [adminFieldCatalog, setAdminFieldCatalog] = React.useState<
    Map<string, { path: string; label: string; sortOrder: number }[]>
  >(() => new Map());

  React.useEffect(() => {
    let cancelled = false;
    const ts = Date.now();
    fetch(`/api/form-options?groupKey=packages&_t=${ts}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then(async (pkgRows: Array<{ value?: string; label?: string; sortOrder?: number }>) => {
        if (cancelled) return;
        const pLabels: Record<string, string> = { insured: "Insured" };
        const pOrder: string[] = [];
        const pkgList: string[] = ["insured"];
        if (Array.isArray(pkgRows)) {
          // Sort packages by their admin sortOrder for a stable order
          // in the field picker.
          const sorted = [...pkgRows].sort((a, b) => {
            const aSo = Number(a?.sortOrder); const bSo = Number(b?.sortOrder);
            return (Number.isFinite(aSo) ? aSo : 0) - (Number.isFinite(bSo) ? bSo : 0);
          });
          for (const row of sorted) {
            const key = String(row?.value ?? "").trim();
            const lbl = String(row?.label ?? "").trim();
            if (!key) continue;
            if (lbl) pLabels[key] = lbl;
            if (!pkgList.includes(key)) pkgList.push(key);
          }
        }
        pOrder.push(...pkgList);
        // Fetch each package's `${pkg}_fields` group in parallel.
        const fieldResults = await Promise.all(
          pkgList.map((pkg) =>
            fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}&_t=${ts}`, { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : []))
              .catch(() => [])
              .then((fRows: Array<{ value?: string; label?: string; sortOrder?: number }>) => ({ pkg, fRows }))
          )
        );
        if (cancelled) return;
        const fLabels: Record<string, string> = {};
        const fOrders: Record<string, number> = {};
        const catalog = new Map<string, { path: string; label: string; sortOrder: number }[]>();
        for (const { pkg, fRows } of fieldResults) {
          if (!Array.isArray(fRows)) continue;
          const pkgEntries: { path: string; label: string; sortOrder: number }[] = [];
          for (const row of fRows) {
            const key = String(row?.value ?? "").trim();
            const lbl = String(row?.label ?? "").trim();
            if (!key || !lbl) continue;
            // Register every key variant the API might emit so the
            // path produced by the API (`<pkg>.<rawKey>`) resolves to
            // the admin label regardless of whether the snapshot key
            // had a `pkg__` / `pkg_` prefix.
            const variants = [`${pkg}.${key}`, `${pkg}.${pkg}__${key}`, `${pkg}.${pkg}_${key}`];
            const so = Number(row?.sortOrder);
            const order = Number.isFinite(so) ? so : 0;
            for (const v of variants) {
              fLabels[v] = lbl;
              fOrders[v] = order;
            }
            // Catalog uses the canonical "bare" path; the picker
            // displays this and the API will accept any registered
            // variant when extracting the value at render time.
            pkgEntries.push({ path: `${pkg}.${key}`, label: lbl, sortOrder: order });
          }
          if (pkgEntries.length > 0) {
            pkgEntries.sort((a, b) => {
              if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
              return a.label.localeCompare(b.label);
            });
            catalog.set(pkg, pkgEntries);
          }
        }
        setPackageLabels(pLabels);
        setPackageOrder(pOrder);
        setFieldLabels(fLabels);
        setFieldSortOrders(fOrders);
        setAdminFieldCatalog(catalog);
      });
    return () => { cancelled = true; };
  }, []);

  const humanizeKey = React.useCallback((raw: string): string => {
    let stripped = raw.replace(/^[a-zA-Z0-9]+__/, "").replace(/^_+/, "");
    stripped = stripped.replace(/__+/g, " ").replace(/_+/g, " ");
    stripped = stripped.replace(/([a-z])([A-Z])/g, "$1 $2");
    return stripped.replace(/\b\w/g, (c) => c.toUpperCase()).trim() || raw;
  }, []);

  const getFieldLabel = React.useCallback((path: string): string => {
    // Synthetic fields (`insured.displayName`, `contactinfo.fullAddress`,
    // …) come from the shared catalog and are NOT in form_options.
    const dot = path.indexOf(".");
    if (dot > 0) {
      const src = path.slice(0, dot);
      const key = path.slice(dot + 1);
      const synth = SYNTHETIC_FIELDS_BY_SOURCE[src]?.find((f) => f.fieldKey === key);
      if (synth) return synth.label;
    }
    if (fieldLabels[path]) return fieldLabels[path];
    const raw = dot >= 0 ? path.slice(dot + 1) : path;
    return humanizeKey(raw);
  }, [fieldLabels, humanizeKey]);

  // Picker source: synthetic fields (resolved by the field-resolver,
  // mirrors the PDF Mail-Merge "Add Section" picker) PLUS the
  // admin-configured catalog PLUS any legacy keys discovered in
  // loaded rows. Grouped by package; synthetic fields get an `auto`
  // flag so the UI can render the green "Auto" badge.
  type PickerField = { path: string; label: string; auto?: boolean };
  const availableFieldOptions = React.useMemo(() => {
    const grouped = new Map<string, PickerField[]>();
    const knownPaths = new Set<string>();

    // 1. Synthetic fields per source — same source the PDF
    //    Mail-Merge picker uses (`lib/pdf/synthetic-fields.ts`).
    //    These resolve via the field-resolver and the API
    //    pre-populates their values into `extraFields[<src>.<key>]`.
    const SYNTH_ORDER = ["insured", "contactinfo", "organisation", "client"];
    for (const src of SYNTH_ORDER) {
      const synth = SYNTHETIC_FIELDS_BY_SOURCE[src];
      if (!synth || synth.length === 0) continue;
      const list: PickerField[] = synth.map((f) => ({
        path: `${src}.${f.fieldKey}`,
        label: f.label,
        auto: true,
      }));
      grouped.set(src, list);
      for (const item of list) knownPaths.add(item.path);
    }

    // 2. Admin-configured fields per package. Filter out keys
    //    already covered by a synthetic Auto field for the same
    //    source, so the picker isn't cluttered with `lastName` /
    //    `firstName` rows when "Display Name" is right above them.
    for (const pkg of packageOrder) {
      const entries = adminFieldCatalog.get(pkg);
      if (!entries || entries.length === 0) continue;
      const filtered = entries
        .filter((e) => {
          const bare = e.path.split(".").slice(1).join(".");
          return !isHandledByDefault(pkg, bare);
        })
        .map((e) => ({ path: e.path, label: e.label }));
      if (filtered.length === 0) continue;
      const existing = grouped.get(pkg) ?? [];
      grouped.set(pkg, [...existing, ...filtered]);
      for (const item of filtered) knownPaths.add(item.path);
    }
    // Tack on any package not yet in packageOrder (race during first render).
    for (const [pkg, entries] of adminFieldCatalog) {
      if (packageOrder.includes(pkg)) continue;
      const filtered = entries
        .filter((e) => {
          const bare = e.path.split(".").slice(1).join(".");
          return !isHandledByDefault(pkg, bare);
        })
        .map((e) => ({ path: e.path, label: e.label }));
      if (filtered.length === 0) continue;
      const existing = grouped.get(pkg) ?? [];
      grouped.set(pkg, [...existing, ...filtered]);
      for (const item of filtered) knownPaths.add(item.path);
    }

    // 3. Append legacy / unregistered keys present in loaded rows
    //    so the picker doesn't silently omit a snapshot value the
    //    admin hasn't yet indexed in form_options.
    for (const r of rows) {
      for (const path of Object.keys(r.extraFields ?? {})) {
        if (fieldLabels[path]) continue;
        if (knownPaths.has(path)) continue;
        const dot = path.indexOf(".");
        const pkg = dot >= 0 ? path.slice(0, dot) : "other";
        if (!grouped.has(pkg)) grouped.set(pkg, []);
        grouped.get(pkg)!.push({ path, label: getFieldLabel(path) });
        knownPaths.add(path);
      }
    }
    return grouped;
  }, [rows, fieldLabels, getFieldLabel, packageOrder, adminFieldCatalog]);

  const visibleRows = React.useMemo(() => {
    let filtered = rows;
    // Apply persistent hidden-status setting (from the settings panel).
    if (settings.hiddenStatuses.length > 0) {
      filtered = filtered.filter((r) =>
        !settings.hiddenStatuses.includes((r.status ?? "").trim() || "quotation_prepared"),
      );
    }
    // Apply session status-chip filter.
    if (statusFilter.size > 0) {
      filtered = filtered.filter((r) =>
        statusFilter.has((r.status ?? "").trim() || "quotation_prepared"),
      );
    }
    // Narrow to the day or month the user is looking at, unless
    // "Show all months" is active.
    if (selectedDay) {
      filtered = filtered.filter((r) =>
        isSameLocalDay(new Date(r.date), selectedDay),
      );
    } else if (!showAllMonths) {
      filtered = filtered.filter((r) => isInActiveMonth(r.date));
    }
    return filtered;
  }, [rows, selectedDay, isInActiveMonth, statusFilter, settings.hiddenStatuses, showAllMonths]);

  const visibleBuckets = React.useMemo(() => {
    const grouped: Record<BucketKey, ExpiringRow[]> = {
      overdue_incomplete: [],
      in_progress: [],
      expired: [],
      week: [],
      month: [],
      later: [],
    };
    for (const r of visibleRows) grouped[bucketForRow(r)].push(r);
    return BUCKET_DEFS.map((def) => ({ ...def, rows: grouped[def.key] }));
  }, [visibleRows]);

  const monthDisplay = activeMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Modifiers feed react-day-picker so each bucket gets its own dot
  // colour on the calendar grid. When a status filter is active we
  // restrict dots to the filtered subset — otherwise the calendar
  // would still light up days that the list is hiding, which is
  // visually confusing.
  const modifiers = React.useMemo(() => {
    const out: Record<BucketKey, Date[]> = {
      overdue_incomplete: [],
      in_progress: [],
      expired: [],
      week: [],
      month: [],
      later: [],
    };
    const sourceRows = statusFilter.size > 0
      ? rows.filter((r) =>
          statusFilter.has((r.status ?? "").trim() || "quotation_prepared"),
        )
      : rows;
    for (const r of sourceRows) {
      const key = bucketForRow(r);
      out[key].push(new Date(r.date));
    }
    return out;
  }, [rows, statusFilter]);

  // Map ISO date string (YYYY-MM-DD) → rows that plot on that day.
  // Used by the custom DayButton to build the hover tooltip showing
  // insured names / policy numbers for each day's events.
  const dayToRows = React.useMemo(() => {
    const map = new Map<string, ExpiringRow[]>();
    for (const r of rows) {
      const d = new Date(r.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [rows]);

  const handleRemind = React.useCallback(
    (row: ExpiringRow) => {
      deliver({
        channel: "email",
        policyId: row.policyId,
        policyNumber: row.policyNumber,
        groups: [],
      });
    },
    [deliver],
  );

  // Build the chip list for the status filter.
  // Show ALL statuses from form_options.policy_statuses in admin-
  // defined sort order — not just ones present in the current window.
  // Counts from the loaded rows are shown in parentheses; statuses
  // with 0 matches are shown dimmed so the user can still click them
  // (useful when navigating to a month where those statuses appear).
  // Statuses in the data but absent from form_options (legacy values)
  // are appended at the end.
  const statusFilterChips = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = (r.status ?? "").trim() || "quotation_prepared";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // Statuses the user persistently hid via the settings panel
    // must NOT appear in the chip row either — otherwise the picker
    // looks broken ("I unchecked it but it's still here").
    const hidden = new Set(settings.hiddenStatuses);

    const seen = new Set<string>();
    const result: { value: string; label: string; color: string; count: number }[] = [];

    for (const opt of statusOptions) {
      if (hidden.has(opt.value)) {
        seen.add(opt.value);
        continue;
      }
      result.push({
        value: opt.value,
        label: opt.label,
        color: opt.color,
        count: counts.get(opt.value) ?? 0,
      });
      seen.add(opt.value);
    }

    // Append any legacy status values present in the data that are
    // not yet in form_options (e.g. old import values), but still
    // respect the persistent hide list.
    for (const [value, count] of counts) {
      if (seen.has(value) || hidden.has(value)) continue;
      result.push({
        value,
        label: getStatusLabel(value),
        color: getStatusColor(value),
        count,
      });
    }

    return result;
  }, [rows, statusOptions, getStatusLabel, getStatusColor, settings.hiddenStatuses]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
          {/*
            "Policy Calendar" — covers BOTH in-progress workflow
            reminders (incomplete bucket, plotted at start date) AND
            renewal reminders (issued policies, plotted at end date).
            The previous "Policy Renewals" name only described half
            of the surface and confused the user.
          */}
          <CardTitle>Policy Calendar</CardTitle>
          {totalCount > 0 ? (
            <Badge variant="secondary" className="ml-1">
              {totalCount}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {selectedDay ? (
            <Button size="sm" variant="ghost" onClick={() => setSelectedDay(undefined)}>
              Clear day filter
            </Button>
          ) : null}
          {statusFilter.size > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setStatusFilter(new Set())}
              title="Clear all status filters"
            >
              Clear status ({statusFilter.size})
            </Button>
          ) : null}
          {/* ── Settings panel ───────────────────────────────────── */}
          {/*
            Draft → Save pattern: the user edits `draftSettings`
            inside the panel; nothing applies to the calendar until
            Save is clicked. Cancel (or closing the panel without
            Save) discards. This avoids the "I unchecked something
            and now my list is gone but I never confirmed" feeling
            users get when changes auto-apply.
          */}
          <DropdownMenu
            open={settingsOpen}
            onOpenChange={(o) => { if (o) openSettings(); else cancelSettings(); }}
          >
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" title="Calendar settings">
                <Settings2 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-96 max-h-[80vh] overflow-y-auto p-0"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {/* Scrollable body */}
              <div className="max-h-[60vh] overflow-y-auto pb-2">
                {/* ── Section 1: which statuses to include ─────────── */}
                <DropdownMenuLabel className="sticky top-0 z-10 bg-popover text-xs font-semibold uppercase tracking-wide text-neutral-500 border-b">
                  Show statuses
                  <span className="ml-1 font-normal normal-case text-neutral-400">
                    (uncheck to hide)
                  </span>
                </DropdownMenuLabel>
                <div className="px-2 py-1 space-y-0.5">
                  {statusOptions.map((opt) => {
                    const hidden = draftSettings.hiddenStatuses.includes(opt.value);
                    return (
                      <button
                        type="button"
                        key={opt.value}
                        onClick={() => toggleDraftHiddenStatus(opt.value)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <span
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            hidden
                              ? "border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-900"
                              : "border-blue-500 bg-blue-500",
                          )}
                        >
                          {!hidden && <Check className="h-3 w-3 text-white" />}
                        </span>
                        <span className={cn("flex-1 truncate", hidden && "opacity-40 line-through")}>
                          {opt.label}
                        </span>
                      </button>
                    );
                  })}
                  {draftSettings.hiddenStatuses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDraftSettings({ ...draftSettings, hiddenStatuses: [] })}
                      className="w-full text-center text-[11px] text-blue-600 dark:text-blue-400 py-1 hover:underline"
                    >
                      Show all statuses
                    </button>
                  )}
                </div>

                {/* ── Section 2: extra fields to show in each row ───── */}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="sticky top-0 z-10 bg-popover text-xs font-semibold uppercase tracking-wide text-neutral-500 border-b">
                  Extra fields per row
                  <span className="ml-1 font-normal normal-case text-neutral-400">
                    (pick up to 3 · {draftSettings.visibleFields.length}/3)
                  </span>
                </DropdownMenuLabel>
                <div className="px-2 py-1 space-y-0.5">
                  {availableFieldOptions.size === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-neutral-400">
                      Loading admin-configured fields…
                    </p>
                  ) : (
                    Array.from(availableFieldOptions.entries()).map(([pkg, fields]) => {
                      // Synthetic-only sources (e.g. `client`) may
                      // not have a row in `form_options.packages` —
                      // fall back to a humanized package label.
                      const pkgLabel = packageLabels[pkg]
                        ?? (pkg === "client" ? "Client"
                          : pkg === "organisation" ? "Organisation / Insurer"
                          : pkg === "contactinfo" ? "Contact Info"
                          : pkg === "insured" ? "Insured"
                          : humanizeKey(pkg));
                      return (
                        <div key={pkg}>
                          <p className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                            {pkgLabel}
                          </p>
                          {fields.map(({ path, label, auto }) => {
                            const selected = draftSettings.visibleFields.includes(path);
                            const maxed = !selected && draftSettings.visibleFields.length >= 3;
                            return (
                              <button
                                type="button"
                                key={path}
                                disabled={maxed}
                                onClick={() => toggleDraftVisibleField(path)}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                                  maxed
                                    ? "opacity-30 cursor-not-allowed"
                                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800",
                                )}
                                title={
                                  maxed
                                    ? "Limit reached — uncheck a field first"
                                    : auto
                                      ? `${label} — auto-resolved (matches PDF Mail-Merge)`
                                      : label
                                }
                              >
                                <span
                                  className={cn(
                                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                    selected
                                      ? "border-blue-500 bg-blue-500"
                                      : "border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-900",
                                  )}
                                >
                                  {selected && <Check className="h-3 w-3 text-white" />}
                                </span>
                                <span className="flex-1 truncate text-[12px]">{label}</span>
                                {auto ? (
                                  <span
                                    className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                    title="Auto-resolved by the field resolver"
                                  >
                                    Auto
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                  {draftSettings.visibleFields.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDraftSettings({ ...draftSettings, visibleFields: [] })}
                      className="w-full text-center text-[11px] text-blue-600 dark:text-blue-400 py-1 hover:underline"
                    >
                      Clear extra fields
                    </button>
                  )}
                </div>
              </div>

              {/* ── Footer: Save / Cancel ─────────────────────────── */}
              <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-popover px-3 py-2">
                <span className="text-[11px] text-neutral-500">
                  {draftDirty ? "Unsaved changes" : "No changes"}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={cancelSettings}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveSettingsNow}
                    disabled={!draftDirty}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent>
        {/*
          Always render the calendar — even when there are zero
          expiring policies in the window. Per the user's spec the
          calendar IS the dashboard surface, not a "show only when
          there's something to show" widget. Loading and error states
          replace it briefly; otherwise the calendar is permanent and
          the list section below carries the empty / populated state.
        */}
        {loading ? (
          <div className="space-y-4">
            <div className="h-112 w-full rounded-md bg-neutral-100 dark:bg-neutral-900" />
            <div className="grid gap-2 md:grid-cols-2">
              <div className="h-12 rounded-md bg-neutral-100 dark:bg-neutral-900" />
              <div className="h-12 rounded-md bg-neutral-100 dark:bg-neutral-900" />
            </div>
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Couldn&apos;t load renewals</div>
              <div className="text-xs opacity-80">{error}</div>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/*
              Big calendar — full width, large day cells. The shadcn
              Calendar accepts a `classNames` prop that deep-merges
              with our defaults in `components/ui/calendar.tsx`, so we
              can scale individual UI slots (day, day_button, weekday,
              month_caption) without forking the primitive. Sizes step
              up at sm: and md: so phones stay tappable but desktops
              get a true "big" calendar feel.
            */}
            <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
              <Calendar
                mode="single"
                selected={selectedDay}
                onSelect={setSelectedDay}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                modifiers={modifiers}
                components={{
                  DayButton: ({ day, modifiers: _m, className, ...props }) => {
                    const d = day.date;
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    const dayRows = dayToRows.get(key) ?? [];
                    // Show only the user's pinned extra field values
                    // (e.g. registration number) — one per policy.
                    // Falls back to policy number if no extra fields
                    // have been selected yet in Settings.
                    const tooltip = dayRows.length
                      ? dayRows
                          .map((r) => {
                            const vals = settings.visibleFields
                              .map((path) => {
                                const dot = path.indexOf(".");
                                const pkg = dot >= 0 ? path.slice(0, dot) : "";
                                const key2 = dot >= 0 ? path.slice(dot + 1) : path;
                                const candidates = pkg
                                  ? [path, `${pkg}.${pkg}__${key2}`, `${pkg}.${pkg}_${key2}`]
                                  : [path];
                                for (const c of candidates) {
                                  if (r.extraFields?.[c]) return r.extraFields[c];
                                }
                                return null;
                              })
                              .filter(Boolean);
                            return vals.length
                              ? vals.join(" · ")
                              : r.insuredName.trim() || r.policyNumber;
                          })
                          .join("\n")
                      : undefined;
                    return (
                      <button
                        {...props}
                        className={className}
                        title={tooltip}
                      />
                    );
                  },
                }}
                formatters={{
                  formatCaption: (date) =>
                    date.toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    }),
                }}
                className="mx-auto p-2 sm:p-4"
                classNames={{
                  months: "flex flex-col items-center gap-4",
                  month: "space-y-3 sm:space-y-4 w-full",
                  month_caption:
                    "flex justify-center pt-1 pb-2 relative items-center text-base sm:text-lg font-semibold text-neutral-900 dark:text-neutral-100",
                  caption_label: "text-base sm:text-lg font-semibold",
                  nav: "flex items-center gap-1",
                  button_previous:
                    "absolute left-2 top-1 size-9 flex items-center justify-center rounded-md bg-transparent text-neutral-600 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 opacity-70 hover:opacity-100 outline-none focus:outline-none focus-visible:outline-none",
                  button_next:
                    "absolute right-2 top-1 size-9 flex items-center justify-center rounded-md bg-transparent text-neutral-600 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 opacity-70 hover:opacity-100 outline-none focus:outline-none focus-visible:outline-none",
                  month_grid: "w-full border-collapse",
                  weekdays: "flex w-full",
                  weekday:
                    "flex-1 text-neutral-500 dark:text-neutral-400 font-medium text-[11px] sm:text-xs uppercase tracking-wide pb-2",
                  week: "flex w-full mt-1",
                  day: cn(
                    "relative flex-1 aspect-square p-0 text-center text-sm focus-within:relative focus-within:z-20",
                    "[&:has([aria-selected])]:bg-blue-50 dark:[&:has([aria-selected])]:bg-blue-950/30",
                    "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
                  ),
                  day_button:
                    "h-full w-full p-0 inline-flex items-center justify-center text-sm sm:text-base font-medium rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 aria-selected:opacity-100 transition-colors",
                  selected:
                    "bg-blue-600 text-white hover:bg-blue-600 hover:text-white focus:bg-blue-600 focus:text-white dark:bg-blue-500 dark:text-white",
                  today:
                    "outline outline-2 outline-blue-500 dark:outline-blue-400 font-bold rounded-md",
                  outside:
                    "text-neutral-400 dark:text-neutral-600 opacity-60",
                  disabled: "text-neutral-300 dark:text-neutral-700 opacity-50",
                  hidden: "invisible",
                }}
                modifiersClassNames={{
                  overdue_incomplete:
                    "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-2 after:w-2 after:rounded-full after:bg-red-500 dark:after:bg-red-400",
                  in_progress:
                    "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-2 after:w-2 after:rounded-full after:bg-blue-500 dark:after:bg-blue-400",
                  expired:
                    "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-2 after:w-2 after:rounded-full after:bg-orange-500 dark:after:bg-orange-400",
                  week:
                    "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-2 after:w-2 after:rounded-full after:bg-amber-500 dark:after:bg-amber-400",
                  month:
                    "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-2 after:w-2 after:rounded-full after:bg-yellow-500 dark:after:bg-yellow-400",
                  later:
                    "relative after:content-[''] after:absolute after:bottom-1 after:left-1/2 after:-translate-x-1/2 after:h-2 after:w-2 after:rounded-full after:bg-slate-400 dark:after:bg-slate-500",
                }}
              />
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-neutral-200 px-3 py-2 text-[11px] text-neutral-600 dark:border-neutral-800 dark:text-neutral-400 sm:text-xs">
                {BUCKET_DEFS.map((b) => (
                  <span key={b.key} className="flex items-center gap-1.5">
                    <span className={cn("inline-block h-2.5 w-2.5 rounded-full", b.dotClass)} />
                    {b.label}
                  </span>
                ))}
              </div>
            </div>

            {/*
              Status filter chips — admin-configurable list from
              `form_options.policy_statuses` via `usePolicyStatuses`
              (per the dynamic-config-first skill — no hardcoded
              status list lives here). Click to toggle. Multi-select.
              Counts in parentheses are computed against the FULL
              dataset, not the visible month, so the user can see at
              a glance how many in each status exist anywhere in the
              window.
            */}
            {statusFilterChips.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 px-1">
                <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                  Filter by status:
                </span>
                {statusFilterChips.map((chip) => {
                  const active = statusFilter.has(chip.value);
                  const hasData = chip.count > 0;
                  return (
                    <button
                      type="button"
                      key={chip.value}
                      onClick={() => toggleStatusFilter(chip.value)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all",
                        active
                          ? `${chip.color} ring-2 ring-offset-1 ring-blue-500 dark:ring-blue-400 dark:ring-offset-neutral-900`
                          : hasData
                            ? `${chip.color} opacity-70 hover:opacity-100`
                            : `${chip.color} opacity-30 hover:opacity-50`,
                      )}
                      title={
                        active
                          ? `Click to remove "${chip.label}" filter`
                          : hasData
                            ? `Filter to ${chip.count} "${chip.label}" polic${chip.count === 1 ? "y" : "ies"}`
                            : `No "${chip.label}" policies in the current window`
                      }
                    >
                      {chip.label}
                      {hasData ? (
                        <span className="opacity-60">({chip.count})</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="space-y-4">
              {/*
                Scope indicator. The list below is filtered to the
                visible calendar month (or the clicked day) — so the
                dashboard isn't a duplicate of the policies page.
                Per the user's spec: "June policy in June, not
                showing all".
              */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                <div>
                  {selectedDay ? (
                    <>
                      Showing {visibleRows.length} polic
                      {visibleRows.length === 1 ? "y" : "ies"} on{" "}
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">
                        {selectedDay.toLocaleDateString("en-US", {
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })}
                      </span>
                      .
                    </>
                  ) : showAllMonths ? (
                    <>
                      Showing all {visibleRows.length} polic
                      {visibleRows.length === 1 ? "y" : "ies"}.
                    </>
                  ) : (
                    <>
                      Showing {visibleRows.length} polic
                      {visibleRows.length === 1 ? "y" : "ies"} in{" "}
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">
                        {monthDisplay}
                      </span>
                      {totalCount > visibleRows.length ? (
                        <> of {totalCount} total</>
                      ) : null}.
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedDay ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedDay(undefined)}
                      className="h-6 text-xs"
                    >
                      Show whole month
                    </Button>
                  ) : null}
                  {!selectedDay && totalCount > 0 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowAllMonths((v) => !v)}
                      className="h-6 text-xs"
                    >
                      {showAllMonths ? "Show by month" : `Show all ${totalCount}`}
                    </Button>
                  ) : null}
                </div>
              </div>

              {totalCount === 0 ? (
                <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                  No incomplete policies or upcoming renewals between{" "}
                  {monthLabel(lookbackDays)} ago and {monthLabel(lookaheadDays)} from today.
                </div>
              ) : visibleBuckets.every((b) => b.rows.length === 0) ? (
                <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
                  {selectedDay
                    ? "Nothing on this day."
                    : `Nothing in ${monthDisplay}. Use the arrows above to navigate to another month, or click the dot on the calendar to jump to a specific day.`}
                </div>
              ) : (
                visibleBuckets.map((bucket) =>
                  bucket.rows.length === 0 ? null : (
                    <BucketSection
                      key={bucket.key}
                      bucket={bucket}
                      canTakeWriteActions={canTakeWriteActions}
                      onRemind={handleRemind}
                      getStatusLabel={getStatusLabel}
                      getStatusColor={getStatusColor}
                      visibleFields={settings.visibleFields}
                      getFieldLabel={getFieldLabel}
                    />
                  ),
                )
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Number of rows shown per bucket before the "Show all" toggle
 * appears. Tenants who run a lot of imports can easily have 50+
 * "quotation prepared" entries — without a cap the dashboard list
 * scrolls forever and looks like a render loop. 8 is enough to see
 * the most pressing items at a glance; the rest are one click away.
 */
const BUCKET_PREVIEW_LIMIT = 8;

function BucketSection({
  bucket,
  canTakeWriteActions,
  onRemind,
  getStatusLabel,
  getStatusColor,
  visibleFields,
  getFieldLabel,
}: {
  bucket: Bucket;
  canTakeWriteActions: boolean;
  onRemind: (row: ExpiringRow) => void;
  getStatusLabel: (value: string) => string;
  getStatusColor: (value: string) => string;
  visibleFields: string[];
  getFieldLabel: (path: string) => string;
}) {
  const [expanded, setExpanded] = React.useState<boolean>(false);

  // Sort within the bucket so the most "actionable" rows surface
  // first: those with a real insured name, then those whose action
  // date is closest to today. Without this, named policies get
  // buried under dozens of unnamed import / endorsement records.
  const sortedRows = React.useMemo(() => {
    const copy = [...bucket.rows];
    copy.sort((a, b) => {
      const aHasName = a.insuredName.trim() !== "";
      const bHasName = b.insuredName.trim() !== "";
      if (aHasName !== bHasName) return aHasName ? -1 : 1;
      return Math.abs(a.daysFromToday) - Math.abs(b.daysFromToday);
    });
    return copy;
  }, [bucket.rows]);

  const overLimit = sortedRows.length > BUCKET_PREVIEW_LIMIT;
  const visibleRows = expanded || !overLimit
    ? sortedRows
    : sortedRows.slice(0, BUCKET_PREVIEW_LIMIT);
  const hiddenCount = sortedRows.length - visibleRows.length;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", bucket.dotClass)} />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {bucket.label}
          </h3>
          <Badge variant="secondary" className="text-[10px]">
            {bucket.rows.length}
          </Badge>
        </div>
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
          {bucket.description}
        </span>
      </div>
      <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {visibleRows.map((row) => (
          <ExpiringRowItem
            key={row.policyId}
            row={row}
            bucketKey={bucket.key}
            badgeClass={bucket.badgeClass}
            canTakeWriteActions={canTakeWriteActions}
            onRemind={onRemind}
            getStatusLabel={getStatusLabel}
            getStatusColor={getStatusColor}
            visibleFields={visibleFields}
            getFieldLabel={getFieldLabel}
          />
        ))}
      </ul>
      {overLimit ? (
        <div className="mt-2 flex justify-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-neutral-600 dark:text-neutral-400"
          >
            {expanded
              ? `Show less`
              : `Show all ${sortedRows.length} (${hiddenCount} more)`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ExpiringRowItem({
  row,
  bucketKey,
  badgeClass,
  canTakeWriteActions,
  onRemind,
  getStatusLabel,
  getStatusColor,
  visibleFields,
  getFieldLabel,
}: {
  row: ExpiringRow;
  bucketKey: BucketKey;
  badgeClass: string;
  canTakeWriteActions: boolean;
  onRemind: (row: ExpiringRow) => void;
  getStatusLabel: (value: string) => string;
  getStatusColor: (value: string) => string;
  visibleFields: string[];
  getFieldLabel: (path: string) => string;
}) {
  const statusValue = row.status?.trim() || "quotation_prepared";
  const statusLabel = getStatusLabel(statusValue);
  const statusColor = getStatusColor(statusValue);
  const hasName = row.insuredName.trim() !== "";

  // Resolve user-chosen extra fields from the snapshot. The picker
  // stores the canonical bare path (`policyinfo.startedDate`) but
  // the API may emit prefixed variants (`policyinfo.policyinfo__startedDate`,
  // `policyinfo.policyinfo_startedDate`); try all three so picking
  // an admin-catalog field always finds the value regardless of
  // which naming convention the source snapshot used.
  const extraFieldValues = visibleFields
    .map((path) => {
      const dot = path.indexOf(".");
      const pkg = dot >= 0 ? path.slice(0, dot) : "";
      const key = dot >= 0 ? path.slice(dot + 1) : path;
      const candidates = pkg
        ? [path, `${pkg}.${pkg}__${key}`, `${pkg}.${pkg}_${key}`]
        : [path];
      let val: string | undefined;
      for (const c of candidates) {
        if (row.extraFields?.[c]) { val = row.extraFields[c]; break; }
      }
      if (!val) return null;
      return { label: getFieldLabel(path), val };
    })
    .filter((x): x is { label: string; val: string } => x !== null);

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              hasName
                ? "text-neutral-900 dark:text-neutral-100"
                : "text-neutral-500 dark:text-neutral-400 font-mono text-xs",
            )}
            title={row.insuredName || row.policyNumber}
          >
            {hasName ? row.insuredName : row.policyNumber}
            {/* Extra fields the user pinned via Settings appear
                inline after the name with a · separator, same
                font weight and size so the row reads as one line. */}
            {extraFieldValues.map(({ label, val }) => (
              <span
                key={label}
                className="text-neutral-400 dark:text-neutral-500"
                title={label}
              >
                {" · "}
                <span className={cn(
                  hasName
                    ? "text-neutral-900 dark:text-neutral-100"
                    : "text-neutral-500 dark:text-neutral-400",
                )}>
                  {val}
                </span>
              </span>
            ))}
          </span>
          {hasName ? (
            <Badge variant="outline" className="truncate max-w-[160px] text-[10px]" title={row.policyNumber}>
              {row.policyNumber}
            </Badge>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium truncate max-w-[160px]",
              statusColor,
            )}
            title={statusLabel}
          >
            {statusLabel}
          </span>
          {!row.isActive ? (
            <Badge variant="secondary" className="text-[10px]">
              Inactive
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          {row.kind === "incomplete" ? (
            <>
              <span>Starts {row.dateDisplay}</span>
              {row.endDateDisplay ? (
                <span className="text-neutral-400 dark:text-neutral-500">
                  · Term ends {row.endDateDisplay}
                </span>
              ) : null}
            </>
          ) : (
            <span>Expires {row.dateDisplay}</span>
          )}
          {/* Relative badge — only shown when it adds urgency info.
              "In Progress" rows (invoice sent, payment received, etc.)
              don't show a date badge because they are NOT overdue;
              showing "10 days ago" there was misleading the user into
              thinking their perfectly-normal invoice workflow was late. */}
          {bucketKey !== "in_progress" && (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                badgeClass,
              )}
            >
              {bucketKey === "overdue_incomplete"
                ? row.daysFromToday < 0
                  ? `Overdue ${Math.abs(row.daysFromToday)}d`
                  : row.daysFromToday === 0
                    ? "Starts today"
                    : "Starts tomorrow"
                : relativeLabel(row.daysFromToday)}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {/*
          Two distinct actions per row:
            1. Open  — pop the policy detail drawer (uses the
               existing `?policyId=N` deep-link convention from
               `lib/reminder-sender.ts` /
               `app/api/policies/[id]/send/route.ts`).
               PoliciesTableClient auto-opens the drawer.
            2. Email — opens the document-delivery dialog with the
               policy already attached (per the document-delivery
               skill / `lib/document-delivery/delivery-context.tsx`).
               User picks PDF templates + recipient + sends.

          The previous "Process" button was a duplicate of Open
          (same destination), and "Renew" was redundant — the user
          can start a renewal from the drawer's Workflow tab, no
          need for a separate dashboard button. Removed both.
        */}
        <Button asChild size="sm" variant="outline" title="Open policy">
          <Link href={openPolicyHref(row)}>
            <ExternalLink className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Open</span>
          </Link>
        </Button>
        {canTakeWriteActions ? (
          <Button
            size="sm"
            variant="secondary"
            title={
              row.kind === "incomplete"
                ? "Email a follow-up to chase this policy"
                : "Email a renewal reminder"
            }
            onClick={() => onRemind(row)}
          >
            <Mail className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Email</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
