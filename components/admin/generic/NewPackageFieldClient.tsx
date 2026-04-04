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
import { AutoFillConfigEditor, type AutoFillConfig } from "@/components/admin/generic/AutoFillConfig";
import { EntityPickerConfigEditor, type EntityPickerConfig } from "@/components/admin/generic/EntityPickerConfig";
const DB_COLUMN_OPTIONS = [
  { value: "grossPremiumCents", label: "Gross Premium", type: "cents" },
  { value: "netPremiumCents", label: "Net Premium", type: "cents" },
  { value: "clientPremiumCents", label: "Client Premium", type: "cents" },
  { value: "agentPremiumCents", label: "Agent Premium", type: "cents" },
  { value: "agentCommissionCents", label: "Agent Commission", type: "cents" },
  { value: "creditPremiumCents", label: "Credit Premium", type: "cents" },
  { value: "levyCents", label: "Levy", type: "cents" },
  { value: "stampDutyCents", label: "Stamp Duty", type: "cents" },
  { value: "discountCents", label: "Discount", type: "cents" },
  { value: "commissionRate", label: "Commission Rate", type: "rate" },
  { value: "currency", label: "Currency", type: "string" },
];
const PREMIUM_CONTEXT_OPTIONS = [
  { value: "policy", label: "Policy" },
  { value: "collaborator", label: "Collaborator (Premium Payable)" },
  { value: "insurer", label: "Insurance Company (Insurer Premium)" },
  { value: "client", label: "Client (Client Premium)" },
  { value: "agent", label: "Agent (Agent Premium)" },
];
const PREMIUM_ROLE_OPTIONS = [
  { value: "", label: "— None —" },
  { value: "client", label: "Client Premium (what client pays)" },
  { value: "agent", label: "Agent Premium (what agent remits — usually auto-computed: client − commission)" },
  { value: "net", label: "Net Premium (base insurer cost)" },
  { value: "commission", label: "Commission (what agent keeps)" },
];
const COLUMN_TO_SUGGESTED_ROLE: Record<string, string> = {
  grossPremiumCents: "client",
  clientPremiumCents: "client",
  netPremiumCents: "net",
  agentPremiumCents: "agent",
  agentCommissionCents: "commission",
};
const isPremiumPkg = (p: string) => p === "premiumRecord" || p === "accounting";
import { InputTypeSelect, type InputType } from "@/components/admin/generic/InputTypeSelect";

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
      labelCase?: "original" | "upper" | "lower" | "title";
      selectDisplay?: "dropdown" | "radio" | "checkbox";
      repeatable?: {
        itemLabel?: string;
        min?: number;
        max?: number;
        fields?: { label?: string; value?: string; inputType?: InputType; options?: { label: string; value: string }[] }[];
      };
      showWhen?: { package: string; category: string | string[]; field?: string; fieldValues?: string[]; childKey?: string; childValues?: string[] }[];
      groupShowWhen?: { field: string; values: string[]; childKey?: string; childValues?: string[] }[] | null;
      groupShowWhenMap?: Record<string, { field: string; values: string[]; childKey?: string; childValues?: string[] }[] | null>;
      autoFill?: AutoFillConfig;
      entityPicker?: EntityPickerConfig;
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
      const g = r.meta?.group;
      const arr = Array.isArray(g) ? g : (typeof g === "string" && g.trim() ? [g.trim()] : []);
      for (const n of arr) if (n) names.add(n);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [existing]);
  const [customGroupMode, setCustomGroupMode] = React.useState(false);
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
      // Compute sortOrder based on target group (append to end)
      const targetGroups = Array.isArray(normalizedMeta.group) ? normalizedMeta.group : [String(normalizedMeta.group ?? "")];
      const targetGroup = targetGroups[0] ?? "";
      const groupMembers = existing.filter((r) => {
        const rg = r.meta?.group;
        const rGroups = Array.isArray(rg) ? rg : [String(rg ?? "")];
        return rGroups.includes(targetGroup);
      });
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
              <X className="h-4 w-4 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
          </Link>
          <Button onClick={save} className="inline-flex items-center gap-2">
            <Save className="h-4 w-4 sm:hidden lg:inline" />
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
            <Label>Label Case</Label>
            <select
              className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              value={(form.meta?.labelCase ?? "original")}
              onChange={(e) => updateMeta("labelCase", e.target.value as "original" | "upper" | "lower" | "title")}
            >
              <option value="original">Original</option>
              <option value="upper">UPPERCASE</option>
              <option value="lower">lowercase</option>
              <option value="title">Title Case</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label>Value (key)</Label>
            <Input value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
          </div>
          <div className="grid gap-1">
            <Label>Input Type</Label>
            <InputTypeSelect
              value={form.meta?.inputType ?? "string"}
              onChange={(v) => updateMeta("inputType", v as InputType)}
            />
          </div>

          {form.meta?.inputType === "agent_picker" ? (
            <div className="grid gap-1">
              <Label>Picker Button Label</Label>
              <Input
                placeholder="e.g. Browse Agents"
                value={String(((form.meta as any)?.agentPickerLabel ?? "") || "")}
                onChange={(e) => updateMeta("agentPickerLabel" as any, e.target.value as any)}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Label shown on the search button. Defaults to &ldquo;Browse&rdquo; if left empty.
              </p>
            </div>
          ) : null}

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
                  Reference other fields using {"{field_key}"} syntax. Supports numeric math (+, -, *, /), date arithmetic (e.g. {"{start_date}"} + 364), and <strong>TODAY</strong> for the current date (e.g. TODAY, TODAY + 30).
                </p>
              </div>
            </div>
          ) : null}

          {(form.meta?.inputType === "currency" || form.meta?.inputType === "negative_currency") ? (
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

          {isPremiumPkg(pkg) && (
            <>
              <div className="grid gap-1">
                <Label>DB Column Mapping</Label>
                <select
                  className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={String((form.meta as any)?.premiumColumn ?? "")}
                  onChange={(e) => {
                    const col = e.target.value || undefined;
                    updateMeta("premiumColumn" as any, col as any);
                    if (col && COLUMN_TO_SUGGESTED_ROLE[col] && !(form.meta as any)?.premiumRole) {
                      updateMeta("premiumRole" as any, COLUMN_TO_SUGGESTED_ROLE[col] as any);
                    }
                  }}
                >
                  <option value="">None (stored in extra values)</option>
                  {DB_COLUMN_OPTIONS.map((opt) => {
                    const suggested = COLUMN_TO_SUGGESTED_ROLE[opt.value];
                    return (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} ({opt.type === "cents" ? "cents" : opt.type === "rate" ? "decimal" : "text"})
                        {suggested ? ` → suggested role: ${suggested}` : ""}
                      </option>
                    );
                  })}
                </select>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Maps this field to a dedicated database column for accounting calculations, invoicing, and sync. Currency fields use cents conversion automatically.
                </p>
              </div>
              <div className="grid gap-1">
                <Label>Premium Role</Label>
                {(() => {
                  const col = (form.meta as any)?.premiumColumn;
                  const currentRole = (form.meta as any)?.premiumRole || "";
                  const suggested = col ? COLUMN_TO_SUGGESTED_ROLE[col] : undefined;
                  const mismatch = suggested && currentRole && currentRole !== suggested;
                  return mismatch ? (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      <strong>Warning:</strong> Column <code>{col}</code> is typically role &ldquo;{suggested}&rdquo; but is set to &ldquo;{currentRole}&rdquo;.
                      Incorrect role mapping will produce wrong premium calculations.
                    </div>
                  ) : null;
                })()}
                <select
                  className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={String((form.meta as any)?.premiumRole ?? "")}
                  onChange={(e) => updateMeta("premiumRole" as any, (e.target.value || undefined) as any)}
                >
                  {PREMIUM_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Identifies this field's semantic role for invoicing, commission, and cross-settlement logic. Only one field per role.
                </p>
              </div>
              <div className="grid gap-1">
                <Label>Show in Premium Tabs</Label>
                <div className="space-y-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
                  {PREMIUM_CONTEXT_OPTIONS.map((ctx) => {
                    const current: string[] = Array.isArray((form.meta as any)?.premiumContexts)
                      ? (form.meta as any).premiumContexts
                      : [];
                    const checked = current.length === 0 || current.includes(ctx.value);
                    return (
                      <label key={ctx.value} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600"
                          checked={checked}
                          onChange={() => {
                            let next: string[];
                            if (current.length === 0) {
                              next = PREMIUM_CONTEXT_OPTIONS.map((o) => o.value).filter((v) => v !== ctx.value);
                            } else if (checked) {
                              next = current.filter((v) => v !== ctx.value);
                            } else {
                              next = [...current, ctx.value];
                            }
                            if (next.length === PREMIUM_CONTEXT_OPTIONS.length) next = [];
                            updateMeta("premiumContexts" as any, (next.length > 0 ? next : undefined) as any);
                          }}
                        />
                        <span className="text-neutral-700 dark:text-neutral-300">{ctx.label}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Choose which Premium tabs display this field. Empty = show everywhere.
                </p>
              </div>
            </>
          )}

          {["select", "multi_select"].includes((form.meta?.inputType ?? "") as string) ? (
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
            <>
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
                currentPkg={pkg}
              />
              <AutoFillConfigEditor
                value={form.meta?.autoFill}
                onChange={(next) => updateMeta("autoFill", next as any)}
                allPackages={allPackages}
                currentPkg={pkg}
                currentFieldValue={form.value}
              />
            </>
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

          <EntityPickerConfigEditor
            value={form.meta?.entityPicker}
            onChange={(next) => updateMeta("entityPicker", next as any)}
            currentPkg={pkg}
          />

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
                allPackages={allPackages}
                currentPkg={pkg}
              />
            );
          })}
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Active
            </label>
          </div>
        </div>
      </div>
      <MetaJsonPreview meta={form.meta as Record<string, unknown>} />
    </main>
  );
}






