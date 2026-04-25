"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getAllIcons, getIconFull } from "@/lib/icons-full";
import { getPopularIconNames } from "@/lib/icons";

const MAX_GRID = 60;

function SelectedIconPreview({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm dark:border-neutral-700">
      {React.createElement(getIconFull(name), { className: "h-4 w-4 shrink-0" })}
      <span className="font-mono text-xs text-neutral-600 dark:text-neutral-400">{name}</span>
    </div>
  );
}

export function IconPicker({
  value,
  onChange,
  label = "Sidebar Icon",
}: {
  value?: string;
  onChange: (name: string) => void;
  label?: string;
}) {
  const [search, setSearch] = React.useState("");
  const allIcons = React.useMemo(() => getAllIcons(), []);
  const popularNames = React.useMemo(() => getPopularIconNames(), []);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      const popular = popularNames
        .map((name) => allIcons.find((i) => i.kebab === name))
        .filter(Boolean) as typeof allIcons;
      return popular;
    }
    return allIcons.filter((i) => i.kebab.includes(q)).slice(0, MAX_GRID);
  }, [search, allIcons, popularNames]);

  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {value && <SelectedIconPreview name={value} />}
      <Input
        placeholder="Search 1400+ icons..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto rounded-md border border-neutral-200 p-1 sm:grid-cols-8 dark:border-neutral-700">
        {filtered.map((opt) => (
          <button
            key={opt.kebab}
            type="button"
            title={opt.kebab}
            onClick={() => onChange(opt.kebab)}
            className={cn(
              "flex items-center justify-center rounded-md border p-2 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800",
              value === opt.kebab
                ? "border-blue-500 bg-blue-50 text-blue-600 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-400"
                : "border-transparent",
            )}
          >
            <opt.icon className="h-4 w-4" />
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-8 py-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
            No icons match &quot;{search}&quot;
          </p>
        )}
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {search ? `${filtered.length} results` : "Popular icons — type to search all"}.
        Default: folder.
      </p>
    </div>
  );
}
