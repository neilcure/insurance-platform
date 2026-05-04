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
 *   <PolicyPresenceBanner policyId={policyId} policyNumber={detail.policyNumber} />
 *
 * Why a separate banner (instead of just the topbar widget)
 * ---------------------------------------------------------
 * The topbar widget answers "who's online right now?". This banner
 * answers the more useful question for collaboration: "who else is
 * looking at THIS POLICY right now?". If we only had the widget, a
 * user could see "3 people online" but not realise one of them was
 * editing the very policy they're about to save.
 *
 * WhatsApp ping (HK-friendly)
 * ---------------------------
 * Each other-viewer chip carries a small WhatsApp icon when their
 * linked client has a `contactPhone`. Clicking it opens
 * https://wa.me/<intl-number> with a pre-filled chat message that
 * names the policy. No Meta API, no per-message cost — just a
 * `<a href>` to wa.me. See `lib/whatsapp.ts` for the normalizer that
 * accepts `12345678`, `1234 5678`, `+852 12345678`, `+852 1234 5678`,
 * etc. as the same HK number.
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
import { WhatsAppPingButton } from "@/components/presence/whatsapp-ping-button";

function displayLabel(u: Pick<OnlineUser, "name" | "email">): string {
  const name = u.name?.trim();
  if (name) return name;
  // Show only the local-part of the email so we don't shout someone's
  // full address into the policy header.
  const email = u.email ?? "";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email || "Someone";
}

function buildPingMessage(
  recipientName: string,
  policyNumber: string | null | undefined,
): string {
  const policyRef = policyNumber ? ` ${policyNumber}` : "";
  return (
    `Hi ${recipientName}, I'm also editing policy${policyRef} right now. ` +
    `Let me know before you save your changes — last write wins.`
  );
}

export function PolicyPresenceBanner({
  policyId,
  policyNumber,
  className,
}: {
  policyId: number | null | undefined;
  /**
   * The user-facing policy number (e.g. "PCAR-202508-0001"). Used in
   * the pre-filled WhatsApp message so the recipient knows which
   * policy you mean. Optional — if omitted, the message just says
   * "this policy".
   */
  policyNumber?: string | null;
  className?: string;
}) {
  const key = policyId ? `policy:${policyId}` : null;
  const others = useUsersOnResource(key);

  if (!key) return null;
  if (others.length === 0) return null;

  return (
    <div
      className={[
        "flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
        className ?? "",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2 leading-snug">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <span className="font-medium">
            {others.length === 1
              ? `${displayLabel(others[0])} is`
              : `${others.length} others are`}
          </span>{" "}
          <span>also viewing this policy.</span>{" "}
          <span className="text-amber-800/80 dark:text-amber-300/80">
            Coordinate before saving — last write wins.
          </span>
        </div>
      </div>

      {/*
        Per-user chips. Each chip is the user's name; if they have a
        WhatsApp-reachable phone we append a small green ping icon
        next to it. Wrap so the chips never overflow narrow drawers
        (per responsive-layout rule on rows of 3+ items).
      */}
      <div className="flex flex-wrap gap-1.5 pl-5">
        {others.map((u) => {
          const name = displayLabel(u);
          return (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-white/60 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-100"
            >
              <span className="truncate max-w-[140px]" title={u.name || u.email}>
                {name}
              </span>
              <WhatsAppPingButton
                phone={u.phone}
                message={buildPingMessage(name, policyNumber)}
                label={`Ping ${name} on WhatsApp`}
                className="-mr-0.5"
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}
