"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCcw, Copy } from "lucide-react";
import { confirmDialog } from "@/components/ui/global-dialogs";

export default function ReissueInviteButton({
  userId,
  recipientEmail,
  recipientName,
}: {
  userId: number;
  recipientEmail?: string | null;
  recipientName?: string | null;
}) {
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function reissue() {
    const targetEmail = (recipientEmail ?? "").trim();
    const targetName = (recipientName ?? "").trim();
    const ok = await confirmDialog({
      title: "Re-issue invite?",
      description: targetEmail
        ? `An invite link will be emailed to:\n\n${targetEmail}${targetName ? `  (${targetName})` : ""}\n\nIf this address is wrong, click Cancel and use Edit to fix it first.`
        : "An invite link will be emailed to this user. Confirm to continue.",
      confirmLabel: "Send Invite",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    setLoading(true);
    setInviteLink(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/invites`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to re-issue invite");
        setLoading(false);
        return;
      }
      const successMsg = targetEmail ? `Invite sent to ${targetEmail}` : "Invite sent";
      if (data.inviteLink) {
        setInviteLink(data.inviteLink);
        toast.success(`${successMsg} (link copied below)`);
      } else {
        toast.success(successMsg);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to send invite";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={reissue} disabled={loading} className="inline-flex items-center gap-2">
        <RefreshCcw className="h-4 w-4" />
        <span className="hidden sm:inline">{loading ? "Working..." : "Re-issue invite"}</span>
      </Button>
      {inviteLink ? (
        <>
          <Input className="max-w-xs" value={inviteLink} readOnly />
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(inviteLink!)} className="inline-flex items-center gap-2">
            <Copy className="h-4 w-4" />
            <span className="hidden sm:inline">Copy</span>
          </Button>
        </>
      ) : null}
    </div>
  );
}





