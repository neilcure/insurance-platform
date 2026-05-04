"use client";

/**
 * `<PolicyPresenceBanner />` — small banner that warns the viewer
 * when ONE OR MORE other users are looking at the same policy right
 * now. Encourages a quick "ping them in chat before you save" instead
 * of blindly overwriting their in-flight edits.
 *
 * Usage on a policy page / drawer:
 *
 *   import { useSetPresenceResource } from "@/lib/presence/presence-context";
 *   import { PolicyPresenceBanner } from "@/components/presence/policy-presence-banner";
 *
 *   useSetPresenceResource(`policy:${policyId}`);
 *   // ...
 *   <PolicyPresenceBanner policyId={policyId} />
 *
 * Why a separate banner (instead of just the topbar widget)
 * ---------------------------------------------------------
 * The topbar widget answers "who's online right now?". This banner
 * answers the more useful question for collaboration: "who else is
 * looking at THIS POLICY right now?". If we only had the widget, a
 * user could see "3 people online" but not realise one of them was
 * editing the very policy they're about to save.
 *
 * Renders nothing when:
 *   - No `policyId` provided
 *   - The presence snapshot hasn't loaded yet
 *   - The viewer is alone on this policy
 *
 * That keeps the policy page visually clean in the common case
 * (single user editing) and only surfaces the banner when there's
 * something worth warning about.
 */

import * as React from "react";
import { Eye } from "lucide-react";
import {
  useUsersOnResource,
  type OnlineUser,
} from "@/lib/presence/presence-context";

function displayLabel(u: Pick<OnlineUser, "name" | "email">): string {
  const name = u.name?.trim();
  if (name) return name;
  // Show only the local-part of the email so we don't shout someone's
  // full address into the policy header.
  const email = u.email ?? "";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email || "Someone";
}

export function PolicyPresenceBanner({
  policyId,
  className,
}: {
  policyId: number | null | undefined;
  className?: string;
}) {
  const key = policyId ? `policy:${policyId}` : null;
  const others = useUsersOnResource(key);

  if (!key) return null;
  if (others.length === 0) return null;

  // Up to 3 names by name, then "+N more". Most teams won't see > 2.
  const shown = others.slice(0, 3).map(displayLabel);
  const overflow = Math.max(0, others.length - shown.length);
  const list =
    shown.length === 1
      ? shown[0]
      : shown.length === 2
        ? `${shown[0]} and ${shown[1]}`
        : `${shown.slice(0, -1).join(", ")}, and ${shown[shown.length - 1]}`;
  const summary = `${list}${overflow > 0 ? ` +${overflow} more` : ""}`;
  const verb = others.length === 1 ? "is" : "are";

  return (
    <div
      className={[
        "flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
        className ?? "",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
      <div className="min-w-0 flex-1 leading-snug">
        <span className="font-medium">{summary}</span>{" "}
        <span>{verb} also viewing this policy.</span>{" "}
        <span className="text-amber-800/80 dark:text-amber-300/80">
          Coordinate before saving — last write wins.
        </span>
      </div>
    </div>
  );
}
