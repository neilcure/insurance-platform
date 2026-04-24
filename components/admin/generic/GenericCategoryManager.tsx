"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { deepEqual, formSnapshot } from "@/lib/form-utils";

type AccountingLine = { key: string; label: string };

type MetaType = {
  labelCase?: "original" | "upper" | "lower" | "title";
  accountingLines?: AccountingLine[];
  [k: string]: unknown;
};

type OptionRow = {
  id: number;
  groupKey: string;
  label: string;
  value: string;
  valueType: string;
  sortOrder: number;
  isActive: boolean;
  meta?: MetaType | null;
};

export default function GenericCategoryManager({ groupKey }: { groupKey: string }) {
  const [rows, setRows] = React.useState<OptionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OptionRow | null>(null);
  const [form, setForm] = React.useState<Partial<OptionRow>>({
    label: "",
    value: "",
    sortOrder: 0,
    isActive: true,
    meta: { labelCase: "original" },
  });
  const [acctLines, setAcctLines] = React.useState<AccountingLine[]>([]);
  const editSnapshot = React.useRef<Record<string, unknown> | null>(null);

  const showAccountingLines = groupKey === "policy_category";

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(groupKey)}`, { cache: "no-store" });
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
  }, [groupKey]);

  function startCreate() {
    setEditing(null);
    setForm({ label: "", value: "", sortOrder: 0, isActive: true, meta: { labelCase: "original" } });
    setAcctLines([]);
    setOpen(true);
    editSnapshot.current = null;
  }
  function startEdit(row: OptionRow) {
    setEditing(row);
    setForm({ ...row, meta: row.meta ?? { labelCase: "original" } });
    setAcctLines(row.meta?.accountingLines ?? []);
    setOpen(true);
    const metaForSnap: MetaType = { ...(row.meta ?? {}), labelCase: row.meta?.labelCase ?? "original" };
    if (showAccountingLines) {
      const lines = row.meta?.accountingLines ?? [];
      const validLines = lines.filter((l) => l.key.trim() && l.label.trim());
      metaForSnap.accountingLines = validLines.length > 0 ? validLines : undefined;
    }
    editSnapshot.current = formSnapshot({
      label: row.label,
      value: row.value,
      sortOrder: Number(row.sortOrder) || 0,
      isActive: !!row.isActive,
      meta: metaForSnap,
    });
  }

  function buildMeta(): MetaType {
    const base: MetaType = { ...(form.meta ?? {}), labelCase: form.meta?.labelCase ?? "original" };
    if (showAccountingLines) {
      const validLines = acctLines.filter((l) => l.key.trim() && l.label.trim());
      base.accountingLines = validLines.length > 0 ? validLines : undefined;
    }
    return base;
  }

  async function save() {
    try {
      if (!form.label || !form.value) {
        toast.error("Label and value are required");
        return;
      }
      const meta = buildMeta();
      if (editing) {
        const current = formSnapshot({
          label: form.label,
          value: form.value,
          sortOrder: Number(form.sortOrder) || 0,
          isActive: !!form.isActive,
          meta,
        });
        if (editSnapshot.current && deepEqual(current, editSnapshot.current)) {
          toast.info("No changes to save");
          setOpen(false);
          return;
        }
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
            meta,
          }),
        });
        if (!res.ok) throw new Error("Update failed");
        toast.success("Updated");
      } else {
        const res = await fetch(`/api/admin/form-options`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            groupKey,
            label: form.label,
            value: form.value,
            sortOrder: Number(form.sortOrder) || 0,
            isActive: !!form.isActive,
            valueType: "string",
            meta,
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
      const proceed = window.confirm(`Delete category "${row.label}"? This cannot be undone.`);
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

  function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "line";
  }

  function addAcctLine() {
    setAcctLines((prev) => [...prev, { key: "", label: "" }]);
  }
  function removeAcctLine(idx: number) {
    setAcctLines((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateAcctLineLabel(idx: number, val: string) {
    setAcctLines((prev) => prev.map((l, i) => (i === idx ? { key: slugify(val), label: val } : l)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-neutral-500 dark:text-neutral-400"></div>
        <Button type="button" size="sm" onClick={startCreate} className="self-start sm:self-auto">
          Add
        </Button>
      </div>
      <div className="overflow-x-auto">
      <Table className="min-w-[640px]">
        <TableHeader className="hidden sm:table-header-group">
          <TableRow>
            <TableHead className="p-2 sm:p-4">Label</TableHead>
            <TableHead className="p-2 sm:p-4">Value</TableHead>
            <TableHead className="p-2 sm:p-4">Sort</TableHead>
            {showAccountingLines && <TableHead className="p-2 sm:p-4">Acct Lines</TableHead>}
            <TableHead className="hidden text-right sm:table-cell p-2 sm:p-4">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className={`${r.isActive ? "text-green-600 dark:text-green-400" : ""} p-2 sm:p-4`}>
                {r.label}
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
              {showAccountingLines && (
                <TableCell className="hidden p-2 sm:table-cell sm:p-4">
                  {r.meta?.accountingLines && r.meta.accountingLines.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {r.meta.accountingLines.map((l, i) => (
                        <span key={i} className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          {l.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                </TableCell>
              )}
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
              <TableCell colSpan={showAccountingLines ? 5 : 4} className="text-center text-sm text-neutral-500 dark:text-neutral-400">
                No categories defined.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Label</Label>
              <Input
                value={form.label ?? ""}
                onChange={(e) => {
                  const label = e.target.value;
                  setForm((f) => {
                    const autoKey = !editing;
                    return { ...f, label, ...(autoKey ? { value: slugify(label) } : {}) };
                  });
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label className="flex items-center gap-2">
                Value (key)
                <span className="text-[10px] font-normal text-neutral-400">auto-generated from label</span>
              </Label>
              <Input
                value={form.value ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                className="font-mono text-xs"
              />
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
              <Label>Label Case</Label>
              <select
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                value={(form.meta?.labelCase ?? "original") as string}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    meta: { ...(f.meta ?? {}), labelCase: e.target.value as "original" | "upper" | "lower" | "title" },
                  }))
                }
              >
                <option value="original">Original</option>
                <option value="upper">UPPERCASE</option>
                <option value="lower">lowercase</option>
                <option value="title">Title Case</option>
              </select>
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

            {showAccountingLines && (
              <div className="grid gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Accounting Sections</Label>
                  <Button type="button" size="sm" variant="outline" className="h-6 text-[11px]" onClick={addAcctLine}>
                    <Plus className="mr-1 h-3 w-3" /> Add Section
                  </Button>
                </div>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  How many accounting sections should appear in the Accounting tab when a policy uses this cover type?
                </p>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  <span className="font-medium">Example:</span> &quot;Third Party&quot; has 1 section. &quot;TPO + Own Damage&quot; has 2 sections (one for Third Party, one for Own Vehicle Damage).
                </p>
                {acctLines.length === 0 && (
                  <p className="py-2 text-center text-xs text-neutral-400">No sections defined. A single default section will be used.</p>
                )}
                {acctLines.map((line, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-neutral-400">{idx + 1}.</span>
                    <Input
                      placeholder="Section name (e.g. Third Party)"
                      value={line.label}
                      onChange={(e) => updateAcctLineLabel(idx, e.target.value)}
                      className="h-7 text-xs"
                    />
                    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" onClick={() => removeAcctLine(idx)}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
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
