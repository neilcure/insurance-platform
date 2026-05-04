"use client";

/**
 * Presence context — single source of truth for the online/presence
 * feature on every signed-in page.
 *
 * Why a context (instead of letting each consumer fetch on its own)
 * -----------------------------------------------------------------
 * Phase A had `<OnlineUsersWidget />` poll `/api/presence/online`
 * directly. Phase B adds `<PolicyPresenceBanner />` which needs the
 * same data filtered by `resourceKey`. If each component polled
 * independently we'd double the request load and they'd see slightly
 * different snapshots. Lifting state here gives us:
 *
 *   1. ONE heartbeat per page, with the resourceKey current at beat
 *      time (set by `useSetPresenceResource` on policy/wizard pages).
 *   2. ONE poll of `/api/presence/online`, shared by every consumer.
 *   3. A consistent snapshot — the widget count and the banner count
 *      always agree.
 *
 * Public API
 * ----------
 * - `<PresenceProvider />` — mount once near the top of the layout
 *   (after sign-in). Wraps header + page so the resourceKey set by
 *   any child component is visible to consumers in the header.
 * - `useOnlineUsers()` — read the latest `/api/presence/online` snapshot.
 * - `useSetPresenceResource(key)` — push `key` into the context for
 *   the lifetime of the calling component (cleared on unmount).
 * - `useUsersOnResource(key)` — convenience: returns just the users
 *   currently sharing `key` with the viewer.
 */

import * as React from "react";
import { usePresenceHeartbeat } from "@/lib/presence/use-presence-heartbeat";

const POLL_MS = 20_000;

export type OnlineUser = {
  id: number;
  name: string | null;
  email: string;
  userType: string;
  lastSeenAt: string;
  resourceKey: string | null;
  isSelf: boolean;
};

export type OnlineSnapshot = {
  ok: true;
  viewerId: number;
  count: number;
  users: OnlineUser[];
};

type Ctx = {
  resourceKey: string | null;
  setResourceKey: (key: string | null) => void;
  online: OnlineSnapshot | null;
};

const PresenceContext = React.createContext<Ctx | null>(null);

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [resourceKey, setResourceKey] = React.useState<string | null>(null);
  const [online, setOnline] = React.useState<OnlineSnapshot | null>(null);

  // Heartbeat continuously, swapping in whatever resourceKey the
  // active page has set. The hook auto-pauses on hidden tabs.
  usePresenceHeartbeat({ resourceKey });

  // Single poll loop shared by every consumer.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch("/api/presence/online", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as OnlineSnapshot;
        if (!cancelled) setOnline(json);
      } catch {
        // Poll errors are non-fatal — try again next tick.
      }
    };

    void tick();
    const schedule = () => {
      timer = setTimeout(async () => {
        await tick();
        if (!cancelled) schedule();
      }, POLL_MS);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Bonus: when the viewer changes resourceKey (e.g. opens a policy
  // drawer), refresh the snapshot immediately so the banner doesn't
  // have to wait up to 20s for the next poll cycle.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/presence/online", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as OnlineSnapshot;
        if (!cancelled) setOnline(json);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resourceKey]);

  const value = React.useMemo<Ctx>(
    () => ({ resourceKey, setResourceKey, online }),
    [resourceKey, online],
  );

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

/**
 * Returns the latest /api/presence/online snapshot, or null until the
 * first response arrives.
 */
export function useOnlineUsers(): OnlineSnapshot | null {
  const ctx = React.useContext(PresenceContext);
  return ctx?.online ?? null;
}

/**
 * Pushes `key` into the presence context for the lifetime of the
 * calling component. Pass `null` to clear (or simply skip the call).
 *
 * Heartbeats fired AFTER this hook mounts will include `resourceKey`
 * in the request body, so within a heartbeat cycle (~30s) other
 * viewers' `<PolicyPresenceBanner />` will see this user appear.
 *
 * Common usage on a policy detail page:
 *   useSetPresenceResource(`policy:${policyId}`);
 */
export function useSetPresenceResource(key: string | null): void {
  const ctx = React.useContext(PresenceContext);
  React.useEffect(() => {
    if (!ctx) return;
    ctx.setResourceKey(key);
    return () => {
      // On unmount or key change, clear so the user is no longer
      // counted as "viewing this resource". The heartbeat will still
      // run (without a resourceKey) so they remain visible in the
      // global online list.
      ctx.setResourceKey(null);
    };
    // ctx is stable (the provider memoises its value) so depending on
    // `key` alone is correct; including `ctx` would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Returns just the OTHER users (excludes self) currently on the same
 * resourceKey as the viewer. Empty array when alone or while the
 * snapshot is still loading.
 */
export function useUsersOnResource(key: string | null): OnlineUser[] {
  const snap = useOnlineUsers();
  if (!key || !snap) return [];
  return snap.users.filter((u) => !u.isSelf && u.resourceKey === key);
}
