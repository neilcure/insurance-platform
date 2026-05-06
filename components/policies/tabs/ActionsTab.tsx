"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getIcon } from "@/lib/icons";
import type { WorkflowActionRow, WorkflowActionMeta } from "@/lib/types/workflow-action";
import type { PolicyDetail } from "@/lib/types/policy";
import {
  AgentPickerDrawer,
  type AgentPickerSelection,
} from "@/components/policies/AgentPickerDrawer";
import { cn } from "@/lib/utils";
import {
  readPdfSelectionMarkFromStorage,
  readPdfSelectionMarkScaleFromStorage,
} from "@/lib/pdf/form-selections-preferences";

async function recordActionTimestamp(
  policyId: number,
  actionKey: string,
  actionLabel: string,
  meta: WorkflowActionMeta,
) {
  try {
    await fetch(`/api/policies/${policyId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        note: `Action executed: ${actionLabel}${meta.targetStatus ? ` → ${meta.targetStatus}` : ""}`,
        noteAction: "append",
      }),
    });
  } catch { /* best-effort */ }
}

type ActionCardProps = {
  action: WorkflowActionRow;
  policyId: number;
  policyNumber: string;
  detail: PolicyDetail;
  onComplete?: () => void;
};

function ActionCard({
  action,
  policyId,
  policyNumber,
  detail,
  onComplete,
}: ActionCardProps) {
  const meta = action.meta!;
  const Icon = getIcon(meta.icon);
  const [inputVal, setInputVal] = React.useState("");
  const [selectedAgent, setSelectedAgent] = React.useState<AgentPickerSelection | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [showManualLookup, setShowManualLookup] = React.useState(false);
  const [assignPanelOpen, setAssignPanelOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const isReassignAgent =
    meta.type === "custom" && action.value === "reassign_agent";

  async function execute() {
    if (isReassignAgent) {
      if (!selectedAgent && !inputVal.trim()) {
        toast.error(
          "Pick an agent or enter email, agent number, or user ID.",
        );
        return;
      }
    } else if (meta.requiresInput && !inputVal.trim()) {
      toast.error(`Please enter ${meta.inputLabel?.toLowerCase() || "a value"}`);
      return;
    }
    setBusy(true);
    try {
      const timestamp = new Date().toISOString();

      await recordActionTimestamp(policyId, action.value, action.label, meta);

      switch (meta.type) {
        case "email": {
          const res = await fetch(`/api/policies/${policyId}/send`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: inputVal.trim() }),
          });
          if (!res.ok) throw new Error(await res.text());
          toast.success(`Sent to ${inputVal.trim()}`);
          setInputVal("");
          break;
        }

        case "note": {
          const res = await fetch(`/api/policies/${policyId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              note: inputVal.trim(),
              noteAction: "append",
            }),
          });
          if (!res.ok) throw new Error(await res.text());
          toast.success("Note saved");
          setInputVal("");
          break;
        }

        case "duplicate": {
          const res = await fetch(`/api/policies/${policyId}/duplicate`, {
            method: "POST",
          });
          if (!res.ok) throw new Error(await res.text());
          const json = await res.json();
          toast.success(
            `Duplicated as ${json.policyNumber || "new record"}`,
          );
          break;
        }

        case "export": {
          const extra = detail.extraAttributes ?? {};
          const blob = new Blob(
            [JSON.stringify({ policyNumber, createdAt: detail.createdAt, ...extra }, null, 2)],
            { type: "application/json" },
          );
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${policyNumber}.json`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("Downloaded");
          break;
        }

        case "send_document": {
          if (!meta.documentTemplateId) {
            toast.error("No document template configured for this action");
            break;
          }
          const genRes = await fetch(`/api/pdf-templates/${meta.documentTemplateId}/generate`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              policyId,
              selectionMarkStyle: readPdfSelectionMarkFromStorage(),
              selectionMarkScale: readPdfSelectionMarkScaleFromStorage(),
            }),
          });
          if (!genRes.ok) throw new Error(await genRes.text());
          if (inputVal.trim()) {
            const sendRes = await fetch(`/api/pdf-templates/send-email`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                policyId,
                templateId: meta.documentTemplateId,
                email: inputVal.trim(),
                selectionMarkStyle: readPdfSelectionMarkFromStorage(),
                selectionMarkScale: readPdfSelectionMarkScaleFromStorage(),
              }),
            });
            if (!sendRes.ok) throw new Error(await sendRes.text());
            toast.success(`Document generated and sent to ${inputVal.trim()}`);
          } else {
            toast.success("Document generated successfully");
          }
          setInputVal("");
          break;
        }

        case "custom": {
          if (action.value === "reassign_agent") {
            const payload =
              selectedAgent
                ? { agentId: selectedAgent.id }
                : { agentLookup: inputVal.trim() };
            const res = await fetch(`/api/policies/${policyId}/reassign`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              let msg = await res.text();
              try {
                const j = JSON.parse(msg) as { error?: string };
                if (j?.error) msg = j.error;
              } catch {
                /* keep raw */
              }
              throw new Error(msg);
            }
            toast.success("Agent reassigned");
            setInputVal("");
            setSelectedAgent(null);
            setShowManualLookup(false);
          } else if (meta.webhookUrl) {
            const res = await fetch(meta.webhookUrl, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                policyId,
                policyNumber,
                input: inputVal.trim() || undefined,
                timestamp,
              }),
            });
            if (!res.ok) throw new Error(await res.text());
            toast.success("Action completed");
            setInputVal("");
          } else {
            toast.info("Custom action - no handler configured");
          }
          break;
        }

        case "status_change": {
          const res = await fetch(`/api/policies/${policyId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status: meta.targetStatus }),
          });
          if (!res.ok) throw new Error(await res.text());
          toast.success(`Status changed to ${meta.targetStatus}`);
          break;
        }

        case "webhook": {
          if (!meta.webhookUrl) {
            toast.error("Webhook URL not configured");
            break;
          }
          const res = await fetch(meta.webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              policyId,
              policyNumber,
              input: inputVal.trim() || undefined,
              timestamp,
            }),
          });
          if (!res.ok) throw new Error(await res.text());
          toast.success("Webhook sent");
          setInputVal("");
          break;
        }

        default:
          toast.info("Unknown action type");
      }
      onComplete?.();
    } catch (err: unknown) {
      toast.error(
        (err as { message?: string })?.message ?? "Action failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {action.label}
      </div>
      {meta.description && (
        <p className="mb-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          {meta.description.replace("{{policyNumber}}", policyNumber)}
        </p>
      )}
      {isReassignAgent ? (
        <div className="space-y-2">
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setAssignPanelOpen((v) => !v)}
              aria-expanded={assignPanelOpen}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{assignPanelOpen ? "Hide" : "Assign Agent"}</span>
            </Button>
          </div>
          <div
            className={cn(
              "overflow-hidden transition-all duration-500 ease-in-out",
              assignPanelOpen ? "max-h-[260px] opacity-100" : "max-h-0 opacity-0",
            )}
          >
            <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900/40">
              {showManualLookup ? (
                <Input
                  placeholder="Email, agent #, or user ID"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  className="h-8 text-xs"
                  aria-label="Agent email, number, or user id"
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    className="shrink-0"
                    onClick={() => setPickerOpen(true)}
                  >
                    {selectedAgent ? "Change" : "Select agent"}
                  </Button>
                  <span className="flex-1 min-w-0 truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {selectedAgent
                      ? `${selectedAgent.userNumber ? `${selectedAgent.userNumber} - ` : ""}${selectedAgent.name ?? ""} <${selectedAgent.email}>`
                      : "No agent selected"}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-[11px] font-medium text-blue-600 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
                  onClick={() => setShowManualLookup((v) => !v)}
                >
                  {showManualLookup ? "Use agent picker instead" : "Use manual lookup instead"}
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => {
                      setSelectedAgent(null);
                      setInputVal("");
                      setShowManualLookup(false);
                      setAssignPanelOpen(false);
                    }}
                    disabled={busy}
                    className="shrink-0"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={execute}
                    disabled={busy}
                    className="shrink-0"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      (meta.buttonLabel ?? "Reassign")
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {meta.requiresInput ? (
            <Input
              placeholder={meta.inputPlaceholder ?? ""}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              className="h-8 flex-1 text-xs"
            />
          ) : null}
          <Button
            size="sm"
            onClick={execute}
            disabled={busy}
            className="shrink-0 sm:ml-auto"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              (meta.buttonLabel ?? "Run")
            )}
          </Button>
        </div>
      )}
      {isReassignAgent ? (
        <AgentPickerDrawer
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(agent) => {
            setSelectedAgent(agent);
            setInputVal("");
          }}
        />
      ) : null}
    </div>
  );
}

export function ActionsTab({
  policyId,
  policyNumber,
  detail,
  currentAgent,
  flowKey,
  currentStatus,
  onActionComplete,
}: {
  policyId: number;
  policyNumber: string;
  detail: PolicyDetail;
  currentAgent?: { id: number; name?: string | null; email?: string } | null;
  flowKey?: string;
  currentStatus?: string;
  onActionComplete?: () => void;
}) {
  const [actions, setActions] = React.useState<WorkflowActionRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/form-options?groupKey=workflow_actions&_t=${Date.now()}`,
      { cache: "no-store" },
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: WorkflowActionRow[]) => {
        if (cancelled) return;
        const applicable = rows.filter((r) => {
          if (!r.meta) return false;
          const flows = r.meta.flows;
          if (flows && flows.length > 0) {
            if (!flowKey || !flows.includes(flowKey)) return false;
          }
          return true;
        });
        setActions(applicable);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowKey]);

  const visibleActions = React.useMemo(() => {
    return actions.filter((a) => {
      const sws = a.meta?.showWhenStatus;
      if (!sws || sws.length === 0) return true;
      const status = currentStatus || "quotation_prepared";
      return sws.includes(status);
    });
  }, [actions, currentStatus]);

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Loading actions...
      </div>
    );
  }

  if (visibleActions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700">
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
          {actions.length > 0 ? "No actions available for current status" : "No actions configured"}
        </div>
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
          {actions.length > 0
            ? "Actions will appear when the record reaches the appropriate stage."
            : "Go to Admin \u2192 Policy Settings \u2192 Workflow Actions to add actions."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleActions.map((action) => (
        <ActionCard
          key={action.id}
          action={action}
          policyId={policyId}
          policyNumber={policyNumber}
          detail={detail}
          onComplete={onActionComplete}
        />
      ))}
    </div>
  );
}
