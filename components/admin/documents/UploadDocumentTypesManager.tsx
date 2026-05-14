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
import { confirmDialog } from "@/components/ui/global-dialogs";
import { toast } from "sonner";
import type {
  UploadDocumentTypeMeta,
  UploadDocumentTypeRow,
} from "@/lib/types/upload-document";
import { useUserTypes } from "@/hooks/use-user-types";
import { TranslationsEditor } from "@/components/admin/i18n/TranslationsEditor";
import type { Locale, TranslationBlock } from "@/lib/i18n";

const GROUP_KEY = "upload_document_types";

const ACCEPTED_TYPE_PRESETS: { label: string; value: string }[] = [
  { label: "Images (jpg, png, webp)", value: "image/*" },
  { label: "PDF", value: "application/pdf" },
  { label: "Word (.doc, .docx)", value: "application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { label: "Excel (.xls, .xlsx)", value: "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
];

export type UploadDocumentSource = "customer" | "admin";

/**
 * Treat any meta with `uploadSource !== "admin"` as a customer-uploaded type
 * (the historical default — every existing row is implicitly "customer").
 */
function isAdminSource(meta: UploadDocumentTypeMeta | null | undefined): boolean {
  return meta?.uploadSource === "admin";
}

function defaultMeta(source: UploadDocumentSource): UploadDocumentTypeMeta {
  return {
    description: "",
    acceptedTypes: ["image/*", "application/pdf"],
    maxSizeMB: 10,
    required: false,
    flows: [],
    uploadSource: source,
  };
}

export default function UploadDocumentTypesManager({
  uploadSource = "customer",
}: {
  /**
   * Scopes the manager to one source.
   * - "customer" (default): documents the client / agent uploads.
   * - "admin": documents the admin uploads to provide to the client / agent.
   * Both sources share the same `form_options` group; the manager filters by
   * `meta.uploadSource` so each admin page only ever shows its own rows.
   */
  uploadSource?: UploadDocumentSource;
} = {}) {
  const isAdminScope = uploadSource === "admin";
  const { options: userTypePickerOptions } = useUserTypes();
  const [rows, setRows] = React.useState<UploadDocumentTypeRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UploadDocumentTypeRow | null>(null);

  const [formLabel, setFormLabel] = React.useState("");
  const [formValue, setFormValue] = React.useState("");
  const [formSort, setFormSort] = React.useState(0);
  const [meta, setMeta] = React.useState<UploadDocumentTypeMeta>(defaultMeta(uploadSource));

  const [flows, setFlows] = React.useState<{ label: string; value: string }[]>([]);
  const [statusOptions, setStatusOptions] = React.useState<{ label: string; value: string }[]>([]);
  const [availableInsurers, setAvailableInsurers] = React.useState<{ id: number; name: string }[]>([]);
  const [insuredCategories, setInsuredCategories] = React.useState<{ label: string; value: string }[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/form-options?groupKey=${GROUP_KEY}&all=true`,
        { cache: "no-store" },
      );
      if (!res.ok) { setRows([]); return; }
      const json = await res.json();
      const all = Array.isArray(json) ? (json as UploadDocumentTypeRow[]) : [];
      // Filter to this manager's scope. Rows missing `uploadSource` are
      // treated as "customer" (the historical default), so existing data
      // stays on the existing page after this change.
      const scoped = all.filter((r) =>
        isAdminScope ? isAdminSource(r.meta) : !isAdminSource(r.meta),
      );
      setRows(scoped);
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
    fetch("/api/admin/organisations", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: { id: number; name: string }[]) =>
        setAvailableInsurers(Array.isArray(data) ? data : []),
      )
      .catch(() => {});
    fetch("/api/form-options?groupKey=insured_category", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((r: { label: string; value: string }[]) =>
        setInsuredCategories(Array.isArray(r) ? r.map((c) => ({ label: c.label, value: c.value })) : []),
      )
      .catch(() => {});
  }, []);

  function startCreate() {
    setEditing(null);
    setFormLabel("");
    setFormValue("");
    setFormSort(0);
    setMeta(defaultMeta(uploadSource));
    setOpen(true);
  }

  function startEdit(row: UploadDocumentTypeRow) {
    setEditing(row);
    setFormLabel(row.label);
    setFormValue(row.value);
    setFormSort(row.sortOrder);
    // Preserve the row's existing source; never silently flip a row's source
    // when an admin clicks Edit from the wrong scope.
    setMeta({ ...(row.meta ?? defaultMeta(uploadSource)), uploadSource: row.meta?.uploadSource ?? uploadSource });
    setOpen(true);
  }

  async function save() {
    if (!formLabel.trim() || !formValue.trim()) {
      toast.error("Label and key are required");
      return;
    }
    // Always tag the saved row with this manager's scope so it shows up on
    // the correct admin page after a save (and so a row created from the
    // "Admin Provided Documents" page can never be missing the flag).
    const scopedMeta: UploadDocumentTypeMeta = {
      ...meta,
      uploadSource: editing?.meta?.uploadSource ?? uploadSource,
    };
    // Strip fields that don't apply to admin-provided docs so we don't
    // persist stale config that would confuse the runtime later.
    if (scopedMeta.uploadSource === "admin") {
      delete scopedMeta.requirePaymentDetails;
      delete scopedMeta.accountingLineKey;
      delete scopedMeta.requireNcb;
    }
    const payload = {
      groupKey: GROUP_KEY,
      label: formLabel.trim(),
      value: formValue.trim(),
      sortOrder: formSort,
      isActive: true,
      valueType: "json",
      meta: scopedMeta,
    };
    async function fetchOrThrow(url: string, init: RequestInit) {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await res.text();
        let msg = body;
        try { msg = (JSON.parse(body) as { error?: string }).error ?? body; } catch { /* raw text */ }
        throw new Error(msg);
      }
      return res;
    }
    try {
      if (editing) {
        await fetchOrThrow(`/api/admin/form-options/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast.success("Document type updated");
      } else {
        await fetchOrThrow("/api/admin/form-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
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
    const ok = await confirmDialog({
      title: `Delete "${row.label}"?`,
      description: "Existing uploads for this type will remain on each policy.\nThis cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
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
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {isAdminSource(r.meta) && (
                      <span className="inline-block rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
                        Backend
                      </span>
                    )}
                    {r.meta?.insuredTypes && r.meta.insuredTypes.length > 0 && (
                      <span className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        {r.meta.insuredTypes.join(", ")}
                      </span>
                    )}
                    {r.meta?.requireNcb && (
                      <span className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                        NCB required
                      </span>
                    )}
                    {r.meta?.requirePaymentDetails && (
                      <span className="inline-block rounded bg-green-50 px-1.5 py-0.5 text-[10px] text-green-600 dark:bg-green-900/30 dark:text-green-400">
                        Payment details
                      </span>
                    )}
                    {r.meta?.accountingLineKey && (
                      <span className="inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
                        Line: {r.meta.accountingLineKey}
                      </span>
                    )}
                    {r.meta?.visibleToUserTypes && r.meta.visibleToUserTypes.length > 0 && (
                      <span className="inline-block rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        Viewers: {r.meta.visibleToUserTypes.join(", ")}
                      </span>
                    )}
                  </div>
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
                  {isAdminScope
                    ? "No backend document types configured. Add one to get started."
                    : "No document types configured. Add one to get started."}
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
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {isAdminScope
                ? "Backend document: admin uploads and provides to the agent / client. No reminders."
                : "Agent or client uploads this document. Admin verifies. Reminders available."}
            </p>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            <TranslationsEditor
              value={(meta.translations ?? null) as Partial<Record<Locale, TranslationBlock>> | null}
              sourceLabel={formLabel}
              hint="Leave a row blank to fall back to English."
              onChange={(next) =>
                setMeta((m) => ({
                  ...m,
                  translations: Object.keys(next).length > 0 ? next : undefined,
                }))
              }
            />

            <div className="grid gap-1">
              <Label>Description</Label>
              <Input
                value={meta.description ?? ""}
                onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
                placeholder="Front and back of valid ID card"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            {statusOptions.length > 0 && (
              <div className="grid gap-1">
                <Label>
                  Show From Status{" "}
                  <span className="text-xs text-neutral-400">(optional - empty = always)</span>
                </Label>
                <p className="text-xs text-neutral-400 mb-1">
                  Visible once the policy reaches the earliest checked status and stays visible for all later statuses.
                  Already-uploaded documents remain visible regardless.
                </p>
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

            {availableInsurers.length > 0 && (
              <div className="grid gap-1">
                <Label>
                  Insurance Company{" "}
                  <span className="text-xs text-neutral-400">(optional - empty = all companies)</span>
                </Label>
                <p className="text-xs text-neutral-400 mb-1">
                  Restrict this upload requirement to policies linked to specific insurance companies.
                </p>
                <div className="flex flex-wrap gap-3">
                  {availableInsurers.map((ins) => (
                    <label key={ins.id} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={meta.insurerPolicyIds?.includes(ins.id) ?? false}
                        onChange={(e) =>
                          setMeta((m) => ({
                            ...m,
                            insurerPolicyIds: e.target.checked
                              ? [...(m.insurerPolicyIds ?? []), ins.id]
                              : (m.insurerPolicyIds ?? []).filter((id) => id !== ins.id),
                          }))
                        }
                      />
                      {ins.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {userTypePickerOptions.length > 0 && (
              <div className="grid gap-1">
                <Label>
                  Visible to user types{" "}
                  <span className="text-xs text-neutral-400">(optional - empty = all)</span>
                </Label>
                <p className="mb-1 text-xs text-neutral-400">
                  Matches <code className="text-[10px]">users.user_type</code>. Restricts who sees this requirement in Workflow;
                  downloads still obey policy access and template audience rules separately.
                </p>
                <div className="flex flex-wrap gap-3">
                  {userTypePickerOptions.map((ut) => (
                    <label key={ut.value} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={meta.visibleToUserTypes?.includes(ut.value) ?? false}
                        onChange={(e) =>
                          setMeta((m) => {
                            const next = new Set(m.visibleToUserTypes ?? []);
                            if (e.target.checked) next.add(ut.value);
                            else next.delete(ut.value);
                            const arr = [...next];
                            return {
                              ...m,
                              visibleToUserTypes: arr.length === 0 ? undefined : arr,
                            };
                          })
                        }
                      />
                      {ut.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {insuredCategories.length > 0 && (
              <div className="grid gap-1">
                <Label>
                  Insured Type{" "}
                  <span className="text-xs text-neutral-400">(optional - empty = all types)</span>
                </Label>
                <p className="text-xs text-neutral-400 mb-1">
                  Only show this upload requirement for policies with the selected insured type.
                </p>
                <div className="flex flex-wrap gap-3">
                  {insuredCategories.map((cat) => (
                    <label key={cat.value} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={meta.insuredTypes?.includes(cat.value) ?? false}
                        onChange={(e) =>
                          setMeta((m) => ({
                            ...m,
                            insuredTypes: e.target.checked
                              ? [...(m.insuredTypes ?? []), cat.value]
                              : (m.insuredTypes ?? []).filter((v) => v !== cat.value),
                          }))
                        }
                      />
                      {cat.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {!isAdminScope && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={meta.requireNcb ?? false}
                  onChange={(e) => setMeta((m) => ({ ...m, requireNcb: e.target.checked }))}
                />
                Only when policy has NCB (No Claims Bonus)
              </label>
            )}

            {!isAdminScope && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={meta.requirePaymentDetails ?? false}
                  onChange={(e) => setMeta((m) => ({ ...m, requirePaymentDetails: e.target.checked }))}
                />
                Require payment details (method, amount, reference) on upload
              </label>
            )}

            {!isAdminScope && (
            <div className="grid gap-1">
              <Label>Cover Type (Accounting Line Key)</Label>
              <Input
                value={meta.accountingLineKey ?? ""}
                onChange={(e) =>
                  setMeta((m) => ({ ...m, accountingLineKey: e.target.value.trim() || undefined }))
                }
                placeholder="e.g. tpo, od"
                className="max-w-xs"
              />
              <p className="text-xs text-neutral-400">
                For multi-cover policies (e.g. TPO + OD): set this to the premium line key
                so this upload type only appears for policies with that cover.
                Leave empty for all policies.
              </p>
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
