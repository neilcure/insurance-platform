"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", color: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200" },
  { value: "pending", label: "Pending Review", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  { value: "active", label: "Active", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "suspended", label: "Suspended", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "expired", label: "Expired", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  { value: "cancelled", label: "Cancelled", color: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" },
] as const;

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
}: {
  policyId: number;
  currentStatus?: string;
  statusHistory?: StatusEntry[];
  onStatusChange?: (newStatus: string) => void;
}) {
  const [selected, setSelected] = React.useState(currentStatus || "active");
  const [saving, setSaving] = React.useState(false);

  const currentDef = STATUS_OPTIONS.find((s) => s.value === (currentStatus || "active"));
  const history = statusHistory ?? [];

  async function updateStatus() {
    if (selected === (currentStatus || "active")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: selected,
          statusNote: `Status changed to ${STATUS_OPTIONS.find((s) => s.value === selected)?.label ?? selected}`,
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
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="mb-2 text-sm font-medium">Current Status</div>
        <Badge className={currentDef?.color ?? ""}>
          {currentDef?.label ?? currentStatus ?? "Active"}
        </Badge>
      </div>

      {onStatusChange && (
        <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="mb-2 text-sm font-medium">Change Status</div>
          <div className="flex items-center gap-2">
            <select
              className="h-8 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
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
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="mb-2 text-sm font-medium">Status History</div>
          <div className="space-y-2">
            {history.map((entry, idx) => {
              const def = STATUS_OPTIONS.find((s) => s.value === entry.status);
              return (
                <div key={idx} className="flex items-start justify-between gap-2 text-xs">
                  <div>
                    <Badge variant="outline" className="text-[10px]">
                      {def?.label ?? entry.status}
                    </Badge>
                    {entry.note && (
                      <div className="mt-0.5 text-neutral-500 dark:text-neutral-400">
                        {entry.note}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-neutral-400 dark:text-neutral-500">
                    <div>{new Date(entry.changedAt).toLocaleDateString()}</div>
                    {entry.changedBy && <div>{entry.changedBy}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
