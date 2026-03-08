"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Pencil, Eye, EyeOff, Save, X, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { GroupShowWhenConfig } from "@/components/admin/generic/GroupShowWhenConfig";
import type { InputType } from "@/lib/types/form";
import { InputTypeSelect } from "@/components/admin/generic/InputTypeSelect";

type BooleanBranchChild = {
  label?: string;
  inputType?: InputType;
  options?: { label: string; value: string }[];
  currencyCode?: string;
  decimals?: number;
};

type ChildFieldMeta = {
  label?: string;
  value?: string;
  inputType?: InputType;
  options?: { label: string; value: string }[];
  currencyCode?: string;
  decimals?: number;
  booleanLabels?: { true?: string; false?: string };
  booleanDisplay?: "radio" | "dropdown";
  booleanChildren?: { true?: BooleanBranchChild[]; false?: BooleanBranchChild[] };
  repeatable?: {
    itemLabel?: string;
    min?: number;
    max?: number;
    fields?: { label?: string; value?: string; inputType?: InputType; options?: { label: string; value: string }[] }[];
  };
};
type SelectOption = { label: string; value: string; children?: ChildFieldMeta[] };
type FieldMeta = {
  inputType?: InputType;
  required?: boolean;
  categories?: string[];
  options?: SelectOption[];
  booleanChildren?: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] };
  defaultBoolean?: boolean | null;
  booleanLabels?: { true?: string; false?: string };
  booleanDisplay?: "radio" | "dropdown";
  repeatable?: {
    keyPrefix?: string;
    itemLabel?: string;
    min?: number;
    max?: number;
    fields?: ChildFieldMeta[];
  };
  group?: string | string[]; // Optional visual grouping label (single or multiple)
  groupOrder?: number; // Optional sort order for the group itself
  groupShowWhen?: { field: string; values: string[]; childKey?: string; childValues?: string[] }[] | null;
  groupShowWhenMap?: Record<string, { field: string; values: string[]; childKey?: string; childValues?: string[] }[] | null>;
  selectDisplay?: "dropdown" | "radio" | "checkbox"; // How to render select/multi_select
  // Display formatting
  labelCase?: "original" | "upper" | "lower" | "title";
  valueCase?: "original" | "upper" | "lower" | "title"; // for string inputs
  dateFormat?: "DD-MM-YYYY" | "YYYY-MM-DD"; // for date inputs
  numberFormat?: "plain" | "currency" | "percent"; // for number inputs
  currencyCode?: string; // when numberFormat === "currency"
  decimals?: number; // for number formatting
};

type FieldRow = {
  id: number;
  label: string;
  value: string;
  valueType: string;
  sortOrder: number;
  isActive: boolean;
  meta: FieldMeta | null;
};

function getFieldGroups(group: string | string[] | undefined): string[] {
  if (!group) return [""];
  if (Array.isArray(group)) return group.length > 0 ? group : [""];
  return group.trim() ? [group.trim()] : [""];
}

function getPrimaryGroup(group: string | string[] | undefined): string {
  if (Array.isArray(group)) return group[0]?.trim() ?? "";
  return String(group ?? "").trim();
}

export default function GenericFieldsManager({ pkg }: { pkg: string }) {
  const groupKey = `${pkg}_fields`;
  const categoryGroupKey = `${pkg}_category`;

  const [rows, setRows] = React.useState<FieldRow[]>([]);
  const makeModelFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FieldRow | null>(null);
  const [categoryOptions, setCategoryOptions] = React.useState<{ label: string; value: string }[]>([]);
  const [applyToAll, setApplyToAll] = React.useState(true);
  const [sortKey, setSortKey] = React.useState<"sortOrder" | "label" | "group">("sortOrder");
  const [sortAsc, setSortAsc] = React.useState(true);
  const [customGroupMode, setCustomGroupMode] = React.useState(false);
  const [renamingGroup, setRenamingGroup] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [confirmDeleteGroup, setConfirmDeleteGroup] = React.useState<string | null>(null);
  const [editingGroupCondition, setEditingGroupCondition] = React.useState<string | null>(null);
  const [pendingGroupCondition, setPendingGroupCondition] = React.useState<unknown>(null);
  const [groupConditionDirty, setGroupConditionDirty] = React.useState(false);
  const [savingGroupCondition, setSavingGroupCondition] = React.useState(false);
  const [allPackagesForGroups, setAllPackagesForGroups] = React.useState<{ label: string; value: string }[]>([]);

  const [form, setForm] = React.useState<Partial<FieldRow>>({
    label: "",
    value: "",
    valueType: "string",
    sortOrder: 0,
    isActive: true,
    meta: { inputType: "string", required: false, categories: [] },
  });

  const [copyDialogOpen, setCopyDialogOpen] = React.useState(false);
  const [availablePackages, setAvailablePackages] = React.useState<{ label: string; value: string }[]>([]);
  const [copySourcePkg, setCopySourcePkg] = React.useState("");
  const [copySourceFields, setCopySourceFields] = React.useState<FieldRow[]>([]);
  const [copySelectedKeys, setCopySelectedKeys] = React.useState<Set<string>>(new Set());
  const [loadingSourceFields, setLoadingSourceFields] = React.useState(false);
  const [copying, setCopying] = React.useState(false);

  // Ensure consistent numeric behavior and stable ordering
  const toInt = React.useCallback((value: unknown, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }, []);
  const sortBySortOrderStable = React.useCallback(
    (a: { sortOrder: number; id: number }, b: { sortOrder: number; id: number }) => {
      const aSort = toInt(a.sortOrder, 0);
      const bSort = toInt(b.sortOrder, 0);
      return aSort - bSort || a.id - b.id;
    },
    [toInt]
  );

  const load = React.useCallback(async () => {
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
  }, [groupKey]);
  React.useEffect(() => {
    void load();
  }, [load]);

  const openCopyDialog = React.useCallback(async () => {
    try {
      const res = await fetch("/api/form-options?groupKey=packages", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { label: string; value: string }[];
      setAvailablePackages((Array.isArray(data) ? data : []).filter((p) => p.value !== pkg));
    } catch { /* ignore */ }
    setCopySourcePkg("");
    setCopySourceFields([]);
    setCopySelectedKeys(new Set());
    setCopyDialogOpen(true);
  }, [pkg]);

  const loadSourceFields = React.useCallback(async (sourcePkg: string) => {
    setCopySourcePkg(sourcePkg);
    setCopySourceFields([]);
    setCopySelectedKeys(new Set());
    if (!sourcePkg) return;
    setLoadingSourceFields(true);
    try {
      const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(`${sourcePkg}_fields`)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as FieldRow[];
      const fields = Array.isArray(data) ? data : [];
      const existingKeys = new Set(rows.map((r) => r.value.toLowerCase()));
      const available = fields.filter((f) => !existingKeys.has(f.value.toLowerCase()));
      setCopySourceFields(available);
      setCopySelectedKeys(new Set(available.map((f) => f.value)));
    } catch { /* ignore */ }
    finally { setLoadingSourceFields(false); }
  }, [rows]);

  const handleCopyFields = React.useCallback(async () => {
    if (!copySourcePkg || copySelectedKeys.size === 0) return;
    setCopying(true);
    try {
      const toCreate = copySourceFields.filter((f) => copySelectedKeys.has(f.value));
      if (toCreate.length === 0) {
        toast.info("No fields selected");
        return;
      }
      let created = 0;
      let skipped = 0;
      for (const field of toCreate) {
        const sourceMeta = (field.meta ?? {}) as Record<string, unknown>;
        const { group, groupOrder, groupShowWhen, groupShowWhenMap, categories, ...cleanMeta } = sourceMeta;
        const postRes = await fetch("/api/admin/form-options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            groupKey,
            label: field.label,
            value: field.value,
            sortOrder: field.sortOrder,
            isActive: field.isActive,
            valueType: field.valueType ?? "string",
            meta: cleanMeta,
          }),
        });
        if (postRes.ok) created++;
        else skipped++;
      }
      toast.success(`Copied ${created} field${created !== 1 ? "s" : ""}${skipped > 0 ? `, ${skipped} skipped` : ""}`);
      setCopyDialogOpen(false);
      void load();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? "Copy failed");
    } finally {
      setCopying(false);
    }
  }, [copySourcePkg, copySelectedKeys, copySourceFields, groupKey, load]);

  const displayRows = React.useMemo(() => {
    const next = [...rows];
    next.sort((a, b) => {
      if (sortKey === "label") {
        const la = String(a.label ?? "");
        const lb = String(b.label ?? "");
        const cmp = la.localeCompare(lb, undefined, { sensitivity: "base" });
        return cmp === 0 ? sortBySortOrderStable(a, b) : cmp;
      }
      if (sortKey === "group") {
        const am = (a.meta ?? {}) as FieldMeta;
        const bm = (b.meta ?? {}) as FieldMeta;
        const ao = Number.isFinite(Number(am.groupOrder)) ? Number(am.groupOrder) : 0;
        const bo = Number.isFinite(Number(bm.groupOrder)) ? Number(bm.groupOrder) : 0;
        if (ao !== bo) return ao - bo;
        const ga = getPrimaryGroup(am.group);
        const gb = getPrimaryGroup(bm.group);
        const cmp = ga.localeCompare(gb, undefined, { sensitivity: "base" });
        return cmp === 0 ? sortBySortOrderStable(a, b) : cmp;
      }
      // default sort: group first (by groupOrder then name), then by field sortOrder
      const am = (a.meta ?? {}) as FieldMeta;
      const bm = (b.meta ?? {}) as FieldMeta;
      const ao = Number.isFinite(Number(am.groupOrder)) ? Number(am.groupOrder) : 0;
      const bo = Number.isFinite(Number(bm.groupOrder)) ? Number(bm.groupOrder) : 0;
      if (ao !== bo) return ao - bo;
      const ga = getPrimaryGroup(am.group);
      const gb = getPrimaryGroup(bm.group);
      const gcmp = ga.localeCompare(gb, undefined, { sensitivity: "base" });
      if (gcmp !== 0) return gcmp;
      return sortBySortOrderStable(a, b);
    });
    if (!sortAsc) next.reverse();
    return next;
  }, [rows, sortKey, sortAsc, sortBySortOrderStable]);

  React.useEffect(() => {
    async function loadCats() {
      try {
        const res = await fetch(`/api/admin/form-options?groupKey=${encodeURIComponent(categoryGroupKey)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { label: string; value: string }[];
        setCategoryOptions(Array.isArray(data) ? data : []);
      } catch {
        // ignore
      }
    }
    void loadCats();
  }, [categoryGroupKey]);

  function startEdit(row: FieldRow) {
    // Navigate to full-page editor
    window.location.href = `/admin/policy-settings/${pkg}/fields/${row.id}`;
  }
  async function save() {
    try {
      if (!form.label || !form.value) {
        toast.error("Label and value are required");
        return;
      }
      const normalizedMeta: FieldMeta = {
        ...(form.meta ?? {}),
        categories: applyToAll ? [] : (form.meta?.categories ?? []),
      };
      // Determine next sort order: append to end if creating, or if group changed
      const targetGroup = getPrimaryGroup(normalizedMeta.group);
      const prevGroup = getPrimaryGroup(((editing?.meta ?? {}) as FieldMeta)?.group);
      const groupMembers = rows.filter(
        (r) => getPrimaryGroup(((r.meta ?? {}) as FieldMeta).group) === targetGroup && (!editing || r.id !== editing.id)
      );
      const maxGroupSort = groupMembers.reduce((acc, r) => Math.max(acc, toInt(r.sortOrder, 0)), -1);
      const nextSortOrder =
        !editing || prevGroup !== targetGroup ? maxGroupSort + 1 : toInt(editing.sortOrder ?? 0, 0);
      const payload = {
        label: form.label,
        value: form.value,
        sortOrder: nextSortOrder,
        isActive: !!form.isActive,
        valueType: form.valueType ?? "string",
        meta: normalizedMeta,
      };
      if (editing) {
        const res = await fetch(`/api/admin/form-options/${editing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Update failed");
        toast.success("Updated");
      } else {
        const res = await fetch(`/api/admin/form-options`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ groupKey, ...payload }),
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
  async function toggleActive(row: FieldRow) {
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

  async function remove(row: FieldRow) {
    try {
      const proceed = window.confirm(`Delete field "${row.label}"? This cannot be undone.`);
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

  function updateMeta<K extends keyof FieldMeta>(key: K, value: FieldMeta[K]) {
    setForm((f) => ({ ...f, meta: { ...((f.meta ?? {}) as FieldMeta), [key]: value } }));
  }
  function toggleCategory(value: string) {
    const current = [...(form.meta?.categories ?? [])];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    updateMeta("categories", next);
  }

  // Reorder helpers within a group by renumbering sortOrder deterministically
  async function moveWithinGroup(targetId: number, direction: "up" | "down") {
    // Allow reordering even when group is empty ("no group").
    const group = getPrimaryGroup((rows.find((r) => r.id === targetId)?.meta as FieldMeta | null)?.group);
    const members = rows
      .filter((r) => getFieldGroups((r.meta as FieldMeta | null)?.group).includes(group))
      .sort(sortBySortOrderStable);
    const idx = members.findIndex((m) => m.id === targetId);
    if (idx < 0) return;
    const newIndex = direction === "up" ? idx - 1 : idx + 1;
    if (newIndex < 0 || newIndex >= members.length) return;

    const reordered = [...members];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(newIndex, 0, moved);

    const updates = reordered
      .map((m, i) => ({ id: m.id, nextSort: i }))
      .filter(({ id, nextSort }) => toInt(members.find((mm) => mm.id === id)?.sortOrder, 0) !== nextSort)
      .map(({ id, nextSort }) =>
        fetch(`/api/admin/form-options/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sortOrder: nextSort }),
        })
      );
    try {
      if (updates.length > 0) {
        await Promise.all(updates);
      }
      await load();
    } catch {
      toast.error("Failed to reorder");
    }
  }

  const moveInfoById = React.useMemo(() => {
    const map = new Map<number, { canUp: boolean; canDown: boolean }>();
    // Build group membership using raw rows (not displayRows) so ordering is deterministic.
    const byGroup = new Map<string, FieldRow[]>();
    for (const r of rows) {
      for (const g of getFieldGroups(((r.meta ?? {}) as FieldMeta).group)) {
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(r);
      }
    }
    for (const [g, membersRaw] of byGroup.entries()) {
      const members = [...membersRaw].sort(sortBySortOrderStable);
      for (let i = 0; i < members.length; i++) {
        map.set(members[i]!.id, { canUp: i > 0, canDown: i < members.length - 1 });
      }
    }
    return map;
  }, [rows, sortBySortOrderStable]);

  // Group-level ordering helpers (swap groupOrder between neighboring groups)
  type GroupInfo = { name: string; order: number; ids: number[]; count: number };
  const groups: GroupInfo[] = React.useMemo(() => {
    const map = new Map<string, GroupInfo>();
    for (const r of rows) {
      const meta = (r.meta ?? {}) as FieldMeta;
      const order = typeof meta.groupOrder === "number" ? meta.groupOrder : 0;
      for (const name of getFieldGroups(meta.group)) {
        const gi = map.get(name) ?? { name, order, ids: [], count: 0 };
        gi.order = Math.min(gi.order, order);
        if (!gi.ids.includes(r.id)) gi.ids.push(r.id);
        gi.count = gi.ids.length;
        map.set(name, gi);
      }
    }
    return Array.from(map.values())
      .filter((g) => g.count > 0)
      .sort((a, b) => a.order - b.order);
  }, [rows]);
  const existingGroupNames = React.useMemo(() => groups.map((g) => g.name).filter((n) => n) as string[], [groups]);
  const isCustomGroup = React.useMemo(() => {
    const vals = getFieldGroups((form.meta as FieldMeta | undefined)?.group);
    return vals.some((v) => v && !existingGroupNames.includes(v));
  }, [form.meta, existingGroupNames]);
  async function moveGroup(name: string, direction: "up" | "down") {
    const idx = groups.findIndex((g) => g.name === name);
    if (idx < 0) return;
    const newIndex = direction === "up" ? idx - 1 : idx + 1;
    if (newIndex < 0 || newIndex >= groups.length) return;

    // Reorder groups array then renumber groupOrder sequentially
    const reordered = [...groups];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(newIndex, 0, moved);

    const orderMap = new Map<string, number>();
    reordered.forEach((g, i) => orderMap.set(g.name, i));

    const updates: Promise<Response>[] = [];
    for (const g of groups) {
      const nextOrder = orderMap.get(g.name) ?? 0;
      if (g.order === nextOrder) continue;
      for (const id of g.ids) {
        updates.push(
          fetch(`/api/admin/form-options/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ meta: { ...(rows.find((r) => r.id === id)?.meta ?? {}), groupOrder: nextOrder } }),
          })
        );
      }
    }
    try {
      if (updates.length > 0) {
        await Promise.all(updates);
      }
      await load();
      toast.success("Group order updated");
    } catch {
      toast.error("Failed to update group order");
    }
  }

  async function renameGroup(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingGroup(null);
      return;
    }
    if (groups.some((g) => g.name === trimmed)) {
      toast.error(`A group named "${trimmed}" already exists.`);
      return;
    }
    const group = groups.find((g) => g.name === oldName);
    if (!group) return;

    const updates: Promise<Response>[] = [];
    for (const id of group.ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      const currentGroups = getFieldGroups((row.meta as FieldMeta | null)?.group);
      const newGroups = currentGroups.map((g) => (g === oldName ? trimmed : g));
      const groupVal = newGroups.length === 1 ? (newGroups[0] || undefined) : newGroups.filter(Boolean);
      const patchMeta = { ...(row.meta ?? {}), group: groupVal } as Record<string, unknown>;
      // Rename key in groupShowWhenMap if present
      const gswMap = patchMeta.groupShowWhenMap as Record<string, unknown> | undefined;
      if (gswMap && oldName in gswMap) {
        const val = gswMap[oldName];
        delete gswMap[oldName];
        gswMap[trimmed] = val;
        patchMeta.groupShowWhenMap = gswMap;
      }
      updates.push(
        fetch(`/api/admin/form-options/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meta: patchMeta }),
        })
      );
    }
    try {
      await Promise.all(updates);
      setRenamingGroup(null);
      await load();
      toast.success(`Group renamed to "${trimmed}"`);
    } catch {
      toast.error("Failed to rename group");
    }
  }

  async function deleteGroup(groupName: string) {
    const group = groups.find((g) => g.name === groupName);
    if (!group) return;

    const updates: Promise<Response>[] = [];
    for (const id of group.ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      const currentGroups = getFieldGroups((row.meta as FieldMeta | null)?.group);
      const remaining = currentGroups.filter((g) => g !== groupName);
      const cleanedMeta = { ...(row.meta ?? {}) };
      if (remaining.length === 0 || (remaining.length === 1 && !remaining[0])) {
        delete (cleanedMeta as Record<string, unknown>).group;
        delete (cleanedMeta as Record<string, unknown>).groupOrder;
        delete (cleanedMeta as Record<string, unknown>).groupShowWhen;
        delete (cleanedMeta as Record<string, unknown>).groupShowWhenMap;
      } else {
        (cleanedMeta as Record<string, unknown>).group = remaining.length === 1 ? remaining[0] : remaining;
        // Remove the deleted group's key from groupShowWhenMap
        const gswMap = (cleanedMeta as Record<string, unknown>).groupShowWhenMap as Record<string, unknown> | undefined;
        if (gswMap && groupName in gswMap) {
          delete gswMap[groupName];
          if (Object.keys(gswMap).length === 0) delete (cleanedMeta as Record<string, unknown>).groupShowWhenMap;
        }
      }
      updates.push(
        fetch(`/api/admin/form-options/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meta: cleanedMeta }),
        })
      );
    }
    try {
      await Promise.all(updates);
      await load();
      toast.success(`Group "${groupName}" deleted — ${group.count} field(s) updated`);
    } catch {
      toast.error("Failed to delete group");
    }
  }

  function getGroupCondition(groupName: string) {
    const group = groups.find((g) => g.name === groupName);
    if (!group) return null;
    for (const id of group.ids) {
      const row = rows.find((r) => r.id === id);
      const meta = row?.meta as FieldMeta & { groupShowWhenMap?: Record<string, unknown> } | null;
      const mapVal = meta?.groupShowWhenMap?.[groupName];
      if (mapVal !== undefined) return mapVal;
      if (meta?.groupShowWhen !== undefined) return meta.groupShowWhen;
    }
    return null;
  }

  async function saveGroupCondition(groupName: string, condition: unknown) {
    const group = groups.find((g) => g.name === groupName);
    if (!group) return;
    const updates: Promise<Response>[] = [];
    for (const id of group.ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      const meta = { ...(row.meta ?? {}) } as Record<string, unknown>;
      const gswMap = { ...((meta.groupShowWhenMap ?? {}) as Record<string, unknown>) };
      gswMap[groupName] = condition;
      meta.groupShowWhenMap = gswMap;
      updates.push(
        fetch(`/api/admin/form-options/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meta }),
        }),
      );
    }
    try {
      await Promise.all(updates);
      await load();
      toast.success(`"${groupName}" group condition updated (${updates.length} field${updates.length === 1 ? "" : "s"})`);
    } catch {
      toast.error("Failed to update group condition");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-neutral-500 dark:text-neutral-400">
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">Sort by</span>
            <select
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs sm:text-sm dark:border-neutral-700 dark:bg-neutral-900"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            >
              <option value="sortOrder">Sort</option>
              <option value="label">Label</option>
              <option value="group">Group</option>
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSortAsc((v) => !v)}
              className="h-7 px-2 text-xs"
              title={sortAsc ? "Ascending" : "Descending"}
            >
              {sortAsc ? "Asc" : "Desc"}
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={openCopyDialog}>
            <span className="hidden sm:inline">Copy from</span>
          </Button>
          <Link href={`/admin/policy-settings/${pkg}/fields/new`}>
            <Button size="sm" className="inline-flex items-center gap-2 self-start sm:self-auto">
              <Plus className="h-4 w-4 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Add</span>
            </Button>
          </Link>
        </div>
      </div>
      <div className="rounded-md border border-neutral-200 p-2 sm:p-3 text-xs dark:border-neutral-800 w-full overflow-x-auto">
        <div className="mb-1 sm:mb-2 text-[13px] font-medium">Group order</div>
        {!groups.some((g) => g.name) ? (
          <div className="text-neutral-500 dark:text-neutral-400">No groups yet. Use the Group field when editing/adding to create groups.</div>
        ) : (
          <ul className="grid gap-1">
            {groups.map((g, i) => {
              const canUp = i > 0;
              const canDown = i < groups.length - 1;
              return (
                <li key={`${g.name}::${i}`} className="relative">
                  <div className="flex min-h-[28px] items-center justify-between gap-1 sm:gap-2">
                  <div className="min-w-0 flex-1 truncate pr-9 sm:pr-0">
                    {renamingGroup === g.name && g.name ? (
                      <span className="inline-flex items-center gap-1">
                        <Input
                          className="h-6 w-40 text-xs"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameGroup(g.name, renameValue);
                            if (e.key === "Escape") setRenamingGroup(null);
                          }}
                          autoFocus
                        />
                        <Button
                          type="button"
                          size="iconCompact"
                          variant="outline"
                          onClick={() => renameGroup(g.name, renameValue)}
                          title="Save new name"
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          size="iconCompact"
                          variant="outline"
                          onClick={() => setRenamingGroup(null)}
                          title="Cancel rename"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="font-medium">{g.name || "(no group)"}</span>
                        {g.name ? (
                          <>
                            <Button
                              type="button"
                              size="iconCompact"
                              variant="ghost"
                              className="h-5 w-5"
                              onClick={() => { setRenamingGroup(g.name); setRenameValue(g.name); }}
                              title="Rename group"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              size="iconCompact"
                              variant="ghost"
                              className="h-5 w-5 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                              onClick={() => setConfirmDeleteGroup(g.name)}
                              title="Delete group"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        ) : null}
                      </span>
                    )}
                    <span className="px-1 sm:px-2 text-neutral-500 dark:text-neutral-400">•</span>
                    <span className="font-mono">order {g.order}</span>
                    <span className="px-1 sm:px-2 text-neutral-500 dark:text-neutral-400">•</span>
                    <span>{g.count} field{g.count === 1 ? "" : "s"}</span>
                    {g.name && (
                      <>
                        <span className="px-1 sm:px-2 text-neutral-500 dark:text-neutral-400">•</span>
                        <button
                          type="button"
                          className={`text-[10px] rounded px-1.5 py-0.5 ${getGroupCondition(g.name) ? "bg-amber-100 text-amber-700 font-medium dark:bg-amber-900 dark:text-amber-300" : "text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 dark:text-neutral-500 dark:hover:text-neutral-300 dark:hover:bg-neutral-800"}`}
                          onClick={() => {
                            if (editingGroupCondition === g.name) {
                              setEditingGroupCondition(null);
                              setGroupConditionDirty(false);
                            } else {
                              setEditingGroupCondition(g.name);
                              setPendingGroupCondition(getGroupCondition(g.name));
                              setGroupConditionDirty(false);
                            }
                            if (allPackagesForGroups.length === 0) {
                              void (async () => {
                                try {
                                  const res = await fetch("/api/form-options?groupKey=packages", { cache: "no-store" });
                                  if (!res.ok) return;
                                  const data = (await res.json()) as { label: string; value: string }[];
                                  setAllPackagesForGroups(Array.isArray(data) ? data : []);
                                } catch { /* ignore */ }
                              })();
                            }
                          }}
                        >
                          {getGroupCondition(g.name) ? "Show when ✓" : "+ Show when…"}
                        </button>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-0.5 sm:gap-2">
                    <Button
                      type="button"
                      size="iconCompact"
                      variant="outline"
                      disabled={!canUp}
                      onClick={() => moveGroup(g.name, "up")}
                      title="Move group up"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      size="iconCompact"
                      variant="outline"
                      disabled={!canDown}
                      onClick={() => moveGroup(g.name, "down")}
                      title="Move group down"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </div>
                  </div>
                  <div
                    className="overflow-hidden transition-all duration-300 ease-in-out"
                    style={{
                      maxHeight: editingGroupCondition === g.name ? "500px" : "0px",
                      opacity: editingGroupCondition === g.name ? 1 : 0,
                    }}
                  >
                    <div className="mt-1 rounded border border-yellow-400 bg-yellow-50 p-2 dark:border-yellow-400 dark:bg-yellow-400/10">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
                          &quot;{g.name}&quot; Group Visibility
                        </span>
                        <div className="flex items-center gap-1.5">
                          {groupConditionDirty && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400">Unsaved</span>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            disabled={savingGroupCondition}
                            onClick={async () => {
                              setSavingGroupCondition(true);
                              await saveGroupCondition(g.name, pendingGroupCondition);
                              setSavingGroupCondition(false);
                              setGroupConditionDirty(false);
                              setEditingGroupCondition(null);
                            }}
                          >
                            {savingGroupCondition ? "Saving…" : "Save"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => { setEditingGroupCondition(null); setGroupConditionDirty(false); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                      <GroupShowWhenConfig
                        groupLabel={g.name}
                        value={pendingGroupCondition as Parameters<typeof GroupShowWhenConfig>[0]["value"]}
                        onChange={(next) => {
                          setPendingGroupCondition(next);
                          setGroupConditionDirty(true);
                        }}
                        fields={rows as Parameters<typeof GroupShowWhenConfig>[0]["fields"]}
                        allPackages={allPackagesForGroups}
                        currentPkg={pkg}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Table className="min-w-[720px]">
        <TableHeader className="hidden sm:table-header-group">
          <TableRow>
            <TableHead className="p-2 sm:p-4">Label</TableHead>
            <TableHead className="p-2 sm:p-4">Group</TableHead>
            <TableHead className="p-2 sm:p-4">Sort</TableHead>
            <TableHead className="p-2 sm:p-4">Categories</TableHead>
            <TableHead className="hidden text-right sm:table-cell p-2 sm:p-4">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayRows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className={`${r.isActive ? "text-green-600 dark:text-green-400" : ""} p-2 sm:p-4`}>
                {r.label}
                <div className="mt-1 text-xs text-neutral-500 sm:hidden">
                  <span>{((r.meta ?? {}) as FieldMeta).group || "(no group)"}</span>
                  <span className="px-2">•</span>
                  <span>Sort {r.sortOrder}</span>
                  <span className="px-2">•</span>
                  <span>
                    {Array.isArray(r.meta?.categories) && r.meta.categories.length > 0
                      ? r.meta.categories.join(", ")
                      : "all"}
                  </span>
                </div>
                <div className="mt-2 flex gap-2 sm:hidden">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(r)} aria-label="Edit">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant={r.isActive ? "outline" : "default"} onClick={() => toggleActive(r)} aria-label={r.isActive ? "Disable" : "Enable"}>
                    {r.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r)} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
              <TableCell className="hidden text-xs p-2 sm:table-cell sm:p-4">{(() => { const g = ((r.meta ?? {}) as FieldMeta).group; return Array.isArray(g) ? g.join(", ") : (g || "(no group)"); })()}</TableCell>
              <TableCell className="hidden p-2 sm:table-cell sm:p-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{r.sortOrder}</span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="iconCompact"
                      variant="outline"
                      title="Move up"
                      disabled={!moveInfoById.get(r.id)?.canUp}
                      onClick={() => moveWithinGroup(r.id, "up")}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      size="iconCompact"
                      variant="outline"
                      title="Move down"
                      disabled={!moveInfoById.get(r.id)?.canDown}
                      onClick={() => moveWithinGroup(r.id, "down")}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden text-xs p-2 sm:table-cell sm:p-4">
                {Array.isArray(r.meta?.categories) && r.meta.categories.length > 0
                  ? r.meta.categories.join(", ")
                  : "all"}
              </TableCell>
              <TableCell className="hidden text-right sm:table-cell p-2 sm:p-4">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => startEdit(r)} className="inline-flex items-center gap-2">
                    <Pencil className="h-4 w-4 sm:hidden lg:inline" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                  <Button size="sm" variant={r.isActive ? "outline" : "default"} onClick={() => toggleActive(r)} className="inline-flex items-center gap-2">
                    {r.isActive ? <EyeOff className="h-4 w-4 sm:hidden lg:inline" /> : <Eye className="h-4 w-4 sm:hidden lg:inline" />}
                    <span className="hidden sm:inline">{r.isActive ? "Disable" : "Enable"}</span>
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r)} className="inline-flex items-center gap-2">
                    <Trash2 className="h-4 w-4 sm:hidden lg:inline" />
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-neutral-500 dark:text-neutral-400">
                No fields defined.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Field" : "Add Field"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Label</Label>
              <Input value={form.label ?? ""} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Value (key)</Label>
              <Input value={form.value ?? ""} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Input Type</Label>
              <InputTypeSelect
                value={form.meta?.inputType ?? "string"}
                onChange={(v) => updateMeta("inputType", v as InputType)}
              />
            </div>

            {/* Formula config */}
            {(form.meta as FieldMeta | undefined)?.inputType === "formula" ? (
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

            {/* Currency config */}
            {(form.meta as FieldMeta | undefined)?.inputType === "currency" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label>Currency Code</Label>
                  <Input
                    placeholder="e.g. HKD, USD"
                    value={String(((form.meta as FieldMeta | undefined)?.currencyCode ?? "") || "")}
                    onChange={(e) => updateMeta("currencyCode", e.target.value)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label>Decimal Places</Label>
                  <Input
                    type="number"
                    className="w-28"
                    placeholder="2"
                    value={String(((form.meta as FieldMeta | undefined)?.decimals ?? 2))}
                    onChange={(e) => updateMeta("decimals", Number(e.target.value) || 0)}
                  />
                </div>
              </div>
            ) : null}

            {/* Display formatting - Label Case (always available) */}
            <div className="grid gap-1">
              <Label>Label Case</Label>
              <select
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                value={(form.meta as FieldMeta | undefined)?.labelCase ?? "original"}
                onChange={(e) => updateMeta("labelCase", e.target.value as FieldMeta["labelCase"])}
              >
                <option value="original">Original</option>
                <option value="upper">UPPERCASE</option>
                <option value="lower">lowercase</option>
                <option value="title">Title Case</option>
              </select>
            </div>

            {/* Display formatting - per input type */}
            {(() => {
              const it = (form.meta as FieldMeta | undefined)?.inputType ?? "string";
              if (it === "string") {
                return (
                  <div className="grid gap-1">
                    <Label>Value Case</Label>
                    <select
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                      value={(form.meta as FieldMeta | undefined)?.valueCase ?? "original"}
                      onChange={(e) => updateMeta("valueCase", e.target.value as FieldMeta["valueCase"])}
                    >
                      <option value="original">Original</option>
                      <option value="upper">UPPERCASE</option>
                      <option value="lower">lowercase</option>
                      <option value="title">Title Case</option>
                    </select>
                  </div>
                );
              }
              if (it === "date") {
                return (
                  <div className="grid gap-1">
                    <Label>Date Format</Label>
                    <select
                      className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                      value={(form.meta as FieldMeta | undefined)?.dateFormat ?? "DD-MM-YYYY"}
                      onChange={(e) => updateMeta("dateFormat", e.target.value as FieldMeta["dateFormat"])}
                    >
                      <option value="DD-MM-YYYY">DD-MM-YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </select>
                  </div>
                );
              }
              if (it === "number") {
                const numberFormat = ((form.meta as FieldMeta | undefined)?.numberFormat ?? "plain") as NonNullable<FieldMeta["numberFormat"]>;
                const decimals = Number.isFinite(Number(((form.meta as FieldMeta | undefined)?.decimals ?? 0))) ? Number(((form.meta as FieldMeta | undefined)?.decimals ?? 0)) : 0;
                return (
                  <div className="grid gap-3">
                    <div className="grid gap-1">
                      <Label>Number Format</Label>
                      <select
                        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                        value={numberFormat}
                        onChange={(e) => updateMeta("numberFormat", e.target.value as FieldMeta["numberFormat"])}
                      >
                        <option value="plain">Plain</option>
                        <option value="currency">Currency</option>
                        <option value="percent">Percent</option>
                      </select>
                    </div>
                    {numberFormat === "currency" ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-1">
                          <Label>Currency Code</Label>
                          <Input
                            placeholder="e.g. HKD, USD"
                            value={String(((form.meta as FieldMeta | undefined)?.currencyCode ?? "") || "")}
                            onChange={(e) => updateMeta("currencyCode", e.target.value)}
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label>Decimals</Label>
                          <Input
                            type="number"
                            className="w-28"
                            value={String(decimals)}
                            onChange={(e) => updateMeta("decimals", Number(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                    ) : null}
                    {numberFormat === "percent" ? (
                      <div className="grid gap-1">
                        <Label>Decimals</Label>
                        <Input
                          type="number"
                          className="w-28"
                          value={String(decimals)}
                          onChange={(e) => updateMeta("decimals", Number(e.target.value) || 0)}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              }
              return null;
            })()}

            {["select", "multi_select"].includes((form.meta?.inputType ?? "") as string) ? (
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label>Display</Label>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="selectDisplayGeneric"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={((form.meta as FieldMeta | undefined)?.selectDisplay ?? "dropdown") === "dropdown"}
                        onChange={() => updateMeta("selectDisplay", "dropdown")}
                      />
                      Dropdown
                    </label>
                    {((form.meta?.inputType ?? "") as string) === "select" ? (
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="selectDisplayGeneric"
                          className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                          checked={(form.meta as FieldMeta | undefined)?.selectDisplay === "radio"}
                          onChange={() => updateMeta("selectDisplay", "radio")}
                        />
                        Radio buttons
                      </label>
                    ) : (
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="radio"
                          name="selectDisplayGeneric"
                          className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                          checked={(form.meta as FieldMeta | undefined)?.selectDisplay === "checkbox"}
                          onChange={() => updateMeta("selectDisplay", "checkbox")}
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
                        const next: SelectOption[] = Array.isArray(form.meta?.options) ? [...form.meta.options] : [];
                        next.push({ label: "", value: "" });
                        updateMeta("options", next);
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
                        const options: SelectOption[] = lines
                          .map((l) => l.trim())
                          .filter(Boolean)
                          .map((l) => {
                            const parts = l.includes("|") ? l.split("|") : l.split("=");
                            const label = (parts[0] ?? "").trim();
                            const value = (parts[1] ?? label).trim();
                            return { label, value };
                          });
                        updateMeta("options", options);
                      }}
                    >
                      Import
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        // Use file upload to avoid clipboard limits and encoding issues
                        makeModelFileInputRef.current?.click();
                      }}
                      title="Build a Make select with a dependent Model select (child field)"
                    >
                      Import Make/Model CSV
                    </Button>
                    {/* Hidden file input for Make/Model CSV import */}
                    <input
                      ref={makeModelFileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={async (e) => {
                        try {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const text = await file.text();
                          const lines = text
                            .split(/\r?\n/)
                            .map((l) => l.trim())
                            .filter(Boolean);
                          if (lines.length === 0) {
                            toast.error("Empty CSV file.");
                            return;
                          }
                          const header = (lines[0] ?? "").toLowerCase();
                          const hasHeader = header.includes("make") && header.includes("model");
                          const dataRows = hasHeader ? lines.slice(1) : lines;
                          const map = new Map<string, Set<string>>();
                          for (const raw of dataRows) {
                            // naive CSV split (no quoted field support required for provided file)
                            const parts = raw.split(",");
                            if (parts.length < 2) continue;
                            const make = (parts[0] ?? "").trim();
                            const model = (parts[1] ?? "").trim();
                            if (!make || !model) continue;
                            const set = map.get(make) ?? new Set<string>();
                            set.add(model);
                            map.set(make, set);
                          }
                          if (map.size === 0) {
                            toast.error("No Make/Model pairs detected.");
                            return;
                          }
                          const options: SelectOption[] = Array.from(map.entries())
                            .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
                            .map(([make, models]) => ({
                              label: make,
                              value: make,
                              children: [
                                {
                                  label: "Model",
                                  inputType: "select",
                                  options: Array.from(models)
                                    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
                                    .map((m) => ({ label: m, value: m })),
                                },
                              ],
                            }));
                          updateMeta("options", options);
                          updateMeta("inputType", "select");
                          toast.success(`Imported ${options.length} makes with models`);
                          // reset input so the same file can be re-selected if needed
                          if (makeModelFileInputRef.current) makeModelFileInputRef.current.value = "";
                        } catch (err: unknown) {
                          const message = err instanceof Error ? err.message : "Import failed";
                          toast.error(message);
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  {(Array.isArray(form.meta?.options) ? (form.meta.options as SelectOption[]) : []).map(
                    (opt, idx) => (
                      <div key={idx} className="grid grid-cols-12 items=center gap-2">
                        <div className="col-span-5">
                          <Input
                            placeholder="Label"
                            value={opt.label ?? ""}
                            onChange={(e) => {
                              const next: SelectOption[] = [...(form.meta?.options ?? [])];
                              next[idx] = { ...next[idx], label: e.target.value };
                              updateMeta("options", next);
                            }}
                          />
                        </div>
                        <div className="col-span-5">
                          <Input
                            placeholder="Value"
                            value={opt.value ?? ""}
                            onChange={(e) => {
                              const next: SelectOption[] = [...(form.meta?.options ?? [])];
                              next[idx] = { ...next[idx], value: e.target.value };
                              updateMeta("options", next);
                            }}
                          />
                        </div>
                        <div className="col-span-2 flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              const next: SelectOption[] = [...(form.meta?.options ?? [])];
                              next.splice(idx, 1);
                              updateMeta("options", next);
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                        <div className="col-span-12 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                          <div className="mb-2 flex items-center justify-between">
                            <Label>Child fields (optional)</Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                children.push({ label: "", inputType: "string", options: [] });
                                next[idx] = { ...next[idx], children };
                                updateMeta("options", next);
                              }}
                            >
                              Add child
                            </Button>
                          </div>
                          <div className="grid gap-3">
                            {(Array.isArray(opt.children) ? opt.children : []).map((child, cIdx) => (
                              <div key={cIdx} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                                <div className="mb-2 flex items-center justify-between">
                                  <Label>Child #{cIdx + 1}</Label>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                      const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                      children.splice(cIdx, 1);
                                      next[idx] = { ...next[idx], children };
                                      updateMeta("options", next);
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
                                        const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                        const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                        children[cIdx] = { ...(children[cIdx] ?? {}), label: e.target.value };
                                        next[idx] = { ...next[idx], children };
                                        updateMeta("options", next);
                                      }}
                                    />
                                  </div>
                                  <div className="w-[200px]">
                                    <Label>Type</Label>
                                    <select
                                      className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                      value={child?.inputType ?? "string"}
                                      onChange={(e) => {
                                        const nextType = e.target.value as InputType;
                                        const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                        const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                        children[cIdx] = {
                                          ...(children[cIdx] ?? {}),
                                          inputType: nextType,
                                          options:
                                            nextType === "select" || nextType === "multi_select"
                                              ? children[cIdx]?.options ?? []
                                              : undefined,
                                        };
                                        next[idx] = { ...next[idx], children };
                                        updateMeta("options", next);
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
                                  {child?.inputType === "currency" ? (
                                    <div className="col-span-12 mt-2 grid gap-2 sm:grid-cols-2">
                                      <div className="grid gap-1">
                                        <Label>Currency Code</Label>
                                        <Input
                                          placeholder="e.g. HKD, USD"
                                          value={String(child?.currencyCode ?? "")}
                                          onChange={(e) => {
                                            const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                            const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                            children[cIdx] = { ...(children[cIdx] ?? {}), currencyCode: e.target.value };
                                            next[idx] = { ...next[idx], children };
                                            updateMeta("options", next);
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
                                            const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                            const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                            children[cIdx] = { ...(children[cIdx] ?? {}), decimals: Number(e.target.value) || 0 };
                                            next[idx] = { ...next[idx], children };
                                            updateMeta("options", next);
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
                                          <Input placeholder="Yes" value={String((child as any)?.booleanLabels?.true ?? "")} onChange={(e) => {
                                            const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                            const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                            children[cIdx] = { ...(children[cIdx] ?? {}), booleanLabels: { ...(children[cIdx]?.booleanLabels ?? {}), true: e.target.value } };
                                            next[idx] = { ...next[idx], children };
                                            updateMeta("options", next);
                                          }} />
                                        </div>
                                        <div className="grid gap-1">
                                          <Label>No Label</Label>
                                          <Input placeholder="No" value={String((child as any)?.booleanLabels?.false ?? "")} onChange={(e) => {
                                            const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                            const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                            children[cIdx] = { ...(children[cIdx] ?? {}), booleanLabels: { ...(children[cIdx]?.booleanLabels ?? {}), false: e.target.value } };
                                            next[idx] = { ...next[idx], children };
                                            updateMeta("options", next);
                                          }} />
                                        </div>
                                        <div className="grid gap-1 sm:col-span-2">
                                          <Label>Display</Label>
                                          <div className="flex items-center gap-4 text-sm">
                                            <label className="inline-flex items-center gap-2">
                                              <input type="radio" checked={((child as any)?.booleanDisplay ?? "radio") === "radio"} onChange={() => {
                                                const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                                children[cIdx] = { ...(children[cIdx] ?? {}), booleanDisplay: "radio" };
                                                next[idx] = { ...next[idx], children };
                                                updateMeta("options", next);
                                              }} />
                                              Radio buttons
                                            </label>
                                            <label className="inline-flex items-center gap-2">
                                              <input type="radio" checked={(child as any)?.booleanDisplay === "dropdown"} onChange={() => {
                                                const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                                children[cIdx] = { ...(children[cIdx] ?? {}), booleanDisplay: "dropdown" };
                                                next[idx] = { ...next[idx], children };
                                                updateMeta("options", next);
                                              }} />
                                              Dropdown
                                            </label>
                                          </div>
                                        </div>
                                      </div>
                                      {(["true", "false"] as const).map((branch) => {
                                        const branchLabel = branch === "true" ? "When YES" : "When NO";
                                        const branchChildren = (child as any)?.booleanChildren?.[branch] ?? [];
                                        const bArr = Array.isArray(branchChildren) ? branchChildren : [];
                                        return (
                                          <div key={branch} className="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                                            <div className="flex items-center justify-between">
                                              <Label className="text-xs">{branchLabel}</Label>
                                              <Button type="button" size="sm" variant="secondary" onClick={() => {
                                                const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                                const boolCh: any = { ...((children[cIdx] as any)?.booleanChildren ?? {}) };
                                                const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                inner.push({ label: "", inputType: "string" });
                                                boolCh[branch] = inner;
                                                children[cIdx] = { ...(children[cIdx] ?? {}), booleanChildren: boolCh };
                                                next[idx] = { ...next[idx], children };
                                                updateMeta("options", next);
                                              }}>Add child</Button>
                                            </div>
                                            {bArr.map((bChild: any, bIdx: number) => (
                                              <div key={`opt-bc-${idx}-${cIdx}-${branch}-${bIdx}`} className="rounded border border-neutral-100 p-2 dark:border-neutral-800">
                                                <div className="mb-1 flex items-center justify-between">
                                                  <span className="text-xs font-medium">Child #{bIdx + 1}</span>
                                                  <Button type="button" size="sm" variant="outline" onClick={() => {
                                                    const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                    const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                                    const boolCh: any = { ...((children[cIdx] as any)?.booleanChildren ?? {}) };
                                                    const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                    inner.splice(bIdx, 1);
                                                    boolCh[branch] = inner;
                                                    children[cIdx] = { ...(children[cIdx] ?? {}), booleanChildren: boolCh };
                                                    next[idx] = { ...next[idx], children };
                                                    updateMeta("options", next);
                                                  }}>Remove</Button>
                                                </div>
                                                <div className="grid grid-cols-12 gap-2">
                                                  <div className="col-span-6">
                                                    <Input placeholder="Label" value={String(bChild?.label ?? "")} onChange={(e) => {
                                                      const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                      const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                                      const boolCh: any = { ...((children[cIdx] as any)?.booleanChildren ?? {}) };
                                                      const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                      inner[bIdx] = { ...inner[bIdx], label: e.target.value };
                                                      boolCh[branch] = inner;
                                                      children[cIdx] = { ...(children[cIdx] ?? {}), booleanChildren: boolCh };
                                                      next[idx] = { ...next[idx], children };
                                                      updateMeta("options", next);
                                                    }} />
                                                  </div>
                                                  <div className="col-span-6">
                                                    <select className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" value={bChild?.inputType ?? "string"} onChange={(e) => {
                                                      const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                      const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                                      const boolCh: any = { ...((children[cIdx] as any)?.booleanChildren ?? {}) };
                                                      const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                      inner[bIdx] = { ...inner[bIdx], inputType: e.target.value };
                                                      boolCh[branch] = inner;
                                                      children[cIdx] = { ...(children[cIdx] ?? {}), booleanChildren: boolCh };
                                                      next[idx] = { ...next[idx], children };
                                                      updateMeta("options", next);
                                                    }}>
                                                      <option value="string">String</option>
                                                      <option value="number">Number</option>
                                                      <option value="currency">Currency</option>
                                                      <option value="date">Date</option>
                                                      <option value="select">Select</option>
                                                      <option value="multi_select">Multi Select</option>
                                                      <option value="formula">Formula</option>
                                                    </select>
                                                  </div>
                                                  {bChild?.inputType === "currency" ? (
                                                    <>
                                                      <div className="col-span-6"><Input placeholder="e.g. HKD" value={String(bChild?.currencyCode ?? "")} onChange={(e) => {
                                                        const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                        const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                                        const boolCh: any = { ...((children[cIdx] as any)?.booleanChildren ?? {}) };
                                                        const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                        inner[bIdx] = { ...inner[bIdx], currencyCode: e.target.value };
                                                        boolCh[branch] = inner;
                                                        children[cIdx] = { ...(children[cIdx] ?? {}), booleanChildren: boolCh };
                                                        next[idx] = { ...next[idx], children };
                                                        updateMeta("options", next);
                                                      }} /></div>
                                                      <div className="col-span-6"><Input type="number" placeholder="2" value={String(bChild?.decimals ?? 2)} onChange={(e) => {
                                                        const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                        const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                                        const boolCh: any = { ...((children[cIdx] as any)?.booleanChildren ?? {}) };
                                                        const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                        inner[bIdx] = { ...inner[bIdx], decimals: Number(e.target.value) };
                                                        boolCh[branch] = inner;
                                                        children[cIdx] = { ...(children[cIdx] ?? {}), booleanChildren: boolCh };
                                                        next[idx] = { ...next[idx], children };
                                                        updateMeta("options", next);
                                                      }} /></div>
                                                    </>
                                                  ) : null}
                                                </div>
                                              </div>
                                            ))}
                                            {bArr.length === 0 ? <p className="text-xs text-neutral-400">No children configured.</p> : null}
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
                                              const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                              const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                              const childOptions = Array.isArray(children[cIdx]?.options)
                                                ? [...(children[cIdx]?.options ?? [])]
                                                : [];
                                              childOptions.push({ label: "", value: "" });
                                              children[cIdx] = { ...(children[cIdx] ?? {}), options: childOptions };
                                              next[idx] = { ...next[idx], children };
                                              updateMeta("options", next);
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
                                                'Paste options, one per line. Use &quot;Label|value&quot; or &quot;Label=value&quot;. If no separator, label is used as value.'
                                              );
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
                                              const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                              const children = Array.isArray(next[idx]?.children) ? [...(next[idx].children ?? [])] : [];
                                              children[cIdx] = { ...(children[cIdx] ?? {}), options: childOptions };
                                              next[idx] = { ...next[idx], children };
                                              updateMeta("options", next);
                                            }}
                                          >
                                            Import
                                          </Button>
                                        </div>
                                      </div>
                                      <div className="grid gap-2">
                                        {(Array.isArray(child?.options) ? child?.options ?? [] : []).map((copt, optIdx) => (
                                          <div key={optIdx} className="grid grid-cols-12 items-center gap-2">
                                            <div className="col-span-5">
                                              <Input
                                                placeholder="Label"
                                                value={copt.label ?? ""}
                                                onChange={(e) => {
                                                  const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                  const children = Array.isArray(next[idx]?.children)
                                                    ? [...(next[idx].children ?? [])]
                                                    : [];
                                                  const opts = Array.isArray(children[cIdx]?.options)
                                                    ? [...(children[cIdx]?.options ?? [])]
                                                    : [];
                                                  opts[optIdx] = { ...opts[optIdx], label: e.target.value };
                                                  children[cIdx] = { ...(children[cIdx] ?? {}), options: opts };
                                                  next[idx] = { ...next[idx], children };
                                                  updateMeta("options", next);
                                                }}
                                              />
                                            </div>
                                            <div className="col-span-5">
                                              <Input
                                                placeholder="Value"
                                                value={copt.value ?? ""}
                                                onChange={(e) => {
                                                  const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                  const children = Array.isArray(next[idx]?.children)
                                                    ? [...(next[idx].children ?? [])]
                                                    : [];
                                                  const opts = Array.isArray(children[cIdx]?.options)
                                                    ? [...(children[cIdx]?.options ?? [])]
                                                    : [];
                                                  opts[optIdx] = { ...opts[optIdx], value: e.target.value };
                                                  children[cIdx] = { ...(children[cIdx] ?? {}), options: opts };
                                                  next[idx] = { ...next[idx], children };
                                                  updateMeta("options", next);
                                                }}
                                              />
                                            </div>
                                            <div className="col-span-2 flex justify-end">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="destructive"
                                                onClick={() => {
                                                  const next: SelectOption[] = [...(form.meta?.options ?? [])];
                                                  const children = Array.isArray(next[idx]?.children)
                                                    ? [...(next[idx].children ?? [])]
                                                    : [];
                                                  const opts = Array.isArray(children[cIdx]?.options)
                                                    ? [...(children[cIdx]?.options ?? [])]
                                                    : [];
                                                  opts.splice(optIdx, 1);
                                                  children[cIdx] = { ...(children[cIdx] ?? {}), options: opts };
                                                  next[idx] = { ...next[idx], children };
                                                  updateMeta("options", next);
                                                }}
                                              >
                                                Remove
                                              </Button>
                                            </div>
                                          </div>
                                        ))}
                                        {((child?.options?.length ?? 0) === 0) ? (
                                          <p className="text-xs text-neutral-500 dark:text-neutral-400">No child options yet. Click &quot;Add option&quot; or &quot;Import&quot;.</p>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                            {(Array.isArray(opt.children) ? opt.children : []).length === 0 ? (
                              <p className="text-xs text-neutral-500 dark:text-neutral-400">No child fields yet. Click &quot;Add child&quot;.</p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    )
                  )}
                  {((form.meta?.options?.length ?? 0) === 0) ? (
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">No options yet. Click &quot;Add option&quot; or &quot;Import&quot;.</p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {form.meta?.inputType === "repeatable" ? (
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label>Repeatable — Item label</Label>
                  <Input
                    placeholder="Accessory"
                    value={String(((form.meta as FieldMeta | undefined)?.repeatable?.itemLabel ?? ""))}
                onChange={(e) => {
                  const prevRepeatable = ((form.meta as FieldMeta | undefined)?.repeatable ?? {}) as {
                    keyPrefix?: string;
                    itemLabel?: string;
                    min?: number;
                    max?: number;
                    fields?: ChildFieldMeta[];
                  };
                  updateMeta("repeatable", { ...prevRepeatable, itemLabel: e.target.value });
                }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="grid gap-1">
                    <Label>Min items</Label>
                    <Input
                      type="number"
                      value={String(((form.meta as FieldMeta | undefined)?.repeatable?.min ?? 0))}
                  onChange={(e) => {
                    const prevRepeatable = ((form.meta as FieldMeta | undefined)?.repeatable ?? {}) as {
                      keyPrefix?: string;
                      itemLabel?: string;
                      min?: number;
                      max?: number;
                      fields?: ChildFieldMeta[];
                    };
                    updateMeta("repeatable", { ...prevRepeatable, min: Number(e.target.value) || 0 });
                  }}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label>Max items</Label>
                    <Input
                      type="number"
                      value={String(((form.meta as FieldMeta | undefined)?.repeatable?.max ?? 0))}
                  onChange={(e) => {
                    const prevRepeatable = ((form.meta as FieldMeta | undefined)?.repeatable ?? {}) as {
                      keyPrefix?: string;
                      itemLabel?: string;
                      min?: number;
                      max?: number;
                      fields?: ChildFieldMeta[];
                    };
                    updateMeta("repeatable", { ...prevRepeatable, max: Number(e.target.value) || 0 });
                  }}
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
                      const rep = ((form.meta as FieldMeta | undefined)?.repeatable ?? {}) as FieldMeta["repeatable"];
                      const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                      fields.push({ label: "", value: "", inputType: "string" });
                  const nextRepeatable = { ...(rep ?? {}), fields } as {
                    keyPrefix?: string;
                    itemLabel?: string;
                    min?: number;
                    max?: number;
                    fields?: ChildFieldMeta[];
                  };
                  updateMeta("repeatable", nextRepeatable);
                    }}
                  >
                    Add field
                  </Button>
                </div>
                <div className="grid gap-2">
                  {(((form.meta as FieldMeta | undefined)?.repeatable?.fields ?? []) as ChildFieldMeta[]).map((fld, idx) => (
                    <div key={`repfld-${idx}`} className="grid grid-cols-12 items-center gap-2">
                      <div className="col-span-4">
                        <Input
                          placeholder="Label"
                          value={fld?.label ?? ""}
                          onChange={(e) => {
                            const rep = ((form.meta as FieldMeta | undefined)?.repeatable ?? {}) as FieldMeta["repeatable"];
                            const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                            fields[idx] = { ...(fields[idx] ?? {}), label: e.target.value };
                            const nextRepeatable = { ...(rep ?? {}), fields } as {
                              keyPrefix?: string;
                              itemLabel?: string;
                              min?: number;
                              max?: number;
                              fields?: ChildFieldMeta[];
                            };
                            updateMeta("repeatable", nextRepeatable);
                          }}
                        />
                      </div>
                      <div className="col-span-4">
                        <Input
                          placeholder="Value (key)"
                          value={fld?.value ?? ""}
                          onChange={(e) => {
                            const rep = ((form.meta as FieldMeta | undefined)?.repeatable ?? {}) as FieldMeta["repeatable"];
                            const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                            fields[idx] = { ...(fields[idx] ?? {}), value: e.target.value };
                            const nextRepeatable = { ...(rep ?? {}), fields } as {
                              keyPrefix?: string;
                              itemLabel?: string;
                              min?: number;
                              max?: number;
                              fields?: ChildFieldMeta[];
                            };
                            updateMeta("repeatable", nextRepeatable);
                          }}
                        />
                      </div>
                      <div className="col-span-3">
                        <select
                          className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                          value={fld?.inputType ?? "string"}
                          onChange={(e) => {
                            const nextType = e.target.value as InputType;
                            const rep = ((form.meta as FieldMeta | undefined)?.repeatable ?? {}) as FieldMeta["repeatable"];
                            const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                            fields[idx] = {
                              ...(fields[idx] ?? {}),
                              inputType: nextType,
                              options: nextType === "select" || nextType === "multi_select" ? (fields[idx]?.options ?? []) : undefined,
                            };
                            const nextRepeatable = { ...(rep ?? {}), fields } as {
                              keyPrefix?: string;
                              itemLabel?: string;
                              min?: number;
                              max?: number;
                              fields?: ChildFieldMeta[];
                            };
                            updateMeta("repeatable", nextRepeatable);
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
                            const rep = ((form.meta as FieldMeta | undefined)?.repeatable ?? {}) as FieldMeta["repeatable"];
                            const fields = Array.isArray(rep?.fields) ? [...(rep?.fields ?? [])] : [];
                            fields.splice(idx, 1);
                          const nextRepeatable = { ...(rep ?? {}), fields } as {
                            keyPrefix?: string;
                            itemLabel?: string;
                            min?: number;
                            max?: number;
                            fields?: ChildFieldMeta[];
                          };
                          updateMeta("repeatable", nextRepeatable);
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {form.meta?.inputType === "boolean" ? (
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label>Default Selection</Label>
                  <div className="flex items-center gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="defaultBooleanGeneric"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={form.meta?.defaultBoolean === true}
                        onChange={() => updateMeta("defaultBoolean", true)}
                      />
                      Yes
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="defaultBooleanGeneric"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={form.meta?.defaultBoolean === false}
                        onChange={() => updateMeta("defaultBoolean", false)}
                      />
                      No
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="defaultBooleanGeneric"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={typeof form.meta?.defaultBoolean === "undefined" || form.meta?.defaultBoolean === null}
                        onChange={() => updateMeta("defaultBoolean", null)}
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
                        name="booleanDisplayGeneric"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={((form.meta as FieldMeta | undefined)?.booleanDisplay ?? "radio") === "radio"}
                        onChange={() => updateMeta("booleanDisplay", "radio")}
                      />
                      Radio buttons
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="booleanDisplayGeneric"
                        className="accent-neutral-900 dark:accent-white border border-neutral-400 dark:border-black focus-visible:ring-0"
                        checked={(form.meta as FieldMeta | undefined)?.booleanDisplay === "dropdown"}
                        onChange={() => updateMeta("booleanDisplay", "dropdown")}
                      />
                      Dropdown
                    </label>
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label>Labels</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="grid gap-1">
                      <Label className="text-xs text-neutral-500 dark:text-neutral-400">Yes label</Label>
                      <Input
                        placeholder="Yes"
                        value={String(((form.meta as FieldMeta | undefined)?.booleanLabels?.true ?? ""))}
                        onChange={(e) =>
                          updateMeta("booleanLabels", {
                          ...(((form.meta as FieldMeta | undefined)?.booleanLabels ?? {})),
                            true: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label className="text-xs text-neutral-500 dark:text-neutral-400">No label</Label>
                      <Input
                        placeholder="No"
                        value={String(((form.meta as FieldMeta | undefined)?.booleanLabels?.false ?? ""))}
                        onChange={(e) =>
                          updateMeta("booleanLabels", {
                          ...(((form.meta as FieldMeta | undefined)?.booleanLabels ?? {})),
                            false: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
                {/* Boolean branch children (Yes / No) */}
                <div className="grid gap-2">
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
                          const current = ((form.meta as FieldMeta | undefined)?.booleanChildren?.true ?? []) as ChildFieldMeta[];
                          const next: ChildFieldMeta[] = [...current, { label: "", inputType: "string", options: [] } as ChildFieldMeta];
                          updateMeta("booleanChildren", {
                        ...(((form.meta as FieldMeta | undefined)?.booleanChildren ?? {})),
                            true: next,
                          });
                        }}
                      >
                        Add child
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      {(((form.meta as FieldMeta | undefined)?.booleanChildren?.true ?? []) as ChildFieldMeta[]).map(
                        (child, cIdx) => (
                          <div key={`bool-yes-${cIdx}`} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                            <div className="mb-2 flex items-center justify-between">
                              <Label>Child #{cIdx + 1}</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                  const arr = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                  arr.splice(cIdx, 1);
                                  updateMeta("booleanChildren", { ...bc, true: arr });
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
                                    const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                    const arr = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                    arr[cIdx] = { ...(arr[cIdx] ?? {}), label: e.target.value };
                                    updateMeta("booleanChildren", { ...bc, true: arr });
                                  }}
                                />
                              </div>
                              <div className="w-[200px]">
                                <Label>Type</Label>
                                <select
                                  className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                  value={child?.inputType ?? "string"}
                                  onChange={(e) => {
                                    const nextType = e.target.value as InputType;
                                    const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                    const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                    arr[cIdx] = {
                                      ...(arr[cIdx] ?? {}),
                                      inputType: nextType,
                                      options: nextType === "select" || nextType === "multi_select" ? (arr[cIdx]?.options ?? []) : undefined,
                                    } as ChildFieldMeta;
                                    updateMeta("booleanChildren", { ...bc, true: arr });
                                  }}
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
                              {child?.inputType === "formula" ? (
                                <div className="col-span-12 mt-2">
                                  <Label>Formula Expression</Label>
                                  <Input
                                    placeholder="e.g. {field_key} * 0.05"
                                    value={String((child as any)?.formula ?? "")}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                      const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), formula: e.target.value } as any;
                                      updateMeta("booleanChildren", { ...bc, true: arr } as any);
                                    }}
                                  />
                                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Reference sibling fields using {"{field_key}"} syntax.</p>
                                </div>
                              ) : null}
                              {child?.inputType === "currency" ? (
                                <div className="col-span-12 mt-2 grid gap-2 sm:grid-cols-2">
                                  <div className="grid gap-1">
                                    <Label>Currency Code</Label>
                                    <Input
                                      placeholder="e.g. HKD, USD"
                                      value={String((child as any)?.currencyCode ?? "")}
                                      onChange={(e) => {
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), currencyCode: e.target.value } as ChildFieldMeta;
                                        updateMeta("booleanChildren", { ...bc, true: arr });
                                      }}
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label>Decimal Places</Label>
                                    <Input
                                      type="number"
                                      className="w-28"
                                      placeholder="2"
                                      value={String((child as any)?.decimals ?? 2)}
                                      onChange={(e) => {
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), decimals: Number(e.target.value) || 0 } as ChildFieldMeta;
                                        updateMeta("booleanChildren", { ...bc, true: arr });
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
                                      <Input placeholder="Yes" value={String((child as any)?.booleanLabels?.true ?? "")} onChange={(e) => {
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanLabels: { ...(arr[cIdx]?.booleanLabels ?? {}), true: e.target.value } } as ChildFieldMeta;
                                        updateMeta("booleanChildren", { ...bc, true: arr });
                                      }} />
                                    </div>
                                    <div className="grid gap-1">
                                      <Label>No Label</Label>
                                      <Input placeholder="No" value={String((child as any)?.booleanLabels?.false ?? "")} onChange={(e) => {
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanLabels: { ...(arr[cIdx]?.booleanLabels ?? {}), false: e.target.value } } as ChildFieldMeta;
                                        updateMeta("booleanChildren", { ...bc, true: arr });
                                      }} />
                                    </div>
                                    <div className="grid gap-1 sm:col-span-2">
                                      <Label>Display</Label>
                                      <div className="flex items-center gap-4 text-sm">
                                        <label className="inline-flex items-center gap-2">
                                          <input type="radio" checked={((child as any)?.booleanDisplay ?? "radio") === "radio"} onChange={() => {
                                            const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                            const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                            arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanDisplay: "radio" } as ChildFieldMeta;
                                            updateMeta("booleanChildren", { ...bc, true: arr });
                                          }} />
                                          Radio buttons
                                        </label>
                                        <label className="inline-flex items-center gap-2">
                                          <input type="radio" checked={(child as any)?.booleanDisplay === "dropdown"} onChange={() => {
                                            const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                            const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                            arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanDisplay: "dropdown" } as ChildFieldMeta;
                                            updateMeta("booleanChildren", { ...bc, true: arr });
                                          }} />
                                          Dropdown
                                        </label>
                                      </div>
                                    </div>
                                  </div>
                                  {(["true", "false"] as const).map((branch) => {
                                    const branchLabel = branch === "true" ? "When YES" : "When NO";
                                    const branchChildren = (child as any)?.booleanChildren?.[branch] ?? [];
                                    const bArr = Array.isArray(branchChildren) ? branchChildren : [];
                                    return (
                                      <div key={branch} className="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                                        <div className="flex items-center justify-between">
                                          <Label className="text-xs">{branchLabel}</Label>
                                          <Button type="button" size="sm" variant="secondary" onClick={() => {
                                            const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                            const parentArr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                            const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                            const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                            inner.push({ label: "", inputType: "string" });
                                            boolCh[branch] = inner;
                                            parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                            updateMeta("booleanChildren", { ...bc, true: parentArr });
                                          }}>Add child</Button>
                                        </div>
                                        {bArr.map((bChild: any, bIdx: number) => (
                                          <div key={`yes-bc-${cIdx}-${branch}-${bIdx}`} className="rounded border border-neutral-100 p-2 dark:border-neutral-800">
                                            <div className="mb-1 flex items-center justify-between">
                                              <span className="text-xs font-medium">Child #{bIdx + 1}</span>
                                              <Button type="button" size="sm" variant="outline" onClick={() => {
                                                const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                const parentArr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                                const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                inner.splice(bIdx, 1);
                                                boolCh[branch] = inner;
                                                parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                updateMeta("booleanChildren", { ...bc, true: parentArr });
                                              }}>Remove</Button>
                                            </div>
                                            <div className="grid grid-cols-12 gap-2">
                                              <div className="col-span-6">
                                                <Input placeholder="Label" value={String(bChild?.label ?? "")} onChange={(e) => {
                                                  const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                  const parentArr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                                  const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                  const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                  inner[bIdx] = { ...inner[bIdx], label: e.target.value };
                                                  boolCh[branch] = inner;
                                                  parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                  updateMeta("booleanChildren", { ...bc, true: parentArr });
                                                }} />
                                              </div>
                                              <div className="col-span-6">
                                                <select className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" value={bChild?.inputType ?? "string"} onChange={(e) => {
                                                  const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                  const parentArr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                                  const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                  const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                  inner[bIdx] = { ...inner[bIdx], inputType: e.target.value };
                                                  boolCh[branch] = inner;
                                                  parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                  updateMeta("booleanChildren", { ...bc, true: parentArr });
                                                }}>
                                                  <option value="string">String</option>
                                                  <option value="number">Number</option>
                                                  <option value="currency">Currency</option>
                                                  <option value="date">Date</option>
                                                  <option value="select">Select</option>
                                                  <option value="multi_select">Multi Select</option>
                                                  <option value="formula">Formula</option>
                                                </select>
                                              </div>
                                              {bChild?.inputType === "currency" ? (
                                                <>
                                                  <div className="col-span-6"><Input placeholder="e.g. HKD" value={String(bChild?.currencyCode ?? "")} onChange={(e) => {
                                                    const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                    const parentArr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                                    const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                    const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                    inner[bIdx] = { ...inner[bIdx], currencyCode: e.target.value };
                                                    boolCh[branch] = inner;
                                                    parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                    updateMeta("booleanChildren", { ...bc, true: parentArr });
                                                  }} /></div>
                                                  <div className="col-span-6"><Input type="number" placeholder="2" value={String(bChild?.decimals ?? 2)} onChange={(e) => {
                                                    const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                    const parentArr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                                    const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                    const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                    inner[bIdx] = { ...inner[bIdx], decimals: Number(e.target.value) };
                                                    boolCh[branch] = inner;
                                                    parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                    updateMeta("booleanChildren", { ...bc, true: parentArr });
                                                  }} /></div>
                                                </>
                                              ) : null}
                                            </div>
                                          </div>
                                        ))}
                                        {bArr.length === 0 ? <p className="text-xs text-neutral-400">No children configured.</p> : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {String(child?.inputType ?? "") === "repeatable" ? (
                                <div className="col-span-12 mt-2 space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="grid gap-1">
                                      <Label>Item label</Label>
                                      <Input
                                        placeholder="Accessory"
                                        value={String((child?.repeatable?.itemLabel ?? ""))}
                                        onChange={(e) => {
                                          const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                          const rep = { ...(arr[cIdx]?.repeatable ?? {}) };
                                          rep.itemLabel = e.target.value;
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                          updateMeta("booleanChildren", { ...bc, true: arr });
                                        }}
                                      />
                                    </div>
                                    <div className="grid gap-1">
                                      <Label>Min</Label>
                                      <Input
                                        type="number"
                                        value={String((child?.repeatable?.min ?? 0))}
                                        onChange={(e) => {
                                          const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                          const rep = { ...(arr[cIdx]?.repeatable ?? {}) };
                                          rep.min = Number(e.target.value) || 0;
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                          updateMeta("booleanChildren", { ...bc, true: arr });
                                        }}
                                      />
                                    </div>
                                    <div className="grid gap-1">
                                      <Label>Max</Label>
                                      <Input
                                        type="number"
                                        value={String((child?.repeatable?.max ?? 0))}
                                        onChange={(e) => {
                                          const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                          const rep = { ...(arr[cIdx]?.repeatable ?? {}) };
                                          rep.max = Number(e.target.value) || 0;
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                          updateMeta("booleanChildren", { ...bc, true: arr });
                                        }}
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
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                        const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                        const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                        fields.push({ label: "", value: "", inputType: "string" });
                                        rep.fields = fields;
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                        updateMeta("booleanChildren", { ...bc, true: arr });
                                      }}
                                    >
                                      Add field
                                    </Button>
                                  </div>
                                  <div className="grid gap-2">
                                    {(((child?.repeatable?.fields ?? []) as any[]) ?? []).map((rf, rfi) => (
                                      <div key={`yes-rep-${cIdx}-${rfi}`} className="grid grid-cols-12 items-center gap-2">
                                        <div className="col-span-4">
                                          <Input
                                            placeholder="Label"
                                            value={String(rf?.label ?? "")}
                                            onChange={(e) => {
                                              const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                              const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                              const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                              fields[rfi] = { ...(fields[rfi] ?? {}), label: e.target.value };
                                              rep.fields = fields;
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                              updateMeta("booleanChildren", { ...bc, true: arr });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-4">
                                          <Input
                                            placeholder="Value (key)"
                                            value={String(rf?.value ?? "")}
                                            onChange={(e) => {
                                              const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                              const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                              const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                              fields[rfi] = { ...(fields[rfi] ?? {}), value: e.target.value };
                                              rep.fields = fields;
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                              updateMeta("booleanChildren", { ...bc, true: arr });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-3">
                                          <select
                                            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                            value={String(rf?.inputType ?? "string")}
                                            onChange={(e) => {
                                              const nextType = e.target.value as InputType;
                                              const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                              const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                              const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                              fields[rfi] = {
                                                ...(fields[rfi] ?? {}),
                                                inputType: nextType,
                                                options: nextType === "select" || nextType === "multi_select" ? (fields[rfi]?.options ?? []) : undefined,
                                              };
                                              rep.fields = fields;
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                              updateMeta("booleanChildren", { ...bc, true: arr });
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
                                              const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr: ChildFieldMeta[] = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                              const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                              const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                              fields.splice(rfi, 1);
                                              rep.fields = fields;
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                              updateMeta("booleanChildren", { ...bc, true: arr });
                                            }}
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
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
                                          const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                          const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                          opts.push({ label: "", value: "" });
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                          updateMeta("booleanChildren", { ...bc, true: arr });
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
                                          const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), options: parsed };
                                          updateMeta("booleanChildren", { ...bc, true: arr });
                                        }}
                                      >
                                        Import
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="grid gap-2">
                                    {(Array.isArray(child?.options) ? child?.options ?? [] : []).map((o, oi) => (
                                      <div key={oi} className="grid grid-cols-12 items-center gap-2">
                                        <div className="col-span-5">
                                          <Input
                                            placeholder="Label"
                                            value={o.label ?? ""}
                                            onChange={(e) => {
                                              const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                              const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                              opts[oi] = { ...(opts[oi] ?? {}), label: e.target.value };
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                              updateMeta("booleanChildren", { ...bc, true: arr });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-5">
                                          <Input
                                            placeholder="Value"
                                            value={o.value ?? ""}
                                            onChange={(e) => {
                                              const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                              const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                              opts[oi] = { ...(opts[oi] ?? {}), value: e.target.value };
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                              updateMeta("booleanChildren", { ...bc, true: arr });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-2 flex justify-end">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => {
                                              const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr = Array.isArray(bc.true) ? [...(bc.true as ChildFieldMeta[])] : [];
                                              const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                              opts.splice(oi, 1);
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                              updateMeta("booleanChildren", { ...bc, true: arr });
                                            }}
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )
                      )}
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
                          const current = ((form.meta as FieldMeta | undefined)?.booleanChildren?.false ?? []) as ChildFieldMeta[];
                          const next: ChildFieldMeta[] = [...current, { label: "", inputType: "string", options: [] } as ChildFieldMeta];
                          updateMeta("booleanChildren", {
                        ...(((form.meta as FieldMeta | undefined)?.booleanChildren ?? {})),
                            false: next,
                          });
                        }}
                      >
                        Add child
                      </Button>
                    </div>
                    <div className="grid gap-3">
                      {(((form.meta as FieldMeta | undefined)?.booleanChildren?.false ?? []) as ChildFieldMeta[]).map(
                        (child, cIdx) => (
                          <div key={`bool-no-${cIdx}`} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                            <div className="mb-2 flex items-center justify-between">
                              <Label>Child #{cIdx + 1}</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                          const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                  const arr = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                  arr.splice(cIdx, 1);
                                  updateMeta("booleanChildren", { ...bc, false: arr });
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
                                    const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                    const arr = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                    arr[cIdx] = { ...(arr[cIdx] ?? {}), label: e.target.value };
                                    updateMeta("booleanChildren", { ...bc, false: arr });
                                  }}
                                />
                              </div>
                              <div className="w-[200px]">
                                <Label>Type</Label>
                                <select
                                  className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                  value={child?.inputType ?? "string"}
                                  onChange={(e) => {
                                    const nextType = e.target.value as InputType;
                                    const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                    const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                    arr[cIdx] = {
                                      ...(arr[cIdx] ?? {}),
                                      inputType: nextType,
                                      options: nextType === "select" || nextType === "multi_select" ? (arr[cIdx]?.options ?? []) : undefined,
                                    } as ChildFieldMeta;
                                    updateMeta("booleanChildren", { ...bc, false: arr });
                                  }}
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
                              {child?.inputType === "formula" ? (
                                <div className="col-span-12 mt-2">
                                  <Label>Formula Expression</Label>
                                  <Input
                                    placeholder="e.g. {field_key} * 0.05"
                                    value={String((child as any)?.formula ?? "")}
                                    onChange={(e) => {
                                      const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                      const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                      arr[cIdx] = { ...(arr[cIdx] ?? {}), formula: e.target.value } as any;
                                      updateMeta("booleanChildren", { ...bc, false: arr } as any);
                                    }}
                                  />
                                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Reference sibling fields using {"{field_key}"} syntax.</p>
                                </div>
                              ) : null}
                              {child?.inputType === "currency" ? (
                                <div className="col-span-12 mt-2 grid gap-2 sm:grid-cols-2">
                                  <div className="grid gap-1">
                                    <Label>Currency Code</Label>
                                    <Input
                                      placeholder="e.g. HKD, USD"
                                      value={String((child as any)?.currencyCode ?? "")}
                                      onChange={(e) => {
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), currencyCode: e.target.value } as ChildFieldMeta;
                                        updateMeta("booleanChildren", { ...bc, false: arr });
                                      }}
                                    />
                                  </div>
                                  <div className="grid gap-1">
                                    <Label>Decimal Places</Label>
                                    <Input
                                      type="number"
                                      className="w-28"
                                      placeholder="2"
                                      value={String((child as any)?.decimals ?? 2)}
                                      onChange={(e) => {
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), decimals: Number(e.target.value) || 0 } as ChildFieldMeta;
                                        updateMeta("booleanChildren", { ...bc, false: arr });
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
                                      <Input placeholder="Yes" value={String((child as any)?.booleanLabels?.true ?? "")} onChange={(e) => {
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanLabels: { ...(arr[cIdx]?.booleanLabels ?? {}), true: e.target.value } } as ChildFieldMeta;
                                        updateMeta("booleanChildren", { ...bc, false: arr });
                                      }} />
                                    </div>
                                    <div className="grid gap-1">
                                      <Label>No Label</Label>
                                      <Input placeholder="No" value={String((child as any)?.booleanLabels?.false ?? "")} onChange={(e) => {
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanLabels: { ...(arr[cIdx]?.booleanLabels ?? {}), false: e.target.value } } as ChildFieldMeta;
                                        updateMeta("booleanChildren", { ...bc, false: arr });
                                      }} />
                                    </div>
                                    <div className="grid gap-1 sm:col-span-2">
                                      <Label>Display</Label>
                                      <div className="flex items-center gap-4 text-sm">
                                        <label className="inline-flex items-center gap-2">
                                          <input type="radio" checked={((child as any)?.booleanDisplay ?? "radio") === "radio"} onChange={() => {
                                            const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                            const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                            arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanDisplay: "radio" } as ChildFieldMeta;
                                            updateMeta("booleanChildren", { ...bc, false: arr });
                                          }} />
                                          Radio buttons
                                        </label>
                                        <label className="inline-flex items-center gap-2">
                                          <input type="radio" checked={(child as any)?.booleanDisplay === "dropdown"} onChange={() => {
                                            const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                            const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                            arr[cIdx] = { ...(arr[cIdx] ?? {}), booleanDisplay: "dropdown" } as ChildFieldMeta;
                                            updateMeta("booleanChildren", { ...bc, false: arr });
                                          }} />
                                          Dropdown
                                        </label>
                                      </div>
                                    </div>
                                  </div>
                                  {(["true", "false"] as const).map((branch) => {
                                    const branchLabel = branch === "true" ? "When YES" : "When NO";
                                    const branchChildren = (child as any)?.booleanChildren?.[branch] ?? [];
                                    const bArr = Array.isArray(branchChildren) ? branchChildren : [];
                                    return (
                                      <div key={branch} className="space-y-2 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                                        <div className="flex items-center justify-between">
                                          <Label className="text-xs">{branchLabel}</Label>
                                          <Button type="button" size="sm" variant="secondary" onClick={() => {
                                            const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                            const parentArr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                            const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                            const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                            inner.push({ label: "", inputType: "string" });
                                            boolCh[branch] = inner;
                                            parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                            updateMeta("booleanChildren", { ...bc, false: parentArr });
                                          }}>Add child</Button>
                                        </div>
                                        {bArr.map((bChild: any, bIdx: number) => (
                                          <div key={`no-bc-${cIdx}-${branch}-${bIdx}`} className="rounded border border-neutral-100 p-2 dark:border-neutral-800">
                                            <div className="mb-1 flex items-center justify-between">
                                              <span className="text-xs font-medium">Child #{bIdx + 1}</span>
                                              <Button type="button" size="sm" variant="outline" onClick={() => {
                                                const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                const parentArr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                                const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                inner.splice(bIdx, 1);
                                                boolCh[branch] = inner;
                                                parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                updateMeta("booleanChildren", { ...bc, false: parentArr });
                                              }}>Remove</Button>
                                            </div>
                                            <div className="grid grid-cols-12 gap-2">
                                              <div className="col-span-6">
                                                <Input placeholder="Label" value={String(bChild?.label ?? "")} onChange={(e) => {
                                                  const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                  const parentArr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                                  const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                  const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                  inner[bIdx] = { ...inner[bIdx], label: e.target.value };
                                                  boolCh[branch] = inner;
                                                  parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                  updateMeta("booleanChildren", { ...bc, false: parentArr });
                                                }} />
                                              </div>
                                              <div className="col-span-6">
                                                <select className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100" value={bChild?.inputType ?? "string"} onChange={(e) => {
                                                  const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                  const parentArr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                                  const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                  const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                  inner[bIdx] = { ...inner[bIdx], inputType: e.target.value };
                                                  boolCh[branch] = inner;
                                                  parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                  updateMeta("booleanChildren", { ...bc, false: parentArr });
                                                }}>
                                                  <option value="string">String</option>
                                                  <option value="number">Number</option>
                                                  <option value="currency">Currency</option>
                                                  <option value="date">Date</option>
                                                  <option value="select">Select</option>
                                                  <option value="multi_select">Multi Select</option>
                                                  <option value="formula">Formula</option>
                                                </select>
                                              </div>
                                              {bChild?.inputType === "currency" ? (
                                                <>
                                                  <div className="col-span-6"><Input placeholder="e.g. HKD" value={String(bChild?.currencyCode ?? "")} onChange={(e) => {
                                                    const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                    const parentArr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                                    const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                    const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                    inner[bIdx] = { ...inner[bIdx], currencyCode: e.target.value };
                                                    boolCh[branch] = inner;
                                                    parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                    updateMeta("booleanChildren", { ...bc, false: parentArr });
                                                  }} /></div>
                                                  <div className="col-span-6"><Input type="number" placeholder="2" value={String(bChild?.decimals ?? 2)} onChange={(e) => {
                                                    const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                                    const parentArr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                                    const boolCh: any = { ...((parentArr[cIdx] as any)?.booleanChildren ?? {}) };
                                                    const inner = Array.isArray(boolCh[branch]) ? [...boolCh[branch]] : [];
                                                    inner[bIdx] = { ...inner[bIdx], decimals: Number(e.target.value) };
                                                    boolCh[branch] = inner;
                                                    parentArr[cIdx] = { ...(parentArr[cIdx] ?? {}), booleanChildren: boolCh } as ChildFieldMeta;
                                                    updateMeta("booleanChildren", { ...bc, false: parentArr });
                                                  }} /></div>
                                                </>
                                              ) : null}
                                            </div>
                                          </div>
                                        ))}
                                        {bArr.length === 0 ? <p className="text-xs text-neutral-400">No children configured.</p> : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {String(child?.inputType ?? "") === "repeatable" ? (
                                <div className="col-span-12 mt-2 space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div className="grid gap-1">
                                      <Label>Item label</Label>
                                      <Input
                                        placeholder="Accessory"
                                        value={String((child?.repeatable?.itemLabel ?? ""))}
                                        onChange={(e) => {
                                          const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                          const rep = { ...(arr[cIdx]?.repeatable ?? {}) };
                                          rep.itemLabel = e.target.value;
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                          updateMeta("booleanChildren", { ...bc, false: arr });
                                        }}
                                      />
                                    </div>
                                    <div className="grid gap-1">
                                      <Label>Min</Label>
                                      <Input
                                        type="number"
                                        value={String((child?.repeatable?.min ?? 0))}
                                        onChange={(e) => {
                                          const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                          const rep = { ...(arr[cIdx]?.repeatable ?? {}) };
                                          rep.min = Number(e.target.value) || 0;
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                          updateMeta("booleanChildren", { ...bc, false: arr });
                                        }}
                                      />
                                    </div>
                                    <div className="grid gap-1">
                                      <Label>Max</Label>
                                      <Input
                                        type="number"
                                        value={String((child?.repeatable?.max ?? 0))}
                                        onChange={(e) => {
                                          const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                          const rep = { ...(arr[cIdx]?.repeatable ?? {}) };
                                          rep.max = Number(e.target.value) || 0;
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                          updateMeta("booleanChildren", { ...bc, false: arr });
                                        }}
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
                                        const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                        const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                        const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                        const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                        fields.push({ label: "", value: "", inputType: "string" });
                                        rep.fields = fields;
                                        arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                        updateMeta("booleanChildren", { ...bc, false: arr });
                                      }}
                                    >
                                      Add field
                                    </Button>
                                  </div>
                                  <div className="grid gap-2">
                                    {(((child?.repeatable?.fields ?? []) as any[]) ?? []).map((rf, rfi) => (
                                      <div key={`no-rep-${cIdx}-${rfi}`} className="grid grid-cols-12 items-center gap-2">
                                        <div className="col-span-4">
                                          <Input
                                            placeholder="Label"
                                            value={String(rf?.label ?? "")}
                                            onChange={(e) => {
                                              const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                              const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                              const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                              fields[rfi] = { ...(fields[rfi] ?? {}), label: e.target.value };
                                              rep.fields = fields;
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                              updateMeta("booleanChildren", { ...bc, false: arr });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-4">
                                          <Input
                                            placeholder="Value (key)"
                                            value={String(rf?.value ?? "")}
                                            onChange={(e) => {
                                              const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                              const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                              const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                              fields[rfi] = { ...(fields[rfi] ?? {}), value: e.target.value };
                                              rep.fields = fields;
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                              updateMeta("booleanChildren", { ...bc, false: arr });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-3">
                                          <select
                                            className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                                            value={String(rf?.inputType ?? "string")}
                                            onChange={(e) => {
                                              const nextType = e.target.value as InputType;
                                              const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                              const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                              const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                              fields[rfi] = {
                                                ...(fields[rfi] ?? {}),
                                                inputType: nextType,
                                                options: nextType === "select" || nextType === "multi_select" ? (fields[rfi]?.options ?? []) : undefined,
                                              };
                                              rep.fields = fields;
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                              updateMeta("booleanChildren", { ...bc, false: arr });
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
                                              const bc = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr: ChildFieldMeta[] = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                              const rep = { ...(arr[cIdx]?.repeatable ?? { fields: [] }) };
                                              const fields = Array.isArray(rep.fields) ? [...(rep.fields ?? [])] : [];
                                              fields.splice(rfi, 1);
                                              rep.fields = fields;
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), repeatable: rep };
                                              updateMeta("booleanChildren", { ...bc, false: arr });
                                            }}
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
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
                                          const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                          const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                          opts.push({ label: "", value: "" });
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                          updateMeta("booleanChildren", { ...bc, false: arr });
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
                                          const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                          const arr = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                          arr[cIdx] = { ...(arr[cIdx] ?? {}), options: parsed };
                                          updateMeta("booleanChildren", { ...bc, false: arr });
                                        }}
                                      >
                                        Import
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="grid gap-2">
                                    {(Array.isArray(child?.options) ? child?.options ?? [] : []).map((o, oi) => (
                                      <div key={oi} className="grid grid-cols-12 items-center gap-2">
                                        <div className="col-span-5">
                                          <Input
                                            placeholder="Label"
                                            value={o.label ?? ""}
                                            onChange={(e) => {
                                              const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                              const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                              opts[oi] = { ...(opts[oi] ?? {}), label: e.target.value };
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                              updateMeta("booleanChildren", { ...bc, false: arr });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-5">
                                          <Input
                                            placeholder="Value"
                                            value={o.value ?? ""}
                                            onChange={(e) => {
                                              const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                              const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                              opts[oi] = { ...(opts[oi] ?? {}), value: e.target.value };
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                              updateMeta("booleanChildren", { ...bc, false: arr });
                                            }}
                                          />
                                        </div>
                                        <div className="col-span-2 flex justify-end">
                                          <Button
                                            type="button"
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => {
                                              const bc: { true?: ChildFieldMeta[]; false?: ChildFieldMeta[] } = { ...((form.meta as FieldMeta | undefined)?.booleanChildren ?? {}) };
                                              const arr = Array.isArray(bc.false) ? [...(bc.false as ChildFieldMeta[])] : [];
                                              const opts = Array.isArray(arr[cIdx]?.options) ? [...(arr[cIdx]?.options ?? [])] : [];
                                              opts.splice(oi, 1);
                                              arr[cIdx] = { ...(arr[cIdx] ?? {}), options: opts };
                                              updateMeta("booleanChildren", { ...bc, false: arr });
                                            }}
                                          >
                                            Remove
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-1">
              <Label>Required</Label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(form.meta?.required)}
                  onChange={(e) => updateMeta("required", e.target.checked)}
                />
                Required
              </label>
            </div>
            <div className="grid gap-1">
              <Label>Categories</Label>
              <label className="mb-1 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                />
                Applies to all categories
              </label>
              {!applyToAll ? null : (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Uncheck above to select specific categories.</p>
              )}
              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${applyToAll ? "opacity-50 pointer-events-none" : ""}`}>
                {categoryOptions.map((opt) => {
                  const selected = Array.isArray(form.meta?.categories) ? form.meta!.categories!.includes(opt.value) : false;
                  return (
                    <label key={opt.value} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selected}
                        onChange={() => toggleCategory(opt.value)}
                      />
                      {opt.label}
                    </label>
                  );
                })}
                {categoryOptions.length === 0 ? (
                  <p className="col-span-2 text-xs text-neutral-500 dark:text-neutral-400">No categories found. Create categories first.</p>
                ) : null}
              </div>
            </div>
            {/* Sort Order input removed; ordering handled by group and in-dialog reordering */}
            <div className="grid gap-1">
              <Label>Groups (optional — select multiple)</Label>
              {existingGroupNames.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {existingGroupNames.map((name) => {
                    const current = getFieldGroups((form.meta as FieldMeta | undefined)?.group);
                    const checked = current.includes(name);
                    return (
                      <label key={name} className="inline-flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked ? current.filter((g) => g !== name) : [...current.filter(Boolean), name];
                            const val = next.filter(Boolean);
                            updateMeta("group", val.length === 0 ? "" : val.length === 1 ? val[0]! : val as any);
                          }}
                        />
                        {name}
                      </label>
                    );
                  })}
                </div>
              ) : null}
              <div className="flex items-center gap-1">
                <Input
                  placeholder="Add new group name"
                  value={customGroupMode ? (typeof (form.meta as FieldMeta | undefined)?.group === "string" && !(form.meta as FieldMeta | undefined)?.group ? "" : "") : ""}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (!val) return;
                      const current = getFieldGroups((form.meta as FieldMeta | undefined)?.group).filter(Boolean);
                      if (current.includes(val)) return;
                      const next = [...current, val];
                      updateMeta("group", next.length === 1 ? next[0]! : next as any);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
                <span className="text-[10px] text-neutral-500 dark:text-neutral-400 shrink-0">Enter to add</span>
              </div>
            </div>
            <div className="grid gap-1">
              <Label>Group Sort Order (optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="0"
                  value={String(((form.meta ?? {}) as FieldMeta).groupOrder ?? 0)}
                  onChange={(e) => updateMeta("groupOrder", Number(e.target.value) || 0)}
                  className="w-28"
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMeta(
                        "groupOrder",
                        Math.max(-1_000_000, Number((((form.meta ?? {}) as FieldMeta).groupOrder ?? 0) - 1)),
                      )
                    }
                  >
                    -1
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMeta(
                        "groupOrder",
                        Math.min(1_000_000, Number((((form.meta ?? {}) as FieldMeta).groupOrder ?? 0) + 1)),
                      )
                    }
                  >
                    +1
                  </Button>
                </div>
              </div>
              {(() => {
                const cGroups = getFieldGroups((form.meta as FieldMeta | undefined)?.group).filter(Boolean);
                if (cGroups.length === 0) return null;
                const meta = form.meta as (FieldMeta & { groupShowWhenMap?: Record<string, any> }) | undefined;
                return cGroups.map((gName) => (
                  <GroupShowWhenConfig
                    key={gName}
                    groupLabel={gName}
                    value={meta?.groupShowWhenMap?.[gName] ?? (cGroups.length === 1 ? (meta?.groupShowWhen ?? null) : null)}
                    onChange={(next) => {
                      const map = { ...(meta?.groupShowWhenMap ?? {}), [gName]: next as any };
                      updateMeta("groupShowWhenMap", map as any);
                    }}
                    fields={rows as any}
                    excludeFieldId={editing?.id}
                  />
                ));
              })()}
              {(() => {
                const fieldGroups = getFieldGroups((form.meta as FieldMeta | undefined)?.group);
                const primaryGroup = fieldGroups.find(Boolean) ?? "";
                const rawMembers = rows
                  .filter((r) => getFieldGroups((r.meta as FieldMeta | null)?.group).includes(primaryGroup))
                  .sort(sortBySortOrderStable);
                const members = rawMembers.map((r) =>
                  editing && r.id === editing.id
                    ? {
                        ...r,
                        label: String(form.label ?? r.label),
                        sortOrder: toInt(form.sortOrder ?? r.sortOrder ?? 0, 0),
                      }
                    : r
                );
                if (!primaryGroup) return null;
                return (
                  <div className="mt-2 w-full overflow-x-auto rounded-md border border-neutral-200 p-1.5 sm:p-2 text-xs dark:border-neutral-800">
                    <div className="mb-1 font-medium">Current group: {primaryGroup}</div>
                    {members.length === 0 ? (
                      <div className="text-neutral-500 dark:text-neutral-400">No other members yet.</div>
                    ) : (
                      <ul className="grid gap-1">
                        {members.map((m, i) => {
                          const canUp = i > 0;
                          const canDown = i < members.length - 1;
                          return (
                            <li key={m.id} className="relative flex min-h-[28px] flex-wrap items-center justify-between gap-1 sm:gap-2">
                              <span className="min-w-0 flex-1 truncate pr-10 sm:pr-0">{m.label}</span>
                              <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 sm:static sm:right-auto sm:top-auto sm:translate-y-0 sm:gap-2">
                                <span className="font-mono">sort {m.sortOrder}</span>
                                <div className="flex gap-1">
                                  <Button
                                    type="button"
                                    size="iconCompact"
                                    variant="outline"
                                    disabled={!canUp}
                                    onClick={() => moveWithinGroup(m.id, "up")}
                                    title="Move up"
                                  >
                                    <ChevronUp className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="iconCompact"
                                    variant="outline"
                                    disabled={!canDown}
                                    onClick={() => moveWithinGroup(m.id, "down")}
                                    title="Move down"
                                  >
                                    <ChevronDown className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })()}
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
            <Button variant="outline" onClick={() => setOpen(false)} className="inline-flex items-center gap-2">
              <X className="h-4 w-4 sm:hidden lg:inline" />
              <span className="hidden sm:inline">Cancel</span>
            </Button>
            <Button onClick={save} className="inline-flex items-center gap-2">
              <Save className="h-4 w-4 sm:hidden lg:inline" />
              <span className="hidden sm:inline">{editing ? "Save" : "Create"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!confirmDeleteGroup} onOpenChange={(v) => { if (!v) setConfirmDeleteGroup(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Group</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Are you sure you want to delete the group <strong>&quot;{confirmDeleteGroup}&quot;</strong>?
            All {groups.find((g) => g.name === confirmDeleteGroup)?.count ?? 0} field(s) will be moved to &quot;(no group)&quot;.
            The fields themselves will not be deleted.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteGroup(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDeleteGroup) {
                  void deleteGroup(confirmDeleteGroup);
                  setConfirmDeleteGroup(null);
                }
              }}
            >
              Delete Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Copy Fields from Another Package</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 flex-1 overflow-hidden">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              Select a package and choose which fields to copy into <strong>{pkg}</strong>. Fields that already exist will not appear.
            </p>
            <div className="grid gap-1">
              <Label>Source Package</Label>
              <select
                value={copySourcePkg}
                onChange={(e) => loadSourceFields(e.target.value)}
                className="flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
              >
                <option value="">-- Select a package --</option>
                {availablePackages.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {loadingSourceFields && (
              <p className="text-xs text-neutral-400">Loading fields...</p>
            )}

            {copySourcePkg && !loadingSourceFields && copySourceFields.length === 0 && (
              <p className="text-xs text-neutral-500">All fields from this package already exist or the package has no fields.</p>
            )}

            {copySourceFields.length > 0 && (
              <div className="flex flex-col gap-2 overflow-hidden">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{copySelectedKeys.size} of {copySourceFields.length} selected</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => setCopySelectedKeys(new Set(copySourceFields.map((f) => f.value)))}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => setCopySelectedKeys(new Set())}
                    >
                      Deselect all
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto max-h-52 border rounded-md dark:border-neutral-700">
                  {copySourceFields.map((f) => (
                    <label
                      key={f.value}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer border-b last:border-b-0 dark:border-neutral-700"
                    >
                      <input
                        type="checkbox"
                        checked={copySelectedKeys.has(f.value)}
                        onChange={(e) => {
                          setCopySelectedKeys((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(f.value);
                            else next.delete(f.value);
                            return next;
                          });
                        }}
                        className="rounded border-neutral-300 dark:border-neutral-600"
                      />
                      <span className="text-sm">{f.label}</span>
                      <span className="text-xs text-neutral-400 ml-auto">{f.value}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCopyFields} disabled={!copySourcePkg || copySelectedKeys.size === 0 || copying}>
              {copying ? "Copying..." : `Copy ${copySelectedKeys.size} Field${copySelectedKeys.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}



