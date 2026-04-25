"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

const GROUP_KEY = "policy_statuses";

const COLOR_PRESETS = [
  { value: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200", label: "Gray" },
  { value: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", label: "Yellow" },
  { value: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", label: "Green" },
  { value: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", label: "Blue" },
  { value: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", label: "Orange" },
  { value: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200", label: "Red" },
  { value: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", label: "Purple" },
  { value: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200", label: "Teal" },
];

type StatusRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
  meta: { color?: string; flows?: string[]; triggersInvoice?: boolean; onEnter?: { action: string; templateId?: number }[] } | null;
};

export default function PolicyStatusesManager() {
  const [rows, setRows] = React.useState<StatusRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StatusRow | null>(null);
  const [flows, setFlows] = React.useState<{ label: string; value: string }[]>([]);

  const [formLabel, setFormLabel] = React.useState("");
  const [formValue, setFormValue] = React.useState("");
  const [formSort, setFormSort] = React.useState(0);
  const [formColor, setFormColor] = React.useState(COLOR_PRESETS[0].value);
  const [formFlows, setFormFlows] = React.useState<string[]>([]);
  const [formTriggersInvoice, setFormTriggersInvoice] = React.useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/form-options?groupKey=${GROUP_KEY}&all=true`, { cache: "no-store" });
      if (!res.ok) { setRows([]); return; }
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } finally { setLoading(false); }
  }

  React.useEffect(() => {
    void load();
    fetch("/api/form-options?groupKey=flows", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((r: { label: string; value: string }[]) => setFlows(r.map((f) => ({ label: f.label, value: f.value }))))
      .catch(() => {});
  }, []);

  function startCreate() {
    setEditing(null);
    setFormLabel("");
    setFormValue("");
    setFormSort(rows.length * 10);
    setFormColor(COLOR_PRESETS[0].value);
    setFormFlows([]);
    setFormTriggersInvoice(false);
    setOpen(true);
  }

  function startEdit(row: StatusRow) {
    setEditing(row);
    setFormLabel(row.label);
    setFormValue(row.value);
    setFormSort(row.sortOrder);
    setFormColor(row.meta?.color ?? COLOR_PRESETS[0].value);
    setFormFlows(row.meta?.flows ?? []);
    setFormTriggersInvoice(row.meta?.triggersInvoice ?? false);
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
      valueType: "string",
      meta: {
        ...(editing?.meta ?? {}),
        color: formColor,
        flows: formFlows.length > 0 ? formFlows : undefined,
        triggersInvoice: formTriggersInvoice || undefined,
      },
    };
    try {
      if (editing) {
        const res = await fetch(`/api/admin/form-options/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Status updated");
      } else {
        const res = await fetch("/api/admin/form-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Status created");
      }
      setOpen(false);
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Save failed");
    }
  }

  async function remove(row: StatusRow) {
    if (!window.confirm(`Delete status "${row.label}"?`)) return;
    try {
      const res = await fetch(`/api/admin/form-options/${row.id}`, { method: "DELETE" });
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
          {rows.length} status{rows.length !== 1 ? "es" : ""}
        </div>
        <Button size="sm" onClick={startCreate}>Add Status</Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Key</TableHead>
              <TableHead className="hidden sm:table-cell">Flows</TableHead>
              <TableHead className="hidden sm:table-cell">Sort</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isActive ? "" : "opacity-50"}>
                <TableCell>
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${r.meta?.color ?? ""}`}>
                    {r.label}
                  </span>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-xs font-mono">{r.value}</TableCell>
                <TableCell className="hidden sm:table-cell text-xs">
                  <div className="flex items-center gap-1.5">
                    {r.meta?.flows?.length ? r.meta.flows.join(", ") : "All"}
                    {r.meta?.triggersInvoice && (
                      <span className="inline-flex items-center rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="Auto-creates invoice on entering this status">INV</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{r.sortOrder}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => startEdit(r)}>Edit</Button>
                    <Button size="sm" variant="destructive" onClick={() => remove(r)}>Delete</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
                  No statuses configured. Default statuses will be used.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Status" : "Add Status"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>Label</Label>
                <Input value={formLabel} onChange={(e) => setFormLabel(e.target.value)} placeholder="Quotation Prepared" />
              </div>
              <div className="grid gap-1">
                <Label>Key</Label>
                <Input value={formValue} onChange={(e) => setFormValue(e.target.value)} placeholder="quotation_prepared" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => setFormColor(c.value)}
                      className={`rounded px-2 py-1 text-[10px] font-medium ${c.value} ${formColor === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-1">
                <Label>Sort Order</Label>
                <Input type="number" value={String(formSort)} onChange={(e) => setFormSort(Number(e.target.value))} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600"
                checked={formTriggersInvoice}
                onChange={(e) => setFormTriggersInvoice(e.target.checked)}
              />
              <span>Auto-create invoice when entering this status</span>
            </label>
            {flows.length > 0 && (
              <div className="grid gap-1">
                <Label>Restrict to Flows <span className="text-xs text-neutral-400">(optional)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {flows.map((f) => (
                    <label key={f.value} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={formFlows.includes(f.value)}
                        onChange={(e) =>
                          setFormFlows((prev) =>
                            e.target.checked ? [...prev, f.value] : prev.filter((v) => v !== f.value),
                          )
                        }
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
