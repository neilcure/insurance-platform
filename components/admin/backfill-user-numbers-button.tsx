"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function BackfillUserNumbersButton() {
  const [loading, setLoading] = React.useState(false);
  const router = useRouter();
  async function run() {
    if (!confirm("Assign numbers to all existing users without one?")) return;
    try {
      setLoading(true);
      const res = await fetch("/api/admin/users/backfill-numbers", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Backfill failed");
      toast.success(`Assigned ${data.updated ?? 0} user numbers`);
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Backfill failed");
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button size="sm" variant="secondary" onClick={run} disabled={loading}>
      {loading ? "Assigning..." : "Assign missing user numbers"}
    </Button>
  );
}

