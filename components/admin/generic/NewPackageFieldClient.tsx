"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Save, X } from "lucide-react";
import { toast } from "sonner";
import { ShowWhenConfig } from "@/components/admin/generic/ShowWhenConfig";
import { GroupShowWhenConfig } from "@/components/admin/generic/GroupShowWhenConfig";

type InputType = "string" | "number" | "currency" | "date" | "select" | "multi_select" | "boolean" | "repeatable" | "formula";

export default function NewPackageFieldClient({ pkg }: { pkg: string }) {
  const [categoryOptions, setCategoryOptions] = React.useState<{ label: string; value: string }[]>([]);
  const [allPackages, setAllPackages] = React.useState<{ label: string; value: string }[]>([]);
  const [crossPkgCategories, setCrossPkgCategories] = React.useState<Record<string, { label: string; value: string }[]>>({});
  const [existing, setExisting] = React.useState<
    { id: number; label: string; value: string; sortOrder: number; isActive?: boolean; meta: { group?: string; inputType?: string; options?: { label: string; value: string }[] } | null }[]
  >([]);
  const [form, setForm] = React.useState<{
    label: string;
    value: string;
    valueType: string;
    sortOrder: number;
    isActive: boolean;
    meta: {
      inputType?: InputType;
      required?: boolean;
      categories?: string[];
      options?: { label: string; value: string }[];
      booleanChildren?: { true?: any[]; false?: any[] };
      defaultBoolean?: boolean | null;
      booleanLabels?: { true?: string; false?: string };
      booleanDisplay?: "radio" | "dropdown";
      group?: string;
      groupOrder?: number;
      selectDisplay?: "dropdown" | "radio" | "checkbox";
      repeatable?: {
        itemLabel?: string;
        min?: number;
        max?: number;
        fields?: { label?: string; value?: string; inputType?: InputType; options?: { label: string; value: string }[] }[];
      };
      showWhen?: { package: string; category: string | string[] }[];
      groupShowWhen?: { field: string; values: string[]; childKey?: string; childValues?: string[] }[] | null;
    };
  }>({
    label: "",
    value: "",
    valueType: "string",
    sortOrder: 0,
    isActive: true,
    meta: { inputType: "string", required: false, categories: [] },
  });
  const [applyToAll, setApplyToAll] = React.useState(true);

  React.useEffect(() => {
    async function loadCats() {
      try {
        const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(`${pkg}_category`)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        setCategoryOptions(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      }
    }
    void loadCats();
  }, [pkg]);

  React.useEffect(() => {
    async function loadPackages() {
      try {
        const res = await fetch("/api/form-options?groupKey=packages", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        setAllPackages(Array.isArray(data) ? data.filter((p) => p.value !== pkg) : []);
      } catch { /* ignore */ }
    }
    void loadPackages();
  }, [pkg]);

  const loadCrossPkgCats = React.useCallback(async (pkgKey: string) => {
    if (crossPkgCategories[pkgKey]) return;
    try {
      const res = await fetch(`/api/form-options?groupKey=${encodeURIComponent(`${pkgKey}_category`)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { label: string; value: string }[];
      setCrossPkgCategories((prev) => ({ ...prev, [pkgKey]: Array.isArray(data) ? data : [] }));
    } catch { /* ignore */ }
  }, [crossPkgCategories]);

  React.useEffect(() => {
    async function loadExisting() {
      try {
        const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(`${pkg}_fields`)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as any[];
        const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
          id: r.id,
          label: r.label,
          value: r.value,
          sortOrder: r.sortOrder ?? 0,
          isActive: r.isActive ?? true,
          meta: (r.meta ?? {}) as { group?: string; inputType?: string; options?: { label: string; value: string }[] } | null,
        }));
        setExisting(rows);
      } catch {
        // ignore
      }
    }
    void loadExisting();
  }, [pkg]);

  const existingGroupNames = React.useMemo(() => {
    const names = new Set<string>();
    for (const r of existing) {
      const n = (r.meta?.group ?? "").trim();
      if (n) names.add(n);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [existing]);
  const [customGroupMode, setCustomGroupMode] = React.useState(false);
  const isCustomGroup = React.useMemo(() => {
    if (customGroupMode) return true;
    const val = (form.meta?.group ?? "").trim();
    return Boolean(val) && !existingGroupNames.includes(val);
  }, [form.meta, existingGroupNames, customGroupMode]);

  function updateMeta<K extends keyof NonNullable<typeof form.meta>>(key: K, value: NonNullable<typeof form.meta>[K]) {
    setForm((f) => ({ ...f, meta: { ...(f.meta ?? {}), [key]: value } }));
  }
  function toggleCategory(value: string) {
    const current = Array.isArray(form.meta?.categories) ? ([...(form.meta?.categories ?? [])] as string[]) : [];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    updateMeta("categories", next);
  }
  React.useEffect(() => {
    const isAll = !Array.isArray(form.meta?.categories) || (form.meta?.categories as string[])?.length === 0;
    setApplyToAll(isAll);
  }, [form.meta]);

  async function save() {
    try {
      if (!form.label || !form.value) {
        toast.error("Label and value are required");
        return;
      }
      const normalizedMeta = {
        ...(form.meta ?? {}),
        categories: applyToAll ? [] : ((form.meta?.categories ?? []) as string[]),
      };
      // Compute sortOrder based on target group (append to end)
      const targetGroup = String((normalizedMeta.group ?? "") || "");
      const groupMembers = existing.filter((r) => String((r.meta?.group ?? "")) === targetGroup);
      const maxGroupSort = groupMembers.reduce((acc, r) => Math.max(acc, Number(r.sortOrder ?? 0)), -1);
      const nextSortOrder = maxGroupSort + 1;
      const payload = {
        label: form.label,
        value: form.value,
        sortOrder: nextSortOrder,
        isActive: !!form.isActive,
        valueType: form.valueType ?? "string",
        meta: normalizedMeta,
      };
      const res = await fetch(`/api/admin/form-options`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupKey: `${pkg}_fields`, ...payload }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        let msg = t || "Create failed";
        try {
          const j = JSON.parse(t);
          msg = j?.error || msg;
        } catch {}
        if (res.status === 409) {
          msg = "This key already exists in this group. Use a different Value (key).";
        }
        throw new Error(msg);
      }
      toast.success("Created");
      window.location.href = `/admin/policy-settings/${pkg}/fields`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Add Field — {pkg}</h1>
        <div className="flex gap-2">
          <Link href={`/admin/policy-settings/${pkg}/fields`}>
            <Button variant="outline" className="inline-flex items-center gap-2">
              <X className="h-4 w-4" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
          </Link>
          <Button onClick={save} className="inline-flex items-center gap-2">
            <Save className="h-4 w-4" />
            <span className="hidden sm:inline">Create</span>
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 sm:p-6">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Label</Label>
            <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label>Value (key)</Label>
            <Input value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label>Input Type</Label>
            <select
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              value={form.meta?.inputType ?? "string"}
              onChange={(e) => updateMeta("inputType", e.target.value as InputType)}
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="currency">Currency</option>
              <option value="date">Date</option>
              <option value="select">Select</option>
              <option value="multi_select">Multi Select</option>
              <option value="boolean">Boolean (Yes/No)</option>
              <option value="repeatable">Repeatable (List)</option>
              <option value="formula">Formula</option>
            </select>
          </div>

          {form.meta?.inputType === "formula" ? (
            <div className="grid gap-2">
              <div className="grid gap-1">
                <Label>Formula Expression</Label>
                <Input
                  placeholder="e.g. {sum_insured} * 0.05"
                  value={String(((form.meta as any)?.formula ?? "") || "")}
                  onChange={(e) => updateMeta("formula" as any, e.target.value as any)}
                />
                <p className="text-xs text-neutral-500">
                  Reference other fields using {"{field_key}"} syntax. Supports numeric math (+, -, *, /) and date arithmetic (e.g. {"{start_date}"} + 364 to add days).
                </p>
              </div>
            </div>
          ) : null}

          {form.meta?.inputType === "currency" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>Currency Code</Label>
                <Input
                  placeholder="e.g. HKD, USD"
                  value={String(((form.meta as any)?.currencyCode ?? "") || "")}
                  onChange={(e) => updateMeta("currencyCode" as any, e.target.value as any)}
                />
              </div>
              <div className="grid gap-1">
                <Label>Decimal Places</Label>
                <Input
                  type="number"
                  className="w-28"
                  placeholder="2"
                  value={String(((form.meta as any)?.decimals ?? 2))}
                  onChange={(e) => updateMeta("decimals" as any, (Number(e.target.value) || 0) as any)}
                />
              </div>
            </div>
          ) : null}

          {["select", "multi_select"].includes((form.meta?.inputType ?? "") as string) ? (
            <div className="grid gap-2">
              <div className="grid gap-1">
                <Label>Display</Label>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="selectDisplayNew"
                      className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                      checked={((form.meta?.selectDisplay ?? "dropdown") as any) === "dropdown"}
                      onChange={() => updateMeta("selectDisplay", "dropdown" as any)}
                    />
                    Dropdown
                  </label>
                  {((form.meta?.inputType ?? "") as string) === "select" ? (
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="selectDisplayNew"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={form.meta?.selectDisplay === ("radio" as any)}
                        onChange={() => updateMeta("selectDisplay", "radio" as any)}
                      />
                      Radio buttons
                    </label>
                  ) : (
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="selectDisplayNew"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={form.meta?.selectDisplay === ("checkbox" as any)}
                        onChange={() => updateMeta("selectDisplay", "checkbox" as any)}
                      />
                      Checkboxes
                    </label>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Options</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const next = Array.isArray(form.meta?.options) ? [...(form.meta?.options ?? [])] : [];
                      next.push({ label: "", value: "" });
                      updateMeta("options", next as any);
                    }}
                  >
                    Add option
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const pasted = window.prompt('Paste options, one per line. Use "Label|value" or "Label=value". If no separator, label is used as value.');
                      if (!pasted) return;
                      const lines = pasted.split(/\r?\n/);
                      const options = lines
                        .map((l) => l.trim())
                        .filter(Boolean)
                        .map((l) => {
                          const parts = l.includes("|") ? l.split("|") : l.split("=");
                          const label = (parts[0] ?? "").trim();
                          const value = (parts[1] ?? label).trim();
                          return { label, value };
                        });
                      updateMeta("options", options as any);
                    }}
                  >
                    Import
                  </Button>
                </div>
              </div>
              <div className="grid gap-2">
                {(Array.isArray(form.meta?.options) ? (form.meta?.options ?? []) : []).map((opt: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-12 items-center gap-2">
                    <div className="col-span-5">
                      <Input
                        placeholder="Label"
                        value={opt.label ?? ""}
                        onChange={(e) => {
                          const next = [...((form.meta?.options ?? []) as any[])];
                          next[idx] = { ...next[idx], label: e.target.value };
                          updateMeta("options", next as any);
                        }}
                      />
                    </div>
                    <div className="col-span-5">
                      <Input
                        placeholder="Value"
                        value={opt.value ?? ""}
                        onChange={(e) => {
                          const next = [...((form.meta?.options ?? []) as any[])];
                          next[idx] = { ...next[idx], value: e.target.value };
                          updateMeta("options", next as any);
                        }}
                      />
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          const next = [...((form.meta?.options ?? []) as any[])];
                          next.splice(idx, 1);
                          updateMeta("options", next as any);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                {((form.meta?.options?.length ?? 0) === 0) ? <p className="text-xs text-neutral-500">No options yet. Click "Add option" or "Import".</p> : null}
              </div>
            </div>
          ) : null}

          {form.meta?.inputType === "repeatable" ? (
            <div className="grid gap-3">
              <div className="grid gap-1">
                <Label>Repeatable — Item label</Label>
                <Input
                  placeholder="Accessory"
                  value={String((form.meta?.repeatable?.itemLabel ?? ""))}
                  onChange={(e) =>
                    updateMeta("repeatable", { ...(form.meta?.repeatable ?? {}), itemLabel: e.target.value } as any)
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label>Min items</Label>
                  <Input
                    type="number"
                    value={String((form.meta?.repeatable?.min ?? 0))}
                    onChange={(e) =>
                      updateMeta("repeatable", { ...(form.meta?.repeatable ?? {}), min: Number(e.target.value) || 0 } as any)
                    }
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Max items</Label>
                  <Input
                    type="number"
                    value={String((form.meta?.repeatable?.max ?? 0))}
                    onChange={(e) =>
                      updateMeta("repeatable", { ...(form.meta?.repeatable ?? {}), max: Number(e.target.value) || 0 } as any)
                    }
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Item fields</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const rep = (form.meta?.repeatable ?? {}) as any;
                    const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                    fields.push({ label: "", value: "", inputType: "string" });
                    updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                  }}
                >
                  Add field
                </Button>
              </div>
              <div className="grid gap-2">
                {(((form.meta?.repeatable?.fields ?? []) as any[]) ?? []).map((fld, idx) => (
                  <div key={`repfld-${idx}`} className="grid grid-cols-12 items-center gap-2">
                    <div className="col-span-4">
                      <Input
                        placeholder="Label"
                        value={fld?.label ?? ""}
                        onChange={(e) => {
                          const rep = (form.meta?.repeatable ?? {}) as any;
                          const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                          fields[idx] = { ...(fields[idx] ?? {}), label: e.target.value };
                          updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                        }}
                      />
                    </div>
                    <div className="col-span-4">
                      <Input
                        placeholder="Value (key)"
                        value={fld?.value ?? ""}
                        onChange={(e) => {
                          const rep = (form.meta?.repeatable ?? {}) as any;
                          const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                          fields[idx] = { ...(fields[idx] ?? {}), value: e.target.value };
                          updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                        }}
                      />
                    </div>
                    <div className="col-span-3">
                      <select
                        className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        value={fld?.inputType ?? "string"}
                        onChange={(e) => {
                          const nextType = e.target.value as InputType;
                          const rep = (form.meta?.repeatable ?? {}) as any;
                          const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                          fields[idx] = {
                            ...(fields[idx] ?? {}),
                            inputType: nextType,
                            options: nextType === "select" || nextType === "multi_select" ? (fields[idx]?.options ?? []) : undefined,
                          };
                          updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                        }}
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="currency">Currency</option>
                        <option value="date">Date</option>
                        <option value="select">Select</option>
                        <option value="multi_select">Multi Select</option>
                        <option value="boolean">Boolean (Yes/No)</option>
                        <option value="formula">Formula</option>
                      </select>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          const rep = (form.meta?.repeatable ?? {}) as any;
                          const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                          fields.splice(idx, 1);
                          updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    {fld?.inputType === "formula" ? (
                      <div className="col-span-12">
                        <Label>Formula Expression</Label>
                        <Input
                          placeholder="e.g. {cost} * 1.1"
                          value={String(fld?.formula ?? "")}
                          onChange={(e) => {
                            const rep = (form.meta?.repeatable ?? {}) as any;
                            const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                            fields[idx] = { ...(fields[idx] ?? {}), formula: e.target.value };
                            updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                          }}
                        />
                        <p className="mt-1 text-xs text-neutral-500">
                          Reference sibling fields using {"{field_key}"} syntax.
                        </p>
                      </div>
                    ) : null}
                    {fld?.inputType && (fld.inputType === "select" || fld.inputType === "multi_select") ? (
                      <div className="col-span-12 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                        <div className="mb-2 flex items-center justify-between">
                          <Label>Options</Label>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const rep = (form.meta?.repeatable ?? {}) as any;
                                const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                                const childOptions = Array.isArray(fields[idx]?.options) ? [...(fields[idx]?.options ?? [])] : [];
                                childOptions.push({ label: "", value: "" });
                                fields[idx] = { ...(fields[idx] ?? {}), options: childOptions };
                                updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                              }}
                            >
                              Add option
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const pasted = window.prompt('Paste options, one per line. Use "Label|value" or "Label=value". If no separator, label is used as value.');
                                if (!pasted) return;
                                const lines = pasted.split(/\r?\n/);
                                const childOptions = lines
                                  .map((l) => l.trim())
                                  .filter(Boolean)
                                  .map((l) => {
                                    const parts = l.includes("|") ? l.split("|") : l.split("=");
                                    const label = (parts[0] ?? "").trim();
                                    const value = (parts[1] ?? label).trim();
                                    return { label, value };
                                  });
                                const rep = (form.meta?.repeatable ?? {}) as any;
                                const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                                fields[idx] = { ...(fields[idx] ?? {}), options: childOptions };
                                updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                              }}
                            >
                              Import
                            </Button>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          {((fld?.options ?? []) as { label?: string; value?: string }[]).map((o, oi) => (
                            <div key={oi} className="grid grid-cols-12 items-center gap-2">
                              <div className="col-span-5">
                                <Input
                                  placeholder="Label"
                                  value={o.label ?? ""}
                                  onChange={(e) => {
                                    const rep = (form.meta?.repeatable ?? {}) as any;
                                    const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                                    const opts = Array.isArray(fields[idx]?.options) ? [...(fields[idx]?.options ?? [])] : [];
                                    opts[oi] = { ...(opts[oi] ?? {}), label: e.target.value };
                                    fields[idx] = { ...(fields[idx] ?? {}), options: opts };
                                    updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                                  }}
                                />
                              </div>
                              <div className="col-span-5">
                                <Input
                                  placeholder="Value"
                                  value={o.value ?? ""}
                                  onChange={(e) => {
                                    const rep = (form.meta?.repeatable ?? {}) as any;
                                    const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                                    const opts = Array.isArray(fields[idx]?.options) ? [...(fields[idx]?.options ?? [])] : [];
                                    opts[oi] = { ...(opts[oi] ?? {}), value: e.target.value };
                                    fields[idx] = { ...(fields[idx] ?? {}), options: opts };
                                    updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                                  }}
                                />
                              </div>
                              <div className="col-span-2 flex justify-end">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => {
                                    const rep = (form.meta?.repeatable ?? {}) as any;
                                    const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                                    const opts = Array.isArray(fields[idx]?.options) ? [...(fields[idx]?.options ?? [])] : [];
                                    opts.splice(oi, 1);
                                    fields[idx] = { ...(fields[idx] ?? {}), options: opts };
                                    updateMeta("repeatable", { ...(rep ?? {}), fields } as any);
                                  }}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ))}
                          {((fld?.options?.length ?? 0) === 0) ? <p className="text-xs text-neutral-500">No child options yet. Click "Add option" or "Import".</p> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {form.meta?.inputType === "boolean" ? (
            <div className="grid gap-2">
              <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                <div className="mb-2">
                  <Label>Default Selection</Label>
                  <div className="mt-2 flex items-center gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="defaultBoolean"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={form.meta?.defaultBoolean === true}
                        onChange={() => updateMeta("defaultBoolean", true as any)}
                      />
                      Yes
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="defaultBoolean"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={form.meta?.defaultBoolean === false}
                        onChange={() => updateMeta("defaultBoolean", false as any)}
                      />
                      No
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="defaultBoolean"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={typeof form.meta?.defaultBoolean === "undefined" || form.meta?.defaultBoolean === null}
                        onChange={() => updateMeta("defaultBoolean", null as any)}
                      />
                      None
                    </label>
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label>Display</Label>
                  <div className="flex items-center gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="booleanDisplayNew"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={((form.meta?.booleanDisplay ?? "radio") as any) === "radio"}
                        onChange={() => updateMeta("booleanDisplay", "radio" as any)}
                      />
                      Radio buttons
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="booleanDisplayNew"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={form.meta?.booleanDisplay === ("dropdown" as any)}
                        onChange={() => updateMeta("booleanDisplay", "dropdown" as any)}
                      />
                      Dropdown
                    </label>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Labels</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-xs text-neutral-500">Yes label</Label>
                      <Input
                        placeholder="Yes"
                        value={String(((form.meta?.booleanLabels as any)?.true ?? ""))}
                        onChange={(e) =>
                          updateMeta("booleanLabels", { ...((form.meta?.booleanLabels as any) ?? {}), true: e.target.value } as any)
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs text-neutral-500">No label</Label>
                      <Input
                        placeholder="No"
                        value={String(((form.meta?.booleanLabels as any)?.false ?? ""))}
                        onChange={(e) =>
                          updateMeta("booleanLabels", { ...((form.meta?.booleanLabels as any) ?? {}), false: e.target.value } as any)
                        }
                      />
                    </div>
                  </div>
                </div>
                {/* Boolean branch children (Yes / No) */}
                <div className="grid gap-2 mt-2">
                  <Label>Children (optional)</Label>
                  {/* YES branch */}
                  <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="font-medium">Yes branch</div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                          const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                          arr.push({ label: "", inputType: "string", options: [] });
                          updateMeta("booleanChildren", { ...bc, true: arr } as any);
                        }}
                      >
                        Add child
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      {(((form.meta?.booleanChildren as any)?.true ?? []) as any[]).map((child, cIdx) => (
                        <div key={`new-bool-yes-${cIdx}`} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                          <div className="mb-2 flex items-center justify-between">
                            <Label>Child #{cIdx + 1}</Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                arr.splice(cIdx, 1);
                                updateMeta("booleanChildren", { ...bc, true: arr } as any);
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[220px] flex-1">
                              <Label>Label</Label>
                              <Input
                                placeholder="Child field label"
                                value={child?.label ?? ""}
                                onChange={(e) => {
                                  const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                  const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                  arr[cIdx] = { ...(arr[cIdx] ?? {}), label: e.target.value };
                                  updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                }}
                              />
                            </div>
                            <div className="w-[200px]">
                              <Label>Type</Label>
                              <select
                                className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                                value={child?.inputType ?? "string"}
                                onChange={(e) => {
                                  const nextType = e.target.value as any;
                                  const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                  const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                  arr[cIdx] = {
                                    ...(arr[cIdx] ?? {}),
                                    inputType: nextType,
                                    options: nextType === "select" || nextType === "multi_select" ? (arr[cIdx]?.options ?? []) : undefined,
                                  };
                                  updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                }}
                              >
                                <option value="string">String</option>
                                <option value="number">Number</option>
                                <option value="currency">Currency</option>
                                <option value="date">Date</option>
                                <option value="select">Select</option>
                                <option value="multi_select">Multi Select</option>
                                <option value="boolean">Boolean (Yes/No)</option>
                                <option value="formula">Formula</option>
                              </select>
                            </div>
                            {child?.inputType === "formula" ? (
                              <div className="col-span-12 mt-2">
                                <Label>Formula Expression</Label>
                                <Input
                                  placeholder="e.g. {field_key} * 0.05"
                                  value={String((child as any)?.formula ?? "")}
                                  onChange={(e) => {
                                    const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                    const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                    arr[cIdx] = { ...(arr[cIdx] ?? {}), formula: e.target.value };
                                    updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                  }}
                                />
                                <p className="mt-1 text-xs text-neutral-500">Reference sibling fields using {"{field_key}"} syntax.</p>
                              </div>
                            ) : null}
                            {child?.inputType === "currency" ? (
                              <div className="col-span-12 mt-2 grid gap-2 sm:grid-cols-2">
                                <div className="grid gap-1">
                                  <Label>Currency Code</Label>
                                  <Input
                                    placeholder="e.g. HKD, USD"
                                    value={String(child?.currencyCode ?? "")}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                      const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), currencyCode: e.target.value };
                                      updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                    }}
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <Label>Decimal Places</Label>
                                  <Input
                                    type="number"
                                    className="w-28"
                                    placeholder="2"
                                    value={String(child?.decimals ?? 2)}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                      const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), decimals: Number(e.target.value) || 0 };
                                      updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                    }}
                                  />
                                </div>
                              </div>
                            ) : null}
                            {child?.inputType === "boolean" ? (
                              <div className="col-span-12 mt-2 space-y-3">
                                <div className="grid gap-2 sm:grid-cols-2">
                                <div className="grid gap-1">
                                  <Label>Yes Label</Label>
                                  <Input
                                    placeholder="Yes"
                                    value={String(child?.booleanLabels?.true ?? "")}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                      const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanLabels: { ...(arr[cIdx]?.booleanLabels ?? {}), true: e.target.value } };
                                      updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                    }}
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <Label>No Label</Label>
                                  <Input
                                    placeholder="No"
                                    value={String(child?.booleanLabels?.false ?? "")}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                      const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanLabels: { ...(arr[cIdx]?.booleanLabels ?? {}), false: e.target.value } };
                                      updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                    }}
                                  />
                                </div>
                                <div className="grid gap-1 sm:col-span-2">
                                  <Label>Display</Label>
                                  <div className="flex items-center gap-4 text-sm">
                                    <label className="inline-flex items-center gap-2">
                                      <input type="radio" checked={(child?.booleanDisplay ?? "radio") === "radio"} onChange={() => {
                                        const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                        const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanDisplay: "radio" };
                                        updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                      }} />
                                      Radio buttons
                                    </label>
                                    <label className="inline-flex items-center gap-2">
                                      <input type="radio" checked={child?.booleanDisplay === "dropdown"} onChange={() => {
                                        const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                        const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanDisplay: "dropdown" };
                                        updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                      }} />
                                      Dropdown
                                    </label>
                                  </div>
                                </div>
                                </div>
                                {(["true", "false"] as const).map((branch) => {
                                  const branchLabel = branch === "true" ? "When YES" : "When NO";
                                  const branchChildren = (child?.booleanChildren as any)?.[branch] ?? [];
                                  const bArr2 = Array.isArray(branchChildren) ? branchChildren : [];
                                  return (
                                    <div key={branch} className="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                                      <div className="flex items-center justify-between">
                                        <Label className="text-xs">{branchLabel}</Label>
                                        <Button type="button" size="sm" variant="secondary" onClick={() => {
                                          const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                          const parentArr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                          const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                          const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                          bArr.push({ label: "", inputType: "string" });
                                          boolCh[branch] = bArr;
                                          parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                          updateMeta("booleanChildren", { ...bc, true: parentArr } as any);
                                        }}>Add child</Button>
                                      </div>
                                      {bArr2.map((bChild: any, bIdx: number) => (
                                        <div key={`yes-c${cIdx}-b${branch}-${bIdx}`} className="rounded border border-neutral-100 p-2 dark:border-neutral-800">
                                          <div className="mb-1 flex items-center justify-between">
                                            <span className="text-xs font-medium">Child #{bIdx + 1}</span>
                                            <Button type="button" size="sm" variant="outline" onClick={() => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr.splice(bIdx, 1);
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, true: parentArr } as any);
                                            }}>Remove</Button>
                                          </div>
                                          <div className="grid grid-cols-12 gap-2">
                                            <div className="col-span-6"><Input placeholder="Label" value={String(bChild?.label ?? "")} onChange={(e) => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr[bIdx] = { ...(bArr[bIdx] ?? {}), label: e.target.value };
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, true: parentArr } as any);
                                            }} /></div>
                                            <div className="col-span-6"><select className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" value={bChild?.inputType ?? "string"} onChange={(e) => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr[bIdx] = { ...(bArr[bIdx] ?? {}), inputType: e.target.value, options: e.target.value === "select" || e.target.value === "multi_select" ? (bArr[bIdx]?.options ?? []) : undefined };
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, true: parentArr } as any);
                                            }}>
                                              <option value="string">String</option>
                                              <option value="number">Number</option>
                                              <option value="currency">Currency</option>
                                              <option value="date">Date</option>
                                              <option value="select">Select</option>
                                              <option value="multi_select">Multi Select</option>
                                              <option value="formula">Formula</option>
                                            </select></div>
                                            {bChild?.inputType === "currency" ? (<><div className="col-span-6"><Input placeholder="e.g. HKD" value={String(bChild?.currencyCode ?? "")} onChange={(e) => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr[bIdx] = { ...(bArr[bIdx] ?? {}), currencyCode: e.target.value };
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, true: parentArr } as any);
                                            }} /></div><div className="col-span-6"><Input type="number" placeholder="2" value={String(bChild?.decimals ?? 2)} onChange={(e) => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr[bIdx] = { ...(bArr[bIdx] ?? {}), decimals: Number(e.target.value) || 0 };
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, true: parentArr } as any);
                                            }} /></div></>) : null}
                                          </div>
                                        </div>
                                      ))}
                                      {bArr2.length === 0 ? <p className="text-xs text-neutral-400">No children configured.</p> : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                            {child?.inputType && ["select", "multi_select"].includes(child.inputType) ? (
                              <div className="col-span-12 mt-2 space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label>Options</Label>
                                  <div className="flex gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => {
                                        const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                        const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                        const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                        opts.push({ label: "", value: "" });
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                        updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                      }}
                                    >
                                      Add option
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        const pasted = window.prompt(
                                          'Paste options, one per line. Use "Label|value" or "Label=value". If no separator, label is used as value.'
                                        );
                                        if (!pasted) return;
                                        const lines = pasted.split(/\r?\n/);
                                        const parsed = lines
                                          .map((l) => l.trim())
                                          .filter(Boolean)
                                          .map((l) => {
                                            const parts = l.includes("|") ? l.split("|") : l.split("=");
                                            const label = (parts[0] ?? "").trim();
                                            const value = (parts[1] ?? label).trim();
                                            return { label, value };
                                          });
                                        const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                        const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), options: parsed };
                                        updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                      }}
                                    >
                                      Import
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          {/* Cross-package condition for this YES child */}
                          <div className="mt-2">
                            <ShowWhenConfig
                              compact
                              value={Array.isArray(child?.showWhen) ? child.showWhen : []}
                              onChange={(next) => {
                                const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                const arr = Array.isArray(bc.true) ? [...(bc.true as any[])] : [];
                                arr[cIdx] = { ...(arr[cIdx] ?? {}), showWhen: next };
                                updateMeta("booleanChildren", { ...bc, true: arr } as any);
                              }}
                              allPackages={allPackages}
                              crossPkgCategories={crossPkgCategories}
                              onLoadCategories={loadCrossPkgCats}
                            />
                          </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* NO branch */}
                  <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="font-medium">No branch</div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                          const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                          arr.push({ label: "", inputType: "string", options: [] });
                          updateMeta("booleanChildren", { ...bc, false: arr } as any);
                        }}
                      >
                        Add child
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      {(((form.meta?.booleanChildren as any)?.false ?? []) as any[]).map((child, cIdx) => (
                        <div key={`new-bool-no-${cIdx}`} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                          <div className="mb-2 flex items-center justify-between">
                            <Label>Child #{cIdx + 1}</Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                arr.splice(cIdx, 1);
                                updateMeta("booleanChildren", { ...bc, false: arr } as any);
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[220px] flex-1">
                              <Label>Label</Label>
                              <Input
                                placeholder="Child field label"
                                value={child?.label ?? ""}
                                onChange={(e) => {
                                  const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                  const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                  arr[cIdx] = { ...(arr[cIdx] ?? {}), label: e.target.value };
                                  updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                }}
                              />
                            </div>
                            <div className="w-[200px]">
                              <Label>Type</Label>
                              <select
                                className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                                value={child?.inputType ?? "string"}
                                onChange={(e) => {
                                  const nextType = e.target.value as any;
                                  const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                  const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                  arr[cIdx] = {
                                    ...(arr[cIdx] ?? {}),
                                    inputType: nextType,
                                    options: nextType === "select" || nextType === "multi_select" ? (arr[cIdx]?.options ?? []) : undefined,
                                  };
                                  updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                }}
                              >
                                <option value="string">String</option>
                                <option value="number">Number</option>
                                <option value="currency">Currency</option>
                                <option value="date">Date</option>
                                <option value="select">Select</option>
                                <option value="multi_select">Multi Select</option>
                                <option value="boolean">Boolean (Yes/No)</option>
                                <option value="formula">Formula</option>
                              </select>
                            </div>
                            {child?.inputType === "formula" ? (
                              <div className="col-span-12 mt-2">
                                <Label>Formula Expression</Label>
                                <Input
                                  placeholder="e.g. {field_key} * 0.05"
                                  value={String((child as any)?.formula ?? "")}
                                  onChange={(e) => {
                                    const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                    const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                    arr[cIdx] = { ...(arr[cIdx] ?? {}), formula: e.target.value };
                                    updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                  }}
                                />
                                <p className="mt-1 text-xs text-neutral-500">Reference sibling fields using {"{field_key}"} syntax.</p>
                              </div>
                            ) : null}
                            {child?.inputType === "currency" ? (
                              <div className="col-span-12 mt-2 grid gap-2 sm:grid-cols-2">
                                <div className="grid gap-1">
                                  <Label>Currency Code</Label>
                                  <Input
                                    placeholder="e.g. HKD, USD"
                                    value={String(child?.currencyCode ?? "")}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                      const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), currencyCode: e.target.value };
                                      updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                    }}
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <Label>Decimal Places</Label>
                                  <Input
                                    type="number"
                                    className="w-28"
                                    placeholder="2"
                                    value={String(child?.decimals ?? 2)}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                      const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), decimals: Number(e.target.value) || 0 };
                                      updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                    }}
                                  />
                                </div>
                              </div>
                            ) : null}
                            {child?.inputType === "boolean" ? (
                              <div className="col-span-12 mt-2 space-y-3">
                                <div className="grid gap-2 sm:grid-cols-2">
                                <div className="grid gap-1">
                                  <Label>Yes Label</Label>
                                  <Input
                                    placeholder="Yes"
                                    value={String(child?.booleanLabels?.true ?? "")}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                      const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanLabels: { ...(arr[cIdx]?.booleanLabels ?? {}), true: e.target.value } };
                                      updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                    }}
                                  />
                                </div>
                                <div className="grid gap-1">
                                  <Label>No Label</Label>
                                  <Input
                                    placeholder="No"
                                    value={String(child?.booleanLabels?.false ?? "")}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                      const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanLabels: { ...(arr[cIdx]?.booleanLabels ?? {}), false: e.target.value } };
                                      updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                    }}
                                  />
                                </div>
                                <div className="grid gap-1 sm:col-span-2">
                                  <Label>Display</Label>
                                  <div className="flex items-center gap-4 text-sm">
                                    <label className="inline-flex items-center gap-2">
                                      <input type="radio" checked={(child?.booleanDisplay ?? "radio") === "radio"} onChange={() => {
                                        const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                        const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanDisplay: "radio" };
                                        updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                      }} />
                                      Radio buttons
                                    </label>
                                    <label className="inline-flex items-center gap-2">
                                      <input type="radio" checked={child?.booleanDisplay === "dropdown"} onChange={() => {
                                        const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                        const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanDisplay: "dropdown" };
                                        updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                      }} />
                                      Dropdown
                                    </label>
                                  </div>
                                </div>
                                </div>
                                {(["true", "false"] as const).map((branch) => {
                                  const branchLabel = branch === "true" ? "When YES" : "When NO";
                                  const branchChildren = (child?.booleanChildren as any)?.[branch] ?? [];
                                  const bArr2 = Array.isArray(branchChildren) ? branchChildren : [];
                                  return (
                                    <div key={branch} className="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                                      <div className="flex items-center justify-between">
                                        <Label className="text-xs">{branchLabel}</Label>
                                        <Button type="button" size="sm" variant="secondary" onClick={() => {
                                          const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                          const parentArr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                          const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                          const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                          bArr.push({ label: "", inputType: "string" });
                                          boolCh[branch] = bArr;
                                          parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                          updateMeta("booleanChildren", { ...bc, false: parentArr } as any);
                                        }}>Add child</Button>
                                      </div>
                                      {bArr2.map((bChild: any, bIdx: number) => (
                                        <div key={`no-c${cIdx}-b${branch}-${bIdx}`} className="rounded border border-neutral-100 p-2 dark:border-neutral-800">
                                          <div className="mb-1 flex items-center justify-between">
                                            <span className="text-xs font-medium">Child #{bIdx + 1}</span>
                                            <Button type="button" size="sm" variant="outline" onClick={() => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr.splice(bIdx, 1);
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, false: parentArr } as any);
                                            }}>Remove</Button>
                                          </div>
                                          <div className="grid grid-cols-12 gap-2">
                                            <div className="col-span-6"><Input placeholder="Label" value={String(bChild?.label ?? "")} onChange={(e) => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr[bIdx] = { ...(bArr[bIdx] ?? {}), label: e.target.value };
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, false: parentArr } as any);
                                            }} /></div>
                                            <div className="col-span-6"><select className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" value={bChild?.inputType ?? "string"} onChange={(e) => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr[bIdx] = { ...(bArr[bIdx] ?? {}), inputType: e.target.value, options: e.target.value === "select" || e.target.value === "multi_select" ? (bArr[bIdx]?.options ?? []) : undefined };
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, false: parentArr } as any);
                                            }}>
                                              <option value="string">String</option>
                                              <option value="number">Number</option>
                                              <option value="currency">Currency</option>
                                              <option value="date">Date</option>
                                              <option value="select">Select</option>
                                              <option value="multi_select">Multi Select</option>
                                              <option value="formula">Formula</option>
                                            </select></div>
                                            {bChild?.inputType === "currency" ? (<><div className="col-span-6"><Input placeholder="e.g. HKD" value={String(bChild?.currencyCode ?? "")} onChange={(e) => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr[bIdx] = { ...(bArr[bIdx] ?? {}), currencyCode: e.target.value };
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, false: parentArr } as any);
                                            }} /></div><div className="col-span-6"><Input type="number" placeholder="2" value={String(bChild?.decimals ?? 2)} onChange={(e) => {
                                              const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                              const parentArr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                              const boolCh = { ...(parentArr[cIdx]?.booleanChildren ?? {}) };
                                              const bArr = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                              bArr[bIdx] = { ...(bArr[bIdx] ?? {}), decimals: Number(e.target.value) || 0 };
                                              boolCh[branch] = bArr;
                                              parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh };
                                              updateMeta("booleanChildren", { ...bc, false: parentArr } as any);
                                            }} /></div></>) : null}
                                          </div>
                                        </div>
                                      ))}
                                      {bArr2.length === 0 ? <p className="text-xs text-neutral-400">No children configured.</p> : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          {/* Cross-package condition for this NO child */}
                          <div className="mt-2">
                            <ShowWhenConfig
                              compact
                              value={Array.isArray(child?.showWhen) ? child.showWhen : []}
                              onChange={(next) => {
                                const bc = { ...((form.meta?.booleanChildren ?? {}) as any) };
                                const arr = Array.isArray(bc.false) ? [...(bc.false as any[])] : [];
                                arr[cIdx] = { ...(arr[cIdx] ?? {}), showWhen: next };
                                updateMeta("booleanChildren", { ...bc, false: arr } as any);
                              }}
                              allPackages={allPackages}
                              crossPkgCategories={crossPkgCategories}
                              onLoadCategories={loadCrossPkgCats}
                            />
                          </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-1">
            <Label>Required</Label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(form.meta?.required)} onChange={(e) => updateMeta("required", e.target.checked)} />
              Required
            </label>
          </div>
          <div className="grid gap-1">
            <Label>Categories</Label>
            <label className="mb-1 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
              Applies to all categories
            </label>
            {!applyToAll ? null : <p className="text-xs text-neutral-500">Uncheck above to select specific categories.</p>}
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${applyToAll ? "opacity-50 pointer-events-none" : ""}`}>
              {categoryOptions.map((opt) => {
                const selected = Array.isArray(form.meta?.categories) ? (form.meta?.categories ?? []).includes(opt.value) : false;
                return (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selected} onChange={() => toggleCategory(opt.value)} />
                    {opt.label}
                  </label>
                );
              })}
              {categoryOptions.length === 0 ? <p className="col-span-2 text-xs text-neutral-500">No categories found. Create categories first.</p> : null}
            </div>
          </div>

          <ShowWhenConfig
            value={form.meta?.showWhen ?? []}
            onChange={(next) => updateMeta("showWhen", next)}
            allPackages={allPackages}
            crossPkgCategories={crossPkgCategories}
            onLoadCategories={loadCrossPkgCats}
          />

          {/* Sort Order input removed; ordering handled by group membership */}
          <div className="grid gap-1">
            <Label>Group (optional)</Label>
            <select
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              value={isCustomGroup ? "__custom" : ((form.meta?.group ?? "") as string)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__custom") {
                  setCustomGroupMode(true);
                  updateMeta("group", "" as any);
                } else {
                  setCustomGroupMode(false);
                  updateMeta("group", v as any);
                  if (v) {
                    const sibling = existing.find((r) => String((r.meta as any)?.group ?? "").trim() === v && (r.meta as any)?.groupShowWhen);
                    if (sibling) {
                      updateMeta("groupShowWhen", (sibling.meta as any).groupShowWhen);
                    } else {
                      updateMeta("groupShowWhen", null as any);
                    }
                  } else {
                    updateMeta("groupShowWhen", null as any);
                  }
                }
              }}
            >
              <option value="">(no group)</option>
              {existingGroupNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              <option value="__custom">Custom…</option>
            </select>
            {isCustomGroup || (String((form.meta?.group ?? "")) === "" && existingGroupNames.length === 0) ? (
              <Input
                placeholder="Enter new group name"
                value={(form.meta?.group ?? "") as string}
                onChange={(e) => updateMeta("group", e.target.value as any)}
              />
            ) : null}
            <div className="grid gap-1">
              <Label>Group Sort Order (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="0"
                  value={String((form.meta?.groupOrder ?? 0) as number)}
                  onChange={(e) => updateMeta("groupOrder", Number(e.target.value) || 0)}
                  className="w-28"
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => updateMeta("groupOrder", Number((form.meta?.groupOrder ?? 0) as number) - 1)}
                  >
                    -1
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => updateMeta("groupOrder", Number((form.meta?.groupOrder ?? 0) as number) + 1)}
                  >
                    +1
                  </Button>
                </div>
              </div>
            </div>
            {String(form.meta?.group ?? "").trim() ? (
              <GroupShowWhenConfig
                value={form.meta?.groupShowWhen ?? null}
                onChange={(next) => updateMeta("groupShowWhen", next as any)}
                fields={existing as any}
              />
            ) : null}
            {(() => {
              const group = (form.meta?.group ?? "") as string;
              if (!group) return null;
              const members = existing
                .filter((r) => ((r.meta ?? {})?.group ?? "") === group)
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
              return (
                <div className="mt-2 rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800">
                  <div className="mb-1 font-medium">Current group: {group}</div>
                  {members.length === 0 ? (
                    <div className="text-neutral-500">No members yet.</div>
                  ) : (
                    <ul className="grid gap-1">
                      {members.map((m) => (
                        <li key={m.id} className="flex justify-between">
                          <span>{m.label}</span>
                          <span className="font-mono">sort {m.sortOrder}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Active
            </label>
          </div>
        </div>
      </div>
    </main>
  );
}






