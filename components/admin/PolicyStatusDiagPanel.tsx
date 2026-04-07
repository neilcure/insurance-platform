"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, Wrench, XCircle } from "lucide-react";

type StatusConfig = {
  id: number;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  color: string;
  flows: string[];
  triggersInvoice: boolean;
  onEnter: unknown[];
};

type Issue = {
  type: "warning" | "error";
  fixAction: string;
  fixId: string;
  fixLabel: string;
  message: string;
  status?: string;
};

type Transition = {
  policyNumber: string;
  policyId: number;
  from: string;
  to: string;
  changedAt: string;
  changedBy: string;
};

type DiagData = {
  configs: StatusConfig[];
  allFlows: string[];
  statusDistribution: Record<string, number>;
  flowDistribution: Record<string, Record<string, number>>;
  issues: Issue[];
  recentTransitions: Transition[];
  totalPolicies: number;
  activePolicies: number;
};

export function PolicyStatusDiagPanel() {
  const [data, setData] = React.useState<DiagData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [fixingId, setFixingId] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/diagnostics/policy-statuses?_t=${Date.now()}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((json) => setData(json))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function handleFix(issue: Issue) {
    setFixingId(issue.fixId);
    try {
      const res = await fetch("/api/admin/diagnostics/policy-statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixAction: issue.fixAction, fixId: issue.fixId }),
      });
      if (!res.ok) throw new Error("Fix failed");
      setRefreshKey((k) => k + 1);
    } catch {
      setError("Fix failed — please try again");
    } finally {
      setFixingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (error || !data) {
    return <div className="py-8 text-center text-sm text-red-500">{error || "Failed to load data"}</div>;
  }

  const configMap = new Map(data.configs.map((c) => [c.value, c]));
  const getLabel = (val: string) => configMap.get(val)?.label ?? val;
  const getColor = (val: string) => configMap.get(val)?.color ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200";

  const sortedDistribution = Object.entries(data.statusDistribution).sort(
    (a, b) => (configMap.get(a[0])?.sortOrder ?? 999) - (configMap.get(b[0])?.sortOrder ?? 999),
  );

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Policies" value={data.totalPolicies} />
        <StatCard label="Active Policies" value={data.activePolicies} />
        <StatCard label="Status Types" value={data.configs.filter((c) => c.isActive).length} />
        <StatCard label="Issues Found" value={data.issues.length} variant={data.issues.length > 0 ? "warning" : "success"} />
      </div>

      {/* Issues */}
      {data.issues.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Issues</h3>
          {data.issues.map((issue, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                issue.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                  : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
              }`}
            >
              {issue.type === "error" ? (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span className="flex-1">{issue.message}</span>
              <button
                disabled={fixingId === issue.fixId}
                onClick={() => handleFix(issue)}
                className="inline-flex items-center gap-1 shrink-0 rounded bg-white/60 dark:bg-white/10 px-2 py-1 text-[10px] font-medium hover:bg-white dark:hover:bg-white/20 transition-colors disabled:opacity-50"
              >
                {fixingId === issue.fixId ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Wrench className="h-2.5 w-2.5" />
                )}
                {issue.fixLabel}
              </button>
            </div>
          ))}
        </div>
      )}

      {data.issues.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          No issues found — all statuses are properly configured.
        </div>
      )}

      {/* Status Distribution */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Status Distribution</h3>
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Count</th>
                <th className="px-3 py-2 text-left font-medium">Bar</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              {sortedDistribution.map(([status, count]) => {
                const pct = data.totalPolicies > 0 ? (count / data.totalPolicies) * 100 : 0;
                const isOrphaned = !configMap.has(status) || !configMap.get(status)?.isActive;
                return (
                  <tr key={status}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <Badge variant="custom" className={`text-[10px] ${getColor(status)}`}>
                          {getLabel(status)}
                        </Badge>
                        {isOrphaned && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">(not in config)</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">{count}</td>
                    <td className="px-3 py-2">
                      <div className="h-2 w-full max-w-[200px] rounded-full bg-neutral-200 dark:bg-neutral-700">
                        <div
                          className="h-2 rounded-full bg-blue-500 dark:bg-blue-400"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Flow x Status Matrix */}
      {Object.keys(data.flowDistribution).length > 1 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Flow × Status Matrix</h3>
          <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Flow</th>
                  {sortedDistribution.map(([status]) => (
                    <th key={status} className="px-2 py-2 text-center font-medium">
                      <Badge variant="custom" className={`text-[9px] ${getColor(status)}`}>
                        {getLabel(status)}
                      </Badge>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-neutral-700">
                {Object.entries(data.flowDistribution)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([flow, counts]) => (
                    <tr key={flow}>
                      <td className="px-3 py-2 font-mono text-xs">{flow}</td>
                      {sortedDistribution.map(([status]) => (
                        <td key={status} className="px-2 py-2 text-center font-mono text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                          {counts[status] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Configured Statuses */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Configured Statuses</h3>
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Order</th>
                <th className="px-3 py-2 text-left font-medium">Label</th>
                <th className="px-3 py-2 text-left font-medium">Value</th>
                <th className="px-3 py-2 text-left font-medium">Color</th>
                <th className="px-3 py-2 text-left font-medium">Flows</th>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-left font-medium">On Enter</th>
                <th className="px-3 py-2 text-left font-medium">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              {data.configs
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((c) => (
                  <tr key={c.id} className={!c.isActive ? "opacity-50" : ""}>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums">{c.sortOrder}</td>
                    <td className="px-3 py-2 font-medium">{c.label}</td>
                    <td className="px-3 py-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">{c.value}</td>
                    <td className="px-3 py-2">
                      <Badge variant="custom" className={`text-[10px] ${c.color || "bg-neutral-200 text-neutral-700"}`}>
                        {c.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {c.flows.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.flows.map((f) => (
                            <span key={f} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono dark:bg-neutral-800">
                              {f}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-neutral-400">all flows</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {c.triggersInvoice ? "Yes" : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c.onEnter.length > 0
                        ? `${c.onEnter.length} action${c.onEnter.length > 1 ? "s" : ""}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-center text-xs">
                      {c.isActive ? (
                        <CheckCircle2 className="inline h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <XCircle className="inline h-3.5 w-3.5 text-neutral-400" />
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Transitions (collapsible) */}
      {data.recentTransitions.length > 0 && (
        <CollapsibleTransitions transitions={data.recentTransitions} getLabel={getLabel} getColor={getColor} />
      )}
    </div>
  );
}

function CollapsibleTransitions({
  transitions,
  getLabel,
  getColor,
}: {
  transitions: { policyNumber: string; from: string; to: string; changedBy: string; changedAt: string }[];
  getLabel: (v: string) => string;
  getColor: (v: string) => string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-semibold hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
      >
        <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        Recent Status Transitions (last 50)
      </button>
      {open && (
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700 mt-2">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Policy</th>
                <th className="px-3 py-2 text-left font-medium">From</th>
                <th className="px-3 py-2 text-left font-medium">To</th>
                <th className="px-3 py-2 text-left font-medium">Changed By</th>
                <th className="px-3 py-2 text-left font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              {transitions.map((t, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-mono text-xs">{t.policyNumber}</td>
                  <td className="px-3 py-2">
                    <Badge variant="custom" className={`text-[10px] ${getColor(t.from)}`}>
                      {getLabel(t.from)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="custom" className={`text-[10px] ${getColor(t.to)}`}>
                      {getLabel(t.to)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 max-w-[160px] truncate">
                    {t.changedBy}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
                    {new Date(t.changedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, variant = "default" }: { label: string; value: number; variant?: "default" | "warning" | "success" }) {
  const borderClass =
    variant === "warning"
      ? "border-amber-200 dark:border-amber-800"
      : variant === "success"
        ? "border-green-200 dark:border-green-800"
        : "border-neutral-200 dark:border-neutral-700";
  const valueClass =
    variant === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : variant === "success"
        ? "text-green-600 dark:text-green-400"
        : "text-neutral-900 dark:text-neutral-100";

  return (
    <div className={`rounded-md border ${borderClass} px-3 py-2`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}
