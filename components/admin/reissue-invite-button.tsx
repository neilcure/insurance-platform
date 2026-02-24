"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCcw, Copy } from "lucide-react";

export default function ReissueInviteButton({ userId }: { userId: number }) {
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function reissue() {
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
      if (data.inviteLink) {
        setInviteLink(data.inviteLink);
        toast.success("Invite re-issued (development)");
      } else {
        toast.success("Invite re-issued");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to re-issue invite";
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





