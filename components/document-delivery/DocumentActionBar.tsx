"use client";

/**
 * Standard "share these documents" icon cluster.
 *
 * Drop-in replacement for the per-row Email + WhatsApp + Download +
 * Preview icon clusters that historically lived inline across
 * `DocumentsTab`, `UploadDocumentsTab`, etc.
 *
 * Each icon is shown only when the corresponding channel is in
 * `channels`. Hidden channels skip rendering entirely so the bar
 * collapses to nothing on rows with no actions enabled.
 *
 * The component is presentation-only — it doesn't know about
 * specific files. Callers pass `groups` and `recipient`, the bar
 * forwards them to the delivery host.
 */

import * as React from "react";
import { Mail, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  useDeliverDocuments,
  type DeliveryDocGroup,
  type DeliveryRecipient,
} from "@/lib/document-delivery";

export type DocumentActionBarChannel = "email" | "whatsapp";

export type DocumentActionBarProps = {
  policyId: number;
  policyNumber?: string;
  groups: DeliveryDocGroup[];
  recipient?: DeliveryRecipient;
  /** Which icons to show. Order is preserved in render. */
  channels?: DocumentActionBarChannel[];
  /** Optional className for the wrapping flex row. */
  className?: string;
  /** Render small (icon-only, ~h-7) or default (icon + label). */
  size?: "sm" | "md";
};

const DEFAULT_CHANNELS: DocumentActionBarChannel[] = ["email", "whatsapp"];

export function DocumentActionBar({
  policyId,
  policyNumber,
  groups,
  recipient,
  channels = DEFAULT_CHANNELS,
  className,
  size = "sm",
}: DocumentActionBarProps) {
  const deliver = useDeliverDocuments();

  // No files = no point rendering the bar at all. Callers can still
  // pass an empty array safely.
  const hasFiles = groups.some((g) => g.uploads.length > 0);
  if (!hasFiles) return null;

  const iconClass = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const buttonClass =
    size === "sm"
      ? "h-7 gap-1.5 px-2 text-[11px]"
      : "h-9 gap-1.5 px-3 text-xs";

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {channels.map((channel) => {
        if (channel === "email") {
          return (
            <Button
              key="email"
              size="sm"
              variant="outline"
              className={buttonClass}
              onClick={() =>
                deliver({
                  channel: "email",
                  policyId,
                  policyNumber,
                  groups,
                  recipient,
                })
              }
              title="Send selected files in one email"
            >
              <Mail className={iconClass} />
              <span className="hidden sm:inline">Email Files</span>
            </Button>
          );
        }
        if (channel === "whatsapp") {
          return (
            <Button
              key="whatsapp"
              size="sm"
              variant="outline"
              className={`${buttonClass} border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 hover:border-emerald-400 dark:border-emerald-900/60 dark:text-emerald-400 dark:hover:bg-emerald-950/30`}
              onClick={() =>
                deliver({
                  channel: "whatsapp",
                  policyId,
                  policyNumber,
                  groups,
                  recipient,
                })
              }
              title="Generate a download link and open WhatsApp pre-filled"
            >
              <MessageCircle className={iconClass} />
              <span className="hidden sm:inline">WhatsApp Files</span>
            </Button>
          );
        }
        return null;
      })}
    </div>
  );
}
