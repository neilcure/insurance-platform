"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Bell,
  BellOff,
  Plus,
  Trash2,
  Loader2,
  Pause,
  Play,
  Send,
  Clock,
  CheckCircle2,
  Mail,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReminderScheduleRow } from "@/lib/types/reminder";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type ReminderSchedulerProps = {
  policyId: number;
  documentTypeKey: string;
  documentLabel: string;
  isAdmin: boolean;
  defaultRecipientEmail?: string;
};

export function ReminderScheduler({
  policyId,
  documentTypeKey,
  documentLabel,
  isAdmin,
  defaultRecipientEmail,
}: ReminderSchedulerProps) {
  const [reminders, setReminders] = React.useState<ReminderScheduleRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);

  const [formEmail, setFormEmail] = React.useState(defaultRecipientEmail ?? "");
  const [formInterval, setFormInterval] = React.useState(3);
  const [formMaxSends, setFormMaxSends] = React.useState("");
  const [formMessage, setFormMessage] = React.useState("");
  const [formSendNow, setFormSendNow] = React.useState(true);

  const activeReminders = reminders.filter((r) => r.isActive && !r.completedAt);
  const completedReminders = reminders.filter((r) => !r.isActive || r.completedAt);

  async function loadReminders() {
    try {
      const res = await fetch(
        `/api/policies/${policyId}/reminders?_t=${Date.now()}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const all: ReminderScheduleRow[] = await res.json();
      setReminders(all.filter((r) => r.documentTypeKey === documentTypeKey));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadReminders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId, documentTypeKey]);

  function openCreate() {
    setFormEmail(defaultRecipientEmail ?? "");
    setFormInterval(3);
    setFormMaxSends("");
    setFormMessage("");
    setFormSendNow(true);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!formEmail.trim() || !formEmail.includes("@")) {
      toast.error("Please enter a valid email");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/policies/${policyId}/reminders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentTypeKey,
          recipientEmail: formEmail.trim(),
          intervalDays: formInterval,
          maxSends: formMaxSends ? Number(formMaxSends) : null,
          customMessage: formMessage.trim() || null,
          sendNow: formSendNow,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed");
      }
      toast.success(formSendNow ? "Reminder created and first email sent" : "Reminder created");
      setCreateOpen(false);
      loadReminders();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Failed to create reminder");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(reminder: ReminderScheduleRow) {
    setActionBusy(reminder.id);
    try {
      const res = await fetch(
        `/api/policies/${policyId}/reminders/${reminder.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ isActive: !reminder.isActive }),
        },
      );
      if (!res.ok) throw new Error("Failed");
      toast.success(reminder.isActive ? "Reminder paused" : "Reminder resumed");
      loadReminders();
    } catch {
      toast.error("Failed to update reminder");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this reminder schedule?")) return;
    setActionBusy(id);
    try {
      const res = await fetch(`/api/policies/${policyId}/reminders/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Reminder deleted");
      loadReminders();
    } catch {
      toast.error("Failed to delete reminder");
    } finally {
      setActionBusy(null);
    }
  }

  if (!isAdmin) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading reminders...
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1.5">
        {/* Active reminders */}
        {activeReminders.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-2 rounded border border-blue-100 bg-blue-50/50 p-2 text-xs dark:border-blue-900/40 dark:bg-blue-950/20"
          >
            <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-blue-700 dark:text-blue-300">
                  Reminding every {r.intervalDays}d
                </span>
                {r.maxSends && (
                  <span className="text-[10px] text-blue-500 dark:text-blue-400">
                    (max {r.maxSends})
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
                <span className="flex items-center gap-0.5">
                  <Mail className="h-2.5 w-2.5" /> {r.recipientEmail}
                </span>
                <span>&middot;</span>
                <span>Sent {r.sendCount ?? 0}x</span>
                {r.lastSentAt && (
                  <>
                    <span>&middot;</span>
                    <span>Last: {formatDate(r.lastSentAt)}</span>
                  </>
                )}
              </div>
              {r.customMessage && (
                <div className="mt-0.5 truncate text-[10px] italic text-neutral-400">
                  &ldquo;{r.customMessage}&rdquo;
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-amber-500 hover:text-amber-600"
                title="Pause"
                onClick={() => handleToggle(r)}
                disabled={actionBusy === r.id}
              >
                {actionBusy === r.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Pause className="h-3 w-3" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-neutral-400 hover:text-red-500"
                title="Delete"
                onClick={() => handleDelete(r.id)}
                disabled={actionBusy === r.id}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}

        {/* Completed / paused reminders */}
        {completedReminders.map((r) => {
          const reason = r.completedReason === "document_verified"
            ? "Auto-completed (verified)"
            : r.completedReason === "max_sends_reached"
              ? "Max sends reached"
              : r.completedReason === "paused_by_admin"
                ? "Paused"
                : "Stopped";
          const canResume = r.completedReason === "paused_by_admin";
          return (
            <div
              key={r.id}
              className="flex items-start gap-2 rounded border border-neutral-100 bg-neutral-50/50 p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900/30"
            >
              <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-neutral-500 line-through">{r.recipientEmail}</span>
                  <Badge variant="outline" className="border-0 text-[10px] bg-neutral-100 text-neutral-500 dark:bg-neutral-800">
                    {reason}
                  </Badge>
                </div>
                <div className="mt-0.5 text-[10px] text-neutral-400">
                  Sent {r.sendCount ?? 0}x
                  {r.completedAt && ` · Stopped ${formatDate(r.completedAt)}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {canResume && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-green-500 hover:text-green-600"
                    title="Resume"
                    onClick={() => handleToggle(r)}
                    disabled={actionBusy === r.id}
                  >
                    {actionBusy === r.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-neutral-400 hover:text-red-500"
                  title="Delete"
                  onClick={() => handleDelete(r.id)}
                  disabled={actionBusy === r.id}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          );
        })}

        {/* Add reminder button — three-stage responsive: icon / text / icon+text */}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 sm:px-2 text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400"
          onClick={openCreate}
          title={activeReminders.length > 0 ? "Add another reminder" : "Set up reminder"}
        >
          <Bell className="h-3.5 w-3.5 sm:hidden lg:inline" />
          <span className="hidden sm:inline">{activeReminders.length > 0 ? "Add reminder" : "Reminder"}</span>
        </Button>
      </div>

      {/* Create reminder dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Set Reminder for &ldquo;{documentLabel}&rdquo;
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Recipient email</label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="client@example.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Repeat every (days)</label>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={formInterval}
                  onChange={(e) => setFormInterval(Number(e.target.value) || 3)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Max sends <span className="font-normal text-neutral-400">(optional)</span>
                </label>
                <Input
                  type="number"
                  min={1}
                  value={formMaxSends}
                  onChange={(e) => setFormMaxSends(e.target.value)}
                  placeholder="Unlimited"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Custom message <span className="font-normal text-neutral-400">(optional)</span>
              </label>
              <Input
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="Please upload your ID document as soon as possible..."
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={formSendNow}
                onChange={(e) => setFormSendNow(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-neutral-300"
              />
              <Send className="h-3 w-3 text-neutral-400" />
              Send first email immediately
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating...</>
              ) : (
                <><Bell className="mr-1.5 h-3.5 w-3.5" /> Create Reminder</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
