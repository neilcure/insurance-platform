"use client";

/**
 * Reusable picker for selecting one or more "people" from the active
 * organisation. Used by:
 *   - Admin → Announcements (audience = "Specific users")
 *   - …any future surface that needs a "pick people in this org" UI
 *
 * Selection model
 * ---------------
 * The picker is **controlled** with two parallel arrays:
 *   - `value.userIds`   — `users.id` of login accounts
 *   - `value.clientIds` — `clients.id` of master records that don't
 *                         (yet) have a login. Consumers can follow the
 *                         link via `clients.user_id` at delivery time
 *                         (e.g. announcements eligibility), so "select a
 *                         client now, deliver it once they get invited"
 *                         works end-to-end.
 *
 * Lazy-loads members from `/api/admin/organisation-members` (admin /
 * internal_staff scoped). Pass `includeClientsWithoutLogin` to also
 * list `clients` rows whose `userId IS NULL`.
 *
 * Optional UX:
 *   - User-type filter chips at the top (`showUserTypeFilter`, default
 *     true). Toggle one or more types to narrow the list.
 *   - Restrict to a fixed allow-list of `user_type` values via
 *     `allowedUserTypes`.
 *   - "Missing" chips at the bottom for selected ids that didn't come
 *     back in the loaded page (left org / past page cap).
 *
 * Translation keys live in `common.userPicker.*` so callers don't have
 * to plumb labels through every prop.
 */

import * as React from "react";
import { Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useUserTypes } from "@/hooks/use-user-types";

/** Filter chips: secondary vs outline are nearly identical in dark mode — use explicit active styling. */
const USER_TYPE_CHIP_BASE =
  "h-7 shrink-0 px-2.5 text-[11px] font-semibold shadow-none transition-colors";
const USER_TYPE_CHIP_OFF =
  "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-200";
const USER_TYPE_CHIP_ON =
  "border-blue-600 bg-blue-600 text-white hover:bg-blue-700 hover:text-white dark:border-sky-500 dark:bg-sky-600 dark:text-white dark:hover:bg-sky-500";

export type UserPickerMember = {
  kind: "user" | "client";
  /** users.id when kind=="user", else null (client master without a login). */
  id: number | null;
  clientId: number | null;
  email: string;
  name: string | null;
  userType: string;
  userNumber: string | null;
  /** True if this row has a login that can be targeted directly. */
  selectable: boolean;
  /** Status hint surfaced as a small badge / tooltip. */
  reason: "ok" | "placeholder_email" | "no_login";
};

export type UserPickerValue = {
  userIds: number[];
  clientIds: number[];
};

export const EMPTY_USER_PICKER_VALUE: UserPickerValue = { userIds: [], clientIds: [] };

export type UserPickerProps = {
  /** Selected ids (controlled). Both arrays may be empty. */
  value: UserPickerValue;
  /** Called when the selection changes. Always receives sorted arrays. */
  onChange: (next: UserPickerValue) => void;
  /**
   * If true, fetch members on mount. Set to `false` while a parent
   * dialog/section is closed to avoid wasted requests.
   */
  enabled?: boolean;
  /** Restrict the visible list to these user_type values. */
  allowedUserTypes?: string[];
  /** Show the "filter by user type" chip row. Default: `true`. */
  showUserTypeFilter?: boolean;
  /** Override the help line above the search box. */
  helpText?: React.ReactNode;
  /** Maximum height of the scrollable list (Tailwind class). */
  listMaxHeightClassName?: string;
  /** Cap server-side. Defaults to 500. */
  fetchLimit?: number;
  /**
   * If true, also list clients that don't have a login account yet.
   * Their `clientId` is added to `value.clientIds` when checked, so the
   * caller can deliver the action via `clients.user_id` once that
   * client is invited / linked. Default is `false` (login users only).
   */
  includeClientsWithoutLogin?: boolean;
};

export default function UserPicker({
  value,
  onChange,
  enabled = true,
  allowedUserTypes,
  showUserTypeFilter = true,
  helpText,
  listMaxHeightClassName = "max-h-60",
  fetchLimit = 500,
  includeClientsWithoutLogin = false,
}: UserPickerProps) {
  const t = useT();
  const { getLabel: getUserTypeLabel, options: userTypeOptions } = useUserTypes();

  const [members, setMembers] = React.useState<UserPickerMember[]>([]);
  const [orgTotal, setOrgTotal] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ limit: String(fetchLimit) });
    if (includeClientsWithoutLogin) params.set("includeClients", "1");
    void fetch(`/api/admin/organisation-members?${params.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { members: [], total: 0 }))
      .then((data: { members?: UserPickerMember[]; total?: number }) => {
        if (cancelled) return;
        if (Array.isArray(data.members)) setMembers(data.members);
        if (typeof data.total === "number") setOrgTotal(data.total);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, fetchLimit, includeClientsWithoutLogin]);

  const allowedSet = React.useMemo(
    () => (allowedUserTypes && allowedUserTypes.length > 0 ? new Set(allowedUserTypes) : null),
    [allowedUserTypes],
  );

  const visibleMembers = React.useMemo(() => {
    if (!allowedSet) return members;
    return members.filter((m) => allowedSet.has(m.userType));
  }, [members, allowedSet]);

  /**
   * Localized labels for user-type filter chips. Includes synthetic
   * "personal_client" / "company_client" buckets emitted by the API
   * for client-only rows so admins can filter to "people without
   * logins" easily.
   */
  const typeLabelFor = React.useCallback(
    (value: string): string => {
      if (value === "personal_client") {
        return t("common.userPicker.bucketPersonalClient", "Client (no login)");
      }
      if (value === "company_client") {
        return t("common.userPicker.bucketCompanyClient", "Company client (no login)");
      }
      return getUserTypeLabel(value);
    },
    [getUserTypeLabel, t],
  );

  const availableTypeValues = React.useMemo(() => {
    const present = new Set(visibleMembers.map((m) => m.userType));
    const seen = new Set<string>();
    const ordered: { value: string; label: string }[] = [];
    for (const opt of userTypeOptions) {
      if (present.has(opt.value) && !seen.has(opt.value)) {
        seen.add(opt.value);
        ordered.push({ value: opt.value, label: opt.label });
      }
    }
    for (const value of present) {
      if (!seen.has(value)) {
        seen.add(value);
        ordered.push({ value, label: typeLabelFor(value) });
      }
    }
    return ordered;
  }, [visibleMembers, userTypeOptions, typeLabelFor]);

  React.useEffect(() => {
    setTypeFilter((prev) => {
      const allowed = new Set(availableTypeValues.map((o) => o.value));
      const next = new Set([...prev].filter((v) => allowed.has(v)));
      return next.size === prev.size ? prev : next;
    });
  }, [availableTypeValues]);

  const filteredMembers = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleMembers.filter((m) => {
      if (typeFilter.size > 0 && !typeFilter.has(m.userType)) return false;
      if (!q) return true;
      const blob = [
        m.id != null ? String(m.id) : "",
        m.clientId != null ? String(m.clientId) : "",
        m.email,
        m.name ?? "",
        m.userNumber ?? "",
        typeLabelFor(m.userType),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [visibleMembers, search, typeFilter, typeLabelFor]);

  const userIdSet = React.useMemo(() => new Set(value.userIds), [value.userIds]);
  const clientIdSet = React.useMemo(() => new Set(value.clientIds), [value.clientIds]);
  const totalSelected = value.userIds.length + value.clientIds.length;

  const knownUserIds = React.useMemo(() => {
    const set = new Set<number>();
    for (const m of visibleMembers) if (m.kind === "user" && m.id != null) set.add(m.id);
    return set;
  }, [visibleMembers]);

  const knownClientIds = React.useMemo(() => {
    const set = new Set<number>();
    for (const m of visibleMembers) if (m.kind === "client" && m.clientId != null) set.add(m.clientId);
    return set;
  }, [visibleMembers]);

  /**
   * Selected ids that we don't have a row for in the loaded list — they
   * stay targeted but the admin can drop them via the chip row.
   */
  const missingUserIds = React.useMemo(
    () => value.userIds.filter((id) => !knownUserIds.has(id)).sort((a, b) => a - b),
    [value.userIds, knownUserIds],
  );
  const missingClientIds = React.useMemo(
    () => value.clientIds.filter((id) => !knownClientIds.has(id)).sort((a, b) => a - b),
    [value.clientIds, knownClientIds],
  );

  const noLoginCount = React.useMemo(
    () => visibleMembers.filter((m) => m.kind === "client").length,
    [visibleMembers],
  );

  function emit(nextUserIds: Iterable<number>, nextClientIds: Iterable<number>) {
    const userIds = [...new Set(nextUserIds)].sort((a, b) => a - b);
    const clientIds = [...new Set(nextClientIds)].sort((a, b) => a - b);
    onChange({ userIds, clientIds });
  }

  function toggleUser(id: number, checked: boolean) {
    const next = new Set(userIdSet);
    if (checked) next.add(id);
    else next.delete(id);
    emit(next, clientIdSet);
  }

  function toggleClient(clientId: number, checked: boolean) {
    const next = new Set(clientIdSet);
    if (checked) next.add(clientId);
    else next.delete(clientId);
    emit(userIdSet, next);
  }

  function toggleType(value: string, checked: boolean) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  }

  function clearAll() {
    onChange({ userIds: [], clientIds: [] });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          {helpText ?? t("common.userPicker.help", "Tick the users you want to include.")}
        </p>
        {totalSelected > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearAll}>
            {t("common.userPicker.clearSelection", "Clear selection")}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="font-medium text-neutral-700 dark:text-neutral-200">
          {t("common.userPicker.selectedCount", "{count} selected", { count: totalSelected })}
        </p>
        {orgTotal !== null ? (
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {t("common.userPicker.shownCount", "Showing {shown} of {total}", {
              shown: filteredMembers.length,
              total: orgTotal,
            })}
            {noLoginCount > 0
              ? ` · ${t("common.userPicker.noLoginCount", "{count} without login", {
                  count: noLoginCount,
                })}`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-neutral-400" aria-hidden />
        <Input
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("common.userPicker.searchPlaceholder", "Search by name, email, or user number…")}
        />
      </div>

      {showUserTypeFilter && availableTypeValues.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {t("common.userPicker.filterTypeLabel", "Filter by user type")}:
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={typeFilter.size === 0}
            className={cn(
              USER_TYPE_CHIP_BASE,
              typeFilter.size === 0 ? USER_TYPE_CHIP_ON : USER_TYPE_CHIP_OFF,
            )}
            onClick={() => setTypeFilter(new Set())}
          >
            {t("common.userPicker.filterAllTypes", "All types")}
          </Button>
          {availableTypeValues.map((opt) => {
            const active = typeFilter.has(opt.value);
            return (
              <Button
                key={opt.value}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={active}
                className={cn(USER_TYPE_CHIP_BASE, active ? USER_TYPE_CHIP_ON : USER_TYPE_CHIP_OFF)}
                onClick={() => toggleType(opt.value, !active)}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
          {t("common.userPicker.loading", "Loading users…")}
        </div>
      ) : (
        <div
          className={`overflow-y-auto rounded border border-neutral-200 dark:border-neutral-700 ${listMaxHeightClassName}`}
        >
          {filteredMembers.length === 0 ? (
            <p className="px-3 py-3 text-sm text-neutral-400">
              {t("common.userPicker.empty", "No matching users.")}
            </p>
          ) : (
            filteredMembers.map((m) => {
              const isClient = m.kind === "client";
              const rowKey = isClient ? `c:${m.clientId}` : `u:${m.id}`;
              const checked = isClient
                ? m.clientId != null && clientIdSet.has(m.clientId)
                : m.id != null && userIdSet.has(m.id);
              const display = m.name?.trim() || m.email || "";
              const subtitleParts: string[] = [];
              if (m.userNumber) subtitleParts.push(m.userNumber);
              if (m.name?.trim() && m.email) subtitleParts.push(m.email);
              const reasonLabel =
                m.reason === "placeholder_email"
                  ? t("common.userPicker.statusNoEmail", "No email yet")
                  : m.reason === "no_login"
                    ? t("common.userPicker.statusNoLogin", "Pending login")
                    : null;
              return (
                <label
                  key={rowKey}
                  title={
                    isClient
                      ? t(
                          "common.userPicker.clientHint",
                          "This client doesn't have a login yet. The pop-up will appear automatically once they're invited as a user.",
                        )
                      : reasonLabel ?? undefined
                  }
                  className={`flex cursor-pointer items-start gap-3 border-b border-neutral-100 px-3 py-2 text-sm last:border-b-0 dark:border-neutral-800 ${
                    checked
                      ? "bg-blue-50 dark:bg-blue-900/20"
                      : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onChange={(e) => {
                      if (isClient) {
                        if (m.clientId != null) toggleClient(m.clientId, e.target.checked);
                      } else if (m.id != null) {
                        toggleUser(m.id, e.target.checked);
                      }
                    }}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-neutral-900 dark:text-neutral-100 truncate">
                      {display}
                    </span>
                    {subtitleParts.length > 0 ? (
                      <span className="block truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                        {subtitleParts.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {typeLabelFor(m.userType)}
                    </span>
                    {reasonLabel ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        {reasonLabel}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })
          )}
        </div>
      )}

      {missingUserIds.length + missingClientIds.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/80 p-2 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
            {t(
              "common.userPicker.missingTitle",
              "Some selected users are not shown below (left the organisation or beyond the list limit). They stay selected until you remove them or save.",
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missingUserIds.map((id) => (
              <Button
                key={`u:${id}`}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                aria-label={t("common.userPicker.removeOne", "Remove user {id}", { id })}
                onClick={() => toggleUser(id, false)}
              >
                #{id}
                <X className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              </Button>
            ))}
            {missingClientIds.map((id) => (
              <Button
                key={`c:${id}`}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                aria-label={t("common.userPicker.removeOneClient", "Remove client {id}", { id })}
                onClick={() => toggleClient(id, false)}
              >
                C#{id}
                <X className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
