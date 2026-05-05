"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { toast } from "sonner";
import { extractDisplayName } from "@/lib/import/entity-display-name";

type RecordRow = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
  carExtra?: Record<string, unknown> | null;
};

export type EntityPickerSelection = {
  policyId: number;
  policyNumber: string;
  extraAttributes: Record<string, unknown>;
  agent?: { id: number; userNumber?: string | null; name?: string | null; email?: string } | null;
};

interface EntityPickerDrawerProps {
  open: boolean;
  onClose: () => void;
  flowKey: string;
  title: string;
  onSelect: (selection: EntityPickerSelection) => void;
}

export function EntityPickerDrawer({
  open,
  onClose,
  flowKey,
  title,
  onSelect,
}: EntityPickerDrawerProps) {
  const [rows, setRows] = React.useState<RecordRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [selecting, setSelecting] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open || !flowKey) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/policies?flow=${encodeURIComponent(flowKey)}&limit=500`,
          { cache: "no-store" },
        );
        const json = res.ok ? await res.json() : null;
        const list: RecordRow[] = Array.isArray(json)
          ? (json as RecordRow[])
          : Array.isArray(json?.rows)
            ? (json.rows as RecordRow[])
            : [];
        if (!cancelled) {
          setRows(
            list.filter((r) => Number.isFinite(r.policyId) && r.policyId > 0),
          );
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [open, flowKey]);

  React.useEffect(() => {
    if (!open) {
      setSearch("");
      setSelecting(null);
    }
  }, [open]);

  const enrichedRows = React.useMemo(
    () => rows.map((r) => ({ ...r, displayName: extractDisplayName(r.carExtra) })),
    [rows],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return enrichedRows;
    return enrichedRows.filter(
      (r) =>
        r.policyNumber.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q),
    );
  }, [enrichedRows, search]);

  async function handleSelect(policyId: number) {
    setSelecting(policyId);
    try {
      const res = await fetch(`/api/policies/${policyId}?_t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        toast.error("Failed to load record");
        return;
      }
      const detail = (await res.json()) as {
        policyId: number;
        policyNumber?: string;
        extraAttributes?: Record<string, unknown> | null;
        agent?: { id: number; userNumber?: string | null; name?: string | null; email?: string } | null;
      };
      onSelect({
        policyId: detail.policyId,
        policyNumber: detail.policyNumber ?? String(detail.policyId),
        extraAttributes: (detail.extraAttributes ?? {}) as Record<string, unknown>,
        agent: detail.agent ?? null,
      });
      onClose();
    } catch {
      toast.error("Failed to load record details");
    } finally {
      setSelecting(null);
    }
  }

  return (
    <SlideDrawer open={open} onClose={onClose} title={title} side="left" zClass="z-[60]">
      <div className="flex h-full flex-col gap-3 p-4">
        <Input
          placeholder="Search by name or record number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-md border border-neutral-200 dark:border-neutral-800">
          {loading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-5/6" />
              <Skeleton className="h-6 w-4/6" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-3 text-sm text-neutral-500 dark:text-neutral-400">
              No records found.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {filtered.map((r) => (
                <li
                  key={r.policyId}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    {r.displayName && (
                      <div className="text-xs font-medium wrap-break-word">{r.displayName}</div>
                    )}
                    <div className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
                      {r.policyNumber}
                    </div>
                    <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleDateString()
                        : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={selecting === r.policyId}
                    onClick={() => void handleSelect(r.policyId)}
                  >
                    {selecting === r.policyId ? "Loading…" : "Select"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SlideDrawer>
  );
}
