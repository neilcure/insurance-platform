"use client";

/**
 * `<OnlineUsersWidget />` — topbar widget that shows who else (in the
 * viewer's active organisation) is currently online.
 *
 * Reads from `PresenceContext` (no self-polling). Mount it INSIDE a
 * `<PresenceProvider />` — the provider owns the heartbeat + the
 * single shared `/api/presence/online` poll loop, so this widget and
 * `<PolicyPresenceBanner />` always render the same snapshot.
 *
 * Rendering rules
 * ---------------
 * - Always shows a small "online" pill: avatar stack OR users icon
 *   plus the count of OTHER users online.
 * - Click the pill → dropdown listing everyone (including self) with
 *   initials avatar, name, "you" badge for self, role + time ago.
 * - At zero others online the dropdown shows "(just you)" so the
 *   user can confirm the widget is healthy.
 *
 * Privacy
 * -------
 * The provider's underlying API call only returns users in the
 * viewer's active organisation, so cross-tenant leak is impossible
 * regardless of what we render here.
 */

import * as React from "react";
import { Users2 } from "lucide-react";
import { useOnlineUsers, type OnlineUser } from "@/lib/presence/presence-context";

const MAX_AVATARS = 4;

function initialsFor(u: Pick<OnlineUser, "name" | "email">): string {
  const source = (u.name?.trim() || u.email || "?").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Deterministic background per user id so two users always get the
// same color across sessions. Picked from a palette with enough
// contrast on both light and dark backgrounds.
const AVATAR_BG = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-sky-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-fuchsia-500",
  "bg-pink-500",
];
function bgFor(id: number): string {
  const safe = Math.abs(Number.isFinite(id) ? id : 0);
  return AVATAR_BG[safe % AVATAR_BG.length];
}

function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function Avatar({
  user,
  size = "md",
}: {
  user: OnlineUser;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-7 w-7 text-xs";
  return (
    <span
      className={[
        "relative inline-flex items-center justify-center rounded-full font-semibold text-white shadow-sm ring-2 ring-white dark:ring-neutral-900",
        bgFor(user.id),
        dim,
      ].join(" ")}
      title={user.name || user.email}
    >
      {initialsFor(user)}
      <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-neutral-900" />
    </span>
  );
}

export function OnlineUsersWidget() {
  const data = useOnlineUsers();
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Show the trigger even at count=0 once we've received a response,
  // so the user can confirm the widget is working ("just you online").
  if (!data) return null;

  const others = data.users.filter((u) => !u.isSelf).slice(0, MAX_AVATARS);
  const overflow = Math.max(0, data.count - others.length);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700 shadow-sm hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
        aria-label={`${data.count} other users online`}
        title={`${data.count} other user${data.count === 1 ? "" : "s"} online`}
      >
        {others.length > 0 ? (
          <span className="-space-x-1.5 flex items-center">
            {others.map((u) => (
              <Avatar key={u.id} user={u} size="sm" />
            ))}
          </span>
        ) : (
          <Users2 className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
        )}
        <span className="ml-0.5 tabular-nums">
          {data.count > 0 ? `${data.count}${overflow > 0 ? "+" : ""}` : "0"}
        </span>
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
            Online now {data.count > 0 ? `(${data.count} other${data.count === 1 ? "" : "s"})` : "(just you)"}
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {data.users.length === 0 ? (
              <li className="px-3 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                No one online.
              </li>
            ) : (
              data.users.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <Avatar user={u} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate font-medium text-neutral-900 dark:text-neutral-100">
                      <span className="truncate">{u.name || u.email}</span>
                      {u.isSelf ? (
                        <span className="rounded bg-blue-100 px-1 py-0 text-[9px] font-semibold uppercase text-blue-700 dark:bg-blue-900 dark:text-blue-200">
                          You
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-[10px] text-neutral-500 dark:text-neutral-400">
                      {u.userType.replace(/_/g, " ")} · {timeAgo(u.lastSeenAt)}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
