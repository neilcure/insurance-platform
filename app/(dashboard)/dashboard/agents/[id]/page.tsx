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
  invoiceType?: string | null;
  direction?: string | null;
  status: string;
  totalAmountCents: number;
  paidAmountCents: number;
  currency: string;
  policyNumbers: string;
  policyId?: number | null;
};

async function fetchAgent(id: number): Promise<Agent | null> {
  const res = await serverFetch(`/api/agents/${id}`);
  if (!res.ok) return null;
  return (await res.json()) as Agent;
}

async function fetchAgentStatements(id: number): Promise<AgentStatementRow[]> {
  const res = await serverFetch(`/api/agents/${id}/statements`);
  if (!res.ok) return [];
  const json = await res.json();
  const rows = Array.isArray(json) ? json : (json as { rows?: unknown[] }).rows ?? [];
  return Array.isArray(rows) ? (rows as AgentStatementRow[]) : [];
}

type StatementSummary = {
  activeTotal: number;
  paidIndividuallyTotal: number;
  commissionTotal: number;
};

async function fetchStatementSummary(policyId: number): Promise<StatementSummary | null> {
  try {
    const res = await serverFetch(`/api/accounting/statements/by-policy/${policyId}?audience=agent`);
    if (!res.ok) return null;
    const json = await res.json();
    const s = json.statement;
    if (!s) return null;
    return {
      activeTotal: Number(s.activeTotal) || 0,
      paidIndividuallyTotal: Number(s.paidIndividuallyTotal) || 0,
      commissionTotal: Number((s.summaryTotals as Record<string, number> | undefined)?.commissionTotal) || 0,
    };
  } catch {
    return null;
  }
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  const agent = await fetchAgent(agentId);
  const statements = await fetchAgentStatements(agentId);
  const individualStatements = statements.filter((s) => String(s.invoiceType || "") !== "statement");
  const firstPolicyId = individualStatements.find((s) => Number(s.policyId) > 0)?.policyId;
  const summary = firstPolicyId ? await fetchStatementSummary(Number(firstPolicyId)) : null;
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
          {individualStatements.length === 0 && !summary ? (
            <div className="text-neutral-600 dark:text-neutral-400">No agent statements yet.</div>
          ) : (
            <>
              {summary && (
                <div className="rounded-md border border-indigo-200 bg-indigo-50 p-2 dark:border-indigo-800 dark:bg-indigo-950/30">
                  {(() => {
                    const totalDue = summary.activeTotal + summary.paidIndividuallyTotal;
                    const outstanding = totalDue - summary.paidIndividuallyTotal - summary.commissionTotal;
                    const ccy = individualStatements[0]?.currency || "HKD";
                    return (
                      <div className="space-y-0.5 text-xs">
                        <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400">
                          <span>Total Due</span>
                          <span className="font-semibold">{fmtMoney(totalDue, ccy)}</span>
                        </div>
                        {summary.paidIndividuallyTotal > 0 && (
                          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400">
                            <span>Paid Individually</span>
                            <span>−{fmtMoney(summary.paidIndividuallyTotal, ccy)}</span>
                          </div>
                        )}
                        {summary.commissionTotal > 0 && (
                          <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
                            <span>Less commission</span>
                            <span>−{fmtMoney(summary.commissionTotal, ccy)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between font-medium pt-1 border-t border-indigo-200/60 dark:border-indigo-700/60">
                          <span>Outstanding</span>
                          <span className="font-bold">{fmtMoney(outstanding, ccy)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              {individualStatements.map((s) => {
                const isPayable = String(s.direction || "") === "payable";
                return (
                  <div key={s.id} className={`rounded-md border p-2 ${isPayable ? "border-amber-200 dark:border-amber-800" : "border-neutral-200 dark:border-neutral-800"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-mono text-xs">{s.invoiceNumber}</div>
                      <div className="flex items-center gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isPayable ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300"}`}>
                          {isPayable ? "Payable" : "Receivable"}
                        </span>
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                          {String(s.status || "").replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {s.policyNumbers || "—"}
                    </div>
                    <div className="mt-1 text-xs">
                      {isPayable ? "−" : ""}{fmtMoney(s.totalAmountCents, s.currency)}
                      {s.paidAmountCents > 0 ? ` · ${fmtMoney(s.paidAmountCents, s.currency)} paid` : ""}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

