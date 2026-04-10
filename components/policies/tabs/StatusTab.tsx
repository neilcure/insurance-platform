"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
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
  audience = "client",
}: {
  policyId: number;
  currentStatus?: string;
  statusHistory?: StatusEntry[];
  onStatusChange?: (newStatus: string) => void;
  flowKey?: string;
  audience?: "client" | "agent";
}) {
  const { options, getLabel } = usePolicyStatuses(flowKey);
  const [selected, setSelected] = React.useState(currentStatus || "quotation_prepared");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [showOverride, setShowOverride] = React.useState(false);

  React.useEffect(() => {
    if (options.length > 0) {
      const cur = currentStatus || "quotation_prepared";
      if (!options.some((o) => o.value === cur)) {
        setSelected(options[0].value);
      }
    }
  }, [options, currentStatus]);

  async function updateStatus() {
    if (selected === (currentStatus || "quotation_prepared")) return;
    if (!reason.trim()) {
      toast.error("A reason is required to override the status");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: selected,
          statusNote: `Admin override: ${reason.trim()}`,
          statusTarget: audience,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Status updated");
      setReason("");
      setShowOverride(false);
      onStatusChange?.(selected);
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  const recentHistory = React.useMemo(() => {
    if (!statusHistory || statusHistory.length === 0) return [];
    return statusHistory.slice(-5).reverse();
  }, [statusHistory]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        {audience === "agent"
          ? "Agent status track. Use for agent-side workflow visibility and communication."
          : "Client status track. Updates automatically based on document actions and payment verification."}
      </p>

      {recentHistory.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Recent History</p>
          {recentHistory.map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
              <span className="shrink-0 text-neutral-400 dark:text-neutral-500">
                {new Date(h.changedAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
              </span>
              <span className="font-medium">{getLabel(h.status)}</span>
              {h.note && <span className="text-neutral-400 dark:text-neutral-500 truncate">— {h.note}</span>}
            </div>
          ))}
        </div>
      )}

      {onStatusChange && (
        <div>
          {!showOverride ? (
            <button
              type="button"
              onClick={() => setShowOverride(true)}
              className="text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 underline transition-colors"
            >
              Admin Override
            </button>
          ) : (
            <div className="space-y-2 rounded-md border border-orange-200 bg-orange-50 p-2.5 dark:border-orange-900 dark:bg-orange-950/30">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-orange-700 dark:text-orange-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Manual Override — use only for corrections</span>
              </div>
              <select
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Reason for override (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setShowOverride(false); setReason(""); }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={updateStatus}
                  disabled={saving || selected === (currentStatus || "quotation_prepared") || !reason.trim()}
                >
                  {saving ? "Saving..." : "Override"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
