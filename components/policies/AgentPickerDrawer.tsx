"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { toast } from "sonner";

type AgentRow = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  isActive: boolean;
  hasCompletedSetup?: boolean;
};

export type AgentPickerSelection = {
  id: number;
  userNumber: string | null;
  name: string | null;
  email: string;
};

interface AgentPickerDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (agent: AgentPickerSelection) => void;
}

export function AgentPickerDrawer({
  open,
  onClose,
  onSelect,
}: AgentPickerDrawerProps) {
  const [rows, setRows] = React.useState<AgentRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/agents?limit=500", { cache: "no-store" });
        const raw = res.ok ? await res.json() : null;
        const json: AgentRow[] = Array.isArray(raw)
          ? (raw as AgentRow[])
          : Array.isArray(raw?.rows)
            ? (raw.rows as AgentRow[])
            : [];
        if (!cancelled) {
          // Show every valid agent including ones who haven't completed the
          // invite flow yet — they're still a legitimate assignment target
          // (e.g. admin pre-assigns work before the agent accepts the
          // invite). The "Setup Pending" badge below makes the state
          // visible, and the warning toast on Select makes it explicit.
          setRows(json.filter((r) => Number.isFinite(r.id) && r.id > 0));
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [open]);

  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.userNumber ?? "").toLowerCase().includes(q) ||
        (r.name ?? "").toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q),
    );
  }, [rows, search]);

  function handleSelect(r: AgentRow) {
    onSelect({
      id: r.id,
      userNumber: r.userNumber,
      name: r.name,
      email: r.email,
    });
    if (r.hasCompletedSetup === false) {
      toast.warning(
        `${r.name ?? r.email ?? "Agent"} hasn't activated their account yet.`,
        {
          description:
            "Selected — click the action button to apply. They'll see this work once they accept the invite.",
        },
      );
    } else if (r.isActive === false) {
      toast.warning(
        `${r.name ?? r.email ?? "Agent"}'s account is disabled.`,
        {
          description:
            "Selected — click the action button to apply. They won't see assignments until reactivated.",
        },
      );
    }
    onClose();
  }

  return (
    <SlideDrawer open={open} onClose={onClose} title="Select Agent" side="left" zClass="z-[60]">
      <div className="flex h-full flex-col gap-3 p-4">
        <Input
          placeholder="Search by name, number, or email…"
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
              No agents found.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {filtered.map((r) => {
                const isPending = r.hasCompletedSetup === false;
                const isInactive = r.isActive === false && !isPending;
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium">
                          {r.name ?? "—"}
                        </span>
                        {isPending && (
                          <span
                            className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            title="Account created but the agent has not completed the invite flow yet."
                          >
                            Setup Pending
                          </span>
                        )}
                        {isInactive && (
                          <span
                            className="inline-flex shrink-0 items-center rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                            title="Agent account is disabled."
                          >
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">
                        {r.userNumber ?? "—"}
                      </div>
                      <div className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                        {r.email}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0"
                      onClick={() => handleSelect(r)}
                    >
                      Select
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </SlideDrawer>
  );
}
