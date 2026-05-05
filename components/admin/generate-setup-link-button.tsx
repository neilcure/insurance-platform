"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";

export default function GenerateSetupLinkButton({ userId }: { userId: number }) {
  const [setupLink, setSetupLink] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function generate() {
    setLoading(true);
    setSetupLink(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/setup-link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to generate setup link");
        setLoading(false);
        return;
      }
      if (data.setupLink) {
        setSetupLink(data.setupLink);
        toast.success("Setup link generated (development)");
      } else {
        toast.success("Setup link generated");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to generate setup link";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={generate} disabled={loading} className="inline-flex items-center gap-2">
        <Link2 className="h-4 w-4 sm:hidden lg:inline" />
        <span className="hidden sm:inline">{loading ? "Working..." : "Setup Link"}</span>
      </Button>
      {setupLink ? (
        <>
          <Input className="max-w-xs" value={setupLink} readOnly />
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(setupLink)} className="inline-flex items-center gap-2">
            <Copy className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Copy</span>
          </Button>
        </>
      ) : null}
    </div>
  );
}
