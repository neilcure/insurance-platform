"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { toast } from "sonner";
import {
  Plus,
  Calendar,
  Loader2,
  Eye,
  PlayCircle,
  Pause,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type {
  PaymentScheduleRow,
  EntityType,
  ScheduleFrequency,
  AccountingInvoiceRow,
  InvoiceStatus,
} from "@/lib/types/accounting";
import {
  ENTITY_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
} from "@/lib/types/accounting";

type Props = {
  flowOptions: Array<{ value: string; label: string }>;
};

function fmtCurrency(cents: number, currency = "HKD"): string {
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  partial: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  submitted: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  verified: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  cancelled: "bg-neutral-300 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-500",
};

export function SchedulesPanel({ flowOptions }: Props) {
  const [schedules, setSchedules] = React.useState<PaymentScheduleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [selectedSchedule, setSelectedSchedule] = React.useState<PaymentScheduleRow | null>(null);

  const loadSchedules = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounting/schedules", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setSchedules(await res.json());
    } catch {
      toast.error("Failed to load schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadSchedules(); }, [loadSchedules]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Payment Schedules</h3>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">New Schedule</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={loadSchedules}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-neutral-500">Loading...</div>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <Calendar className="mx-auto mb-2 h-8 w-8 text-neutral-400" />
              <p className="text-sm text-neutral-600 dark:text-neutral-400">No payment schedules created yet.</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
                Create a schedule to group an agent or client into weekly/monthly billing cycles.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {schedules.map((s) => (
            <Card key={s.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => setSelectedSchedule(s)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{s.entityName || "Unnamed"}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {ENTITY_TYPE_LABELS[s.entityType as EntityType] || s.entityType}
                    </p>
                  </div>
                  <Badge variant={s.isActive ? "success" : "secondary"}>
                    {s.isActive ? "Active" : "Paused"}
                  </Badge>
                </div>
                <Separator className="my-2" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {s.frequency === "weekly" ? "Weekly" : "Monthly"}
                    {s.billingDay ? ` (Day ${s.billingDay})` : ""}
                  </span>
                  <span className="font-medium">{s.currency}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateScheduleDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          void loadSchedules();
        }}
      />

      {selectedSchedule && (
        <ScheduleDetailDrawer
          schedule={selectedSchedule}
          open={!!selectedSchedule}
          onClose={() => setSelectedSchedule(null)}
          onUpdated={loadSchedules}
          flowOptions={flowOptions}
        />
      )}
    </div>
  );
}

function CreateScheduleDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [entityType, setEntityType] = React.useState<EntityType>("agent");
  const [entityName, setEntityName] = React.useState("");
  const [frequency, setFrequency] = React.useState<ScheduleFrequency>("monthly");
  const [billingDay, setBillingDay] = React.useState("1");
  const [currency, setCurrency] = React.useState("HKD");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    if (!entityName.trim()) {
      toast.error("Please enter a name");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/accounting/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityName: entityName.trim(),
          frequency,
          billingDay: Number(billingDay) || null,
          currency,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast.success("Schedule created");
      setEntityName("");
      setNotes("");
      onCreated();
    } catch (err: any) {
      toast.error(err.message || "Failed to create schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Payment Schedule</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label>Entity Type</Label>
              <select
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as EntityType)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="agent">Agent</option>
                <option value="client">Client</option>
                <option value="collaborator">Collaborator</option>
              </select>
            </div>
            <div>
              <Label>Name</Label>
              <Input value={entityName} onChange={(e) => setEntityName(e.target.value)} className="mt-1" placeholder="Agent / Client name" />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label>Frequency</Label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <Label>{frequency === "weekly" ? "Day of Week (1-7)" : "Day of Month (1-31)"}</Label>
              <Input
                type="number"
                value={billingDay}
                onChange={(e) => setBillingDay(e.target.value)}
                min={1}
                max={frequency === "weekly" ? 7 : 31}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDetailDrawer({
  schedule,
  open,
  onClose,
  onUpdated,
  flowOptions,
}: {
  schedule: PaymentScheduleRow;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  flowOptions: Array<{ value: string; label: string }>;
}) {
  const [detail, setDetail] = React.useState<(PaymentScheduleRow & { statements: AccountingInvoiceRow[] }) | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [showGenerate, setShowGenerate] = React.useState(false);
  const [periodStart, setPeriodStart] = React.useState("");
  const [periodEnd, setPeriodEnd] = React.useState("");
  const [genFlow, setGenFlow] = React.useState("");

  const loadDetail = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/schedules/${schedule.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      setDetail(await res.json());
    } catch {
      toast.error("Failed to load schedule details");
    } finally {
      setLoading(false);
    }
  }, [schedule.id]);

  React.useEffect(() => {
    if (open) void loadDetail();
  }, [open, loadDetail]);

  const handleToggleActive = async () => {
    try {
      const res = await fetch(`/api/accounting/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !schedule.isActive }),
      });
      if (!res.ok) throw new Error();
      toast.success(schedule.isActive ? "Schedule paused" : "Schedule activated");
      onUpdated();
    } catch {
      toast.error("Failed to update schedule");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this schedule? Existing statements will not be affected.")) return;
    try {
      const res = await fetch(`/api/accounting/schedules/${schedule.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Schedule deleted");
      onClose();
      onUpdated();
    } catch {
      toast.error("Failed to delete schedule");
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/accounting/schedules/${schedule.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodStart: periodStart || null,
          periodEnd: periodEnd || null,
          flowFilter: genFlow || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      const result = await res.json();
      toast.success(`Statement ${result.statement.invoiceNumber} created with ${result.itemCount} items`);
      setShowGenerate(false);
      void loadDetail();
      onUpdated();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate statement");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SlideDrawer
      open={open}
      onClose={onClose}
      title={`Schedule: ${schedule.entityName || "Unnamed"}`}
      side="right"
      widthClass="w-[340px] sm:w-[440px] md:w-[520px]"
    >
      <div className="overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
          </div>
        ) : !detail ? (
          <div className="py-12 text-center text-sm text-neutral-500">Not found</div>
        ) : (
          <div className="space-y-5">
            {/* Schedule info */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{detail.entityName || "Unnamed"}</h3>
                <Badge variant={detail.isActive ? "success" : "secondary"}>
                  {detail.isActive ? "Active" : "Paused"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Type</span>
                  <p className="font-medium">{ENTITY_TYPE_LABELS[detail.entityType as EntityType]}</p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Frequency</span>
                  <p className="font-medium">
                    {detail.frequency === "weekly" ? "Weekly" : "Monthly"}
                    {detail.billingDay ? ` (Day ${detail.billingDay})` : ""}
                  </p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Currency</span>
                  <p className="font-medium">{detail.currency}</p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Created</span>
                  <p className="font-medium">{fmtDate(detail.createdAt)}</p>
                </div>
              </div>
              {detail.notes && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">{detail.notes}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setShowGenerate(true)}>
                <PlayCircle className="mr-1 h-4 w-4" />
                Generate Statement
              </Button>
              <Button size="sm" variant="outline" onClick={handleToggleActive}>
                <Pause className="mr-1 h-4 w-4" />
                {detail.isActive ? "Pause" : "Activate"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleDelete}>
                <Trash2 className="mr-1 h-4 w-4 text-red-500" />
              </Button>
            </div>

            <Separator />

            {/* Statements */}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Statements ({detail.statements.length})</h4>
              {detail.statements.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No statements generated yet. Click "Generate Statement" to create one.
                </p>
              ) : (
                <div className="space-y-2">
                  {detail.statements.map((st) => (
                    <div key={st.id} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{st.invoiceNumber}</span>
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[st.status] || ""}`}>
                          {INVOICE_STATUS_LABELS[st.status as InvoiceStatus] || st.status}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                        <span>
                          {st.periodStart && st.periodEnd
                            ? `${fmtDate(st.periodStart)} — ${fmtDate(st.periodEnd)}`
                            : fmtDate(st.invoiceDate)}
                        </span>
                        <span className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
                          {fmtCurrency(st.totalAmountCents, st.currency)}
                        </span>
                      </div>
                      {st.paidAmountCents > 0 && (
                        <div className="mt-1 text-xs">
                          <span className="text-green-600 dark:text-green-400">
                            Paid: {fmtCurrency(st.paidAmountCents, st.currency)}
                          </span>
                          <span className="mx-1 text-neutral-400">|</span>
                          <span className="text-red-600 dark:text-red-400">
                            Remaining: {fmtCurrency(st.totalAmountCents - st.paidAmountCents, st.currency)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Generate Statement Dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Statement</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              This will collect all outstanding premiums for <strong>{schedule.entityName}</strong> and create a batch statement invoice.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Period Start</Label>
                <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Period End</Label>
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="mt-1" />
              </div>
            </div>
            {flowOptions.length > 0 && (
              <div>
                <Label>Filter by Flow</Label>
                <select
                  value={genFlow}
                  onChange={(e) => setGenFlow(e.target.value)}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  <option value="">All Flows</option>
                  {flowOptions.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerate(false)}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SlideDrawer>
  );
}
