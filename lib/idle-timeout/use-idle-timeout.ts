"use client";

/**
 * `useIdleTimeout` — track the user's last interactive activity
 * (mouse, keyboard, touch, scroll) and surface two phases:
 *
 *   - "active"  → user is doing things, no warning needed.
 *   - "warning" → idle for `idleSeconds`; show the lightbox with
 *                 `warnSeconds` countdown.
 *
 * On `warnSeconds` reaching 0 the host is expected to call
 * `signOut` (we keep that side-effect outside the hook so the
 * hook is testable and the host can also persist a "you were
 * signed out automatically" toast on the next page load).
 *
 * Cross-tab sync
 * --------------
 * Activity in any tab counts as activity in every tab — otherwise
 * a user filling a long form in tab A would get auto-signed-out
 * by tab B that's been idle. We use `localStorage` (broadcasts
 * the timestamp via the `storage` event) which is supported
 * everywhere. `BroadcastChannel` would also work but adds a
 * second source of truth for no real benefit.
 *
 * Throttling
 * ----------
 * Activity bumps the timestamp at most once every
 * `ACTIVITY_THROTTLE_MS` (5s) to avoid hammering localStorage on
 * every pixel of mousemove. The check loop runs once per second;
 * the dialog countdown also updates once per second — both rely
 * on the same single `setInterval` to keep the page cheap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "idle:lastActivity";
const ACTIVITY_THROTTLE_MS = 5_000;
const TICK_MS = 1_000;

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
  "mousedown",
  "mousemove",
  "keydown",
  "touchstart",
  "scroll",
  "pointerdown",
  "wheel",
];

export type IdleStage = "active" | "warning";

export type UseIdleTimeoutOptions = {
  /** Idle period (seconds) before the warning lightbox fires. */
  idleSeconds: number;
  /** Countdown (seconds) shown inside the warning lightbox. */
  warnSeconds: number;
  /** Pause the timer entirely (e.g. when policy.enabled = false). */
  enabled?: boolean;
  /** Called once when the countdown reaches zero. */
  onTimeout?: () => void;
};

export type UseIdleTimeoutReturn = {
  stage: IdleStage;
  /** Seconds remaining in the warning countdown (only meaningful when stage = "warning"). */
  warningRemaining: number;
  /** Reset the activity clock to "now" (e.g. user clicked "Stay signed in"). */
  reset: () => void;
};

function readLastActivity(): number {
  if (typeof window === "undefined") return Date.now();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return Date.now();
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return Date.now();
    return n;
  } catch {
    return Date.now();
  }
}

function writeLastActivity(ts: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    // localStorage may be unavailable (private mode, quota) —
    // we silently fall back to in-memory tracking.
  }
}

export function useIdleTimeout(opts: UseIdleTimeoutOptions): UseIdleTimeoutReturn {
  const { idleSeconds, warnSeconds, enabled = true, onTimeout } = opts;

  const [stage, setStage] = useState<IdleStage>("active");
  const [warningRemaining, setWarningRemaining] = useState<number>(warnSeconds);

  const lastActivityRef = useRef<number>(Date.now());
  const lastWriteRef = useRef<number>(0);
  const stageRef = useRef<IdleStage>("active");
  const onTimeoutRef = useRef<typeof onTimeout>(onTimeout);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  // Stamp activity, throttled, and broadcast to other tabs.
  const stampActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (now - lastWriteRef.current >= ACTIVITY_THROTTLE_MS) {
      lastWriteRef.current = now;
      writeLastActivity(now);
    }
    // If we were in the warning state, snap back to active immediately.
    if (stageRef.current !== "active") {
      setStage("active");
      setWarningRemaining(warnSeconds);
    }
  }, [warnSeconds]);

  const reset = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    lastWriteRef.current = now;
    writeLastActivity(now);
    setStage("active");
    setWarningRemaining(warnSeconds);
  }, [warnSeconds]);

  // Bind the activity listeners + cross-tab sync.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    // Seed from localStorage so a freshly-mounted tab inherits the
    // "last activity" of the rest of the session.
    //
    // BUT: if the stored timestamp is already older than the idle
    // window, it's stale — typically left over from a previous
    // session that was just timed-out and signed back in. Adopting
    // it would make the very first tick fire `onTimeout` immediately
    // and sign the freshly-authenticated user right back out.
    //
    // In that case treat "becoming enabled" as user activity (the
    // user just signed in / loaded the dashboard) and stamp NOW —
    // which also broadcasts the fresh timestamp to any other tabs
    // via the `storage` event listener below.
    const stored = readLastActivity();
    const now = Date.now();
    const isStale = now - stored >= idleSeconds * 1000;
    if (isStale) {
      lastActivityRef.current = now;
      lastWriteRef.current = now;
      writeLastActivity(now);
    } else {
      lastActivityRef.current = stored;
    }

    const handler = () => stampActivity();
    for (const evt of ACTIVITY_EVENTS) {
      document.addEventListener(evt, handler, { passive: true });
    }
    window.addEventListener("focus", handler);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      const ts = Number(e.newValue);
      if (!Number.isFinite(ts) || ts <= 0) return;
      // Adopt the newer timestamp from another tab.
      if (ts > lastActivityRef.current) {
        lastActivityRef.current = ts;
        if (stageRef.current !== "active") {
          setStage("active");
          setWarningRemaining(warnSeconds);
        }
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        document.removeEventListener(evt, handler);
      }
      window.removeEventListener("focus", handler);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, stampActivity, warnSeconds, idleSeconds]);

  // Single per-second tick that drives both the idle check and the
  // warning countdown.
  useEffect(() => {
    if (!enabled) {
      setStage("active");
      setWarningRemaining(warnSeconds);
      return;
    }

    const id = window.setInterval(() => {
      const now = Date.now();
      const idleMs = now - lastActivityRef.current;
      const warnAtMs = idleSeconds * 1000;
      const expireAtMs = (idleSeconds + warnSeconds) * 1000;

      if (idleMs >= expireAtMs) {
        // Time's up — fire onTimeout exactly once. The host is
        // expected to call signOut(); we still update local state
        // so the dialog hides while the redirect happens.
        if (stageRef.current !== "active") {
          // Already in warning; transitioning to "expired".
          // Snap back to "active" visually so a stale dialog
          // doesn't keep counting down at -3, -4 …
          setStage("active");
          setWarningRemaining(0);
        }
        onTimeoutRef.current?.();
        return;
      }

      if (idleMs >= warnAtMs) {
        const remainingSec = Math.max(
          0,
          Math.ceil((expireAtMs - idleMs) / 1000),
        );
        if (stageRef.current !== "warning") setStage("warning");
        setWarningRemaining(remainingSec);
        return;
      }

      if (stageRef.current !== "active") {
        setStage("active");
        setWarningRemaining(warnSeconds);
      }
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [enabled, idleSeconds, warnSeconds]);

  return useMemo(
    () => ({ stage, warningRemaining, reset }),
    [stage, warningRemaining, reset],
  );
}
