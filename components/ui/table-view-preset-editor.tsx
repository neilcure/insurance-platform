"use client";

/**
 * `TableViewPresetEditor` — the unified "Edit View" / "New View" / "Set Up
 * Columns" dialog used by every dashboard table.
 *
 * Layout:
 *   ┌──────────────────────────────────────┐
 *   │  View Name                           │
 *   │  [optional] Sort By + Direction      │
 *   │  Columns (n / max)                   │
 *   │   - draft list with up/down/remove   │
 *   │   - grouped checkbox list of options │
 *   │  [optional] Set as default checkbox  │
 *   │  [optional] Saved Views panel        │
 *   └──────────────────────────────────────┘
 *
 * The component is layout-only — it renders against caller-provided draft
 * state. Persistence is the caller's responsibility (typically via
 * `useTableViewPresets`).
 *
 * See `.cursor/skills/table-view-presets/SKILL.md`.
 */

import * as React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CompactSelect } from "@/components/ui/compact-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  ViewPreset,
  ViewPresetColumnGroup,
} from "@/lib/view-presets/types";

export type TableViewPresetEditorSortControls = {
  options: Array<{ value: string; label: string }>;
  sortKey: string;
  setSortKey: (key: string) => void;
  sortDir: "asc" | "desc";
  setSortDir: (dir: "asc" | "desc") => void;
};

export type TableViewPresetEditorDefaultToggle = {
  isDefault: boolean;
  setIsDefault: (value: boolean) => void;
};

export type TableViewPresetEditorSavedViews = {
  presets: ViewPreset[];
  onEdit: (preset: ViewPreset) => void;
  onDelete: (id: string) => void;
  onSetDefault?: (id: string) => void;
};

export type TableViewPresetEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` when creating a new preset. */
  editing: ViewPreset | null;

  draftName: string;
  setDraftName: (name: string) => void;
  draftColumns: string[];
  setDraftColumns: React.Dispatch<React.SetStateAction<string[]>>;

  /** Hard cap on selected columns. Omit for no limit. */
  maxColumns?: number;
  /** Label resolver for selected-column rows. Defaults to a humanised
   *  version of the path. */
  getSelectedLabel?: (path: string) => string;

  /** Per-preset sort controls. Omit if the table doesn't store sort on the
   *  preset (e.g. PoliciesTable derives sort from the active columns). */
  sortControls?: TableViewPresetEditorSortControls;

  /** "Set as default" checkbox. Omit when the editor is the only entry
   *  point and the default flag is implicit (first preset becomes default). */
  defaultToggle?: TableViewPresetEditorDefaultToggle;

  /** Available columns shown in the picker, grouped by source. Tables with
   *  no meaningful grouping should pass a single group. */
  columnGroups: ViewPresetColumnGroup[];

  /** Optional in-dialog list of saved views with edit/delete/set-default. */
  savedViewsPanel?: TableViewPresetEditorSavedViews;

  onSave: () => void;
  /** Disable the save button (e.g. when no columns selected). */
  saveDisabled?: boolean;

  newTitle?: string;
  editTitle?: string;
  saveLabel?: string;
  updateLabel?: string;
};

function defaultHumanise(path: string): string {
  const parts = path.split(".");
  const raw = parts[parts.length - 1] ?? path;
  const stripped = raw
    .replace(/^[a-zA-Z0-9]+__/, "")
    .replace(/^_+/, "")
    .replace(/__+/g, " ")
    .replace(/_+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return stripped.replace(/\b\w/g, (c) => c.toUpperCase()).trim() || path;
}

export function TableViewPresetEditor({
  open,
  onOpenChange,
  editing,
  draftName,
  setDraftName,
  draftColumns,
  setDraftColumns,
  maxColumns,
  getSelectedLabel,
  sortControls,
  defaultToggle,
  columnGroups,
  savedViewsPanel,
  onSave,
  saveDisabled,
  newTitle = "New View",
  editTitle = "Edit View",
  saveLabel = "Save View",
  updateLabel = "Update View",
}: TableViewPresetEditorProps) {
  const labelFor = React.useCallback(
    (path: string): string => {
      if (getSelectedLabel) return getSelectedLabel(path);
      for (const group of columnGroups) {
        const opt = group.options.find((o) => o.path === path);
        if (opt) return opt.selectedLabel ?? opt.label;
      }
      return defaultHumanise(path);
    },
    [getSelectedLabel, columnGroups],
  );

  function moveColumn(index: number, direction: "up" | "down") {
    setDraftColumns((prev) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeColumn(path: string) {
    setDraftColumns((prev) => prev.filter((p) => p !== path));
  }

  function toggleColumn(path: string) {
    setDraftColumns((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path);
      if (maxColumns !== undefined && prev.length >= maxColumns) return prev;
      return [...prev, path];
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? editTitle : newTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>View Name</Label>
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. My Default View"
            />
          </div>

          {sortControls ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Sort By</Label>
                <CompactSelect
                  options={sortControls.options}
                  value={sortControls.sortKey}
                  onChange={sortControls.setSortKey}
                  maxWidth="100%"
                />
              </div>
              <div className="grid gap-2">
                <Label>Direction</Label>
                <CompactSelect
                  options={[
                    { value: "asc", label: "Ascending" },
                    { value: "desc", label: "Descending" },
                  ]}
                  value={sortControls.sortDir}
                  onChange={(v) =>
                    sortControls.setSortDir(v === "asc" ? "asc" : "desc")
                  }
                  maxWidth="100%"
                />
              </div>
            </div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-sm font-medium">
                Columns{" "}
                <span className="font-normal text-neutral-400">
                  ({draftColumns.length}
                  {maxColumns !== undefined ? `/${maxColumns}` : ""})
                </span>
              </Label>
              {draftColumns.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setDraftColumns([])}
                >
                  Clear all
                </Button>
              ) : null}
            </div>

            {draftColumns.length > 0 ? (
              <div className="mb-3 space-y-1">
                {draftColumns.map((path, i) => (
                  <div
                    key={path}
                    className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    <span className="w-4 text-center text-[10px] font-medium text-neutral-400">
                      {i + 1}
                    </span>
                    <span className="flex-1">{labelFor(path)}</span>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => moveColumn(i, "up")}
                      className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 disabled:opacity-20 dark:hover:text-neutral-200"
                      title="Move up"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={i === draftColumns.length - 1}
                      onClick={() => moveColumn(i, "down")}
                      className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 disabled:opacity-20 dark:hover:text-neutral-200"
                      title="Move down"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeColumn(path)}
                      className="rounded p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="max-h-80 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700">
              {columnGroups.map((group) => (
                <div key={group.groupKey}>
                  {columnGroups.length > 1 || group.groupLabel ? (
                    <div className="sticky top-0 border-b border-neutral-100 bg-neutral-50 px-3 py-1.5 text-xs font-semibold text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
                      {group.groupLabel}
                    </div>
                  ) : null}
                  {group.options.map((opt) => {
                    const checked = draftColumns.includes(opt.path);
                    const disabled =
                      !checked &&
                      maxColumns !== undefined &&
                      draftColumns.length >= maxColumns;
                    return (
                      <label
                        key={opt.path}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50",
                          disabled && "cursor-not-allowed opacity-40",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleColumn(opt.path)}
                          className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600"
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {defaultToggle ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={defaultToggle.isDefault}
                onChange={(e) => defaultToggle.setIsDefault(e.target.checked)}
              />
              Set as default
            </label>
          ) : null}

          {savedViewsPanel && savedViewsPanel.presets.length > 0 ? (
            <div>
              <Label className="mb-1 block text-sm font-medium">
                Saved Views
              </Label>
              <div className="space-y-1">
                {savedViewsPanel.presets.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.isDefault && (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                          Default
                        </span>
                      )}
                      <span className="text-xs text-neutral-400">
                        {p.columns.length} cols
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {!p.isDefault && savedViewsPanel.onSetDefault ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[11px]"
                          onClick={() => savedViewsPanel.onSetDefault?.(p.id)}
                        >
                          Set Default
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px]"
                        onClick={() => {
                          onOpenChange(false);
                          setTimeout(() => savedViewsPanel.onEdit(p), 150);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px] text-red-500 hover:text-red-600"
                        onClick={() => savedViewsPanel.onDelete(p.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={saveDisabled || draftColumns.length === 0}
          >
            {editing ? updateLabel : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
