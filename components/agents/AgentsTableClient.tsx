"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info, Loader2, X } from "lucide-react";

type Row = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
};

type AgentDetail = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  userType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
};

type LogEntry = { at: string; type: string; message: string; meta?: Record<string, unknown> };

export default function AgentsTableClient({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = React.useState<Row[]>(initialRows);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [openingId, setOpeningId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<AgentDetail | null>(null);
  const [logs, setLogs] = React.useState<LogEntry[] | null>(null);
  const [auditOpen, setAuditOpen] = React.useState(false);
  const [auditDrawerOpen, setAuditDrawerOpen] = React.useState(false);

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setOpenId(null), 250);
  }

  async function openDetails(id: number) {
    setOpenId(id);
    setDetail(null);
    setLogs(null);
    setAuditOpen(false);
    setAuditDrawerOpen(false);
    setOpeningId(id);
    try {
      const res = await fetch(`/api/agents/${id}`, { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as AgentDetail;
        setDetail(d);
      }
    } finally {
      setOpeningId(null);
      setDrawerOpen(false);
      requestAnimationFrame(() => setDrawerOpen(true));
    }
  }

  function openAudit() {
    setAuditOpen(true);
    // fetch logs lazily
    if (openId !== null && !logs) {
      fetch(`/api/agents/${openId}/logs`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : []))
        .then((j) => setLogs(Array.isArray(j) ? (j as LogEntry[]) : []))
        .catch(() => setLogs([]))
        .finally(() => requestAnimationFrame(() => setAuditDrawerOpen(true)));
    } else {
      requestAnimationFrame(() => setAuditDrawerOpen(true));
    }
  }
  function closeAudit() {
    setAuditDrawerOpen(false);
    setTimeout(() => setAuditOpen(false), 400);
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent No.</TableHead>
            <TableHead>Name / Email</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                <span className={r.isActive ? "text-green-600 dark:text-green-400" : "text-neutral-500 dark:text-neutral-400"}>
                  {r.userNumber ?? "—"}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.name ?? "—"}</span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{r.email}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openDetails(r.id)}
                    disabled={openingId === r.id}
                    aria-busy={openingId === r.id}
                    className="inline-flex items-center gap-2 transition-transform active:scale-95"
                  >
                    {openingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Info className="h-4 w-4" />}
                    {openingId === r.id ? "Opening…" : "Details"}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

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
              <div className="font-semibold">Agent Details</div>
              <Button size="iconCompact" variant="ghost" onClick={closeDrawer} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3 text-sm">
              {detail ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">Overview</div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={openAudit}>
                        Log
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-neutral-500">Agent No.</div>
                    <div className="font-mono">{detail.userNumber ?? "—"}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-xs text-neutral-500">Name</div>
                      <div>{detail.name ?? "—"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-neutral-500">Email</div>
                      <div className="font-mono">{detail.email}</div>
                    </div>
                    <div>
                      <div className="text-xs text-neutral-500">Role</div>
                      <div className="capitalize">{detail.userType}</div>
                    </div>
                    <div>
                      <div className="text-xs text-neutral-500">Status</div>
                      <div>{detail.isActive ? "Active" : "Inactive"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-neutral-500">Created</div>
                      <div className="font-mono">{new Date(detail.createdAt).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-neutral-500">Updated</div>
                      <div className="font-mono">{detail.updatedAt ? new Date(detail.updatedAt).toLocaleString() : "—"}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-neutral-500">Loading...</div>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {auditOpen ? (
        <div className="fixed inset-0 z-60 pointer-events-none">
          <div className="pointer-events-auto absolute inset-0" onClick={closeAudit} aria-label="Close log panel" />
          <aside
            className={`pointer-events-auto absolute right-0 top-0 h-full w-[300px] sm:w-[360px] md:w-[420px] bg-white dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-400 ease-in-out will-change-transform ${
              auditDrawerOpen ? "translate-x-0" : "translate-x-full"
            }`}
          >
            <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
              <div className="font-semibold">Activity Log</div>
              <Button size="iconCompact" variant="ghost" onClick={closeAudit} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3 text-xs">
              {Array.isArray(logs) ? (
                logs.length === 0 ? (
                  <div className="text-neutral-500">No logs.</div>
                ) : (
                  <div className="space-y-2">
                    {logs.map((l, i) => (
                      <div key={`log-${i}`} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="font-medium">{new Date(l.at).toLocaleString()}</div>
                          <div className="text-neutral-500 capitalize">{l.type}</div>
                        </div>
                        <div>{l.message}</div>
                        {l.meta ? (
                          <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-[11px] leading-snug text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                            {JSON.stringify(l.meta, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-neutral-500">Loading…</div>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

