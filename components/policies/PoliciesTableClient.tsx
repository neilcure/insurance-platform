"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { X, Trash2, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PolicySnapshotView } from "@/components/policies/PolicySnapshotView";

type Row = {
  policyId: number;
  policyNumber: string;
  createdAt: string;
};

type PackagesSnapshot = Record<
  string,
  | { category?: string | number | boolean; values?: Record<string, unknown> }
  | Record<string, unknown>
>;

type PolicyDetail = {
  policyNumber: string;
  createdAt: string;
  extraAttributes?: {
    packagesSnapshot?: PackagesSnapshot;
    [key: string]: unknown;
  };
  client?: { id: number; clientNumber: string; createdAt?: string };
  agent?: { id: number; userNumber?: string | null; name?: string | null; email?: string };
  plateNumber?: string;
  plateNo?: string;
  plate?: string;
  make?: string;
  model?: string;
  year?: string | number;
};

export default function PoliciesTableClient({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = React.useState<Row[]>(initialRows);
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<PolicyDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [openingId, setOpeningId] = React.useState<number | null>(null);
  // Sorting
  const [sortKey, setSortKey] = React.useState<"createdAt" | "policyNumber">("createdAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  

  const sorted = React.useMemo(() => {
    const r = [...rows];
    r.sort((a, b) => {
      if (sortKey === "createdAt") {
        const ad = Date.parse(a.createdAt);
        const bd = Date.parse(b.createdAt);
        const cmp = (Number.isFinite(ad) ? ad : 0) - (Number.isFinite(bd) ? bd : 0);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const cmp = a.policyNumber.localeCompare(b.policyNumber, undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [rows, sortKey, sortDir]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => r.policyNumber.toLowerCase().includes(q));
  }, [sorted, query]);

  async function openDetails(id: number) {
    setOpenId(id);
    setDetail(null);
    setLoading(true);
    // Mount closed first so the transition to open is visible
    setDrawerOpen(false);
    // Ensure the drawer is in the DOM before starting the animation
    requestAnimationFrame(() => setDrawerOpen(true));
    setOpeningId(id);
    try {
      const res = await fetch(`/api/policies/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setDetail(json);
    } catch (err: unknown) {
      const message = (err as { message?: string } | undefined)?.message ?? "Failed to load details";
      toast.error(message);
      setDrawerOpen(false);
      setTimeout(() => setOpenId(null), 250);
    } finally {
      setLoading(false);
      setOpeningId(null);
    }
  }

  // Open details automatically when policyId is provided via query string
  React.useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const raw = sp.get("policyId") ?? sp.get("open") ?? sp.get("id");
      const id = Number(raw);
      if (Number.isFinite(id) && id > 0) {
        void openDetails(id);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setOpenId(null), 250);
  }

  async function remove(id: number) {
    const ok = window.confirm("Delete this policy? This cannot be undone.");
    if (!ok) return;
    try {
      const res = await fetch(`/api/policies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setRows((r) => r.filter((x) => x.policyId !== id));
      toast.success("Deleted");
      if (openId === id) closeDrawer();
    } catch (err: unknown) {
      const message = (err as { message?: string } | undefined)?.message ?? "Delete failed";
      toast.error(message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search policies..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button variant="secondary" onClick={() => setQuery((q) => q)}>
          Search
        </Button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label className="text-neutral-500">Sort</label>
          <select
            className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
          >
            <option value="createdAt">Created</option>
            <option value="policyNumber">Policy #</option>
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="h-9"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Policy #</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.policyId}>
              <TableCell className="font-mono">{r.policyNumber}</TableCell>
              <TableCell className="font-mono">
                {(() => {
                  const d = new Date(r.createdAt);
                  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
                })()}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openDetails(r.policyId)}
                    disabled={openingId === r.policyId}
                    aria-busy={openingId === r.policyId}
                    className="inline-flex items-center gap-2 transition-transform active:scale-95"
                  >
                    {openingId === r.policyId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Info className="h-4 w-4" />}
                    {openingId === r.policyId ? "Opening…" : "Details"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r.policyId)} className="inline-flex items-center gap-2">
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Slide-over from the left */}
      {openId !== null ? (
        <div className="fixed inset-0 z-50">
          <div
            className={`absolute inset-0 bg-black transition-opacity duration-300 ${drawerOpen ? "opacity-60" : "opacity-0"}`}
            onClick={closeDrawer}
          />
          <aside
            className={`absolute left-0 top-0 h-full w-[280px] sm:w-[320px] md:w-[380px] bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-300 ease-out will-change-transform ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
              <div className="font-semibold">Policy Details</div>
              <Button size="iconCompact" variant="ghost" onClick={closeDrawer} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="overflow-y-auto p-3 text-sm" style={{ maxHeight: "calc(100vh - 52px)" }}>
              {loading ? (
                <div className="text-neutral-500">Loading...</div>
              ) : detail ? (
                <PolicySnapshotView detail={detail} />
              ) : (
                <div className="text-neutral-500">No details.</div>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}


