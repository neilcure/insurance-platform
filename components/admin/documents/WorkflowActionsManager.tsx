"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";
import { getIcon } from "@/lib/icons";
import type {
  WorkflowActionMeta,
  WorkflowActionRow,
  WorkflowActionType,
} from "@/lib/types/workflow-action";

const GROUP_KEY = "workflow_actions";

const ACTION_TYPES: { value: WorkflowActionType; label: string; description: string }[] = [
  { value: "email", label: "Send Email", description: "Send an email notification about this record" },
  { value: "send_document", label: "Send Document", description: "Generate a PDF document and optionally email it" },
  { value: "note", label: "Add Note", description: "Attach a text note to the record" },
  { value: "duplicate", label: "Duplicate", description: "Create a copy of the record" },
  { value: "export", label: "Export", description: "Download record data as a file" },
  { value: "status_change", label: "Status Change", description: "Change the record status to a specific value" },
  { value: "webhook", label: "Webhook", description: "POST record data to an external URL" },
  { value: "custom", label: "Custom", description: "Custom action with configurable handler" },
];

const ICON_SUGGESTIONS = [
  "Send", "UserPlus", "StickyNote", "Copy", "Download", "RefreshCw",
  "Check", "X", "AlertTriangle", "Bell", "Mail", "FileText",
  "Printer", "Share2", "Link", "ExternalLink", "Zap", "Star",
];

function defaultMeta(): WorkflowActionMeta {
  return {
    type: "custom",
    icon: "Zap",
    description: "",
    buttonLabel: "Run",
    requiresInput: false,
    inputPlaceholder: "",
    inputLabel: "",
  };
}

export default function WorkflowActionsManager() {
  const [rows, setRows] = React.useState<WorkflowActionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WorkflowActionRow | null>(null);

  const [formLabel, setFormLabel] = React.useState("");
  const [formValue, setFormValue] = React.useState("");
  const [formSort, setFormSort] = React.useState(0);
  const [meta, setMeta] = React.useState<WorkflowActionMeta>(defaultMeta());

  const [flows, setFlows] = React.useState<{ label: string; value: string }[]>([]);
  const [statusOptions, setStatusOptions] = React.useState<{ label: string; value: string }[]>([]);
  const [pdfTemplates, setPdfTemplates] = React.useState<{ id: number; label: string; value: string }[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/form-options?groupKey=${GROUP_KEY}&all=true`,
        { cache: "no-store" },
      );
      if (!res.ok) { setRows([]); return; }
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    fetch("/api/form-options?groupKey=flows", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((r: { label: string; value: string }[]) =>
        setFlows(r.map((f) => ({ label: f.label, value: f.value }))),
      )
      .catch(() => {});
    fetch("/api/form-options?groupKey=policy_statuses", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((r: { label: string; value: string }[]) =>
        setStatusOptions(Array.isArray(r) ? r.map((s) => ({ label: s.label, value: s.value })) : []),
      )
      .catch(() => {});
    fetch("/api/form-options?groupKey=pdf_merge_templates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((r: { id: number; label: string; value: string }[]) =>
        setPdfTemplates(Array.isArray(r) ? r.map((t) => ({ id: t.id, label: t.label, value: t.value })) : []),
      )
      .catch(() => {});
  }, []);

  function startCreate() {
    setEditing(null);
    setFormLabel("");
    setFormValue("");
    setFormSort(0);
    setMeta(defaultMeta());
    setOpen(true);
  }

  function startEdit(row: WorkflowActionRow) {
    setEditing(row);
    setFormLabel(row.label);
    setFormValue(row.value);
    setFormSort(row.sortOrder);
    setMeta(row.meta ?? defaultMeta());
    setOpen(true);
  }

  async function save() {
    if (!formLabel.trim() || !formValue.trim()) {
      toast.error("Label and key are required");
      return;
    }
    const payload = {
      groupKey: GROUP_KEY,
      label: formLabel.trim(),
      value: formValue.trim(),
      sortOrder: formSort,
      isActive: true,
      valueType: "json",
      meta,
    };
    try {
      if (editing) {
        const res = await fetch(`/api/admin/form-options/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Action updated");
      } else {
        const res = await fetch("/api/admin/form-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Action created");
      }
      setOpen(false);
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Save failed");
    }
  }

  async function toggleActive(row: WorkflowActionRow) {
    try {
      const res = await fetch(`/api/admin/form-options/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) throw new Error("Failed");
      await load();
    } catch {
      toast.error("Update failed");
    }
  }

  async function remove(row: WorkflowActionRow) {
    if (!window.confirm(`Delete action "${row.label}"? This cannot be undone.`))
      return;
    try {
      const res = await fetch(`/api/admin/form-options/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Deleted");
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Delete failed");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-500 dark:text-neutral-400">
          {rows.length} action{rows.length !== 1 ? "s" : ""}
        </div>
        <Button size="sm" onClick={startCreate}>
          Add Action
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden sm:table-cell">Sort</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const IconComp = getIcon(r.meta?.icon);
              const typeDef = ACTION_TYPES.find((t) => t.value === r.meta?.type);
              return (
                <TableRow key={r.id} className={r.isActive ? "" : "opacity-50"}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <IconComp className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
                      <div>
                        <div className="font-medium">{r.label}</div>
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                          {r.value}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-xs">
                    {typeDef?.label ?? r.meta?.type ?? "—"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {r.sortOrder}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => startEdit(r)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant={r.isActive ? "outline" : "default"}
                        onClick={() => toggleActive(r)}
                      >
                        {r.isActive ? "Disable" : "Enable"}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => remove(r)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400"
                >
                  No actions configured.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Action" : "Add Action"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Action Name</Label>
                <Input
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="Send Reminder"
                />
              </div>
              <div className="grid gap-1">
                <Label>Key</Label>
                <Input
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  placeholder="send_reminder"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Type</Label>
                <select
                  className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={meta.type}
                  onChange={(e) =>
                    setMeta((m) => ({ ...m, type: e.target.value as WorkflowActionType }))
                  }
                >
                  {ACTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={String(formSort)}
                  onChange={(e) => setFormSort(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="grid gap-1">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-1">
                {ICON_SUGGESTIONS.map((name) => {
                  const I = getIcon(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setMeta((m) => ({ ...m, icon: name }))}
                      className={`rounded border p-1.5 ${
                        meta.icon === name
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                          : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                      }`}
                      title={name}
                    >
                      <I className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-1">
              <Label>Description</Label>
              <Input
                value={meta.description ?? ""}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
                placeholder="What this action does..."
              />
            </div>

            <div className="grid gap-1">
              <Label>Button Label</Label>
              <Input
                value={meta.buttonLabel ?? ""}
                onChange={(e) => setMeta((m) => ({ ...m, buttonLabel: e.target.value }))}
                placeholder="Run"
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={meta.requiresInput ?? false}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, requiresInput: e.target.checked }))
                }
              />
              Requires user input
            </label>

            {meta.requiresInput && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label>Input Label</Label>
                  <Input
                    value={meta.inputLabel ?? ""}
                    onChange={(e) =>
                      setMeta((m) => ({ ...m, inputLabel: e.target.value }))
                    }
                    placeholder="Email Address"
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Input Placeholder</Label>
                  <Input
                    value={meta.inputPlaceholder ?? ""}
                    onChange={(e) =>
                      setMeta((m) => ({ ...m, inputPlaceholder: e.target.value }))
                    }
                    placeholder="user@example.com"
                  />
                </div>
              </div>
            )}

            {meta.type === "status_change" && (
              <div className="grid gap-1">
                <Label>Target Status</Label>
                {statusOptions.length > 0 ? (
                  <select
                    className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={meta.targetStatus ?? ""}
                    onChange={(e) => setMeta((m) => ({ ...m, targetStatus: e.target.value }))}
                  >
                    <option value="">-- Select --</option>
                    {statusOptions.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={meta.targetStatus ?? ""}
                    onChange={(e) => setMeta((m) => ({ ...m, targetStatus: e.target.value }))}
                    placeholder="active"
                  />
                )}
              </div>
            )}

            {meta.type === "send_document" && (
              <div className="grid gap-1">
                <Label>PDF Template</Label>
                {pdfTemplates.length > 0 ? (
                  <select
                    className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={String(meta.documentTemplateId ?? "")}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const tpl = pdfTemplates.find((t) => t.id === id);
                      setMeta((m) => ({
                        ...m,
                        documentTemplateId: id || undefined,
                        documentTemplateLabel: tpl?.label,
                        requiresInput: true,
                        inputLabel: "Recipient Email",
                        inputPlaceholder: "user@example.com",
                      }));
                    }}
                  >
                    <option value="">-- Select Template --</option>
                    {pdfTemplates.map((t) => (
                      <option key={t.id} value={String(t.id)}>{t.label}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-neutral-500">No PDF templates configured. Create them in PDF Mail Merge first.</p>
                )}
              </div>
            )}

            {(meta.type === "webhook" || (meta.type === "custom" && meta.webhookUrl)) && (
              <div className="grid gap-1">
                <Label>Webhook URL</Label>
                <Input
                  value={meta.webhookUrl ?? ""}
                  onChange={(e) =>
                    setMeta((m) => ({ ...m, webhookUrl: e.target.value }))
                  }
                  placeholder="https://..."
                />
              </div>
            )}

            {/* Flow restriction */}
            {flows.length > 0 && (
              <div className="grid gap-1">
                <Label>
                  Restrict to Flows{" "}
                  <span className="text-xs text-neutral-400">(optional)</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {flows.map((f) => (
                    <label key={f.value} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={meta.flows?.includes(f.value) ?? false}
                        onChange={(e) =>
                          setMeta((m) => ({
                            ...m,
                            flows: e.target.checked
                              ? [...(m.flows ?? []), f.value]
                              : (m.flows ?? []).filter((v) => v !== f.value),
                          }))
                        }
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Show only when status matches */}
            {statusOptions.length > 0 && (
              <div className="grid gap-1">
                <Label>
                  Show When Status{" "}
                  <span className="text-xs text-neutral-400">(optional - empty = always)</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {statusOptions.map((s) => (
                    <label key={s.value} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={meta.showWhenStatus?.includes(s.value) ?? false}
                        onChange={(e) =>
                          setMeta((m) => ({
                            ...m,
                            showWhenStatus: e.target.checked
                              ? [...(m.showWhenStatus ?? []), s.value]
                              : (m.showWhenStatus ?? []).filter((v) => v !== s.value),
                          }))
                        }
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
