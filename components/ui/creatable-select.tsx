"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type CreatableSelectOption = {
  label?: string;
  value?: string;
};

type Props = {
  options: CreatableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  onCreateOption: (label: string) => Promise<CreatableSelectOption | null>;
  onRemoveOption?: (value: string) => Promise<boolean>;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

export function CreatableSelect({
  options,
  value,
  onChange,
  onCreateOption,
  onRemoveOption,
  placeholder = "-- Select --",
  required,
  disabled,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [confirmAdd, setConfirmAdd] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<{ value: string; label: string } | null>(null);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase().trim();
    return options.filter(
      (o) =>
        (o.label ?? "").toLowerCase().includes(q) ||
        (o.value ?? "").toLowerCase().includes(q),
    );
  }, [options, search]);

  const exactMatch = React.useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return options.some(
      (o) =>
        (o.label ?? "").toLowerCase() === q ||
        (o.value ?? "").toLowerCase() === q,
    );
  }, [options, search]);

  const selectedLabel = React.useMemo(() => {
    if (!value) return "";
    const match = options.find((o) => o.value === value);
    return match?.label ?? value;
  }, [options, value]);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !confirmAdd &&
        !confirmRemove
      ) {
        setOpen(false);
        setSearch("");
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open, confirmAdd, confirmRemove]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setSearch("");
  };

  const handleCreateConfirmed = async () => {
    const label = confirmAdd;
    if (!label || creating) return;
    setCreating(true);
    try {
      const created = await onCreateOption(label);
      if (created?.value) {
        onChange(created.value);
        setOpen(false);
        setSearch("");
      }
    } finally {
      setCreating(false);
      setConfirmAdd(null);
    }
  };

  const handleRemoveConfirmed = async () => {
    if (!confirmRemove || !onRemoveOption || removing) return;
    const optValue = confirmRemove.value;
    setRemoving(optValue);
    try {
      const ok = await onRemoveOption(optValue);
      if (ok && value === optValue) {
        onChange("");
      }
    } finally {
      setRemoving(null);
      setConfirmRemove(null);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="flex h-10 w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 text-left text-sm text-neutral-900 outline-none transition-colors dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <span className={value ? "" : "text-neutral-500 dark:text-neutral-400"}>
          {value ? selectedLabel : placeholder}
        </span>
        <svg className="h-4 w-4 shrink-0 opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 p-1.5 dark:border-neutral-700">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !exactMatch && search.trim()) {
                  e.preventDefault();
                  setConfirmAdd(search.trim());
                } else if (e.key === "Escape") {
                  setOpen(false);
                  setSearch("");
                }
              }}
              placeholder="Type to search or add..."
              className="h-8 w-full rounded border-0 bg-neutral-50 px-2 text-sm outline-none dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {!required && (
              <button
                type="button"
                onClick={() => handleSelect("")}
                className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                {placeholder}
              </button>
            )}
            {filtered.map((o) => (
              <div
                key={o.value}
                className={`group flex w-full items-center rounded transition-colors ${
                  o.value === value
                    ? "bg-neutral-100 font-medium dark:bg-neutral-800"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelect(o.value ?? "")}
                  className="flex-1 px-2 py-1.5 text-left text-sm dark:text-neutral-100"
                >
                  {o.label ?? o.value}
                </button>
                {onRemoveOption && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmRemove({ value: o.value ?? "", label: o.label ?? o.value ?? "" });
                    }}
                    className="mr-1 hidden rounded p-0.5 text-neutral-400 hover:bg-red-100 hover:text-red-600 group-hover:inline-flex dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    title="Remove option"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {filtered.length === 0 && exactMatch && (
              <p className="px-2 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                No options found.
              </p>
            )}
            {!exactMatch && search.trim() && (
              <button
                type="button"
                disabled={creating}
                onClick={() => setConfirmAdd(search.trim())}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
              >
                <Plus className="h-3.5 w-3.5" />
                {`Add "${search.trim()}"`}
              </button>
            )}
          </div>
        </div>
      )}

      {required && <input type="hidden" value={value} required />}

      {/* Confirm Add Dialog */}
      <Dialog open={!!confirmAdd} onOpenChange={(v) => { if (!v) setConfirmAdd(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add new option</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Are you sure you want to add <strong className="text-neutral-900 dark:text-neutral-100">&ldquo;{confirmAdd}&rdquo;</strong> as
            a new option? This will be available to all users.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmAdd(null)} disabled={creating}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleCreateConfirmed()} disabled={creating}>
              {creating ? "Adding..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Remove Dialog */}
      <Dialog open={!!confirmRemove} onOpenChange={(v) => { if (!v) setConfirmRemove(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove option</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Are you sure you want to remove <strong className="text-neutral-900 dark:text-neutral-100">&ldquo;{confirmRemove?.label}&rdquo;</strong>?
            This will remove it from the list for all users.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmRemove(null)} disabled={!!removing}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleRemoveConfirmed()} disabled={!!removing}>
              {removing ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
