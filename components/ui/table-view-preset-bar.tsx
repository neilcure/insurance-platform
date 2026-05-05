"use client";

/**
 * `TableViewPresetBar` — the right-aligned strip every dashboard table puts
 * above its rows: a "Saved Views" dropdown (current view), an "Edit" button
 * for the active preset, and a "New View" / "Set Up Columns" button.
 *
 * The bar is layout-only. All preset state must come from
 * `useTableViewPresets`. Sort controls (CompactSelect + Asc/Desc) are
 * deliberately rendered by the caller because they are table-specific.
 *
 * See `.cursor/skills/table-view-presets/SKILL.md`.
 */

import * as React from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { ViewPreset } from "@/lib/view-presets/types";

export type TableViewPresetBarProps = {
  presets: ViewPreset[];
  activePresetId: string | null;
  activePreset: ViewPreset | null;
  onSelect: (id: string) => void;
  onEditActive: () => void;
  onNew: () => void;
  emptySetupLabel?: string;
  newLabel?: string;
  className?: string;
};

export function TableViewPresetBar({
  presets,
  activePresetId,
  activePreset,
  onSelect,
  onEditActive,
  onNew,
  emptySetupLabel = "Set Up View",
  newLabel = "New View",
  className,
}: TableViewPresetBarProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-sm">
        {presets.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-auto max-w-20 flex-col gap-0 py-1 sm:h-9 sm:max-w-none sm:flex-row sm:gap-1.5 sm:py-0"
              >
                <span className="truncate text-[9px] leading-tight sm:text-xs">
                  {activePreset?.name ?? "View"}
                </span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Saved Views</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {presets.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p.id}
                  checked={activePresetId === p.id}
                  onCheckedChange={() => onSelect(p.id)}
                  onSelect={(e) => e.preventDefault()}
                >
                  <span className="flex-1">{p.name}</span>
                  {p.isDefault && (
                    <span className="ml-1 text-[10px] text-neutral-400">
                      default
                    </span>
                  )}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {activePreset ? (
          <Button
            variant="outline"
            size="sm"
            className="h-auto flex-col gap-0 py-1 sm:h-9 sm:flex-row sm:gap-1 sm:py-0"
            onClick={onEditActive}
          >
            <span className="text-[9px] leading-tight sm:hidden">Edit</span>
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="h-auto flex-col gap-0 py-1 sm:h-9 sm:flex-row sm:gap-1.5 sm:py-0"
          onClick={onNew}
        >
          <span className="text-[9px] leading-tight sm:hidden">
            {presets.length === 0 ? "Set Up" : "New"}
          </span>
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline">
            {presets.length === 0 ? emptySetupLabel : newLabel}
          </span>
        </Button>
      </div>
    </div>
  );
}
