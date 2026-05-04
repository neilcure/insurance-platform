"use client";

/**
 * `<WhatsAppPingButton />` — small icon-only link that opens WhatsApp
 * (Web / Desktop / Mobile, whichever the user has) with a pre-filled
 * message addressed to `phone`.
 *
 * Renders nothing when:
 *   - `phone` is null/empty (user has no linked client, or the linked
 *     client has no `contactPhone`)
 *   - `normalizeForWhatsApp(phone)` returns null (the phone string
 *     was malformed beyond recognition)
 *
 * That keeps the policy banner clean: only users we can actually
 * reach get the button.
 *
 * Why an `<a>` and not a `<button onClick={() => window.open(...)}>`
 * --------------------------------------------------------------
 * `<a href>` lets the OS routing system pick the best handler:
 *   - Mobile  → opens the native WhatsApp app via deep link
 *   - Desktop → opens WhatsApp Desktop if installed, falls back to
 *               WhatsApp Web in the browser
 * Both `target="_blank"` and `rel="noopener noreferrer"` make sure
 * we don't leak `window.opener` into the wa.me page.
 *
 * Privacy note
 * ------------
 * This is a click-to-chat link only — the recipient's phone number
 * is never sent to the server, never logged, and we do not call
 * Meta's API. The link is built client-side; opening it just hands
 * off to WhatsApp the same way `<a href="mailto:">` hands off to a
 * mail client. No cost.
 */

import * as React from "react";
import { MessageCircle } from "lucide-react";
import { buildWhatsAppUrl } from "@/lib/whatsapp";

export type WhatsAppPingButtonProps = {
  /** Raw phone string (any format — see `normalizeForWhatsApp`). */
  phone: string | null | undefined;
  /** Pre-filled chat message. Newlines and emoji are fine. */
  message?: string | null;
  /** Optional aria-label override; defaults to "Ping on WhatsApp". */
  label?: string;
  className?: string;
};

export function WhatsAppPingButton({
  phone,
  message,
  label = "Ping on WhatsApp",
  className,
}: WhatsAppPingButtonProps) {
  const url = React.useMemo(() => buildWhatsAppUrl(phone, message), [phone, message]);

  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      // Stop the click from bubbling into a parent banner / row that
      // might also have its own onClick (e.g. opens a profile drawer).
      onClick={(e) => e.stopPropagation()}
      className={[
        "inline-flex items-center justify-center rounded-full p-1 text-emerald-600 transition-colors hover:bg-emerald-100 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900 dark:hover:text-emerald-300",
        className ?? "",
      ].join(" ")}
    >
      <MessageCircle className="h-3.5 w-3.5" />
    </a>
  );
}
