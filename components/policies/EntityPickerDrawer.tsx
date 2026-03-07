"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SlideDrawer } from "@/components/ui/slide-drawer";
import { toast } from "sonner";

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
};

function norm(k: string): string {
  return k.replace(/^[a-zA-Z0-9]+__?/, "").toLowerCase().replace(/[^a-z]/g, "");
}

const SKIP_KEYS = /district|area|region|street|block|floor|flat|room|address|city|state|zip|postal|country|phone|tel|fax|mobile|email|account|number|date|remark|note|memo/;

function extractDisplayName(carExtra: Record<string, unknown> | null | undefined): string {
  if (!carExtra) return "";
  const pkgs = (carExtra.packagesSnapshot ?? {}) as Record<string, unknown>;

  for (const [pkgKey, data] of Object.entries(pkgs)) {
    if (!data || typeof data !== "object") continue;
    const structured = data as { values?: Record<string, unknown> };
    const vals = structured.values ?? (data as Record<string, unknown>);
    if (!vals || typeof vals !== "object") continue;

    let firstName = "", lastName = "";
    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (!lastName && /lastname|surname|lname/.test(n)) lastName = s;
      if (!firstName && /firstname|fname/.test(n)) firstName = s;
    }
    if (firstName || lastName) return [lastName, firstName].filter(Boolean).join(" ");

    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (/companyname|organisationname|orgname|corporatename|firmname/.test(n)) return s;
    }

    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (/fullname|displayname|^name$|title|label/.test(n)) return s;
    }

    // Match field key that equals or ends with the package key itself
    // e.g., pkg="collaborator" matches key "collaborator__collaborator"
    const pkgNorm = pkgKey.toLowerCase().replace(/[^a-z]/g, "");
    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s || typeof v !== "string") continue;
      if (n === pkgNorm && s.length > 1 && !SKIP_KEYS.test(n)) return s;
    }

    // Match any key containing "name" or "broker" or "agent" or "company" or "insurer"
    for (const [k, v] of Object.entries(vals)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s || typeof v !== "string") continue;
      if (/name|broker|agent|company|insurer|vendor|supplier|partner/.test(n) && !SKIP_KEYS.test(n)) return s;
    }
  }

  const insured = (carExtra.insuredSnapshot ?? null) as Record<string, unknown> | null;
  if (insured) {
    for (const [k, v] of Object.entries(insured)) {
      const n = norm(k), s = String(v ?? "").trim();
      if (!s) continue;
      if (/companyname|fullname|^name$|organisationname/.test(n)) return s;
    }
  }
  return "";
}

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
          `/api/policies?flow=${encodeURIComponent(flowKey)}`,
          { cache: "no-store" },
        );
        const json = res.ok ? ((await res.json()) as RecordRow[]) : [];
        if (!cancelled) {
          setRows(
            (Array.isArray(json) ? json : []).filter(
              (r) => Number.isFinite(r.policyId) && r.policyId > 0,
            ),
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
      };
      onSelect({
        policyId: detail.policyId,
        policyNumber: detail.policyNumber ?? String(detail.policyId),
        extraAttributes: (detail.extraAttributes ?? {}) as Record<string, unknown>,
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
      <div className="space-y-3 p-4">
        <Input
          placeholder="Search by name or record number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-[65vh] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
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
