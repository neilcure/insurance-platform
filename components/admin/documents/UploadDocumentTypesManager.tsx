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
import type {
  UploadDocumentTypeMeta,
  UploadDocumentTypeRow,
} from "@/lib/types/upload-document";

const GROUP_KEY = "upload_document_types";

const ACCEPTED_TYPE_PRESETS: { label: string; value: string }[] = [
  { label: "Images (jpg, png, webp)", value: "image/*" },
  { label: "PDF", value: "application/pdf" },
  { label: "Word (.doc, .docx)", value: "application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { label: "Excel (.xls, .xlsx)", value: "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
];

function defaultMeta(): UploadDocumentTypeMeta {
  return {
    description: "",
    acceptedTypes: ["image/*", "application/pdf"],
    maxSizeMB: 10,
    required: false,
    flows: [],
  };
}

export default function UploadDocumentTypesManager() {
  const [rows, setRows] = React.useState<UploadDocumentTypeRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UploadDocumentTypeRow | null>(null);

  const [formLabel, setFormLabel] = React.useState("");
  const [formValue, setFormValue] = React.useState("");
  const [formSort, setFormSort] = React.useState(0);
  const [meta, setMeta] = React.useState<UploadDocumentTypeMeta>(defaultMeta());

  const [flows, setFlows] = React.useState<{ label: string; value: string }[]>([]);

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
  }, []);

  function startCreate() {
    setEditing(null);
    setFormLabel("");
    setFormValue("");
    setFormSort(0);
    setMeta(defaultMeta());
    setOpen(true);
  }

  function startEdit(row: UploadDocumentTypeRow) {
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
        toast.success("Document type updated");
      } else {
        const res = await fetch("/api/admin/form-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        toast.success("Document type created");
      }
      setOpen(false);
      await load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Save failed");
    }
  }

  async function toggleActive(row: UploadDocumentTypeRow) {
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

  async function remove(row: UploadDocumentTypeRow) {
    if (!window.confirm(`Delete document type "${row.label}"? Existing uploads for this type will remain.`))
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

  function toggleAcceptedType(typeVal: string) {
    setMeta((m) => {
      const types = new Set(m.acceptedTypes ?? []);
      const vals = typeVal.split(",");
      const allPresent = vals.every((v) => types.has(v));
      if (allPresent) {
        vals.forEach((v) => types.delete(v));
      } else {
        vals.forEach((v) => types.add(v));
      }
      return { ...m, acceptedTypes: [...types] };
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-500 dark:text-neutral-400">
          {rows.length} document type{rows.length !== 1 ? "s" : ""}
        </div>
        <Button size="sm" onClick={startCreate}>
          Add Document Type
        </Button>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document Type</TableHead>
              <TableHead className="hidden sm:table-cell">Required</TableHead>
              <TableHead className="hidden sm:table-cell">Max Size</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.isActive ? "" : "opacity-50"}>
                <TableCell>
                  <div className="font-medium">{r.label}</div>
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                    {r.value}
                  </div>
                  {r.meta?.description && (
                    <div className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">
                      {r.meta.description}
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-xs">
                  {r.meta?.required ? (
                    <span className="text-red-600 dark:text-red-400 font-medium">Required</span>
                  ) : (
                    <span className="text-neutral-400">Optional</span>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-xs">
                  {r.meta?.maxSizeMB ?? 10}MB
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
            ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400"
                >
                  No document types configured. Add one to get started.
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
              {editing ? "Edit Document Type" : "Add Document Type"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Display Name</Label>
                <Input
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="ID Card Copy"
                />
              </div>
              <div className="grid gap-1">
                <Label>Key</Label>
                <Input
                  value={formValue}
                  onChange={(e) => setFormValue(e.target.value)}
                  placeholder="id_card"
                />
              </div>
            </div>

            <div className="grid gap-1">
              <Label>Description</Label>
              <Input
                value={meta.description ?? ""}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
                placeholder="Front and back of valid ID card"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Max Size (MB)</Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  value={String(meta.maxSizeMB ?? 10)}
                  onChange={(e) => setMeta((m) => ({ ...m, maxSizeMB: Number(e.target.value) || 10 }))}
                />
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
              <Label>Accepted File Types</Label>
              <div className="flex flex-wrap gap-2">
                {ACCEPTED_TYPE_PRESETS.map((preset) => {
                  const vals = preset.value.split(",");
                  const checked = vals.every((v) => meta.acceptedTypes?.includes(v));
                  return (
                    <label key={preset.value} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAcceptedType(preset.value)}
                      />
                      {preset.label}
                    </label>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={meta.required ?? false}
                onChange={(e) => setMeta((m) => ({ ...m, required: e.target.checked }))}
              />
              Required document
            </label>

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
