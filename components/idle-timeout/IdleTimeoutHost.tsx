"use client";

/**
 * IdleTimeoutHost — single component that:
 *
 *   1. Loads the org's idle-timeout policy from the API.
 *   2. Reads the signed-in user's role from `useSession`.
 *   3. Drives the `useIdleTimeout` hook with the right thresholds.
 *   4. Renders the warning lightbox (with a per-second countdown
 *      and "Stay signed in" / "Sign out now" buttons).
 *   5. Calls `signOut` when the countdown finishes — and when
 *      the user clicks "Sign out now".
 *
 * Mounted once near the top of the dashboard layout. The host
 * never renders anything when the user is not signed in or when
 * the policy is disabled — both states resolve to a no-op.
 *
 * NOTE: We deliberately build a dedicated `<Dialog>` here instead
 * of reusing `confirmDialog()` from `@/components/ui/global-dialogs`
 * because we need a live countdown inside the body — see
 * `.cursor/rules/no-native-dialogs.mdc` §6 ("for truly modal flows
 * that need richer content … build a dedicated `<Dialog>`").
 */

import * as React from "react";
import { signOut, useSession } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Clock, LogOut } from "lucide-react";
import { useIdleTimeout } from "@/lib/idle-timeout/use-idle-timeout";
import {
  DEFAULT_IDLE_TIMEOUT_POLICY,
  type IdleTimeoutPolicy,
  resolveRoleConfig,
} from "@/lib/idle-timeout/policy";

const SIGNED_OUT_REASON_KEY = "idle:signedOutReason";
const LAST_ACTIVITY_KEY = "idle:lastActivity";

/**
 * Clear the cross-tab "last activity" timestamp. Called right
 * before any sign-out so the next sign-in on this browser starts
 * with a fresh idle window — without this, the stale value would
 * make the freshly-authenticated user immediately face another
 * timeout (since `now - stored` is already past the idle limit).
 *
 * The hook also has a stale-detection guard, this is a belt-and-
 * braces clear so the contract is obvious from this side too.
 */
function clearStoredActivity(): void {
  try {
    window.localStorage.removeItem(LAST_ACTIVITY_KEY);
  } catch {
    /* ignore: localStorage may be unavailable */
  }
}

export function IdleTimeoutHost() {
  const session = useSession();
  const [policy, setPolicy] = React.useState<IdleTimeoutPolicy | null>(null);

  // Load the policy once after sign-in. The endpoint requires a
  // valid session, so we don't even hit it for unauthenticated
  // users (avoids unnecessary 401 noise in the network panel).
  React.useEffect(() => {
    if (session.status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/admin/idle-timeout-policy", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : DEFAULT_IDLE_TIMEOUT_POLICY))
      .then((p: IdleTimeoutPolicy) => {
        if (!cancelled) setPolicy(p);
      })
      .catch(() => {
        if (!cancelled) setPolicy(DEFAULT_IDLE_TIMEOUT_POLICY);
      });
    return () => {
      cancelled = true;
    };
  }, [session.status]);

  const userType = (session.data?.user as { userType?: string } | undefined)
    ?.userType;
  const enabled =
    session.status === "authenticated" && !!policy && policy.enabled;
  const cfg = resolveRoleConfig(policy, userType ?? null);

  const handleTimeout = React.useCallback(() => {
    try {
      // Persist a tiny breadcrumb so the sign-in page can show a
      // toast like "You were signed out due to inactivity." We
      // don't surface it here because we're about to redirect.
      window.sessionStorage.setItem(SIGNED_OUT_REASON_KEY, "idle");
    } catch {
      /* ignore: sessionStorage may be unavailable */
    }
    clearStoredActivity();
    void signOut({ callbackUrl: "/auth/signin?reason=idle" });
  }, []);

  const { stage, warningRemaining, reset } = useIdleTimeout({
    idleSeconds: cfg.idleSeconds,
    warnSeconds: cfg.warnSeconds,
    enabled,
    onTimeout: handleTimeout,
  });

  // While the policy hasn't loaded or the user isn't signed in,
  // render nothing. This also avoids a flash of the dialog right
  // after sign-in (the timer would otherwise tick from before the
  // user finished logging in).
  if (!enabled) return null;

  const open = stage === "warning";
  const mins = Math.floor(cfg.idleSeconds / 60);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Close-via-overlay-click counts as "Stay signed in" so
        // accidental dismissals don't immediately sign the user
        // out.
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            Are you still there?
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm text-neutral-700 dark:text-neutral-300">
          <p>
            You&apos;ve been idle for about {mins} minute{mins === 1 ? "" : "s"}.
            For your security we&apos;ll sign you out automatically if there&apos;s
            no activity.
          </p>
          <div
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            role="status"
            aria-live="polite"
          >
            Signing out in <span className="font-semibold tabular-nums">{warningRemaining}</span>{" "}
            second{warningRemaining === 1 ? "" : "s"}…
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              try {
                window.sessionStorage.setItem(SIGNED_OUT_REASON_KEY, "manual");
              } catch {
                /* ignore */
              }
              clearStoredActivity();
              void signOut({ callbackUrl: "/" });
            }}
          >
            <LogOut className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Sign out now</span>
          </Button>
          <Button onClick={reset} autoFocus>
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
