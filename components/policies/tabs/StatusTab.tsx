"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const DEFAULT_STATUS_OPTIONS = [
  { value: "draft", label: "Draft", color: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200" },
  { value: "pending", label: "Pending Review", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  { value: "active", label: "Active", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  { value: "suspended", label: "Suspended", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  { value: "expired", label: "Expired", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  { value: "cancelled", label: "Cancelled", color: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" },
] as const;

type StatusOption = { value: string; label: string; color: string };

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
  const [selected, setSelected] = React.useState(currentStatus || "active");
  const [saving, setSaving] = React.useState(false);
  const [statusOptions, setStatusOptions] = React.useState<StatusOption[]>([...DEFAULT_STATUS_OPTIONS]);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/form-options?groupKey=policy_statuses&_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { label: string; value: string; meta?: { color?: string; flows?: string[]; sortOrder?: number } }[]) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const applicable = rows.filter((r) => {
          const flows = r.meta?.flows;
          if (!flows || flows.length === 0) return true;
          if (!flowKey) return false;
          return flows.includes(flowKey);
        });
        if (applicable.length > 0) {
          const opts = applicable.map((r) => ({
            value: r.value,
            label: r.label,
            color: r.meta?.color || "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
          }));
          setStatusOptions(opts);
          const cur = currentStatus || "active";
          if (!opts.some((o) => o.value === cur)) {
            setSelected(opts[0].value);
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [flowKey, currentStatus]);

  const allKnownStatuses = React.useMemo(() => {
    const map = new Map<string, StatusOption>();
    for (const s of DEFAULT_STATUS_OPTIONS) map.set(s.value, s);
    for (const s of statusOptions) map.set(s.value, s);
    return map;
  }, [statusOptions]);


  async function updateStatus() {
    if (selected === (currentStatus || "active")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: selected,
          statusNote: `Status changed to ${allKnownStatuses.get(selected)?.label ?? selected}`,
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
            {statusOptions.map((opt) => (
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
