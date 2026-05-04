"use client";

/**
 * `usePresenceHeartbeat` — sends a POST to /api/presence/heartbeat
 * every `intervalMs` while the tab is visible. Pauses on hidden /
 * blur, resumes on visible / focus, fires once on mount.
 *
 * Why a custom hook (no SSE / WebSocket)
 * --------------------------------------
 * SSE/WebSockets need a long-lived server process, which doesn't
 * exist in this app's serverless target. Plain HTTP polling at 30s
 * is ~2 requests/min/user — for the team sizes this app supports,
 * that's noise-level traffic and trivially scalable. If we ever
 * outgrow it, swap the implementation here without touching callers.
 *
 * Phase B
 * -------
 * Pass `resourceKey` (e.g. `policy:${id}`) when the user is actively
 * viewing/editing a specific resource. The widget on /policies/[id]
 * uses this to render "Bob is also editing this policy".
 */

import { useEffect, useRef } from "react";

const DEFAULT_INTERVAL_MS = 30_000;

export function usePresenceHeartbeat(opts?: {
  intervalMs?: number;
  resourceKey?: string | null;
  /** Disable entirely (e.g. on public pages). Defaults to enabled. */
  enabled?: boolean;
}) {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const resourceKey = opts?.resourceKey ?? null;
  const enabled = opts?.enabled ?? true;

  // Stash the latest resourceKey in a ref so the polling loop always
  // reads the current value without resubscribing on every change.
  const resourceKeyRef = useRef(resourceKey);
  useEffect(() => {
    resourceKeyRef.current = resourceKey;
  }, [resourceKey]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const beat = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        await fetch("/api/presence/heartbeat", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resourceKey: resourceKeyRef.current }),
          // Heartbeats must not block page unload or block on the
          // network — fire and forget. `keepalive` lets the request
          // outlive a quick navigation.
          keepalive: true,
        });
      } catch {
        // Network blip — next tick will retry. Swallow silently to
        // avoid filling the console.
      }
    };

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        await beat();
        schedule();
      }, intervalMs);
    };

    // Immediate beat on mount so the user shows up "online" within
    // the first request, not after `intervalMs`.
    void beat();
    schedule();

    // Re-beat on visibility change so a tab that was backgrounded for
    // an hour shows up again immediately when the user returns.
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void beat();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [intervalMs, enabled]);
}
