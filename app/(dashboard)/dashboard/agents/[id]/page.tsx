import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { AgentDetail } from "@/lib/types/agent";
import { formatDDMMYYYYHHMM } from "@/lib/format/date";
import { serverFetch } from "@/lib/auth/server-fetch";

type Agent = AgentDetail;
type AgentStatementRow = {
  id: number;
  invoiceNumber: string;
  status: string;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  policyNumbers: string;
};

async function fetchAgent(id: number): Promise<Agent | null> {
  const res = await serverFetch(`/api/agents/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as Agent;
}

async function fetchAgentStatements(id: number): Promise<AgentStatementRow[]> {
  const res = await serverFetch(`/api/agents/${id}/statements`);
  if (!res.ok) return [];
  const rows = (await res.json()) as AgentStatementRow[];
  return Array.isArray(rows) ? rows : [];
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  const agent = await fetchAgent(agentId);
  const statements = await fetchAgentStatements(agentId);
  const fmtMoney = (cents: number, ccy: string) =>
    new Intl.NumberFormat("en-HK", { style: "currency", currency: ccy || "HKD", minimumFractionDigits: 2 }).format((Number(cents) || 0) / 100);

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
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Agent Statements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {statements.length === 0 ? (
            <div className="text-neutral-600 dark:text-neutral-400">No agent statements yet.</div>
          ) : (
            statements.map((s) => (
              <div key={s.id} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono text-xs">{s.invoiceNumber}</div>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    {String(s.status || "").replace(/_/g, " ")}
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {s.policyNumbers || "—"}
                </div>
                <div className="mt-1 text-xs">
                  {fmtMoney(s.totalAmountCents, s.currency)} total
                  {s.paidAmountCents > 0 ? ` · ${fmtMoney(s.paidAmountCents, s.currency)} paid` : ""}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}

