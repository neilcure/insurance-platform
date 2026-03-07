"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, X } from "lucide-react";

export function GroupAssignmentSection({
  currentGroups,
  existingGroupNames,
  groupOrder,
  onGroupChange,
  onOrderChange,
}: {
  currentGroups: string[];
  existingGroupNames: string[];
  groupOrder: number;
  onGroupChange: (next: string[]) => void;
  onOrderChange: (v: number) => void;
}) {
  const [creatingNew, setCreatingNew] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState("");
  const selectCls =
    "h-8 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  const unselected = existingGroupNames.filter((n) => !currentGroups.includes(n));

  function commitRename(oldName: string) {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== oldName) {
      onGroupChange(currentGroups.map((n) => (n === oldName ? trimmed : n)));
    }
    setEditingGroup(null);
  }

  return (
    <div className="grid gap-1">
      <Label className="text-xs">Groups (optional)</Label>
      <p className="text-xs text-neutral-500">Assign this field to one or more visual groups.</p>
      {currentGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 py-1">
          {currentGroups.map((g) =>
            editingGroup === g ? (
              <Input
                key={g}
                autoFocus
                className="h-7 w-40 text-xs"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(g);
                  }
                  if (e.key === "Escape") setEditingGroup(null);
                }}
                onBlur={() => commitRename(g)}
              />
            ) : (
              <span
                key={g}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-800"
              >
                {g}
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
                  onClick={() => {
                    setEditValue(g);
                    setEditingGroup(g);
                  }}
                  title={`Rename "${g}"`}
                >
                  <Pencil className="h-2.5 w-2.5" />
                </button>
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
                  onClick={() => onGroupChange(currentGroups.filter((n) => n !== g))}
                  title={`Remove from "${g}"`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ),
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        {!creatingNew ? (
          <select
            className={selectCls}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__new__") {
                setCreatingNew(true);
                return;
              }
              if (v && !currentGroups.includes(v)) {
                onGroupChange([...currentGroups, v]);
              }
            }}
          >
            <option value="">— Select group to add —</option>
            {unselected.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value="__new__">+ Create new group…</option>
          </select>
        ) : (
          <Input
            autoFocus
            placeholder="New group name — Enter to add, Esc to cancel"
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const val = (e.target as HTMLInputElement).value.trim();
                if (val && !currentGroups.includes(val)) {
                  onGroupChange([...currentGroups, val]);
                }
                setCreatingNew(false);
              }
              if (e.key === "Escape") {
                setCreatingNew(false);
              }
            }}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val && !currentGroups.includes(val)) {
                onGroupChange([...currentGroups, val]);
              }
              setCreatingNew(false);
            }}
          />
        )}
      </div>
      {currentGroups.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Label className="shrink-0 text-xs text-neutral-500">Sort Order</Label>
          <Input
            type="number"
            placeholder="0"
            value={String(groupOrder)}
            onChange={(e) => onOrderChange(Number(e.target.value) || 0)}
            className="h-7 w-20 text-xs"
          />
        </div>
      )}
    </div>
  );
}
