"use client";

import * as React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailsButton } from "@/components/ui/details-button";
import { RecordDetailsDrawer } from "@/components/ui/record-details-drawer";
import type { AgentDetail } from "@/lib/types/agent";
import { formatDDMMYYYYHHMM } from "@/lib/format/date";

type Row = {
  id: number;
  userNumber: string | null;
  email: string;
  name: string | null;
  isActive: boolean;
  createdAt: string;
};

type LogEntry = { at: string; type: string; message: string; meta?: Record<string, unknown> };

function AgentLogPanel({ agentId }: { agentId: number }) {
  const [logs, setLogs] = React.useState<LogEntry[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/agents/${agentId}/logs`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => { if (!cancelled) setLogs(Array.isArray(j) ? (j as LogEntry[]) : []); })
      .catch(() => { if (!cancelled) setLogs([]); });
    return () => { cancelled = true; };
  }, [agentId]);

  if (!logs) {
    return <div className="text-neutral-500 dark:text-neutral-400">Loading…</div>;
  }
  if (logs.length === 0) {
    return <div className="text-neutral-500 dark:text-neutral-400">No logs.</div>;
  }
  return (
    <div className="space-y-2">
      {logs.map((l, i) => (
        <div key={`log-${i}`} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
          <div className="mb-1 flex items-center justify-between">
            <div className="font-medium">{formatDDMMYYYYHHMM(l.at)}</div>
            <div className="text-neutral-500 dark:text-neutral-400 capitalize">{l.type}</div>
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
  );
}

export default function AgentsTableClient({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = React.useState<Row[]>(initialRows);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [openingId, setOpeningId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<AgentDetail | null>(null);

  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setOpenId(null), 250);
  }

  async function openDetails(id: number) {
    setOpenId(id);
    setDetail(null);
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  <span className="font-medium">{r.name ?? "—"}</span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">{r.email}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <DetailsButton
                    onClick={() => openDetails(r.id)}
                    loading={openingId === r.id}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <RecordDetailsDrawer
        open={openId !== null}
        drawerOpen={drawerOpen}
        onClose={closeDrawer}
        title="Agent Details"
        loading={!detail}
        logContent={openId !== null ? <AgentLogPanel agentId={openId} /> : undefined}
      >
        {detail ? (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Agent No.</div>
              <div className="font-mono">{detail.userNumber ?? "—"}</div>
            </div>
            <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="mb-1 text-sm font-medium">Details</div>
              <div className="grid grid-cols-1 gap-1">
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Name</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.name ?? "—"}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Email</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.email}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Role</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right capitalize">{detail.userType}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Status</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.isActive ? "Active" : "Inactive"}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Created</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{formatDDMMYYYYHHMM(detail.createdAt)}</div>
                </div>
                <div className="flex items-start justify-between gap-3 text-xs">
                  <div className="text-neutral-500 dark:text-neutral-400">Updated</div>
                  <div className="max-w-[60%] wrap-break-word font-mono text-right">{detail.updatedAt ? formatDDMMYYYYHHMM(detail.updatedAt) : "—"}</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-neutral-500 dark:text-neutral-400">No details.</div>
        )}
      </RecordDetailsDrawer>
    </div>
  );
}

