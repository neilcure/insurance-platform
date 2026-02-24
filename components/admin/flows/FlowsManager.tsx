"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import Link from "next/link";

type OptionRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  valueType: string;
  sortOrder: number;
  isActive: boolean;
};

export default function FlowsManager() {
  const [rows, setRows] = React.useState<OptionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OptionRow | null>(null);
  const [form, setForm] = React.useState<Partial<OptionRow>>({
    label: "",
    value: "",
    sortOrder: 0,
    isActive: true,
  });

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/form-options?groupKey=flows`, { cache: "no-store" });
      if (!res.ok) {
        setRows([]);
        return;
      }
      const json = await res.json();
      setRows(Array.isArray(json) ? json : []);
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    void load();
  }, []);

  function startCreate() {
    setEditing(null);
    setForm({ label: "", value: "", sortOrder: 0, isActive: true });
    setOpen(true);
  }
  function startEdit(row: OptionRow) {
    setEditing(row);
    setForm({ ...row });
    setOpen(true);
  }
  async function save() {
    try {
      if (!form.label || !form.value) {
        toast.error("Label and value are required");
        return;
      }
      if (editing) {
        const res = await fetch(`/api/admin/form-options/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: form.label,
            value: form.value,
            sortOrder: Number(form.sortOrder) || 0,
            isActive: !!form.isActive,
          }),
        });
        if (!res.ok) throw new Error("Update failed");
        toast.success("Updated");
      } else {
        const res = await fetch(`/api/admin/form-options`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            groupKey: "flows",
            label: form.label,
            value: form.value,
            sortOrder: Number(form.sortOrder) || 0,
            isActive: !!form.isActive,
            valueType: "string",
          }),
        });
        if (!res.ok) throw new Error("Create failed");
        toast.success("Created");
      }
      setOpen(false);
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    }
  }
  async function toggleActive(row: OptionRow) {
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
  async function remove(row: OptionRow) {
    try {
      const proceed = window.confirm(`Delete flow "${row.label}"? This cannot be undone.`);
      if (!proceed) return;
      const res = await fetch(`/api/admin/form-options/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Delete failed");
      }
      toast.success("Deleted");
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Delete failed";
      toast.error(message);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-neutral-500"></div>
        <Button type="button" size="sm" onClick={startCreate} className="self-start sm:self-auto">
          Add Flow
        </Button>
      </div>
      <Table className="min-w-[640px]">
        <TableHeader className="hidden sm:table-header-group">
          <TableRow>
            <TableHead className="p-2 sm:p-4">Flow</TableHead>
            <TableHead className="p-2 sm:p-4">Key</TableHead>
            <TableHead className="p-2 sm:p-4">Sort</TableHead>
            <TableHead className="hidden text-right sm:table-cell p-2 sm:p-4">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className={`${r.isActive ? "text-green-600 dark:text-green-400" : ""} p-2 sm:p-4`}>
                <div className="flex items-center gap-2">
                  <span>{r.label}</span>
                  <Link href={`/admin/policy-settings/flows/${r.value}/steps`}>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-xs bg-yellow-400 text-neutral-900 hover:bg-yellow-400 dark:bg-yellow-400 dark:text-neutral-900"
                    >
                      Steps
                    </Button>
                  </Link>
                </div>
                <div className="mt-1 text-xs text-neutral-500 sm:hidden">
                  <span className="font-mono">{r.value}</span>
                  <span className="px-2">•</span>
                  <span>Sort {r.sortOrder}</span>
                </div>
                <div className="mt-2 flex gap-2 sm:hidden">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant={r.isActive ? "outline" : "default"} onClick={() => toggleActive(r)}>
                    {r.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r)}>
                    Delete
                  </Button>
                </div>
              </TableCell>
              <TableCell className="hidden font-mono text-xs p-2 sm:table-cell sm:p-4">{r.value}</TableCell>
              <TableCell className="hidden p-2 sm:table-cell sm:p-4">{r.sortOrder}</TableCell>
              <TableCell className="hidden text-right sm:table-cell p-2 sm:p-4">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant={r.isActive ? "outline" : "default"} onClick={() => toggleActive(r)}>
                    {r.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r)}>
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-sm text-neutral-500">
                No flows defined.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Flow" : "Add Flow"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Flow Name</Label>
              <Input value={form.label ?? ""} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Key (slug)</Label>
              <Input value={form.value ?? ""} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Sort Order</Label>
              <Input
                type="number"
                value={String(form.sortOrder ?? 0)}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
              />
            </div>
            <div className="grid gap-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>{editing ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}



