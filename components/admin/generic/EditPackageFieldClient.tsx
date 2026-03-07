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
import { BooleanChildrenEditor, MetaJsonPreview } from "@/components/admin/generic/BooleanChildrenEditor";
import { TopLevelSelectEditor, TopLevelRepeatableEditor } from "@/components/admin/generic/FieldTypeEditors";
import { GroupAssignmentSection } from "@/components/admin/generic/GroupAssignmentSection";
import { InputTypeSelect, type InputType } from "@/components/admin/generic/InputTypeSelect";

export default function EditPackageFieldClient({ pkg, id }: { pkg: string; id: number }) {
  const [categoryOptions, setCategoryOptions] = React.useState<{ label: string; value: string }[]>([]);
  const [allPackages, setAllPackages] = React.useState<{ label: string; value: string }[]>([]);
  const [crossPkgCategories, setCrossPkgCategories] = React.useState<Record<string, { label: string; value: string }[]>>({});
  const [existing, setExisting] = React.useState<
    { id: number; label: string; value: string; sortOrder: number; isActive?: boolean; meta: { group?: string; inputType?: string; options?: { label: string; value: string }[] } | null }[]
  >([]);
  const [loading, setLoading] = React.useState(true);
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
      groupShowWhenMap?: Record<string, { field: string; values: string[]; childKey?: string; childValues?: string[] }[] | null>;
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
  const [customGroupMode, setCustomGroupMode] = React.useState(false);

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
        setAllPackages(Array.isArray(data) ? data : []);
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
      setLoading(true);
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
          valueType: r.valueType ?? "string",
          meta: (r.meta ?? {}) as { group?: string; inputType?: string; options?: { label: string; value: string }[] } | null,
        }));
        setExisting(rows);
        const current = rows.find((r) => r.id === id);
        if (current) {
          const mergedMeta = { inputType: "string", required: false, categories: [], ...(current.meta ?? {}) } as any;
          // Inherit groupShowWhenMap from siblings for each group
          const grpArr = Array.isArray(mergedMeta.group) ? mergedMeta.group : (typeof mergedMeta.group === "string" && mergedMeta.group.trim() ? [mergedMeta.group.trim()] : []);
          if (grpArr.length > 0 && !mergedMeta.groupShowWhenMap) {
            const inherited: Record<string, any> = {};
            for (const groupName of grpArr) {
              const sibling = rows.find((r) => {
                const rg = (r.meta as any)?.group;
                const rGroups = Array.isArray(rg) ? rg : (typeof rg === "string" && rg.trim() ? [rg.trim()] : []);
                return r.id !== id && rGroups.includes(groupName) && ((r.meta as any)?.groupShowWhenMap?.[groupName] || (r.meta as any)?.groupShowWhen);
              });
              if (sibling) {
                inherited[groupName] = (sibling.meta as any)?.groupShowWhenMap?.[groupName] ?? (sibling.meta as any).groupShowWhen;
              }
            }
            if (Object.keys(inherited).length > 0) mergedMeta.groupShowWhenMap = inherited;
          }
          setForm({
            label: current.label,
            value: current.value,
            valueType: current.valueType,
            sortOrder: current.sortOrder,
            isActive: Boolean((current as any).isActive ?? true),
            meta: mergedMeta,
          });
          const isAll = !Array.isArray((current.meta as any)?.categories) || ((current.meta as any)?.categories ?? []).length === 0;
          setApplyToAll(isAll);
          const existingShowWhen = Array.isArray(mergedMeta.showWhen) ? mergedMeta.showWhen : [];
          for (const rule of existingShowWhen) {
            if (rule?.package) {
              fetch(`/api/form-options?groupKey=${encodeURIComponent(`${rule.package}_category`)}`, { cache: "no-store" })
                .then((r) => r.json())
                .then((data) => {
                  setCrossPkgCategories((prev) => ({ ...prev, [rule.package]: Array.isArray(data) ? data : [] }));
                })
                .catch(() => {});
            }
          }
        } else {
          toast.error("Field not found");
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    void loadExisting();
  }, [pkg, id]);

  const existingGroupNames = React.useMemo(() => {
    const names = new Set<string>();
    for (const r of existing) {
      const g = r.meta?.group;
      const arr = Array.isArray(g) ? g : (typeof g === "string" && g.trim() ? [g.trim()] : []);
      for (const n of arr) if (n) names.add(n);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [existing]);
  const currentGroups = React.useMemo(() => {
    const g = form.meta?.group;
    if (Array.isArray(g)) return g.filter(Boolean) as string[];
    const s = String(g ?? "").trim();
    return s ? [s] : [];
  }, [form.meta?.group]);
  const isCustomGroup = React.useMemo(() => {
    if (customGroupMode) return true;
    return currentGroups.some((v) => !existingGroupNames.includes(v));
  }, [currentGroups, existingGroupNames, customGroupMode]);

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
      const payload = {
        label: form.label,
        value: form.value,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: !!form.isActive,
        valueType: form.valueType ?? "string",
        meta: normalizedMeta,
      };
      const res = await fetch(`/api/admin/form-options/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        let msg = t || "Update failed";
        try {
          const j = JSON.parse(t);
          msg = j?.error || msg;
        } catch {}
        throw new Error(msg);
      }
      toast.success("Updated");
      window.location.href = `/admin/policy-settings/${pkg}/fields`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Save failed";
      toast.error(message);
    }
  }

  return (
    <main className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">Edit Field — {pkg}</h1>
        <div className="flex gap-2">
          <Link href={`/admin/policy-settings/${pkg}/fields`}>
            <Button variant="outline" className="inline-flex items-center gap-2">
              <X className="h-4 w-4 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
          </Link>
          <Button onClick={save} disabled={loading} className="inline-flex items-center gap-2">
            <Save className="h-4 w-4 sm:hidden lg:inline" />
            <span className="hidden sm:inline">Save</span>
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 sm:p-6">
        {loading ? <div className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</div> : null}
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Label</Label>
            <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label>Value (key)</Label>
            <Input value={form.value} disabled readOnly />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Field keys are immutable to prevent data mismatches. To change the key, create a new field and migrate data if needed.
            </p>
          </div>
          <div className="grid gap-1">
            <Label>Input Type</Label>
            <InputTypeSelect
              value={form.meta?.inputType ?? "string"}
              onChange={(v) => updateMeta("inputType", v as InputType)}
            />
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
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
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

          {(["select", "multi_select"] as string[]).includes((form.meta?.inputType ?? "") as string) ? (
            <TopLevelSelectEditor
              inputType={(form.meta?.inputType ?? "select") as string}
              selectDisplay={((form.meta?.selectDisplay ?? "dropdown") as string)}
              onSelectDisplayChange={(v) => updateMeta("selectDisplay", v as any)}
              options={Array.isArray(form.meta?.options) ? (form.meta?.options as any[]) : []}
              onOptionsChange={(next) => updateMeta("options", next as any)}
              children={(Array.isArray(form.meta?.options) ? (form.meta?.options as any[]) : []).map((o: any) => Array.isArray(o?.children) ? o.children : [])}
              onChildrenChange={(optIdx, nextChildren) => {
                const opts = [...(Array.isArray(form.meta?.options) ? (form.meta?.options as any[]) : [])];
                opts[optIdx] = { ...(opts[optIdx] ?? {}), children: nextChildren };
                updateMeta("options", opts as any);
              }}
              allPackages={allPackages}
              crossPkgCategories={crossPkgCategories}
              onLoadCategories={loadCrossPkgCats}
            />
          ) : null}

          {form.meta?.inputType === "repeatable" ? (
            <TopLevelRepeatableEditor
              repeatable={form.meta?.repeatable as any}
              onChange={(next) => updateMeta("repeatable", next as any)}
              allPackages={allPackages}
              crossPkgCategories={crossPkgCategories}
              onLoadCategories={loadCrossPkgCats}
            />
          ) : null}

          {form.meta?.inputType === "boolean" ? (
            <BooleanChildrenEditor
              booleanChildren={form.meta?.booleanChildren as any}
              onChange={(next) => updateMeta("booleanChildren", next as any)}
              defaultBoolean={form.meta?.defaultBoolean as any}
              onDefaultBooleanChange={(v) => updateMeta("defaultBoolean", v as any)}
              booleanLabels={form.meta?.booleanLabels as any}
              onBooleanLabelsChange={(v) => updateMeta("booleanLabels", v as any)}
              booleanDisplay={(form.meta?.booleanDisplay as any) ?? "radio"}
              onBooleanDisplayChange={(v) => updateMeta("booleanDisplay", v as any)}
              allPackages={allPackages}
              crossPkgCategories={crossPkgCategories}
              onLoadCategories={loadCrossPkgCats}
            />
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
            {!applyToAll ? null : <p className="text-xs text-neutral-500 dark:text-neutral-400">Uncheck above to select specific categories.</p>}
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
              {categoryOptions.length === 0 ? <p className="col-span-2 text-xs text-neutral-500 dark:text-neutral-400">No categories found. Create categories first.</p> : null}
            </div>
          </div>

          <ShowWhenConfig
            value={form.meta?.showWhen ?? []}
            onChange={(next) => updateMeta("showWhen", next)}
            allPackages={allPackages}
            crossPkgCategories={crossPkgCategories}
            onLoadCategories={loadCrossPkgCats}
          />

          <div className="grid gap-1">
            <Label>Sort Order</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                className="w-28"
                value={String(form.sortOrder ?? 0)}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Lower numbers appear first (within the same group).</p>
            </div>
          </div>
          <GroupAssignmentSection
            currentGroups={currentGroups}
            existingGroupNames={existingGroupNames}
            groupOrder={(form.meta?.groupOrder ?? 0) as number}
            onGroupChange={(next) => {
              const val = next.length === 0 ? "" : next.length === 1 ? next[0] : next;
              updateMeta("group", val as any);
            }}
            onOrderChange={(v) => updateMeta("groupOrder", v)}
          />
          {currentGroups.map((gName) => {
            const gswVal = form.meta?.groupShowWhenMap?.[gName]
              ?? (currentGroups.length === 1 ? (form.meta?.groupShowWhen ?? null) : null);
            return (
              <GroupShowWhenConfig
                key={gName}
                groupLabel={gName}
                value={gswVal}
                onChange={(next) => {
                  const map = { ...(form.meta?.groupShowWhenMap ?? {}), [gName]: next as any };
                  updateMeta("groupShowWhenMap", map as any);
                }}
                fields={existing as any}
                excludeFieldId={id}
                allPackages={allPackages}
                currentPkg={pkg}
              />
            );
          })}
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              Active
            </label>
          </div>
        </div>
      </div>
      <MetaJsonPreview meta={form.meta as Record<string, unknown>} />
    </main>
  );
}

