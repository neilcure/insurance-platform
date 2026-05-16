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
import { columnForRole } from "@/lib/accounting-columns";
import { useUserTypes } from "@/hooks/use-user-types";
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
const isPremiumPkg = (p: string) => p === "premiumRecord" || p === "accounting";
import { InputTypeSelect, type InputType } from "@/components/admin/generic/InputTypeSelect";
import { TranslationsEditor } from "@/components/admin/i18n/TranslationsEditor";
import type { Locale, TranslationBlock } from "@/lib/i18n";

/**
 * Inline editor for `meta.mirrorSource` on a brand-new field. Same
 * contract as `MirrorSourceEditor` in `EditPackageFieldClient.tsx`,
 * but local to this file to avoid a circular import (the Edit page is
 * a server-component default export, importing it would force this
 * client component to load all of its dependencies).
 */
function NewFieldMirrorSourceEditor({
  allPackages,
  value,
  onChange,
}: {
  allPackages: { label: string; value: string }[];
  value: { package?: string; field?: string } | undefined;
  onChange: (next: { package: string; field: string } | undefined) => void;
}) {
  const pkgKey = String(value?.package ?? "").trim();
  const [fields, setFields] = React.useState<{ label: string; value: string }[]>([]);
  const [loadingFields, setLoadingFields] = React.useState(false);

  React.useEffect(() => {
    if (!pkgKey) {
      setFields([]);
      return;
    }
    let cancelled = false;
    setLoadingFields(true);
    fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(`${pkgKey}_fields`)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (cancelled) return;
        const list = (Array.isArray(rows) ? rows : []) as Array<{ label?: string; value?: string; isActive?: boolean }>;
        setFields(
          list
            .filter((r) => r.isActive !== false)
            .map((r) => ({ label: String(r.label ?? r.value ?? ""), value: String(r.value ?? "") }))
            .filter((r) => r.value),
        );
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingFields(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pkgKey]);

  const fieldKey = String(value?.field ?? "").trim();
  const commit = (nextPkg: string, nextField: string) => {
    if (!nextPkg || !nextField) {
      onChange(undefined);
      return;
    }
    onChange({ package: nextPkg, field: nextField });
  };

  return (
    <div className="grid gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        This field always equals the chosen source field. Read-only, updates live, no formula edge cases.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label>Source Package</Label>
          <select
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            value={pkgKey}
            onChange={(e) => commit(e.target.value, "")}
          >
            <option value="">— Pick package —</option>
            {allPackages.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label || p.value}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label>Source Field</Label>
          <select
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm disabled:bg-neutral-100 disabled:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:disabled:bg-neutral-800"
            value={fieldKey}
            disabled={!pkgKey || loadingFields}
            onChange={(e) => commit(pkgKey, e.target.value)}
          >
            <option value="">
              {!pkgKey ? "— Pick package first —" : loadingFields ? "Loading…" : "— Pick field —"}
            </option>
            {fields.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label || f.value}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

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
      premiumRole?: string;
      premiumColumn?: string;
      premiumContexts?: string[];
      visibleToUserTypes?: string[];
      requiresAgent?: boolean;
      /**
       * When true, this field's value participates in the duplicate-
       * client check on POST /api/policies (clientSet flow). See
       * `lib/import/client-resolver.ts` for the matching rule.
       */
      dedupeIdentifier?: boolean;
      /** Category scope for the dedupe match: "any" (or omitted), "company", "personal", or any admin-configured category. */
      dedupeCategory?: string;
      /** Locale-specific overrides; edited via `<TranslationsEditor>`. Missing locales fall back to English. */
      translations?: Partial<Record<Locale, TranslationBlock>>;
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
  const { options: userTypeOptions, getLabel: getUserTypeLabel } = useUserTypes();

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
          <TranslationsEditor
            value={(form.meta?.translations ?? null) as Partial<Record<Locale, TranslationBlock>> | null}
            sourceLabel={form.label}
            options={(form.meta?.options ?? []) as { value?: string; label?: string }[]}
            booleanChildren={
              form.meta?.booleanChildren as
                | { true?: { label?: string }[]; false?: { label?: string }[] }
                | undefined
            }
            repeatable={
              (form.meta?.repeatable?.fields ?? []) as { value?: string; label?: string }[]
            }
            hint="Leave a row blank to fall back to English."
            onChange={(next) => updateMeta("translations" as never, next as never)}
          />
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

          {form.meta?.inputType === "mirror" ? (
            <NewFieldMirrorSourceEditor
              allPackages={allPackages}
              value={(form.meta as { mirrorSource?: { package?: string; field?: string } })?.mirrorSource}
              onChange={(next) => updateMeta("mirrorSource" as any, next as any)}
            />
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
                  Reference other fields using {"{field_key}"} syntax. For a simple <em>this field = another field</em> mirror, pick the <strong>Mirror</strong> input type instead — it&apos;s dead-simple and skips formula edge cases. Formula supports numeric math (+, -, *, /), date arithmetic (e.g. {"{start_date}"} + 364), and <strong>TODAY</strong> for the current date.
                </p>
              </div>
            </div>
          ) : null}

          {(form.meta?.inputType === "currency" || form.meta?.inputType === "negative_currency" || form.meta?.inputType === "formula") ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>Currency Code</Label>
                <Input
                  placeholder={form.meta?.inputType === "formula" ? "e.g. HKD (leave blank for plain number)" : "e.g. HKD, USD"}
                  value={String(((form.meta as any)?.currencyCode ?? "") || "")}
                  onChange={(e) => updateMeta("currencyCode" as any, e.target.value as any)}
                />
                {form.meta?.inputType === "formula" ? (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Set when the formula returns a monetary amount (e.g. commission, premium). Leave blank for non-currency results (counts, ratios, dates).
                  </p>
                ) : null}
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
                <Label>Premium Role</Label>
                <select
                  className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={String((form.meta as any)?.premiumRole ?? "")}
                  onChange={(e) => {
                    const role = e.target.value || undefined;
                    updateMeta("premiumRole" as any, role as any);
                    // Auto-derive the DB column from the chosen role.
                    // Roles with a canonical column overwrite premiumColumn; clearing the role
                    // also clears the auto-derived column. Fields with no canonical role
                    // (Levy / Stamp Duty / Discount / etc.) keep their existing premiumColumn
                    // untouched here — those values land in extra_values JSON if no column is set.
                    const derived = columnForRole(role);
                    updateMeta("premiumColumn" as any, derived as any);
                  }}
                >
                  {PREMIUM_ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Identifies this field&apos;s semantic role for invoicing, commission, and cross-settlement logic. Only one field per role. The DB column is auto-derived from the role; fields with no role are stored in <code>extra_values</code> JSON.
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
              <div className="grid gap-1">
                <Label>Visible to user types</Label>
                <div className="space-y-1.5 rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
                  {userTypeOptions.length === 0 ? (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">Loading user types…</p>
                  ) : (
                    userTypeOptions.map((ut) => {
                      const current: string[] = Array.isArray((form.meta as any)?.visibleToUserTypes)
                        ? ((form.meta as any).visibleToUserTypes as string[])
                        : [];
                      const checked = current.length === 0 || current.includes(ut.value);
                      return (
                        <label key={ut.value} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600"
                            checked={checked}
                            onChange={() => {
                              let next: string[];
                              if (current.length === 0) {
                                next = userTypeOptions.map((o) => o.value).filter((v) => v !== ut.value);
                              } else if (checked) {
                                next = current.filter((v) => v !== ut.value);
                              } else {
                                next = [...current, ut.value];
                              }
                              if (next.length === userTypeOptions.length) next = [];
                              updateMeta("visibleToUserTypes" as any, (next.length > 0 ? next : undefined) as any);
                            }}
                          />
                          <span className="text-neutral-700 dark:text-neutral-300">{getUserTypeLabel(ut.value)}</span>
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Pick which logged-in user types can see this field on the Premium tab. Empty = visible to everyone. Admin-like users (admin / internal staff / accounting) always see every field.
                </p>
              </div>
              <div className="grid gap-1">
                <Label>Policy wizard (create flow)</Label>
                <select
                  className="h-9 w-full max-w-xl rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  value={
                    form.meta?.requiresAgent === true
                      ? "wait"
                      : form.meta?.requiresAgent === false
                        ? "always"
                        : "auto"
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "wait") {
                      updateMeta("requiresAgent", true);
                    } else if (v === "always") {
                      updateMeta("requiresAgent", false);
                    } else {
                      setForm((f) => {
                        const nextMeta = { ...(f.meta ?? {}) };
                        delete nextMeta.requiresAgent;
                        return { ...f, meta: nextMeta };
                      });
                    }
                  }}
                >
                  <option value="auto">Default — agent and commission roles wait for agent pick</option>
                  <option value="wait">Hide until an agent is selected</option>
                  <option value="always">Always show (even before agent)</option>
                </select>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Applies to the create-policy wizard. Admin-like users bypass user-type filtering but still respect wait-for-agent when this field or its role default requires it.
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

          {/* Duplicate-client check — see EditPackageFieldClient.tsx for
              the full rationale. Mirrored here so admins creating a NEW
              identifier field (e.g. Mainland Unified Social Credit Code,
              Singapore NRIC, passport number) can opt in immediately
              without a save → reload → edit cycle. */}
          {pkg === "insured" ? (
            <div className="grid gap-1 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <Label className="text-amber-800 dark:text-amber-200">Duplicate-client check</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(form.meta?.dedupeIdentifier)}
                  onChange={(e) =>
                    updateMeta("dedupeIdentifier", e.target.checked ? true : undefined)
                  }
                />
                Use this field to detect duplicate clients
              </label>
              {form.meta?.dedupeIdentifier ? (
                <div className="mt-2 grid gap-1">
                  <Label className="text-xs text-amber-800 dark:text-amber-200">
                    Applies to category
                  </Label>
                  <select
                    className="h-9 max-w-xs rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                    value={String(form.meta?.dedupeCategory ?? "any")}
                    onChange={(e) =>
                      updateMeta(
                        "dedupeCategory",
                        e.target.value === "any" ? undefined : e.target.value,
                      )
                    }
                  >
                    <option value="any">Any category</option>
                    {categoryOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <p className="text-xs text-amber-700 dark:text-amber-300">
                When ticked, the policy wizard hard-blocks creation of a new
                client whose value for this field matches an existing client
                (case-insensitive, whitespace-collapsed). Use for STRONG
                identifiers like CI Number / BR Number (company) or HKID
                (personal). Avoid for weak identifiers like names or phone
                numbers — they can collide legitimately.
              </p>
            </div>
          ) : null}

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






