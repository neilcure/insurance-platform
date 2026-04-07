"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { usePolicyStatuses } from "@/hooks/use-policy-statuses";

type StatusEntry = {
  status: string;
  changedAt: string;
  changedBy?: string;
  note?: string;
};

export function StatusTab({
  policyId,
  currentStatus,
  statusHistory,
  onStatusChange,
  flowKey,
}: {
  policyId: number;
  currentStatus?: string;
  statusHistory?: StatusEntry[];
  onStatusChange?: (newStatus: string) => void;
  flowKey?: string;
}) {
  const { options, getLabel } = usePolicyStatuses(flowKey);
  const [selected, setSelected] = React.useState(currentStatus || "active");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (options.length > 0) {
      const cur = currentStatus || "active";
      if (!options.some((o) => o.value === cur)) {
        setSelected(options[0].value);
      }
    }
  }, [options, currentStatus]);

  async function updateStatus() {
    if (selected === (currentStatus || "active")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: selected,
          statusNote: `Status changed to ${getLabel(selected)}`,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Status updated");
      onStatusChange?.(selected);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        Status updates automatically when documents are sent or confirmed. Use this to manually override if needed.
      </p>
      {onStatusChange && (
        <div className="flex items-center gap-2">
          <select
            className="h-8 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={updateStatus}
            disabled={saving || selected === (currentStatus || "active")}
          >
            {saving ? "Saving..." : "Update"}
          </Button>
        </div>
      )}
    </div>
  );
}
