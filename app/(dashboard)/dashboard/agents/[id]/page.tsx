import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AgentDetail } from "@/lib/types/agent";
import { formatDDMMYYYYHHMM } from "@/lib/format/date";
import { serverFetch } from "@/lib/auth/server-fetch";

type Agent = AgentDetail;

async function fetchAgent(id: number): Promise<Agent | null> {
  const res = await serverFetch(`/api/agents/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as Agent;
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  const agent = await fetchAgent(agentId);

  return (
    <main className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Agent Details</h1>
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/agents/${agentId}/logs`}>
            <Button variant="secondary">View Logs</Button>
          </Link>
          <Link href="/dashboard/agents">
            <Button>Back to Agents</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {agent ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500 dark:text-neutral-400">Agent No.</div>
                <div className="col-span-2">
                  <span className={agent.isActive ? "text-green-600 dark:text-green-400 font-mono" : "text-neutral-500 dark:text-neutral-400 font-mono"}>
                    {agent.userNumber ?? "—"}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500 dark:text-neutral-400">Name</div>
                <div className="col-span-2">{agent.name ?? "—"}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500 dark:text-neutral-400">Email</div>
                <div className="col-span-2">{agent.email}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500 dark:text-neutral-400">Role</div>
                <div className="col-span-2 capitalize">{agent.userType}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500 dark:text-neutral-400">Status</div>
                <div className="col-span-2">{agent.isActive ? "Active" : "Inactive"}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500 dark:text-neutral-400">Created</div>
                <div className="col-span-2">{formatDDMMYYYYHHMM(agent.createdAt)}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-neutral-500 dark:text-neutral-400">Updated</div>
                <div className="col-span-2">{agent.updatedAt ? formatDDMMYYYYHHMM(agent.updatedAt) : "—"}</div>
              </div>
            </>
          ) : (
            <div className="text-neutral-600 dark:text-neutral-400">Not found or no access.</div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

