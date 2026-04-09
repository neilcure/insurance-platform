"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  CalendarClock,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  User,
  Briefcase,
  FileText,
  Play,
} from "lucide-react";
import {
  SCHEDULE_FREQUENCY_OPTIONS,
  SCHEDULE_FREQUENCY_LABELS,
  ENTITY_TYPE_LABELS,
  type ScheduleFrequency,
  type EntityType,
  type PaymentScheduleRow,
} from "@/lib/types/accounting";

type LinkedInvoice = {
  id: number;
  invoiceNumber: string;
  invoiceType: string;
  direction: string;
  entityPolicyId: number | null;
  entityName: string | null;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  status: string;
  notes: string | null;
  policyNumber: string | null;
};

type ScheduleDetail = PaymentScheduleRow & {
  linkedInvoices: LinkedInvoice[];
  eligibleInvoices: LinkedInvoice[];
};

type ClientOption = { id: number; displayName: string | null; clientNumber?: string | null; profilePolicyNumber?: string | null };
type AgentOption = { id: number; name: string | null; email: string; userNumber?: string | null };

function formatCurrency(cents: number, currency = "HKD"): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function getSchedulePurpose(type: EntityType) {
  return type === "agent"
    ? "Agent settlement / commission return"
    : "Client billing / premium statement";
}

export default function PaymentSchedulesPage() {
  const [schedules, setSchedules] = React.useState<PaymentScheduleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [expandedDetail, setExpandedDetail] = React.useState<ScheduleDetail | null>(null);
  const [showCreateForm, setShowCreateForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [generating, setGenerating] = React.useState<number | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [agents, setAgents] = React.useState<AgentOption[]>([]);

  const [formEntityType, setFormEntityType] = React.useState<EntityType>("client");
  const [formClientId, setFormClientId] = React.useState<string>("");
  const [formAgentId, setFormAgentId] = React.useState<string>("");
  const [formFrequency, setFormFrequency] = React.useState<ScheduleFrequency>("monthly");
  const [formBillingDay, setFormBillingDay] = React.useState<string>("1");
  const [formNotes, setFormNotes] = React.useState("");

  React.useEffect(() => {
    setLoading(true);
    fetch("/api/accounting/schedules", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setSchedules(Array.isArray(data) ? data : []))
      .catch(() => setSchedules([]))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  React.useEffect(() => {
    fetch("/api/clients?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : data?.clients ?? [];
        setClients(arr.map((c: Record<string, unknown>) => ({
          id: c.id as number,
          clientNumber: (c.clientNumber ?? null) as string | null,
          profilePolicyNumber: (c.profilePolicyNumber ?? null) as string | null,
          displayName: (c.displayName ?? c.name ?? `Client #${c.id}`) as string,
        })));
      })
      .catch(() => {});
    fetch("/api/agents?limit=500", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setAgents(arr.map((a: Record<string, unknown>) => ({
          id: a.id as number,
          userNumber: (a.userNumber ?? null) as string | null,
          name: (a.name ?? null) as string | null,
          email: (a.email ?? "") as string,
        })));
      })
      .catch(() => {});
  }, []);

  const resetForm = () => {
    setFormEntityType("client");
    setFormClientId("");
    setFormAgentId("");
    setFormFrequency("monthly");
    setFormBillingDay("1");
    setFormNotes("");
    setShowCreateForm(false);
    setEditingId(null);
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        entityType: formEntityType,
        frequency: formFrequency,
        billingDay: formBillingDay ? Number(formBillingDay) : null,
        notes: formNotes.trim() || null,
      };
      if (formEntityType === "client" && formClientId) body.clientId = Number(formClientId);
      if (formEntityType === "agent" && formAgentId) body.agentId = Number(formAgentId);

      const res = await fetch("/api/accounting/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Failed to create schedule");
      }
      resetForm();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: number) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        frequency: formFrequency,
        billingDay: formBillingDay ? Number(formBillingDay) : null,
        notes: formNotes.trim() || null,
      };

      const res = await fetch(`/api/accounting/schedules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update");
      resetForm();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (id: number, isActive: boolean) => {
    try {
      await fetch(`/api/accounting/schedules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      setRefreshKey((k) => k + 1);
    } catch {}
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this payment schedule? This cannot be undone.")) return;
    try {
      await fetch(`/api/accounting/schedules/${id}`, { method: "DELETE" });
      setRefreshKey((k) => k + 1);
    } catch {}
  };

  const handleGenerate = async (id: number) => {
    setGenerating(id);
    try {
      const res = await fetch(`/api/accounting/schedules/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "No outstanding premiums to generate");
      } else {
        alert(`Statement ${data.statement?.invoiceNumber} created with ${data.itemCount} items.`);
        setRefreshKey((k) => k + 1);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setGenerating(null);
    }
  };

  const [linkingSaving, setLinkingSaving] = React.useState(false);

  const handleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    try {
      const res = await fetch(`/api/accounting/schedules/${id}?includeEligible=1`, { cache: "no-store" });
      const data = await res.json();
      setExpandedDetail(data);
    } catch {
      setExpandedDetail(null);
    }
  };

  const reloadDetail = async (id: number) => {
    try {
      const res = await fetch(`/api/accounting/schedules/${id}?includeEligible=1`, { cache: "no-store" });
      const data = await res.json();
      setExpandedDetail(data);
    } catch {}
  };

  const handleLinkToggle = async (scheduleId: number, invoiceId: number, add: boolean) => {
    setLinkingSaving(true);
    try {
      const body = add
        ? { addInvoiceIds: [invoiceId] }
        : { removeInvoiceIds: [invoiceId] };
      const res = await fetch(`/api/accounting/schedules/${scheduleId}/link-invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update");
      await reloadDetail(scheduleId);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLinkingSaving(false);
    }
  };

  const startEdit = (s: PaymentScheduleRow) => {
    setEditingId(s.id);
    setFormEntityType(s.entityType as EntityType);
    setFormFrequency(s.frequency as ScheduleFrequency);
    setFormBillingDay(String(s.billingDay ?? "1"));
    setFormNotes(s.notes || "");
    setShowCreateForm(false);
  };

  const entityIcon = (type: string) =>
    type === "client" ? <User className="h-3.5 w-3.5" /> : <Briefcase className="h-3.5 w-3.5" />;

  const getScheduleEntityLabel = React.useCallback((s: PaymentScheduleRow) => {
    if (s.entityType === "client" && s.clientId) {
      const client = clients.find((c) => c.id === s.clientId);
      if (client) {
        const parts = [client.profilePolicyNumber || client.clientNumber, client.displayName, `Client ID ${client.id}`].filter(Boolean);
        if (parts.length > 0) return parts.join(" · ");
      }
    }

    if (s.entityType === "agent" && s.agentId) {
      const agent = agents.find((a) => a.id === s.agentId);
      if (agent) {
        const parts = [agent.userNumber, agent.name || agent.email, `Agent ID ${agent.id}`].filter(Boolean);
        if (parts.length > 0) return parts.join(" · ");
      }
    }

    if (s.entityName?.trim()) return s.entityName.trim();

    return ENTITY_TYPE_LABELS[s.entityType as EntityType] ?? s.entityType;
  }, [agents, clients]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-3 pt-0 sm:p-6 sm:pt-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Payment Schedules
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Manage client billing schedules and agent settlement schedules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setShowCreateForm(true);
            }}
          >
            <Plus className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">New Schedule</span>
          </Button>
        </div>
      </div>
      <Separator />

      {/* Create form */}
      {showCreateForm && (
        <Card className="border-indigo-200 dark:border-indigo-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              New Payment Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
              {formEntityType === "agent"
                ? "Agent schedules are for settlement items such as commission returns and other payable balances."
                : "Client schedules are for policy premium billing and periodic client-facing statements."}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Entity Type</Label>
                <select
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={formEntityType}
                  onChange={(e) => setFormEntityType(e.target.value as EntityType)}
                >
                  <option value="client">Client</option>
                  <option value="agent">Agent</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">
                  {formEntityType === "client" ? "Client" : "Agent"}
                </Label>
                {formEntityType === "client" ? (
                  <select
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={formClientId}
                    onChange={(e) => setFormClientId(e.target.value)}
                  >
                    <option value="">Select client...</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.displayName}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={formAgentId}
                    onChange={(e) => setFormAgentId(e.target.value)}
                  >
                    <option value="">Select agent...</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.name || a.email}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Frequency</Label>
                <select
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={formFrequency}
                  onChange={(e) => setFormFrequency(e.target.value as ScheduleFrequency)}
                >
                  {SCHEDULE_FREQUENCY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">
                  {formFrequency === "weekly" ? "Day of Week (0=Sun)" : "Billing Day"}
                </Label>
                <Input
                  type="number"
                  min={formFrequency === "weekly" ? 0 : 1}
                  max={formFrequency === "weekly" ? 6 : 31}
                  value={formBillingDay}
                  onChange={(e) => setFormBillingDay(e.target.value)}
                  className="mt-1 h-8 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                type="text"
                placeholder="Schedule notes..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" disabled={saving} onClick={handleCreate}>
                {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Creating...</> : "Create Schedule"}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Schedule list */}
      {loading ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin mb-2" />
          Loading schedules...
        </div>
      ) : schedules.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-400">
          No payment schedules configured. Create one to enable period billing.
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => {
            const isEditing = editingId === s.id;
            const isExpanded = expandedId === s.id;
            return (
              <Card key={s.id} className={`overflow-hidden ${!s.isActive ? "opacity-60" : ""}`}>
                <button
                  type="button"
                  onClick={() => handleExpand(s.id)}
                  className="w-full px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      {entityIcon(s.entityType)}
                      <span className="text-sm font-medium truncate">
                        {getScheduleEntityLabel(s)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant="custom"
                        className={`text-[10px] ${s.isActive
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                        }`}
                      >
                        {s.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="custom" className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                        {SCHEDULE_FREQUENCY_LABELS[s.frequency as ScheduleFrequency] ?? s.frequency}
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-neutral-400" /> : <ChevronDown className="h-4 w-4 text-neutral-400" />}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {ENTITY_TYPE_LABELS[s.entityType as EntityType] ?? s.entityType}
                    {s.billingDay ? ` · Day ${s.billingDay}` : ""}
                    {s.lastGeneratedAt ? ` · Last: ${new Date(s.lastGeneratedAt).toLocaleDateString()}` : " · Never generated"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-indigo-600 dark:text-indigo-400">
                    {getSchedulePurpose(s.entityType as EntityType)}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3 space-y-3">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Frequency</Label>
                            <select
                              className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                              value={formFrequency}
                              onChange={(e) => setFormFrequency(e.target.value as ScheduleFrequency)}
                            >
                              {SCHEDULE_FREQUENCY_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">
                              {formFrequency === "weekly" ? "Day of Week (0=Sun)" : "Billing Day"}
                            </Label>
                            <Input
                              type="number"
                              min={formFrequency === "weekly" ? 0 : 1}
                              max={formFrequency === "weekly" ? 6 : 31}
                              value={formBillingDay}
                              onChange={(e) => setFormBillingDay(e.target.value)}
                              className="mt-1 h-8 text-sm"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">Notes</Label>
                          <Input
                            type="text"
                            value={formNotes}
                            onChange={(e) => setFormNotes(e.target.value)}
                            className="mt-1 h-8 text-sm"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" disabled={saving} onClick={() => handleUpdate(s.id)}>
                            {saving ? "Saving..." : "Save"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                            <div className="text-neutral-500 dark:text-neutral-400">Frequency</div>
                            <div className="font-medium">{SCHEDULE_FREQUENCY_LABELS[s.frequency as ScheduleFrequency] ?? s.frequency}</div>
                          </div>
                          <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                            <div className="text-neutral-500 dark:text-neutral-400">Billing Day</div>
                            <div className="font-medium">{s.billingDay ?? "—"}</div>
                          </div>
                          <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                            <div className="text-neutral-500 dark:text-neutral-400">Currency</div>
                            <div className="font-medium">{s.currency}</div>
                          </div>
                          <div className="rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-2">
                            <div className="text-neutral-500 dark:text-neutral-400">Last Period</div>
                            <div className="font-medium">
                              {s.lastPeriodStart && s.lastPeriodEnd
                                ? `${s.lastPeriodStart} – ${s.lastPeriodEnd}`
                                : "—"}
                            </div>
                          </div>
                        </div>

                        {s.notes && (
                          <div className="text-xs text-neutral-500 dark:text-neutral-400 italic">{s.notes}</div>
                        )}

                        {/* Linked Policies / Invoices */}
                        {expandedDetail && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
                              {s.entityType === "agent"
                                ? `Settlement Items on Statement (${expandedDetail.linkedInvoices.length})`
                                : `Policies on Statement (${expandedDetail.linkedInvoices.length})`}
                            </div>
                            {expandedDetail.linkedInvoices.length === 0 ? (
                              <div className="text-[11px] text-neutral-400 italic py-1">
                                {s.entityType === "agent"
                                  ? "No settlement items added to this statement yet."
                                  : "No policies added to this statement yet."}
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {expandedDetail.linkedInvoices.map((inv) => (
                                  <label
                                    key={inv.id}
                                    className="flex items-center gap-2 rounded-md border border-indigo-100 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/20 p-2 text-xs cursor-pointer hover:bg-indigo-100/60 dark:hover:bg-indigo-950/40 transition-colors"
                                  >
                                    <input
                                      type="checkbox"
                                      checked
                                      disabled={linkingSaving}
                                      onChange={() => handleLinkToggle(s.id, inv.id, false)}
                                      className="accent-indigo-600 h-3.5 w-3.5"
                                    />
                                    <FileText className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <span className="font-medium">{inv.invoiceNumber}</span>
                                      {inv.policyNumber && (
                                        <span className="text-neutral-500 dark:text-neutral-400 ml-1">
                                          · {inv.policyNumber}
                                        </span>
                                      )}
                                    </div>
                                    <span className="shrink-0 font-medium text-indigo-700 dark:text-indigo-300">
                                      {formatCurrency(inv.totalAmountCents - inv.paidAmountCents, inv.currency)}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}

                            {/* Eligible (not yet linked) invoices */}
                            {expandedDetail.eligibleInvoices.length > 0 && (
                              <>
                                <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 mt-3">
                                  {s.entityType === "agent"
                                    ? `Available Settlement Items (${expandedDetail.eligibleInvoices.length})`
                                    : `Available to Add (${expandedDetail.eligibleInvoices.length})`}
                                </div>
                                <div className="space-y-1">
                                  {expandedDetail.eligibleInvoices.map((inv) => (
                                    <label
                                      key={inv.id}
                                      className="flex items-center gap-2 rounded-md border border-neutral-100 dark:border-neutral-700 p-2 text-xs cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={false}
                                        disabled={linkingSaving}
                                        onChange={() => handleLinkToggle(s.id, inv.id, true)}
                                        className="accent-indigo-600 h-3.5 w-3.5"
                                      />
                                      <FileText className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <span className="font-medium">{inv.invoiceNumber}</span>
                                        {inv.policyNumber && (
                                          <span className="text-neutral-500 dark:text-neutral-400 ml-1">
                                            · {inv.policyNumber}
                                          </span>
                                        )}
                                      </div>
                                      <span className="shrink-0 text-neutral-500">
                                        {formatCurrency(inv.totalAmountCents - inv.paidAmountCents, inv.currency)}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-1">
                          <Button size="sm" variant="outline" onClick={() => startEdit(s)}>
                            <Pencil className="h-3.5 w-3.5 sm:hidden lg:inline" />
                            <span className="hidden sm:inline">Edit</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggleActive(s.id, s.isActive)}
                          >
                            {s.isActive ? "Deactivate" : "Activate"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={generating === s.id || !s.isActive}
                            onClick={() => handleGenerate(s.id)}
                            className="text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-800 dark:hover:bg-indigo-950/30"
                          >
                            {generating === s.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5 sm:hidden lg:inline" />
                            )}
                            <span className="hidden sm:inline">{s.entityType === "agent" ? "Generate Settlement" : "Generate Statement"}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 ml-auto"
                            onClick={() => handleDelete(s.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
