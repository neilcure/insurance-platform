"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, CheckCircle2, Circle, Clock, Loader2, Search } from "lucide-react";

type FlowStep = { index: number; status: string; label: string };
type DocTrigger = { docType: string; action: string; targetStatus: string; targetLabel: string };
type Chain = { from: string; fromLabel: string; to: string; toLabel: string; note: string };
type PaymentTrigger = { trigger: string; targetStatus: string };
type RollbackTrigger = { trigger: string; effect: string };
type PolicyDiag = {
  policyId: number;
  policyNumber: string;
  currentStatus: string;
  statusHistory: Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>;
  flowKey: string | null;
  currentStepIndex: number;
  nextExpectedAction: string | null;
};

type DiagData = {
  flowSteps: FlowStep[];
  docTriggers: DocTrigger[];
  chains: Chain[];
  paymentTriggers: PaymentTrigger[];
  rollbackTriggers: RollbackTrigger[];
  policyDiag: PolicyDiag | null;
};

export function StatusFlowDiagPanel() {
  const [data, setData] = React.useState<DiagData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [policyNumber, setPolicyNumber] = React.useState("");
  const [searching, setSearching] = React.useState(false);

  const loadData = React.useCallback(async (pn?: string) => {
    const qs = pn ? `?policyNumber=${encodeURIComponent(pn)}&_t=${Date.now()}` : `?_t=${Date.now()}`;
    const res = await fetch(`/api/admin/diagnostics/status-flow${qs}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load");
    return res.json() as Promise<DiagData>;
  }, []);

  React.useEffect(() => {
    setLoading(true);
    loadData()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [loadData]);

  async function handleSearch() {
    if (!policyNumber.trim()) return;
    setSearching(true);
    try {
      const result = await loadData(policyNumber.trim());
      setData(result);
    } catch {}
    setSearching(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!data) {
    return <div className="py-8 text-center text-sm text-red-500">Failed to load status flow data</div>;
  }

  return (
    <div className="space-y-6">
      {/* Visual Flow */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Status Flow (Linear Order)</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {data.flowSteps.map((step, i) => {
            const isCurrent = data.policyDiag && data.policyDiag.currentStatus === step.status;
            const isPast = data.policyDiag && data.policyDiag.currentStepIndex >= 0 && step.index < data.policyDiag.currentStepIndex;
            const isFuture = data.policyDiag && data.policyDiag.currentStepIndex >= 0 && step.index > data.policyDiag.currentStepIndex;

            let badgeClass = "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
            if (isCurrent) badgeClass = "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 ring-2 ring-blue-400";
            else if (isPast) badgeClass = "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
            else if (isFuture) badgeClass = "bg-neutral-50 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-500";

            return (
              <React.Fragment key={step.status}>
                {i > 0 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" />}
                <Badge variant="custom" className={`text-[10px] whitespace-nowrap ${badgeClass}`}>
                  {isPast && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                  {isCurrent && <Circle className="mr-1 inline h-3 w-3 fill-current" />}
                  {step.label}
                </Badge>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Document Action → Status Mapping */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Document Action Triggers</h3>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          When a document action occurs, the policy status auto-advances to the target (forward-only).
        </p>
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Document Type</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Target Status</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              {data.docTriggers.map((t, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 font-mono text-xs text-blue-600 dark:text-blue-400">{t.docType}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      t.action === "send" ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"
                      : t.action === "confirm" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                    }`}>
                      {t.action}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="custom" className="text-[10px] bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {t.targetLabel}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auto-Chain Rules */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Auto-Chain Rules</h3>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          When a status is reached, it automatically advances to the next status in the chain (single DB write).
        </p>
        {data.chains.length > 0 ? (
          <div className="space-y-1.5">
            {data.chains.map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-700">
                <Badge variant="custom" className="text-[10px] bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {c.fromLabel}
                </Badge>
                <ArrowRight className="h-3.5 w-3.5 text-blue-500" />
                <Badge variant="custom" className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  {c.toLabel}
                </Badge>
                <span className="text-[11px] text-neutral-400 dark:text-neutral-500">— {c.note}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-400">No auto-chain rules configured.</p>
        )}
      </div>

      {/* Payment Triggers */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Payment Triggers</h3>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Actions outside the document template system that also advance status.
        </p>
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Trigger</th>
                <th className="px-3 py-2 text-left font-medium">Target Status</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              {data.paymentTriggers.map((t, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-xs">{t.trigger}</td>
                  <td className="px-3 py-2">
                    <Badge variant="custom" className="text-[10px] bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {t.targetStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rollback Triggers */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Rollback Triggers</h3>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          When admin rejects or resets a document that previously advanced the status, the system recalculates the correct status from the current state.
        </p>
        <div className="overflow-x-auto rounded-md border dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Trigger</th>
                <th className="px-3 py-2 text-left font-medium">Effect</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-neutral-700">
              {data.rollbackTriggers.map((t, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-xs">{t.trigger}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">{t.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Policy Lookup */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Policy Status Lookup</h3>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Enter policy number..."
            value={policyNumber}
            onChange={(e) => setPolicyNumber(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="max-w-xs text-xs"
          />
          <Button size="sm" onClick={handleSearch} disabled={searching || !policyNumber.trim()}>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            <span className="ml-1.5">Lookup</span>
          </Button>
        </div>

        {data.policyDiag && (
          <div className="rounded-md border border-neutral-200 dark:border-neutral-700 p-3 space-y-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{data.policyDiag.policyNumber}</span>
              {data.policyDiag.flowKey && (
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono dark:bg-neutral-800">
                  {data.policyDiag.flowKey}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">Current:</span>
              <Badge variant="custom" className="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {data.policyDiag.currentStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </Badge>
              <span className="text-[11px] text-neutral-400">
                (step {data.policyDiag.currentStepIndex + 1} of {data.flowSteps.length})
              </span>
            </div>

            {data.policyDiag.nextExpectedAction && (
              <div className="flex items-start gap-2 rounded bg-blue-50 px-2.5 py-1.5 dark:bg-blue-950/30">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
                <span className="text-[11px] text-blue-700 dark:text-blue-300">
                  <span className="font-medium">Next action:</span> {data.policyDiag.nextExpectedAction}
                </span>
              </div>
            )}

            {data.policyDiag.statusHistory.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Status History
                </p>
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {[...data.policyDiag.statusHistory].reverse().map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] text-neutral-600 dark:text-neutral-400">
                      <span className="shrink-0 w-[70px] text-neutral-400 dark:text-neutral-500">
                        {new Date(h.changedAt).toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <Badge variant="custom" className="text-[9px] bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                        {h.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </Badge>
                      {h.note && (
                        <span className="text-neutral-400 dark:text-neutral-500 truncate max-w-[250px]">{h.note}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {policyNumber.trim() && !searching && data.policyDiag === null && (
          <p className="text-xs text-neutral-400">No policy found with that number.</p>
        )}
      </div>

      {/* Upload Notification Settings */}
      <NotificationSettings />
    </div>
  );
}

function NotificationSettings() {
  const [enabled, setEnabled] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/admin/notification-settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setEnabled(!!data.enabled);
        setEmail(data.recipientEmail || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/admin/notification-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, recipientEmail: email }),
      });
    } catch {}
    setSaving(false);
  }

  if (loading) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Upload Notification (Opt-in)</h3>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        When enabled, sends an email notification when an agent or client uploads a document that requires review.
      </p>
      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded border-neutral-300 dark:border-neutral-600"
          />
          Enable email notifications for document uploads
        </label>
        {enabled && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Admin email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-xs text-xs"
            />
          </div>
        )}
        <div>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
