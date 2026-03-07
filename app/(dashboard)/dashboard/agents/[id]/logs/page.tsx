import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDDMMYYYYHHMM } from "@/lib/format/date";
import { serverFetch } from "@/lib/auth/server-fetch";

type LogEntry = {
  at: string;
  type: string;
  message: string;
  meta?: Record<string, unknown>;
};

async function fetchLogs(id: number): Promise<LogEntry[]> {
  const res = await serverFetch(`/api/agents/${id}/logs`);
  if (!res.ok) return [];
  return (await res.json()) as LogEntry[];
}

export default async function AgentLogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  const logs = await fetchLogs(agentId);

  return (
    <main className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Agent Logs</h1>
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/agents/${agentId}`}>
            <Button variant="secondary">Back to Details</Button>
          </Link>
          <Link href="/dashboard/agents">
            <Button>Agents</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              No logs.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
              {logs.map((l, idx) => (
                <li key={idx} className="py-2 flex items-start gap-3">
                  <div className="w-44 shrink-0 text-neutral-500 dark:text-neutral-400">{formatDDMMYYYYHHMM(l.at)}</div>
                  <div className="flex-1">
                    <div className="font-medium capitalize">{l.type}</div>
                    <div className="text-neutral-700 dark:text-neutral-200">{l.message}</div>
                    {l.meta ? (
                      <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                        {JSON.stringify(l.meta, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

